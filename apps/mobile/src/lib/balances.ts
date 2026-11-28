/**
 * LIVE balances — real RPC reads only. No placeholder balances.
 *
 * A new wallet has NO tokens: balances start empty and the portfolio is
 * $0.00 until the user receives funds on-chain. The imported-token list
 * is stored locally and is EMPTY by default — the user adds tokens by
 * address; nothing is pre-seeded.
 *
 * - Native balance: ethers provider.getBalance (per-chain public RPCs,
 *   env-overridable via EXPO_PUBLIC_<CHAIN>_RPC_URL — see chains.ts).
 *   Reads go through getProvider(), an ethers FallbackProvider over ALL
 *   registry RPCs for the chain (quorum 1), so one dead RPC hostname
 *   can no longer break balances / Import Token / send / swap.
 * - ERC-20 balanceOf via a minimal ABI (balanceOf / decimals / symbol / name).
 * - Prices come from prices.ts (DexScreener/CoinGecko) and are labelled
 *   with source + timestamp; a token with no live price has priceUsd null
 *   and contributes $0 to the displayed total (it is still listed).
 *   The same sources populate TokenBalance.change24h (DexScreener h24 /
 *   CoinGecko usd_24h_change); null when unknown, never invented.
 * - Default stablecoins (chain.stablecoins: USDT + USDC, verified
 *   addresses only) are listed alongside native + imported, 0-balance
 *   rows included, like registry rows. On-chain holdings the user never
 *   imported are auto-discovered (Blockscout on Arc, Etherscan tokenlist
 *   elsewhere) and persisted as `discovered` imports.
 * - Solana: SOL + SPL tokens via @solana/web3.js (see lib/solana.ts).
 *   The caller passes the wallet's derived Solana address (stored in the
 *   wallet meta) as `address`; the EVM address is meaningless on Solana.
 *   Restored 2026-11-27 (all chains active again).
 */
import { ethers } from 'ethers';
import { EVM_NATIVE_RPC_DECIMALS, getChain, type ChainConfig } from './chains';
import { fetchDexScreenerToken, fetchMajorPrices } from './prices';
import { fetchSolanaBalances } from './solana';
import { getExplorerApiKeyAsync } from './history';
import { isTokenHidden, loadHiddenTokens } from './importToken';
import { kvDelete, kvGet, kvSet } from './storage';

export const ERC20_MIN_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
] as const;

export interface ImportedToken {
  chainId: string;
  address: string; // ERC-20 contract address (EVM); mint address on Solana
  symbol: string;
  name: string;
  decimals: number;
  coingeckoId?: string;
  /** Logo URL verified at import time (user saw it in the preview card). */
  logoUrl?: string | null;
  /** True when this row came from the admin token registry and the admin
   *  marked it verified — My Assets shows the verified badge. */
  verified?: boolean;
  /** True when this row was auto-discovered on-chain (see discoverTokens)
   *  rather than imported by the user — it persists in the imported list
   *  so it can be toggled off in the import modal like any import. */
  discovered?: boolean;
  /** Admin-set display order (registry rows only); user-imported rows
   *  have none and sort after registry rows, in their saved order. */
  sortOrder?: number;
}

export interface TokenBalance {
  symbol: string;
  name: string;
  chainId: string;
  address: string; // '' for the native asset
  decimals: number;
  balance: number; // spendable, in token units (float for display)
  balanceRaw: string; // exact raw units as a decimal string
  locked: number; // locked amount is filled in by the store from on-chain locks; 0 here
  priceUsd: number | null;
  /** Alias of priceUsd, kept so existing callers reading `.price` keep working. */
  price: number | null;
  /** 24h price change in percent, from the same source as the price
   *  (DexScreener h24 / CoinGecko usd_24h_change). Null = unknown —
   *  never invented. Optional (not required) so existing TokenBalance
   *  literals in other suites keep compiling; fetchBalances always
   *  sets it (null when no source reports a change). */
  change24h?: number | null;
  priceSource: 'dexscreener' | 'coingecko' | 'unavailable';
  priceUpdatedAt: number | null;
  coingeckoId?: string;
  /** Verified logo URL (imported tokens) — null = no logo found anywhere. */
  logoUrl?: string | null;
  /** True when this row shows the verified badge in My Assets.
   *  Native assets and default stablecoins (USDT/USDC/USDT0) are
   *  verified BY DEFAULT — unless the admin registry explicitly
   *  unverifies that address (verified = 0), which overrides the
   *  default. Every other token is verified only when the admin
   *  registry marked it verified. */
  verified?: boolean;
  /** Admin-set display order (registry rows only). */
  sortOrder?: number;
  isSpam: boolean; // true only when flagged by the dust/spam filter (see history.ts)
}

/** A token from the admin Token Registry, as the wallet sync delivers it. */
export interface RegistryTokenInput {
  chainId: string;
  address: string;
  symbol: string;
  name?: string;
  decimals: number;
  logoUrl?: string | null;
  verified: boolean;
  sortOrder: number;
}

/** Merge the admin registry into the user's imported tokens for one chain.
 *  Every registry token for the chain appears in My Assets — in the
 *  admin's order — and a token the user also imported is shown once,
 *  with the registry's (verified) name, symbol, decimals and logo.
 *  User-imported tokens that are not in the registry follow, in their
 *  saved order. Pure function, unit-tested. */
export function mergeRegistryTokens(
  imported: ImportedToken[],
  registry: RegistryTokenInput[],
  chainId: string,
): ImportedToken[] {
  const byAddress = new Map<string, ImportedToken>();
  const orderedRegistry = [...registry]
    .filter((r) => r.chainId === chainId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  for (const r of orderedRegistry) {
    byAddress.set(r.address.toLowerCase(), {
      chainId,
      address: r.address,
      symbol: r.symbol,
      name: r.name ?? r.symbol,
      decimals: r.decimals,
      logoUrl: r.logoUrl ?? null,
      verified: r.verified,
      sortOrder: r.sortOrder,
    });
  }
  for (const t of imported) {
    if (t.chainId !== chainId) continue;
    const key = t.address.toLowerCase();
    if (!byAddress.has(key)) byAddress.set(key, t);
  }
  return [...byAddress.values()];
}

/** The admin registry's verified value for one address on one chain,
 *  or undefined when the registry has no row for that address.
 *  Address match is case-insensitive; other chains never match. */
export function registryVerifiedOverride(
  registry: RegistryTokenInput[],
  chainId: string,
  address: string,
): boolean | undefined {
  const key = address.toLowerCase();
  const row = registry.find((r) => r.chainId === chainId && r.address.toLowerCase() === key);
  return row?.verified;
}

/** Verified-by-default rule for the native asset and the default
 *  stablecoins (USDT / USDC / USDT0): verified UNLESS the admin
 *  registry has a row for this address with verified = false, which
 *  overrides the default and hides the badge. A registry row with
 *  verified = true (or no row at all) keeps the badge. Pure,
 *  unit-tested. */
export function verifiedByDefault(
  registry: RegistryTokenInput[],
  chainId: string,
  address: string,
): boolean {
  return registryVerifiedOverride(registry, chainId, address) !== false;
}

/** Verified-by-default rule for the chain's native asset: verified
 *  unless the admin registry explicitly unverifies the native asset.
 *  The native row has no contract address of its own, so the lookup
 *  also checks the token address the native asset IS on chains where
 *  it has one — Arc's native asset is the USDC token contract
 *  (chain.stablecoins.USDC), so an admin unverifying that USDC row
 *  unverifies the Arc native row too. Every other chain's native
 *  asset has no registry address and is verified by default. Pure,
 *  unit-tested. */
export function nativeAssetVerified(registry: RegistryTokenInput[], chain: ChainConfig): boolean {
  const candidates = [''];
  if (chain.nativeSymbol === 'USDC' && chain.stablecoins?.USDC) {
    candidates.push(chain.stablecoins.USDC);
  }
  for (const address of candidates) {
    if (registryVerifiedOverride(registry, chain.id, address) === false) return false;
  }
  return true;
}

/** P&L on a holding's current value from its 24h change.
 *  value = balance * price; the position 24h ago was worth
 *  value / (1 + change/100), so P&L = value − value/(1+change/100)
 *  = value * change / (100 + change). Null when the change is unknown
 *  or the -100% edge would divide by zero — never an invented number. */
export function calcPnl(valueUsd: number, change24h: number | null | undefined): number | null {
  if (change24h === null || change24h === undefined || !Number.isFinite(change24h)) return null;
  if (100 + change24h === 0) return null;
  return (valueUsd * change24h) / (100 + change24h);
}

/** One holding for the portfolio P&L total: its current USD value, or
 *  null when it has no live price (it cannot contribute a P&L). */
export interface PnlHolding {
  valueUsd: number | null;
  change24h: number | null | undefined;
}

/** Today's P&L for the whole portfolio: the sum of calcPnl over every
 *  holding with a price and a 24h change, plus the return on the
 *  starting value of exactly those holdings — pnl / (value − pnl).
 *  Null pnl/pct when no holding has price data; never an invented
 *  number. Pure, unit-tested. */
export function calcPortfolioPnl(holdings: PnlHolding[]): { pnl: number | null; pct: number | null } {
  let pnl = 0;
  let value = 0;
  let any = false;
  for (const h of holdings) {
    if (h.valueUsd === null) continue;
    const p = calcPnl(h.valueUsd, h.change24h);
    if (p === null) continue;
    any = true;
    pnl += p;
    value += h.valueUsd;
  }
  if (!any) return { pnl: null, pct: null };
  const start = value - pnl;
  return { pnl, pct: start === 0 ? null : (pnl / start) * 100 };
}

// ---------------------------------------------------------------------------
// Auto-discovery — on-chain holdings the user never imported.
// Silent by design: no key / endpoint down / non-EVM chain returns []
// with no error and no user-facing text.
// ---------------------------------------------------------------------------

/** A token found on-chain that the user never imported. */
export interface DiscoveredToken {
  chainId: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string | null;
}

/** Merge discovered tokens into an already-merged (registry + imported)
 *  list for one chain. Precedence: registry wins, then imported, then
 *  discovered — a discovered address already listed is dropped, never
 *  duplicated. Discovered rows are marked `discovered: true` so they
 *  persist in the imported list and can be toggled off. Pure, unit-tested. */
export function mergeDiscoveredTokens(
  imported: ImportedToken[],
  discovered: DiscoveredToken[],
  chainId: string,
): ImportedToken[] {
  const out = [...imported];
  const seen = new Set(
    imported.filter((t) => t.chainId === chainId).map((t) => t.address.toLowerCase()),
  );
  for (const d of discovered) {
    if (d.chainId !== chainId) continue;
    const key = d.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      chainId,
      address: d.address,
      symbol: d.symbol,
      name: d.name,
      decimals: d.decimals,
      logoUrl: d.logoUrl ?? null,
      discovered: true,
    });
  }
  return out;
}

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Pure parser for a Blockscout v2 `/tokens?type=ERC-20` response:
 *  items are { token: { address, symbol, name, decimals }, value }
 *  where value is the raw (unscaled) balance — only balance > 0 rows
 *  are returned. */
export function parseBlockscoutTokenList(json: unknown): DiscoveredToken[] {
  const items: unknown[] = Array.isArray((json as { items?: unknown } | null)?.items)
    ? ((json as { items: unknown[] }).items as unknown[])
    : [];
  const out: DiscoveredToken[] = [];
  for (const item of items) {
    const raw = item as {
      token?: { address?: string; symbol?: string; name?: string; decimals?: string | number };
      value?: string;
    };
    const address = raw?.token?.address;
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) continue;
    let balanceRaw = 0n;
    try {
      balanceRaw = BigInt(raw?.value ?? '0');
    } catch {
      continue;
    }
    if (balanceRaw <= 0n) continue;
    const symbol = raw.token?.symbol ?? `${address.slice(0, 4)}…${address.slice(-4)}`;
    out.push({
      chainId: '',
      address,
      symbol,
      name: raw.token?.name ?? symbol,
      decimals: Number(raw.token?.decimals ?? 18),
    });
  }
  return out;
}

/** Pure parser for an Etherscan-family `tokenlist` response: the
 *  contracts the wallet holds, with their on-chain metadata. Balance
 *  is confirmed separately (balanceOf) — the list alone is not proof
 *  of a current holding. */
export function parseEtherscanTokenList(json: unknown): Omit<DiscoveredToken, 'chainId'>[] {
  const result: unknown[] = Array.isArray((json as { result?: unknown } | null)?.result)
    ? ((json as { result: unknown[] }).result as unknown[])
    : [];
  const seen = new Set<string>();
  const out: Omit<DiscoveredToken, 'chainId'>[] = [];
  for (const r of result) {
    const row = r as {
      contractAddress?: string;
      tokenSymbol?: string;
      tokenName?: string;
      tokenDecimal?: string;
    };
    const address = row?.contractAddress;
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const symbol = row.tokenSymbol ?? `${address.slice(0, 4)}…${address.slice(-4)}`;
    out.push({
      address,
      symbol,
      name: row.tokenName ?? symbol,
      decimals: Number(row.tokenDecimal ?? 18),
    });
  }
  return out;
}

/** Pure parser for an Etherscan-family `tokentx` response: the unique
 *  token contracts the wallet has ever transacted with (a token sold
 *  to zero still appears here — balanceOf filters it out later). */
export function parseEtherscanTokenTx(json: unknown): string[] {
  const result: unknown[] = Array.isArray((json as { result?: unknown } | null)?.result)
    ? ((json as { result: unknown[] }).result as unknown[])
    : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of result) {
    const address = (r as { contractAddress?: string })?.contractAddress;
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) continue;
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }
  return out;
}

export interface DiscoveryDeps {
  fetchFn?: (url: string, ms?: number) => Promise<Response>;
  getApiKey?: () => Promise<string | null>;
  balanceOf?: (tokenAddress: string) => Promise<bigint>;
  resolveMetadata?: (tokenAddress: string) => Promise<{ symbol: string; name: string; decimals: number }>;
}

/** Discover on-chain ERC-20 holdings the user never imported.
 *  Blockscout v2 (keyless) for Arc; Etherscan-family
 *  `tokenlist` (fallback: `tokentx` → unique contracts → balanceOf)
 *  for other EVM chains, using the explorer key from
 *  getExplorerApiKeyAsync(). Only balance > 0. Returns [] on any
 *  failure, missing key, or non-EVM chain — never throws. */
export async function discoverTokens(
  chain: ChainConfig,
  address: string,
  deps: DiscoveryDeps = {},
): Promise<DiscoveredToken[]> {
  if (chain.kind !== 'evm' || chain.chainId === null || !ethers.isAddress(address)) return [];
  const fetchFn = deps.fetchFn ?? fetchWithTimeout;
  try {
    if (chain.id === 'arc-mainnet') {
      const res = await fetchFn(
        `${chain.explorerUrl.replace(/\/$/, '')}/api/v2/addresses/${address}/tokens?type=ERC-20`,
      );
      if (!res.ok) return [];
      return parseBlockscoutTokenList(await res.json()).map((t) => ({ ...t, chainId: chain.id }));
    }
    const apiKey = deps.getApiKey ? await deps.getApiKey() : await getExplorerApiKeyAsync();
    if (!apiKey || !chain.explorerApiUrl) return [];
    const provider = getProvider(chain);
    const balanceOf =
      deps.balanceOf ??
      (async (tokenAddress: string) => {
        const contract = new ethers.Contract(tokenAddress, ERC20_MIN_ABI, provider);
        return (await contract.balanceOf(address)) as bigint;
      });
    const listRes = await fetchFn(
      `${chain.explorerApiUrl}?module=account&action=tokenlist&address=${address}&apikey=${apiKey}`,
    );
    if (listRes.ok) {
      const candidates = parseEtherscanTokenList(await listRes.json());
      if (candidates.length > 0) {
        const out: DiscoveredToken[] = [];
        for (const c of candidates) {
          try {
            if ((await balanceOf(c.address)) > 0n) out.push({ ...c, chainId: chain.id });
          } catch {
            continue;
          }
        }
        return out;
      }
      // tokenlist answered but listed nothing usable — fall through to tokentx.
    }
    const txRes = await fetchFn(
      `${chain.explorerApiUrl}?module=account&action=tokentx&address=${address}&page=1&offset=100&sort=desc&apikey=${apiKey}`,
    );
    if (!txRes.ok) return [];
    const contracts = parseEtherscanTokenTx(await txRes.json());
    const resolve = deps.resolveMetadata ?? ((a: string) => resolveTokenMetadata(chain, a));
    const out: DiscoveredToken[] = [];
    for (const contract of contracts) {
      try {
        if ((await balanceOf(contract)) <= 0n) continue;
        const meta = await resolve(contract);
        out.push({ chainId: chain.id, address: contract, symbol: meta.symbol, name: meta.name, decimals: meta.decimals });
      } catch {
        continue;
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Default stablecoins for a chain (chain.stablecoins, all addresses
 *  verified — see chains.ts), resolved on-chain for symbol/name/decimals
 *  so a wrong registry entry can never invent a row. Skipped when the
 *  token is already listed, when its metadata cannot be read, or when
 *  it IS the native asset (Arc: the native row already is USDC).
 *  Rows are verified BY DEFAULT — unless the admin registry has a row
 *  for that stablecoin address with verified = false, which overrides
 *  the default and hides the badge (see verifiedByDefault). A stable
 *  already listed via the registry keeps the registry's verified
 *  value exactly (mergeRegistryTokens) — this function never sees it.
 *  `deps.resolveMetadata` is an injectable seam for tests; production
 *  resolves on-chain. */
export async function resolveDefaultStables(
  chain: ChainConfig,
  already: ImportedToken[],
  registry: RegistryTokenInput[] = [],
  deps: { resolveMetadata?: (chain: ChainConfig, address: string) => Promise<{ symbol: string; name: string; decimals: number }> } = {},
): Promise<ImportedToken[]> {
  const stables = chain.stablecoins;
  if (!stables) return [];
  const resolve = deps.resolveMetadata ?? resolveTokenMetadata;
  const out: ImportedToken[] = [];
  for (const addr of [stables.USDT, stables.USDC]) {
    if (!addr) continue;
    if (already.some((t) => t.address.toLowerCase() === addr.toLowerCase())) continue;
    try {
      const meta = await resolve(chain, addr);
      if (meta.symbol === chain.nativeSymbol) continue;
      out.push({
        chainId: chain.id,
        address: addr,
        symbol: meta.symbol,
        name: meta.name,
        decimals: meta.decimals,
        verified: verifiedByDefault(registry, chain.id, addr),
      });
    } catch {
      continue; // unreadable stable: skipped, never zero-filled with guessed metadata
    }
  }
  return out;
}

export interface BalancesResult {
  chain: ChainConfig;
  address: string;
  tokens: TokenBalance[];
  totalUsd: number; // sum over tokens with a live price only
  loading: boolean;
  error: string | null;
  updatedAt: number;
}

/** The token rows actually listed on Home: spam hidden unless the user
 *  opted to show it. The "Assets N tokens" header count must equal this
 *  list's length — counting by balance (balance > 0) undercounts, because
 *  0-balance default/imported rows are still listed. */
export function visibleTokens<T extends { isSpam: boolean }>(tokens: T[], showSpam: boolean): T[] {
  return tokens.filter((t) => !t.isSpam || showSpam);
}

/** My Assets display order: the chain's native asset first, then USDT,
 *  then USDC — pinned at the top in that fixed order. Everything else
 *  follows: registry tokens in their admin order (sortOrder), then
 *  imported / discovered tokens in their existing order. A stablecoin
 *  that is also a registry row still pins to the top (its rank wins
 *  over sortOrder), and on Arc the native row already IS USDC, so
 *  there is no second USDC row to pin. Matching is by symbol
 *  (USDT / USDT0 / USDC) or, when the chain config is passed, by the
 *  chain's verified stablecoin addresses — Plasma's USDT0 reads
 *  on-chain as USDT0, so the address match pins it. Pure and stable:
 *  equal ranks keep their input order. Applied in fetchBalances and
 *  again at render, so a cached / differently-ordered list still
 *  displays pinned. */
export function sortMyAssets<T extends TokenBalance>(tokens: T[], chain?: ChainConfig): T[] {
  const usdtAddr = chain?.stablecoins?.USDT?.toLowerCase();
  const usdcAddr = chain?.stablecoins?.USDC?.toLowerCase();
  const rank = (t: T): number => {
    if (t.address === '') return 0; // native asset
    const symbol = t.symbol.toUpperCase();
    const addr = t.address.toLowerCase();
    if (symbol === 'USDT' || symbol === 'USDT0' || (usdtAddr !== undefined && addr === usdtAddr)) return 1;
    if (symbol === 'USDC' || (usdcAddr !== undefined && addr === usdcAddr)) return 2;
    if (t.sortOrder !== undefined) return 3; // registry row, admin order
    return 4; // imported / discovered, existing order
  };
  return tokens
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const r = rank(a.t) - rank(b.t);
      if (r !== 0) return r;
      if (rank(a.t) === 3) {
        const s = (a.t.sortOrder ?? 0) - (b.t.sortOrder ?? 0);
        if (s !== 0) return s;
      }
      return a.i - b.i;
    })
    .map(({ t }) => t);
}

const IMPORTED_TOKENS_KEY = 'stelix_imported_tokens_v2';

/** Imported tokens are per WALLET, not per device: switching wallets
 *  must show that wallet's imports, not the other wallet's. The key is
 *  scoped by the wallet's EVM address (lowercase). The unscoped key is
 *  the legacy single-wallet list — migrateImportedTokensForWallet moves
 *  it to the active wallet once, then deletes it. */
function importedTokensKey(ownerAddress?: string): string {
  return ownerAddress
    ? `${IMPORTED_TOKENS_KEY}:${ownerAddress.toLowerCase()}`
    : IMPORTED_TOKENS_KEY;
}

/** One-time move of the legacy device-wide imported-token list onto the
 *  given wallet (the wallet that was active when multi-wallet landed).
 *  No-op when the wallet already has its own list or nothing was saved. */
export async function migrateImportedTokensForWallet(ownerAddress: string): Promise<void> {
  const scoped = importedTokensKey(ownerAddress);
  try {
    const existing = await kvGet(scoped);
    if (existing) return;
    const legacy = await kvGet(IMPORTED_TOKENS_KEY);
    if (!legacy) return;
    await kvSet(scoped, legacy);
    await kvDelete(IMPORTED_TOKENS_KEY);
  } catch {
    // Best-effort: the legacy list stays readable under its old key.
  }
}

/** NOTE (2026-11-28): the old one-time Arc import migration is
 *  removed. It re-checked legacy 'arc' rows against a hardcoded Arc
 *  testnet RPC, and there is no hardcoded testnet in the app any
 *  more. A legacy row saved with chainId 'arc' simply stays 'arc':
 *  it reappears only if the admin serves an 'arc' chain through the
 *  sync, matched by id to that synced chain — it is never silently
 *  re-attributed to mainnet. */

/** Ordered RPC URLs for a chain: the (env-overridable) primary first,
 *  then the registry fallbacks, de-duplicated. The env override wins
 *  when EXPO_PUBLIC_<CHAIN>_RPC_URL is set — it is already baked into
 *  chain.rpcUrl by chains.ts, so it sorts first here. */
export function getRpcUrls(chain: ChainConfig): string[] {
  const urls = [chain.rpcUrl, ...chain.rpcUrls];
  return [...new Set(urls.filter((u) => typeof u === 'string' && u.startsWith('http')))];
}

/**
 * Provider for an EVM chain, with RPC fallback.
 *
 * The old code used only chain.rpcUrl: when that one hostname died,
 *  every balance / import-token / send / swap read broke.
 * This builds an ethers FallbackProvider over ALL registry RPCs in
 * order (primary first), quorum 1 so a single live RPC is enough, and
 * the default 400 ms stall timeout so a dead primary fails over fast.
 * One dead hostname can no longer break the wallet.
 *
 * Callers keep using it as a normal ethers provider (getBalance, call,
 * estimateGas, getFeeData, signer.connect); the return type is
 * ethers.AbstractProvider because a FallbackProvider is not a
 * JsonRpcProvider. A chain with a single RPC still gets a plain
 * JsonRpcProvider (no fallback overhead).
 *
 * Sub-providers are built with `{ staticNetwork: true }`: the chain id
 * is pinned by the registry, so no eth_chainId detection round-trip is
 * needed — and a dead host's provider would otherwise retry detection
 * every 1s forever (ethers _start loop), spamming the console and
 * leaking a timer per getProvider() call while the host is down. The
 * FallbackProvider still requires all sub-providers to agree on the
 * network (it reads each one's static network at initial sync).
 */
export function getProvider(chain: ChainConfig): ethers.AbstractProvider {
  if (chain.kind !== 'evm' || chain.chainId === null) {
    throw new Error(`${chain.name} is not an EVM chain — use its native RPC client, not ethers.`);
  }
  const chainId: number = chain.chainId;
  const urls = getRpcUrls(chain);
  if (urls.length === 1) {
    return new ethers.JsonRpcProvider(urls[0], chainId, { staticNetwork: true });
  }
  return new ethers.FallbackProvider(
    urls.map((url) => new ethers.JsonRpcProvider(url, chainId, { staticNetwork: true })),
    chainId,
    { quorum: 1 },
  );
}

export async function loadImportedTokens(ownerAddress?: string): Promise<ImportedToken[]> {
  try {
    const raw = await kvGet(importedTokensKey(ownerAddress));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ImportedToken[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveImportedTokens(tokens: ImportedToken[], ownerAddress?: string): Promise<void> {
  await kvSet(importedTokensKey(ownerAddress), JSON.stringify(tokens));
}

export async function addImportedToken(token: ImportedToken, ownerAddress?: string): Promise<ImportedToken[]> {
  const list = await loadImportedTokens(ownerAddress);
  if (
    list.some(
      (t) => t.chainId === token.chainId && t.address.toLowerCase() === token.address.toLowerCase(),
    )
  ) {
    return list;
  }
  const next = [...list, token];
  await saveImportedTokens(next, ownerAddress);
  return next;
}

export async function removeImportedToken(chainId: string, address: string, ownerAddress?: string): Promise<ImportedToken[]> {
  const list = await loadImportedTokens(ownerAddress);
  const next = list.filter(
    (t) => !(t.chainId === chainId && t.address.toLowerCase() === address.toLowerCase()),
  );
  await saveImportedTokens(next, ownerAddress);
  return next;
}

/** Resolve an ERC-20's symbol/name/decimals from chain (used when adding a token by address).
 * EVM-only: on Solana the import sheet must refuse before calling this
 * (SPL tokens are discovered from the wallet's token accounts, not by
 * pasting a mint) — the raw getProvider() error ('not an EVM chain')
 * used to leak into the import preview as a confusing message. */
export async function resolveTokenMetadata(
  chain: ChainConfig,
  address: string,
): Promise<{ symbol: string; name: string; decimals: number }> {
  if (chain.kind !== 'evm' || chain.chainId === null) {
    throw new Error(
      `${chain.name} is not an EVM chain — tokens are added by contract address on EVM chains only. On Solana, tokens appear automatically from the wallet's token accounts.`,
    );
  }
  const provider = getProvider(chain);
  const contract = new ethers.Contract(address, ERC20_MIN_ABI, provider);
  const [symbol, name, decimals] = await Promise.all([
    contract.symbol() as Promise<string>,
    contract.name() as Promise<string>,
    contract.decimals() as Promise<number>,
  ]);
  return { symbol, name, decimals: Number(decimals) };
}

async function fetchNativeBalance(
  chain: ChainConfig,
  provider: ethers.AbstractProvider,
  address: string,
  verified = true,
): Promise<TokenBalance> {
  const raw = await provider.getBalance(address);
  // eth_getBalance is ALWAYS wei — 10^18 per native unit — on every EVM
  // chain, including Arc. Arc's "6 decimals" is the USDC *token*
  // decimals (the ERC-20 view of USDC), NOT the native RPC unit. The
  // old code formatted with chain.nativeDecimals (6 on Arc), so a real
  // 30 USDC balance (30e18 wei) showed as 30,000,000,000,000 USDC —
  // 1,000,000,000,000x too big — and native sends built with
  // tokenDecimals 6 sent 1e6 wei instead of 1e18 wei per USDC.
  // The native entry therefore carries decimals 18: that is the unit
  // every native amount (value, gas, balance) is actually in.
  const balance = Number(ethers.formatUnits(raw, EVM_NATIVE_RPC_DECIMALS));
  return {
    symbol: chain.nativeSymbol,
    name: chain.nativeName,
    chainId: chain.id,
    address: '',
    decimals: EVM_NATIVE_RPC_DECIMALS,
    balance,
    balanceRaw: raw.toString(),
    locked: 0,
    priceUsd: null,
    price: null,
    change24h: null,
    priceSource: 'unavailable',
    priceUpdatedAt: null,
    // Native asset: verified by default (see nativeAssetVerified) —
    // the row previously carried no verified flag, so My Assets never
    // showed the badge on the native asset.
    verified,
    isSpam: false,
  };
}

async function fetchErc20Balance(
  chain: ChainConfig,
  provider: ethers.AbstractProvider,
  address: string,
  token: ImportedToken,
): Promise<TokenBalance> {
  const contract = new ethers.Contract(token.address, ERC20_MIN_ABI, provider);
  const raw = (await contract.balanceOf(address)) as bigint;
  return {
    symbol: token.symbol,
    name: token.name,
    chainId: token.chainId,
    address: token.address,
    decimals: token.decimals,
    balance: Number(ethers.formatUnits(raw, token.decimals)),
    balanceRaw: raw.toString(),
    locked: 0,
    priceUsd: null,
    price: null,
    change24h: null,
    priceSource: 'unavailable',
    priceUpdatedAt: null,
    coingeckoId: token.coingeckoId,
    logoUrl: token.logoUrl ?? null,
    verified: token.verified ?? false,
    sortOrder: token.sortOrder,
    isSpam: false,
  };
}

const MAJOR_COINGECKO_IDS: Record<string, string> = {
  BNB: 'binancecoin',
  ETH: 'ethereum',
  SOL: 'solana',
  POL: 'matic-network',
  USDC: 'usd-coin',
  USDT: 'tether',
};

/** Fetch live balances for the native asset + the user's imported tokens.
 *  `registryTokens` are the admin registry entries for this chain: every
 *  one appears in My Assets, in the admin's order, verified badge when
 *  the admin marked it verified — except the native asset and the
 *  default stablecoins, which are verified BY DEFAULT unless the admin
 *  explicitly unverified that address (see verifiedByDefault /
 *  nativeAssetVerified). */
export async function fetchBalances(
  chainId: string,
  address: string,
  importedTokens?: ImportedToken[],
  registryTokens?: RegistryTokenInput[],
): Promise<BalancesResult> {
  const chain = getChain(chainId);
  const startedAt = Date.now();
  // NOTE (2026-11-27): the EVM address check MUST come after the Solana
  // branch below. A valid base58 Solana address fails ethers.isAddress,
  // so validating it here rejected every Solana balance read with
  // 'Invalid wallet address.' — Solana showed an empty portfolio even
  // though the Solana branch itself was correctly placed. EVM chains
  // are validated just before getProvider() further down.
  if (chain.kind === 'solana') {
    if (!address || address.startsWith('0x')) {
      return {
        chain,
        address,
        tokens: [],
        totalUsd: 0,
        loading: false,
        error:
          'No Solana address for this wallet — it was imported from a raw private key, so no Solana address could be derived. Import the seed phrase to use Solana.',
        updatedAt: startedAt,
      };
    }
    try {
      const sol = await fetchSolanaBalances(address);
      const tokens: TokenBalance[] = [];
      const solCg = (await fetchMajorPrices(['solana']))?.solana;
      const solPrice = solCg?.price ?? null;
      tokens.push({
        symbol: chain.nativeSymbol,
        name: chain.nativeName,
        chainId: chain.id,
        address: '',
        decimals: chain.nativeDecimals,
        balance: sol.sol,
        balanceRaw: sol.lamports.toString(),
        locked: 0,
        priceUsd: solPrice,
        price: solPrice,
        change24h: solCg?.change24h ?? null,
        priceSource: solPrice !== null ? 'coingecko' : 'unavailable',
        priceUpdatedAt: solPrice !== null ? Date.now() : null,
        // Native asset: verified by default (no registry address can
        // unverify SOL — see nativeAssetVerified).
        verified: nativeAssetVerified(registryTokens ?? [], chain),
        isSpam: false,
      });
      // Prices for every SPL token in parallel: a sequential loop made
      // the list load one DexScreener round-trip at a time.
      const priced = await Promise.all(
        sol.tokens.map(async (t) => {
          const ds = await fetchDexScreenerToken(chain.id, t.mint);
          return {
            symbol: ds?.symbol ?? `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`,
            name: ds?.name ?? `SPL token ${t.mint.slice(0, 8)}…`,
            chainId: chain.id,
            address: t.mint,
            decimals: t.decimals,
            balance: t.balance,
            balanceRaw: t.balanceRaw,
            locked: 0,
            priceUsd: ds?.priceUsd ?? null,
            price: ds?.priceUsd ?? null,
            change24h: ds?.change24h ?? null,
            priceSource: ds?.priceUsd ? 'dexscreener' : 'unavailable',
            priceUpdatedAt: ds?.updatedAt ?? null,
            logoUrl: null,
            isSpam: false,
          } as TokenBalance;
        }),
      );
      tokens.push(...priced);
      const ordered = sortMyAssets(tokens, chain);
      const totalUsd = ordered.reduce((s, t) => s + (t.priceUsd !== null ? t.balance * t.priceUsd : 0), 0);
      return { chain, address, tokens: ordered, totalUsd, loading: false, error: null, updatedAt: Date.now() };
    } catch (e) {
      return {
        chain,
        address,
        tokens: [],
        totalUsd: 0,
        loading: false,
        error: `Could not read Solana balances from ${chain.rpcUrl}: ${e instanceof Error ? e.message : String(e)}`,
        updatedAt: startedAt,
      };
    }
  }
  // EVM-only address check (see the note above the Solana branch): a
  // base58 Solana address must never reach this point — it returns
  // inside the Solana branch above.
  if (!ethers.isAddress(address)) {
    return { chain, address, tokens: [], totalUsd: 0, loading: false, error: 'Invalid wallet address.', updatedAt: startedAt };
  }
  const provider = getProvider(chain);
  const rawImported = importedTokens ?? (await loadImportedTokens(address));
  const imported = mergeRegistryTokens(rawImported, registryTokens ?? [], chain.id);
  // Default stablecoins (USDT + USDC, verified addresses only) and
  // auto-discovery run BEFORE balances are read, so the new rows get
  // balances and prices in the same pass. Both are silent on failure.
  const stables = await resolveDefaultStables(chain, imported, registryTokens ?? []);
  const withStables = [...imported, ...stables];
  // Hidden-set hook (the ONLY discovery-path change): a token the user
  // toggled off in the import screen is skipped here, so it cannot
  // reappear on the next refresh. Derived rows (registry, default
  // stables) never reach this path — they cannot be hidden.
  const hidden = await loadHiddenTokens(address);
  const discovered = (await discoverTokens(chain, address)).filter(
    (d) => !isTokenHidden(hidden, d.chainId, d.address),
  );
  const allImported = mergeDiscoveredTokens(withStables, discovered, chain.id);
  // Persist newly discovered tokens in the per-wallet imported list so
  // they survive reloads and can be toggled off in the import modal.
  // Registry rows and default stables are NOT persisted — they are
  // derived on every load from the registry / chain config.
  const newlyDiscovered = allImported.filter(
    (t) =>
      t.discovered &&
      !rawImported.some(
        (r) => r.chainId === chain.id && r.address.toLowerCase() === t.address.toLowerCase(),
      ),
  );
  if (newlyDiscovered.length > 0) {
    try {
      await saveImportedTokens([...rawImported, ...newlyDiscovered], address);
    } catch {
      // Best-effort: the rows are still shown this load.
    }
  }
  const importedList = allImported;
  let native: TokenBalance;
  try {
    native = await fetchNativeBalance(chain, provider, address, nativeAssetVerified(registryTokens ?? [], chain));
  } catch (e) {
    return {
      chain,
      address,
      tokens: [],
      totalUsd: 0,
      loading: false,
      error: `Could not read ${chain.name} balance from ${chain.rpcUrl} (tried ${getRpcUrls(chain).join(', ')}): ${e instanceof Error ? e.message : String(e)}`,
      updatedAt: startedAt,
    };
  }
  const erc20 = await Promise.all(
    importedList.map(async (t) => {
      try {
        return await fetchErc20Balance(chain, provider, address, t);
      } catch {
        return null; // unreadable token: dropped, not zero-filled silently
      }
    }),
  );
  const tokens = sortMyAssets(
    [native, ...erc20.filter((t): t is TokenBalance => t !== null)],
    chain,
  );

  // Prices: DexScreener per ERC-20, CoinGecko for majors (native + stables).
  // The DexScreener reads run in parallel: a sequential loop made the
  // list load one round-trip at a time on every chain switch.
  const cgIds = [...new Set(tokens.map((t) => t.coingeckoId ?? MAJOR_COINGECKO_IDS[t.symbol]).filter(Boolean))] as string[];
  const cg = cgIds.length > 0 ? await fetchMajorPrices(cgIds) : {};
  await Promise.all(
    tokens.map(async (t) => {
      const cgId = t.coingeckoId ?? MAJOR_COINGECKO_IDS[t.symbol];
      if (t.address) {
        const ds = await fetchDexScreenerToken(chain.id, t.address);
        if (ds?.priceUsd) {
          t.priceUsd = ds.priceUsd;
          t.price = ds.priceUsd;
          t.change24h = ds.change24h ?? null;
          t.priceSource = 'dexscreener';
          t.priceUpdatedAt = ds.updatedAt;
          return;
        }
      }
      if (cgId && cg[cgId]?.price !== null) {
        t.priceUsd = cg[cgId].price;
        t.price = cg[cgId].price;
        t.change24h = cg[cgId].change24h ?? null;
        t.priceSource = 'coingecko';
        t.priceUpdatedAt = cg[cgId].updatedAt;
      } else {
        t.change24h = null;
      }
    }),
  );

  const totalUsd = tokens.reduce((s, t) => s + (t.priceUsd !== null ? t.balance * t.priceUsd : 0), 0);
  return { chain, address, tokens, totalUsd, loading: false, error: null, updatedAt: Date.now() };
}
