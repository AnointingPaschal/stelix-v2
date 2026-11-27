/**
 * Admin chain registry — wallet-side fetch + merge library.
 *
 * NEW FILE (2026-11-27). This is the ONLY wallet-side piece of the
 * "add chains in the future" feature. It does NOT replace the built-in
 * registry in `./chains` (CHAINS / ACTIVE_CHAINS) and it does NOT wire
 * itself into any screen: the coordinator integrates it afterwards by
 * calling `fetchAdminChains()` once at startup and passing the result
 * through `mergeAdminChains(CHAINS, remote)` before deriving the active
 * list. Until that integration lands, the app behaves exactly as before.
 *
 * Contract:
 * - `fetchAdminChains()` reads GET /api/chains on the admin
 *   (https://stelix-admin.pages.dev by default, overridable with
 *   EXPO_PUBLIC_ADMIN_API_URL). The endpoint is public (read-only) —
 *   chain writes stay behind the admin login.
 * - On ANY failure — offline, non-200, bad JSON, wrong shape — it
 *   returns `null` and the wallet keeps working with its built-in
 *   registry. It never throws and never invents a chain.
 * - Results are cached in memory for 5 minutes; `clearAdminChainsCache()`
 *   exists for tests and for a manual refresh.
 * - `mergeAdminChains(builtIn, remote)` returns the built-in list with
 *   remote rows overlaid. Matching is by slug (`id`), falling back to
 *   EVM chain id. For a match, a remote field wins ONLY when the remote
 *   row actually provides a usable value — an empty remote value never
 *   blanks out a verified built-in value (e.g. the D1 seed stores an
 *   empty stablecoin address for most chains; the wallet keeps the
 *   verified built-in address instead). The remote `active` flag DOES
 *   win when present: that is the admin enable/disable toggle.
 * - Remote-only chains are appended as new entries marked
 *   `fromAdmin: true`, in remote order, after the built-ins.
 * - `remote === null` (fetch failed) returns a copy of `builtIn`
 *   unchanged: built-in chains never disappear because the API failed.
 *
 * Honest-limits note — read this before wiring the merged list into a
 * screen: a chain listed this way appears in the picker / Discover /
 * Swap, but its vault and DEX router still need verified contract
 * addresses before locks or swaps go live on it. The admin stores those
 * addresses ONLY when pasted from the explorer (never guessed), and the
 * wallet must show "vault not deployed / router not verified" for such a
 * chain instead of letting the user start a lock or a swap on it. The
 * merged entry carries `vaultContract` (null until registered); the DEX
 * router address is NOT part of `ChainConfig`, so swap code must read it
 * from the admin row directly if it ever needs it — do not guess one.
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
export const ADMIN_CHAINS_CACHE_TTL_MS = 5 * 60 * 1000;
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

let cachedRows: AdminChainRow[] | null = null;
let cachedAt = 0;

/** Test / manual-refresh escape hatch for the in-memory cache. */
export function clearAdminChainsCache(): void {
  cachedRows = null;
  cachedAt = 0;
}

/**
 * Fetch the admin chain registry. Returns the rows on success, or `null`
 * on ANY failure (offline, HTTP error, bad JSON, unexpected shape).
 * Never throws — the wallet must keep working with its built-in registry.
 */
export async function fetchAdminChains(opts?: { forceRefresh?: boolean }): Promise<AdminChainRow[] | null> {
  if (!opts?.forceRefresh && cachedRows !== null && Date.now() - cachedAt < ADMIN_CHAINS_CACHE_TTL_MS) {
    return cachedRows;
  }
  const url = `${getAdminApiBase()}/api/chains`;
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
    const rows = ((body as { chains: unknown[] }).chains).filter(isValidRow);
    cachedRows = rows;
    cachedAt = Date.now();
    return rows;
  } catch {
    // Offline, timeout, bad JSON, no fetch — fall back silently.
    return null;
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
 *   unchanged — built-in chains never disappear because the API failed.
 * - Matching remote rows overlay display fields on the built-in entry
 *   (remote wins where it provides a value; see `overlayBuiltIn`).
 * - Remote-only rows are appended as new entries with `fromAdmin: true`.
 * - Invalid remote rows (no slug/name, no usable https RPC, EVM chain
 *   without a numeric chain id) are skipped, never fatal.
 */
export function mergeAdminChains(builtIn: ChainConfig[], remote: AdminChainRow[] | null): AdminMergedChain[] {
  if (!remote || !Array.isArray(remote)) return builtIn.map((c) => ({ ...c }));
  const valid = remote.filter(isValidRow);
  const remoteIsDefault = valid.find((r) => asBool(r.is_default) === true)?.id ?? null;
  const bySlug = new Map(valid.map((r) => [r.id, r]));
  const byChainId = new Map<number, AdminChainRow>();
  for (const r of valid) {
    if (typeof r.chain_id === 'number' && r.chain_id > 0 && !byChainId.has(r.chain_id)) byChainId.set(r.chain_id, r);
  }
  const merged: AdminMergedChain[] = builtIn.map((c) => {
    const match = bySlug.get(c.id) ?? (typeof c.chainId === 'number' ? byChainId.get(c.chainId) : undefined);
    return match ? overlayBuiltIn(c, match, remoteIsDefault) : { ...c, isDefault: remoteIsDefault !== null ? false : c.isDefault };
  });
  const seen = new Set(builtIn.map((c) => c.id));
  for (const r of valid) {
    if (seen.has(r.id)) continue;
    if (typeof r.chain_id === 'number' && r.chain_id > 0 && builtIn.some((c) => c.chainId === r.chain_id)) continue;
    const extra = remoteOnlyChain(r, remoteIsDefault);
    if (extra) {
      merged.push(extra);
      seen.add(r.id);
    }
  }
  return merged;
}
