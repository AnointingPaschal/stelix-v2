/**
 * Admin chain registry — wallet-side fetch + merge library.
 *
 * The wallet polls the admin's GET /api/sync (see ./adminSync) for the
 * whole admin state; `fetchAdminChains()` below reads the chains section
 * of that same endpoint. This is LIVE POLLING, not push: the poll runs
 * every ~45s while the app is open, on foreground, on network-picker
 * open and on pull-to-refresh (see store/AppContext.tsx).
 *
 * There is deliberately NO time-based cache any more: the old 5-minute
 * cache hid admin edits. Only concurrent duplicate calls share one
 * in-flight request.
 *
 * Contract:
 * - `fetchAdminChains()` reads GET /api/sync on the admin
 *   (https://stelix-admin.pages.dev by default, overridable with
 *   EXPO_PUBLIC_ADMIN_API_URL). The endpoint is public (read-only) —
 *   chain writes stay behind the admin login.
 * - On ANY failure — offline, non-200, bad JSON, wrong shape — it
 *   returns `null` and the wallet keeps working with its built-in
 *   registry. It never throws and never invents a chain.
 * - `mergeAdminChains(builtIn, remote, opts)` returns the built-in list
 *   with remote rows overlaid. Matching is by slug (`id`), falling back to
 *   EVM chain id. For a match, a remote field wins ONLY when the remote
 *   row actually provides a usable value — an empty remote value never
 *   blanks out a verified built-in value (e.g. the D1 seed stores an
 *   empty stablecoin address for most chains; the wallet keeps the
 *   verified built-in address instead). The remote `active` flag DOES
 *   win when present: that is the admin enable/disable toggle.
 * - Remote-only chains are appended as new entries marked
 *   `fromAdmin: true`, in remote order, after the built-ins.
 * - `opts.deletedIds` are the server tombstones: a slug in there is
 *   dropped even if it is a built-in chain. A deleted admin chain must
 *   NEVER be resurrected from the built-in fallback. Pass the persisted
 *   tombstones (see ./adminSync loadPersistedAdminChainState) when the
 *   fetch failed (`remote === null`), so a deleted chain stays deleted
 *   while the API is down.
 * - `opts.disabledIds` are the last-seen admin-disabled chain ids. They
 *   apply only when `remote === null` (when the fetch succeeds the remote
 *   rows are authoritative); a built-in chain the admin disabled stays
 *   disabled while the API is down.
 * - `remote === null` (fetch failed) with no opts returns a copy of
 *   `builtIn` unchanged: built-in chains never disappear because the
 *   API failed — except the ones the admin deleted or disabled, which
 *   the persisted opts above keep gone.
 *
 * Honest-limits note — read this before wiring the merged list into a
 * screen: a chain listed this way appears in the picker / Discover /
 * Swap, but its vault and DEX router still need verified contract
 * addresses before locks or swaps go live on it. The admin stores those
 * addresses ONLY when pasted from the explorer (never guessed), and the
 * wallet must show "vault not deployed / router not verified" for such a
 * chain instead of letting the user start a lock or a swap on it. The
 * merged entry carries `vaultContract` (null until registered) and
 * `dexRouter` (null until registered) from the admin row.
 */

import type { ChainConfig } from './chains';

/** One row of GET /api/chains, as stored in D1 (snake_case). */
export interface AdminChainRow {
  id: string;
  name: string;
  chain_id: number | null;
  rpc_urls: string;
  explorer_url: string;
  native_token: string;
  native_decimals?: number | null;
  stablecoin: string;
  stablecoin_address?: string | null;
  stablecoin_decimals?: number | null;
  gas_token?: string | null;
  dex_router?: string | null;
  vault_address?: string | null;
  status?: string;
  is_default?: number | boolean | null;
  is_testnet?: number | boolean | null;
  active?: number | boolean | null;
  paired_chain_id?: string | null;
  launchpad_address?: string | null;
  token_factory_address?: string | null;
}

/** A built-in chain, or a remote-only chain appended from the admin. */
export type AdminMergedChain = ChainConfig & { fromAdmin?: boolean };

export const DEFAULT_ADMIN_API_URL = 'https://stelix-admin.pages.dev';
const FETCH_TIMEOUT_MS = 8000;

/** Base URL of the admin API. Override with EXPO_PUBLIC_ADMIN_API_URL. */
export function getAdminApiBase(): string {
  const fromEnv =
    typeof process !== 'undefined'
      ? (process.env as Record<string, string | undefined>).EXPO_PUBLIC_ADMIN_API_URL
      : undefined;
  const base = (fromEnv ?? '').trim().replace(/\/$/, '');
  return base === '' ? DEFAULT_ADMIN_API_URL : base;
}

function asBool(v: number | boolean | null | undefined): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1;
  return undefined;
}

function httpsUrls(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('https://'));
}

function mapRemoteStatus(status: string | undefined, fallback: ChainConfig['status']): ChainConfig['status'] {
  if (status === 'live' || status === 'testnet' || status === 'paused') return status;
  if (status === 'hidden') return 'coming-soon';
  return fallback;
}

function isValidRow(row: unknown): row is AdminChainRow {
  if (typeof row !== 'object' || row === null) return false;
  const r = row as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.trim() !== '' &&
    typeof r.name === 'string' &&
    r.name.trim() !== '' &&
    typeof r.rpc_urls === 'string' &&
    httpsUrls(r.rpc_urls).length > 0 &&
    typeof r.explorer_url === 'string' &&
    r.explorer_url.startsWith('https://')
  );
}

let inflight: Promise<AdminChainRow[] | null> | null = null;

/** Test / manual-refresh escape hatch for the in-flight dedup. */
export function clearAdminChainsCache(): void {
  inflight = null;
}

/**
 * Fetch the admin chain registry (the chains section of GET /api/sync).
 * Returns the rows on success, or `null` on ANY failure (offline, HTTP
 * error, bad JSON, unexpected shape). Never throws — the wallet must keep
 * working with its built-in registry. No time-based cache: every call
 * hits the server (only concurrent calls share one request).
 */
export async function fetchAdminChains(): Promise<AdminChainRow[] | null> {
  if (inflight) return inflight;
  const run = (async (): Promise<AdminChainRow[] | null> => {
    const url = `${getAdminApiBase()}/api/sync`;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) return null;
      const body: unknown = await res.json();
      if (typeof body !== 'object' || body === null || !Array.isArray((body as { chains?: unknown }).chains)) {
        return null;
      }
      return ((body as { chains: unknown[] }).chains).filter(isValidRow);
    } catch {
      // Offline, timeout, bad JSON, no fetch — fall back silently.
      return null;
    }
  })();
  inflight = run;
  try {
    return await run;
  } finally {
    inflight = null;
  }
}

function overlayBuiltIn(builtIn: ChainConfig, remote: AdminChainRow, remoteIsDefault: string | null): AdminMergedChain {
  const rpcUrls = httpsUrls(remote.rpc_urls);
  const stablecoin = remote.stablecoin && remote.stablecoin.trim() !== '' ? remote.stablecoin.trim().toUpperCase() : null;
  const exitStablecoin: ChainConfig['exitStablecoin'] =
    stablecoin === 'USDT' ? 'USDT' : stablecoin === 'USDC' ? 'USDC' : builtIn.exitStablecoin;
  const remoteActive = asBool(remote.active);
  const remoteTestnet = asBool(remote.is_testnet);
  const next: AdminMergedChain = {
    ...builtIn,
    name: remote.name.trim() || builtIn.name,
    // Solana has no EVM chain id in the wallet (chainId null); a remote
    // numeric id must never overwrite that.
    chainId: builtIn.kind === 'solana' ? null : typeof remote.chain_id === 'number' && remote.chain_id > 0 ? remote.chain_id : builtIn.chainId,
    nativeSymbol: remote.native_token && remote.native_token.trim() !== '' ? remote.native_token.trim() : builtIn.nativeSymbol,
    nativeDecimals:
      typeof remote.native_decimals === 'number' && remote.native_decimals >= 0 && remote.native_decimals <= 18
        ? remote.native_decimals
        : builtIn.nativeDecimals,
    exitStablecoin,
    exitStablecoinLabel: `auto-sell to ${exitStablecoin}`,
    // Empty remote address never blanks a verified built-in address, and
    // a 0x EVM address never replaces a Solana base58 mint address.
    exitStablecoinAddress:
      builtIn.kind === 'evm' && remote.stablecoin_address && /^0x[0-9a-fA-F]{40}$/.test(remote.stablecoin_address)
        ? remote.stablecoin_address
        : builtIn.exitStablecoinAddress,
    rpcUrl: rpcUrls[0] ?? builtIn.rpcUrl,
    rpcUrls: rpcUrls.length > 0 ? rpcUrls : builtIn.rpcUrls,
    explorerUrl: remote.explorer_url && remote.explorer_url.trim() !== '' ? remote.explorer_url.trim() : builtIn.explorerUrl,
    vaultContract:
      remote.vault_address && remote.vault_address.trim() !== '' ? remote.vault_address.trim() : builtIn.vaultContract,
    // Admin-registered DEX router (null = not confirmed yet). Only a
    // verified 0x address is carried — blank never blanks a verified
    // built-in router, and never invents one.
    dexRouter:
      remote.dex_router && /^0x[0-9a-fA-F]{40}$/.test(remote.dex_router.trim())
        ? remote.dex_router.trim()
        : builtIn.dexRouter ?? null,
    pairedChainId: remote.paired_chain_id ?? builtIn.pairedChainId ?? null,
    status: mapRemoteStatus(remote.status, builtIn.status),
    testnet: remoteTestnet !== undefined ? remoteTestnet : remote.status === 'testnet' ? true : remote.status === 'live' ? false : builtIn.testnet,
    active: remoteActive !== undefined ? remoteActive : builtIn.active,
    isDefault: remoteIsDefault !== null ? remote.id === remoteIsDefault : builtIn.isDefault,
  };
  return next;
}

function remoteOnlyChain(remote: AdminChainRow, remoteIsDefault: string | null): AdminMergedChain | null {
  const rpcUrls = httpsUrls(remote.rpc_urls);
  if (rpcUrls.length === 0) return null;
  const isSolana = remote.id === 'solana';
  const chainId = isSolana ? null : typeof remote.chain_id === 'number' && remote.chain_id > 0 ? remote.chain_id : null;
  // An EVM chain without a numeric chain id cannot be used on-chain.
  if (!isSolana && chainId === null) return null;
  const stablecoin = remote.stablecoin && remote.stablecoin.trim() !== '' ? remote.stablecoin.trim().toUpperCase() : 'USDC';
  const exitStablecoin: ChainConfig['exitStablecoin'] = stablecoin === 'USDT' ? 'USDT' : 'USDC';
  const nativeSymbol = remote.native_token && remote.native_token.trim() !== '' ? remote.native_token.trim() : stablecoin;
  const nativeDecimals =
    typeof remote.native_decimals === 'number' && remote.native_decimals >= 0 && remote.native_decimals <= 18
      ? remote.native_decimals
      : 18;
  return {
    id: remote.id,
    name: remote.name.trim(),
    chainId,
    kind: isSolana ? 'solana' : 'evm',
    nativeSymbol,
    nativeName: nativeSymbol,
    nativeDecimals,
    exitStablecoin,
    exitStablecoinLabel: `auto-sell to ${exitStablecoin}`,
    // Only a verified 0x address is carried; blank means "not confirmed
    // yet" and the UI must say so — never a guessed address.
    exitStablecoinAddress:
      !isSolana && remote.stablecoin_address && /^0x[0-9a-fA-F]{40}$/.test(remote.stablecoin_address)
        ? remote.stablecoin_address
        : null,
    rpcUrl: rpcUrls[0],
    rpcUrls,
    explorerUrl: remote.explorer_url.trim(),
    explorerApiUrl: null,
    dexScreenerChainId: remote.id,
    geckoTerminalNetwork: remote.id,
    dex: 'Admin registry',
    vaultContract: remote.vault_address && remote.vault_address.trim() !== '' ? remote.vault_address.trim() : null,
    dexRouter:
      remote.dex_router && /^0x[0-9a-fA-F]{40}$/.test(remote.dex_router.trim()) ? remote.dex_router.trim() : null,
    pairedChainId: remote.paired_chain_id ?? null,
    status: mapRemoteStatus(remote.status, 'coming-soon'),
    isDefault: remoteIsDefault !== null ? remote.id === remoteIsDefault : false,
    testnet: asBool(remote.is_testnet) ?? remote.status === 'testnet',
    active: asBool(remote.active) ?? true,
    fromAdmin: true,
  };
}

/**
 * Merge the admin registry over the built-in registry.
 *
 * - `remote === null` (fetch failed): returns a copy of `builtIn`
 *   unchanged — built-in chains never disappear because the API failed —
 *   EXCEPT the ids in `opts.deletedIds` (tombstones) which are dropped,
 *   and the ids in `opts.disabledIds` which are forced `active: false`.
 *   Pass the persisted tombstones/disabled ids (see ./adminSync) so a
 *   deleted or disabled chain stays gone while the API is down.
 * - Matching remote rows overlay display fields on the built-in entry
 *   (remote wins where it provides a value; see `overlayBuiltIn`).
 * - Remote-only rows are appended as new entries with `fromAdmin: true`,
 *   unless their slug is tombstoned.
 * - Invalid remote rows (no slug/name, no usable https RPC, EVM chain
 *   without a numeric chain id) are skipped, never fatal.
 */
export function mergeAdminChains(
  builtIn: ChainConfig[],
  remote: AdminChainRow[] | null,
  opts?: { deletedIds?: string[]; disabledIds?: string[] },
): AdminMergedChain[] {
  const deleted = new Set(opts?.deletedIds ?? []);
  const disabled = new Set(opts?.disabledIds ?? []);
  if (!remote || !Array.isArray(remote)) {
    return builtIn
      .filter((c) => !deleted.has(c.id))
      .map((c) => ({ ...c, active: disabled.has(c.id) ? false : c.active }));
  }
  const valid = remote.filter(isValidRow);
  const remoteIsDefault = valid.find((r) => asBool(r.is_default) === true)?.id ?? null;
  const bySlug = new Map(valid.map((r) => [r.id, r]));
  const byChainId = new Map<number, AdminChainRow>();
  for (const r of valid) {
    if (typeof r.chain_id === 'number' && r.chain_id > 0 && !byChainId.has(r.chain_id)) byChainId.set(r.chain_id, r);
  }
  const merged: AdminMergedChain[] = builtIn
    .filter((c) => !deleted.has(c.id))
    .map((c) => {
      const match = bySlug.get(c.id) ?? (typeof c.chainId === 'number' ? byChainId.get(c.chainId) : undefined);
      return match ? overlayBuiltIn(c, match, remoteIsDefault) : { ...c, isDefault: remoteIsDefault !== null ? false : c.isDefault };
    });
  const seen = new Set(builtIn.map((c) => c.id));
  for (const r of valid) {
    if (seen.has(r.id) || deleted.has(r.id)) continue;
    if (typeof r.chain_id === 'number' && r.chain_id > 0 && builtIn.some((c) => c.chainId === r.chain_id)) continue;
    const extra = remoteOnlyChain(r, remoteIsDefault);
    if (extra) {
      merged.push(extra);
      seen.add(r.id);
    }
  }
  return merged;
}
