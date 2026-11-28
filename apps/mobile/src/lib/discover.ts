/**
 * LIVE Discover — a full DEX browser (DexScreener-style), no static list.
 *
 * Sources (all verified live from this VM on 2026-11-26):
 *   - GeckoTerminal trending pools:
 *       GET https://api.geckoterminal.com/api/v2/networks/trending_pools?page=N
 *     Global feed, one pool per row, with network id, price, FDV /
 *     market_cap_usd, h24 change, h24 volume, reserve (liquidity),
 *     pool_created_at and dex id. Drives Trending / Gainers (same live
 *     feed, different ranking — see sortDiscoverTokens) and is paged
 *     through fetchDiscoverPage for infinite scroll.
 *   - GeckoTerminal new pools (per network):
 *       GET https://api.geckoterminal.com/api/v2/networks/<network>/new_pools?page=N
 *     Verified for bsc, eth, base, polygon_pos, solana AND arc (Arc uses
 *     Uniswap V4 on GeckoTerminal). Drives the New Pairs tab, also paged.
 *   - DexScreener search:
 *       GET https://api.dexscreener.com/latest/dex/search?q=<query>
 *     Drives search by symbol / name / contract address.
 *   - DexScreener token batch lookup (enrichment):
 *       GET https://api.dexscreener.com/latest/dex/tokens/<a1,a2,...>
 *     Up to 30 addresses per call, grouped per chain. Fills the token's
 *     full name, logo (info.imageUrl), market cap, price and pair age
 *     where the GeckoTerminal feed has none of those.
 *   - DexScreener token profiles (fallback for New):
 *       GET https://api.dexscreener.com/token-profiles/latest/v1
 *     New tokens with a profile + icon; enriched with the batch lookup.
 *   - DexScreener token boosts (fallback for Trending):
 *       GET https://api.dexscreener.com/token-boosts/top/v1
 *     Most-boosted tokens; enriched with the batch lookup.
 *   - CoinMarketCap public listing API (Binance Alpha tab only):
 *       GET https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?tagSlugs=binance-alpha
 *     Verified live from this VM on 2026-11-28 (387 Alpha-tagged coins,
 *     page 2 returns a full 100 rows). No key needed. Binance's own
 *     Alpha endpoints and CoinGecko's `binance-alpha` category both 404,
 *     so CMC is the list source. The listing feed carries no chain or
 *     contract address — Alpha rows use a stable `cmc:<id>` address, a
 *     CoinMarketCap icon URL, and do not navigate to a token detail page.
 *     Prices, 24h change, market cap and volume are live from CMC.
 *
 * One row per TOKEN, never one per pool: dedupeDiscoverTokens keeps the
 * highest-liquidity pair per token (PONS on three DEXes is one row, with
 * the DEX noted). Logos come from the enrichment (DexScreener
 * info.imageUrl) and fall back to the existing TokenLogo resolver
 * (Trust Wallet -> DexScreener -> GeckoTerminal -> CoinGecko -> token
 * lists); the letter circle only appears when no source has a logo.
 *
 * Rate limits: GeckoTerminal free tier is 30 calls/min, DexScreener
 * 300/min. A page load makes 1 (trending) or up to 6 (new, all chains)
 * GeckoTerminal calls plus one DexScreener batch call per chain present
 * (usually 1-3). There is no auto-refresh polling — the user refreshes
 * manually — so a normal session stays far under the limit.
 *
 * Restored 2026-11-27: all chains active again. Results are still
 * filtered to USABLE_CHAINS (see lib/chains.ts) so a chain disabled
 * later (e.g. from admin) — or marked coming-soon — never appears,
 * even when an upstream feed returns it. See apps/mobile/SCOPE.md.
 *
 * No secrets, no keys. Pure helpers are unit-testable with an injected
 * fetch implementation.
 */
import { getChain, isChainActive, USABLE_CHAINS } from './chains';
import { normalizeChainId } from './tokenLogos';
import type { TokenMarketData } from './prices';
import { fetchTokenMarketData } from './prices';

export interface DiscoverToken {
  symbol: string;
  name: string;
  /** Stelix chain id: 'arc' | 'bnb' | 'base' | 'ethereum' | 'polygon' | 'solana'. */
  chainId: string;
  address: string;
  pairAddress: string | null;
  priceUsd: number | null;
  change24h: number | null;
  change1h: number | null;
  /** Market cap in USD. GeckoTerminal often reports market_cap_usd as
   *  null for new pools — then this falls back to FDV (see
   *  marketCapSource) so the MC column is never blank for a listed pair. */
  marketCap: number | null;
  marketCapSource: 'marketcap' | 'fdv' | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  txns24h: number | null;
  dexId: string | null;
  url: string | null;
  /** Best pair's creation time, ms since epoch, or null when unknown. */
  pairCreatedAt: number | null;
  /** Real logo URL from DexScreener enrichment (info.imageUrl), or null
   *  — the TokenLogo component then resolves one via tokenLogos. */
  iconUrl: string | null;
}

export interface DiscoverResult {
  tokens: DiscoverToken[];
  source: 'dexscreener' | 'geckoterminal' | 'coinmarketcap' | 'unavailable';
  error: string | null;
  updatedAt: number;
}

export type DiscoverTab = 'trending' | 'gainers' | 'new' | 'alpha';
export type DiscoverSort = 'trending' | 'volume' | 'marketcap' | 'newest' | 'gainers';

export interface DiscoverFilters {
  minLiquidityUsd?: number | null;
  minVolume24h?: number | null;
  minMarketCap?: number | null;
  /** Only pairs created within the last N ms (null = any age). */
  maxAgeMs?: number | null;
  /** Only pairs created within the last 24h. */
  newOnly?: boolean;
  dexId?: string | null;
  chainId?: string | 'all' | null;
  query?: string;
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

const FETCH_TIMEOUT_MS = 8000;
const MAX_BATCH_ADDRESSES = 30;
/** GeckoTerminal trending pages fetched per Trending/Gainers load. */
const TRENDING_PAGES = 2;
/** GeckoTerminal default page size for trending_pools / new_pools.
 *  A page that returns this many pools is treated as full — there may
 *  be another page after it. */
const GECKO_PAGE_SIZE = 20;

async function fetchWithTimeout(
  url: string,
  fetchImpl: FetchImpl = fetch,
  ms = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchImpl(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Stelix chain ids shown in the Discover chain filter — usable chains
 *  only (a coming-soon chain has no prices or pairs to discover). */
export const DISCOVER_CHAINS: { id: string; label: string }[] = USABLE_CHAINS.map((c) => ({
  id: c.id,
  label: c.id === 'bnb' ? 'BNB' : c.name,
}));

/** GeckoTerminal network slugs for the Stelix chains (from chains.ts). */
export function discoverNetworks(chainId: string | 'all'): string[] {
  if (chainId === 'all') return USABLE_CHAINS.map((c) => c.geckoTerminalNetwork);
  return [getChain(chainId).geckoTerminalNetwork];
}

/** "pancakeswap_v2" -> "PancakeSwap V2" for display. */
export function prettyDexId(dexId: string | null): string {
  if (!dexId) return '—';
  return dexId
    .split(/[-_ ]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** "2h ago" / "3d ago" / "12m ago" / "just now" for a pair/token age. */
export function formatTokenAge(createdAtMs: number | null, nowMs = Date.now()): string {
  if (createdAtMs === null) return '—';
  const diff = Math.max(0, nowMs - createdAtMs);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// ---------------------------------------------------------------------------
// Mappers (exported for tests)
// ---------------------------------------------------------------------------

interface DexScreenerPairLike {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  baseToken?: { symbol?: string; name?: string; address?: string };
  priceUsd?: string;
  priceChange?: { h24?: number; h1?: number };
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
}

/** Map one DexScreener pair to a DiscoverToken (best-pair rows only). */
export function mapDexScreenerPair(p: DexScreenerPairLike): DiscoverToken {
  const mc = num(p.marketCap);
  const fdv = num(p.fdv);
  return {
    symbol: p.baseToken?.symbol ?? '',
    name: p.baseToken?.name ?? '',
    chainId: normalizeChainId(p.chainId ?? ''),
    address: p.baseToken?.address ?? '',
    pairAddress: p.pairAddress ?? null,
    priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
    change24h: typeof p.priceChange?.h24 === 'number' ? p.priceChange.h24 : null,
    change1h: typeof p.priceChange?.h1 === 'number' ? p.priceChange.h1 : null,
    marketCap: mc ?? fdv,
    marketCapSource: mc !== null ? 'marketcap' : fdv !== null ? 'fdv' : null,
    fdvUsd: fdv,
    liquidityUsd: num(p.liquidity?.usd),
    volume24h: num(p.volume?.h24),
    txns24h:
      typeof p.txns?.h24?.buys === 'number' || typeof p.txns?.h24?.sells === 'number'
        ? (p.txns.h24.buys ?? 0) + (p.txns.h24.sells ?? 0)
        : null,
    dexId: p.dexId ?? null,
    url: p.url ?? null,
    pairCreatedAt: typeof p.pairCreatedAt === 'number' ? p.pairCreatedAt : null,
    iconUrl: p.info?.imageUrl ?? null,
  };
}

interface GeckoPoolLike {
  id?: string;
  attributes?: {
    address?: string;
    name?: string;
    base_token_price_usd?: string;
    market_cap_usd?: string | null;
    fdv_usd?: string;
    reserve_in_usd?: string;
    pool_created_at?: string;
    price_change_percentage?: { h24?: string; h1?: string };
    volume_usd?: { h24?: string };
    transactions?: { h24?: { buys?: number; sells?: number } };
  };
  relationships?: {
    base_token?: { data?: { id?: string } };
    network?: { data?: { id?: string } };
    dex?: { data?: { id?: string } };
  };
}

/** Map one GeckoTerminal pool to a DiscoverToken. The base token's
 *  symbol comes from the pool name ("SYMBOL / QUOTE"); the full name and
 *  logo are filled by DexScreener enrichment (see enrichWithDexScreener). */
export function mapGeckoPool(pool: GeckoPoolLike): DiscoverToken {
  const a = pool.attributes ?? {};
  const networkId =
    pool.relationships?.network?.data?.id ?? pool.id?.split('_')[0] ?? '';
  const baseId = pool.relationships?.base_token?.data?.id ?? '';
  const address = baseId.includes('_') ? baseId.split('_').slice(1).join('_') : baseId;
  const name = a.name ?? '';
  const symbol = name.split('/')[0]?.trim() ?? '';
  const mc = num(a.market_cap_usd);
  const fdv = num(a.fdv_usd);
  const h24 = a.transactions?.h24;
  return {
    symbol,
    name: symbol,
    chainId: normalizeChainId(networkId),
    address,
    pairAddress: a.address ?? null,
    priceUsd: num(a.base_token_price_usd),
    change24h: num(a.price_change_percentage?.h24),
    change1h: num(a.price_change_percentage?.h1),
    marketCap: mc ?? fdv,
    marketCapSource: mc !== null ? 'marketcap' : fdv !== null ? 'fdv' : null,
    fdvUsd: fdv,
    liquidityUsd: num(a.reserve_in_usd),
    volume24h: num(a.volume_usd?.h24),
    txns24h:
      typeof h24?.buys === 'number' || typeof h24?.sells === 'number'
        ? (h24.buys ?? 0) + (h24.sells ?? 0)
        : null,
    dexId: pool.relationships?.dex?.data?.id ?? null,
    url: null,
    pairCreatedAt: a.pool_created_at ? Date.parse(a.pool_created_at) : null,
    iconUrl: null,
  };
}

// ---------------------------------------------------------------------------
// Pure list helpers (unit-tested)
// ---------------------------------------------------------------------------

function tokenKey(t: DiscoverToken): string {
  return `${t.chainId}:${t.address.toLowerCase()}`;
}

/**
 * One row per token: when the same token has several pools (PONS on
 * three DEXes), keep the highest-liquidity pair and note its DEX.
 * Ties break on 24h volume, then on newest pair.
 */
export function dedupeDiscoverTokens(tokens: DiscoverToken[]): DiscoverToken[] {
  const best = new Map<string, DiscoverToken>();
  for (const t of tokens) {
    if (!t.symbol || !t.address) continue;
    const key = tokenKey(t);
    const cur = best.get(key);
    if (!cur) {
      best.set(key, t);
      continue;
    }
    const liq = t.liquidityUsd ?? -1;
    const curLiq = cur.liquidityUsd ?? -1;
    if (
      liq > curLiq ||
      (liq === curLiq && (t.volume24h ?? -1) > (cur.volume24h ?? -1)) ||
      (liq === curLiq &&
        (t.volume24h ?? -1) === (cur.volume24h ?? -1) &&
        (t.pairCreatedAt ?? 0) > (cur.pairCreatedAt ?? 0))
    ) {
      best.set(key, t);
    }
  }
  return [...best.values()];
}

/** Client-side advanced filters. Tokens with an unknown pair age are
 *  excluded by maxAgeMs / newOnly — their age cannot be verified.
 *  Tokens on chains that are not active are always dropped, even when
 *  the caller asks for 'all' (all six chains are active as restored
 *  2026-11-27, so this is a no-op until a chain is disabled again). */
export function applyDiscoverFilters(
  tokens: DiscoverToken[],
  filters: DiscoverFilters,
  nowMs = Date.now(),
): DiscoverToken[] {
  const q = (filters.query ?? '').trim().toLowerCase();
  return tokens.filter((t) => {
    if (!isChainActive(t.chainId)) return false;
    if (filters.chainId && filters.chainId !== 'all' && t.chainId !== filters.chainId) return false;
    if (filters.dexId && t.dexId !== filters.dexId) return false;
    if (filters.minLiquidityUsd != null && (t.liquidityUsd ?? 0) < filters.minLiquidityUsd) return false;
    if (filters.minVolume24h != null && (t.volume24h ?? 0) < filters.minVolume24h) return false;
    if (filters.minMarketCap != null && (t.marketCap ?? 0) < filters.minMarketCap) return false;
    if (filters.newOnly) {
      if (t.pairCreatedAt === null || nowMs - t.pairCreatedAt > 24 * 60 * 60 * 1000) return false;
    } else if (filters.maxAgeMs != null) {
      if (t.pairCreatedAt === null || nowMs - t.pairCreatedAt > filters.maxAgeMs) return false;
    }
    if (q) {
      const hay = `${t.symbol} ${t.name} ${t.address}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Rank a token list. Nulls always sort last. */
export function sortDiscoverTokens(tokens: DiscoverToken[], sort: DiscoverSort): DiscoverToken[] {
  const sorted = [...tokens];
  const desc = (a: number | null, b: number | null) => (b ?? -Infinity) - (a ?? -Infinity);
  switch (sort) {
    case 'volume':
    case 'trending':
      return sorted.sort(
        (a, b) => desc(a.volume24h, b.volume24h) || desc(a.txns24h, b.txns24h),
      );
    case 'marketcap':
      return sorted.sort((a, b) => desc(a.marketCap, b.marketCap));
    case 'newest':
      return sorted.sort((a, b) => desc(a.pairCreatedAt, b.pairCreatedAt));
    case 'gainers':
      return sorted.sort((a, b) => desc(a.change24h, b.change24h));
    default:
      return sorted;
  }
}

// ---------------------------------------------------------------------------
// DexScreener enrichment (batch token lookup, grouped per chain)
// ---------------------------------------------------------------------------

/**
 * Fill name / logo / market cap / price / pair age from DexScreener's
 * batch token endpoint (one call per chain, up to 30 addresses each).
 * Best-effort: a failed lookup leaves the token exactly as it was.
 */
export async function enrichWithDexScreener(
  tokens: DiscoverToken[],
  fetchImpl: FetchImpl = fetch,
): Promise<DiscoverToken[]> {
  if (tokens.length === 0) return tokens;
  const byChain = new Map<string, DiscoverToken[]>();
  for (const t of tokens) {
    const list = byChain.get(t.chainId) ?? [];
    list.push(t);
    byChain.set(t.chainId, list);
  }
  // address (lowercase) -> best DexScreener pair for that token
  const bestByAddress = new Map<string, DexScreenerPairLike>();
  await Promise.all(
    [...byChain.entries()].map(async ([chainId, group]) => {
      const chain = getChain(chainId);
      for (let i = 0; i < group.length; i += MAX_BATCH_ADDRESSES) {
        const chunk = group.slice(i, i + MAX_BATCH_ADDRESSES);
        try {
          const res = await fetchWithTimeout(
            `https://api.dexscreener.com/latest/dex/tokens/${chunk
              .map((t) => encodeURIComponent(t.address))
              .join(',')}`,
            fetchImpl,
          );
          if (!res.ok) continue;
          const json = await res.json();
          const pairs: DexScreenerPairLike[] = Array.isArray(json?.pairs) ? json.pairs : [];
          for (const p of pairs) {
            if (!p.baseToken?.address) continue;
            // Prefer a pair on the token's own chain, then highest liquidity.
            const onChain = p.chainId === chain.dexScreenerChainId;
            const key = `${chainId}:${p.baseToken.address.toLowerCase()}`;
            const cur = bestByAddress.get(key);
            const curLiq = cur ? Number(cur.liquidity?.usd ?? 0) : -1;
            const curOnChain = cur ? cur.chainId === chain.dexScreenerChainId : false;
            const liq = Number(p.liquidity?.usd ?? 0);
            if (!cur || (onChain && !curOnChain) || (onChain === curOnChain && liq > curLiq)) {
              bestByAddress.set(key, p);
            }
          }
        } catch {
          // Enrichment is best-effort — the GeckoTerminal row stays.
        }
      }
    }),
  );
  if (bestByAddress.size === 0) return tokens;
  return tokens.map((t) => {
    const p = bestByAddress.get(`${t.chainId}:${t.address.toLowerCase()}`);
    if (!p) return t;
    const enriched = mapDexScreenerPair(p);
    return {
      ...t,
      symbol: t.symbol || enriched.symbol,
      name: enriched.name || t.name,
      iconUrl: enriched.iconUrl ?? t.iconUrl,
      priceUsd: t.priceUsd ?? enriched.priceUsd,
      change24h: t.change24h ?? enriched.change24h,
      change1h: t.change1h ?? enriched.change1h,
      marketCap: t.marketCap ?? enriched.marketCap,
      marketCapSource: t.marketCapSource ?? enriched.marketCapSource,
      fdvUsd: t.fdvUsd ?? enriched.fdvUsd,
      liquidityUsd: t.liquidityUsd ?? enriched.liquidityUsd,
      volume24h: t.volume24h ?? enriched.volume24h,
      txns24h: t.txns24h ?? enriched.txns24h,
      pairAddress: t.pairAddress ?? enriched.pairAddress,
      dexId: t.dexId ?? enriched.dexId,
      url: t.url ?? enriched.url,
      pairCreatedAt: t.pairCreatedAt ?? enriched.pairCreatedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

async function fetchGeckoPools(
  url: string,
  fetchImpl: FetchImpl,
): Promise<DiscoverToken[]> {
  const res = await fetchWithTimeout(url, fetchImpl);
  if (!res.ok) throw new Error(`GeckoTerminal returned HTTP ${res.status}.`);
  const json = await res.json();
  const pools: GeckoPoolLike[] = Array.isArray(json?.data) ? json.data : [];
  return pools.map(mapGeckoPool).filter((t) => t.symbol && t.address);
}

/** Trending / Gainers from GeckoTerminal trending pools. */
async function fetchTrendingPools(fetchImpl: FetchImpl): Promise<DiscoverToken[]> {
  const pages = await Promise.all(
    Array.from({ length: TRENDING_PAGES }, (_, i) =>
      fetchGeckoPools(
        `https://api.geckoterminal.com/api/v2/networks/trending_pools?page=${i + 1}`,
        fetchImpl,
      ).catch(() => [] as DiscoverToken[]),
    ),
  );
  return pages.flat();
}

/** New pairs from GeckoTerminal new_pools, one call per network. */
async function fetchNewPools(
  chainId: string | 'all',
  fetchImpl: FetchImpl,
): Promise<DiscoverToken[]> {
  const networks = discoverNetworks(chainId);
  const pages = await Promise.all(
    networks.map((n) =>
      fetchGeckoPools(
        `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(n)}/new_pools?page=1`,
        fetchImpl,
      ).catch(() => [] as DiscoverToken[]),
    ),
  );
  return pages.flat();
}

interface DexScreenerBoost {
  chainId?: string;
  tokenAddress?: string;
}

/** Fallback for Trending: DexScreener's most-boosted tokens, enriched. */
async function fetchBoostedTokens(
  limit: number,
  fetchImpl: FetchImpl,
): Promise<DiscoverToken[]> {
  const res = await fetchWithTimeout('https://api.dexscreener.com/token-boosts/top/v1', fetchImpl);
  if (!res.ok) throw new Error(`DexScreener boosts returned HTTP ${res.status}.`);
  const json = await res.json();
  const boosts: DexScreenerBoost[] = Array.isArray(json) ? json : [];
  const seeds: DiscoverToken[] = boosts.slice(0, limit).map((b) => ({
    symbol: '',
    name: '',
    chainId: normalizeChainId(b.chainId ?? ''),
    address: b.tokenAddress ?? '',
    pairAddress: null,
    priceUsd: null,
    change24h: null,
    change1h: null,
    marketCap: null,
    marketCapSource: null,
    fdvUsd: null,
    liquidityUsd: null,
    volume24h: null,
    txns24h: null,
    dexId: null,
    url: null,
    pairCreatedAt: null,
    iconUrl: null,
  }));
  const enriched = await enrichWithDexScreener(
    seeds.filter((t) => t.address),
    fetchImpl,
  );
  return enriched.filter((t) => t.symbol);
}

interface DexScreenerProfile {
  chainId?: string;
  tokenAddress?: string;
  icon?: string;
}

/** Fallback for New: DexScreener's latest token profiles, enriched. */
export async function fetchTokenProfilesNew(
  chainId: string | 'all',
  limit = 30,
  fetchImpl: FetchImpl = fetch,
): Promise<DiscoverResult> {
  try {
    const res = await fetchWithTimeout('https://api.dexscreener.com/token-profiles/latest/v1', fetchImpl);
    if (!res.ok) {
      return {
        tokens: [],
        source: 'unavailable',
        error: `DexScreener profiles returned HTTP ${res.status}.`,
        updatedAt: Date.now(),
      };
    }
    const json = await res.json();
    const profiles: DexScreenerProfile[] = Array.isArray(json) ? json : [];
    const wanted = chainId === 'all' ? null : getChain(chainId).dexScreenerChainId;
    const seeds: DiscoverToken[] = profiles
      // Profiles on inactive chains never become rows.
      .filter((p) => p.tokenAddress && isChainActive(normalizeChainId(p.chainId ?? '')) && (!wanted || p.chainId === wanted))
      .slice(0, limit)
      .map((p) => ({
        symbol: '',
        name: '',
        chainId: normalizeChainId(p.chainId ?? ''),
        address: p.tokenAddress ?? '',
        pairAddress: null,
        priceUsd: null,
        change24h: null,
        change1h: null,
        marketCap: null,
        marketCapSource: null,
        fdvUsd: null,
        liquidityUsd: null,
        volume24h: null,
        txns24h: null,
        dexId: null,
        url: null,
        pairCreatedAt: null,
        iconUrl: p.icon ?? null,
      }));
    const enriched = await enrichWithDexScreener(seeds, fetchImpl);
    const tokens = dedupeDiscoverTokens(enriched.filter((t) => t.symbol));
    return { tokens, source: 'dexscreener', error: null, updatedAt: Date.now() };
  } catch (e) {
    return {
      tokens: [],
      source: 'unavailable',
      error: `DexScreener profiles failed: ${e instanceof Error ? e.message : String(e)}`,
      updatedAt: Date.now(),
    };
  }
}

const TAB_SORT: Record<DiscoverTab, DiscoverSort> = {
  trending: 'trending',
  gainers: 'gainers',
  new: 'newest',
  alpha: 'marketcap',
};

export interface DiscoverPageResult {
  /** This page's tokens, deduped by chain+address. */
  tokens: DiscoverToken[];
  /** True when the upstream page came back full — a next page may exist.
   *  False when the page was empty or short: the screen stops paging. */
  hasMore: boolean;
  source: DiscoverResult['source'];
  error: string | null;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Binance Alpha (CoinMarketCap public listing API, `binance-alpha` tag)
// ---------------------------------------------------------------------------

interface CmcAlphaListing {
  id?: number;
  name?: string;
  symbol?: string;
  dateAdded?: string;
  quotes?: {
    price?: number;
    percentChange1h?: number;
    percentChange24h?: number;
    marketCap?: number;
    fullyDilluttedMarketCap?: number;
    volume24h?: number;
  }[];
}

const CMC_ALPHA_PAGE_SIZE = 100;

/**
 * Map one CoinMarketCap Alpha listing row to a DiscoverToken. The CMC
 * listing feed carries no chain or contract address, so these rows use
 * a stable `cmc:<id>` address (never a real contract address), no chain
 * (the screen does not navigate on them), and the CoinMarketCap icon
 * URL — no logo resolution is needed. pairCreatedAt is the CMC
 * dateAdded, so the Newest sort orders by listing date.
 */
export function mapCmcAlphaListing(c: CmcAlphaListing): DiscoverToken {
  const q = c.quotes?.[0];
  const mc = num(q?.marketCap);
  const fdv = num(q?.fullyDilluttedMarketCap);
  return {
    symbol: c.symbol ?? '',
    name: c.name ?? '',
    chainId: '',
    address: typeof c.id === 'number' ? `cmc:${c.id}` : '',
    pairAddress: null,
    priceUsd: num(q?.price),
    change24h: num(q?.percentChange24h),
    change1h: num(q?.percentChange1h),
    marketCap: mc ?? fdv,
    marketCapSource: mc !== null ? 'marketcap' : fdv !== null ? 'fdv' : null,
    fdvUsd: fdv,
    liquidityUsd: null,
    volume24h: num(q?.volume24h),
    txns24h: null,
    dexId: null,
    url: null,
    pairCreatedAt: c.dateAdded ? Date.parse(c.dateAdded) : null,
    iconUrl:
      typeof c.id === 'number'
        ? `https://s2.coinmarketcap.com/static/img/coins/64x64/${c.id}.png`
        : null,
  };
}

/**
 * Load ONE page of Binance Alpha tokens (100 per page, market-cap
 * order) from CoinMarketCap's public listing API. No key, no auth.
 * A failed page reports unavailable rather than fabricating rows.
 */
export async function fetchAlphaPage(
  page = 1,
  fetchImpl: FetchImpl = fetch,
): Promise<DiscoverPageResult> {
  const safePage = Math.max(1, Math.floor(page));
  const start = (safePage - 1) * CMC_ALPHA_PAGE_SIZE + 1;
  try {
    const res = await fetchWithTimeout(
      `https://api.coinmarketcap.com/data-api/v3/cryptocurrency/listing?start=${start}&limit=${CMC_ALPHA_PAGE_SIZE}&sortBy=market_cap&sortType=desc&convert=USD&tagSlugs=binance-alpha`,
      fetchImpl,
    );
    if (!res.ok) throw new Error(`CoinMarketCap returned HTTP ${res.status}.`);
    const json = await res.json();
    const list: CmcAlphaListing[] = Array.isArray(json?.data?.cryptoCurrencyList)
      ? json.data.cryptoCurrencyList
      : [];
    const total = num(json?.data?.totalCount);
    if (list.length === 0) {
      return {
        tokens: [],
        hasMore: false,
        source: 'unavailable',
        error: 'Binance Alpha tokens are unavailable right now — no data was fabricated.',
        updatedAt: Date.now(),
      };
    }
    const tokens = list.map(mapCmcAlphaListing).filter((t) => t.symbol && t.address);
    const hasMore =
      list.length >= CMC_ALPHA_PAGE_SIZE &&
      (total === null || start + list.length - 1 < total);
    return {
      tokens: sortDiscoverTokens(tokens, 'marketcap'),
      hasMore,
      source: 'coinmarketcap',
      error: null,
      updatedAt: Date.now(),
    };
  } catch (e) {
    return {
      tokens: [],
      hasMore: false,
      source: 'unavailable',
      error: `Binance Alpha failed: ${e instanceof Error ? e.message : String(e)}`,
      updatedAt: Date.now(),
    };
  }
}

/**
 * Load ONE page of a Discover tab (infinite scroll).
 * Trending / Gainers read GeckoTerminal trending_pools?page=N; New Pairs
 * reads new_pools?page=N per network. DexScreener has no list-all
 * endpoint, so GeckoTerminal pages are the honest source of thousands
 * of tokens. Rows are deduped by chain+address, enriched with
 * DexScreener logos/names, filtered to the chain and ranked per tab.
 * No DexScreener fallback here — a failed page reports unavailable
 * rather than fabricating rows (fetchDiscoverTab keeps the fallback
 * for its single-shot callers).
 * Binance Alpha reads CoinMarketCap's public listing API (see
 * fetchAlphaPage) — no chain filter or enrichment applies there.
 */
export async function fetchDiscoverPage(
  tab: DiscoverTab,
  chainId: string | 'all' = 'all',
  page = 1,
  fetchImpl: FetchImpl = fetch,
): Promise<DiscoverPageResult> {
  const safePage = Math.max(1, Math.floor(page));
  // Binance Alpha has its own feed (CoinMarketCap) — no chain filter
  // or DexScreener enrichment applies.
  if (tab === 'alpha') return fetchAlphaPage(safePage, fetchImpl);
  try {
    let tokens: DiscoverToken[] = [];
    let hasMore = false;
    if (tab === 'new') {
      const networks = discoverNetworks(chainId);
      const perNetwork = await Promise.all(
        networks.map((n) =>
          fetchGeckoPools(
            `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(n)}/new_pools?page=${safePage}`,
            fetchImpl,
          ).catch(() => [] as DiscoverToken[]),
        ),
      );
      tokens = perNetwork.flat();
      // Any network page that came back full may have another page.
      hasMore = perNetwork.some((p) => p.length >= GECKO_PAGE_SIZE);
    } else {
      tokens = await fetchGeckoPools(
        `https://api.geckoterminal.com/api/v2/networks/trending_pools?page=${safePage}`,
        fetchImpl,
      );
      hasMore = tokens.length >= GECKO_PAGE_SIZE;
    }
    if (tokens.length === 0) {
      return {
        tokens: [],
        hasMore: false,
        source: 'unavailable',
        error:
          tab === 'new'
            ? 'New pools are unavailable right now — no data was fabricated.'
            : 'Trending pools are unavailable right now — no data was fabricated.',
        updatedAt: Date.now(),
      };
    }
    const deduped = dedupeDiscoverTokens(tokens);
    const enriched = await enrichWithDexScreener(deduped, fetchImpl);
    const filtered = applyDiscoverFilters(enriched, { chainId });
    return {
      tokens: sortDiscoverTokens(filtered, TAB_SORT[tab]),
      hasMore,
      source: 'geckoterminal',
      error: null,
      updatedAt: Date.now(),
    };
  } catch (e) {
    return {
      tokens: [],
      hasMore: false,
      source: 'unavailable',
      error: `Discover failed: ${e instanceof Error ? e.message : String(e)}`,
      updatedAt: Date.now(),
    };
  }
}

/**
 * Load one Discover tab. `chainId` is a Stelix chain id or 'all'.
 * Trending / Gainers share the GeckoTerminal trending feed with
 * different rankings; New uses GeckoTerminal new pools per network.
 * Each tab has a DexScreener fallback when its primary feed fails.
 */
export async function fetchDiscoverTab(
  tab: DiscoverTab,
  chainId: string | 'all' = 'all',
  limit = 30,
  fetchImpl: FetchImpl = fetch,
): Promise<DiscoverResult> {
  try {
    let tokens: DiscoverToken[] = [];
    let source: DiscoverResult['source'] = 'geckoterminal';
    if (tab === 'new') {
      tokens = await fetchNewPools(chainId, fetchImpl);
      if (tokens.length === 0) {
        const fb = await fetchTokenProfilesNew(chainId, limit, fetchImpl);
        if (fb.tokens.length > 0) return { ...fb, tokens: fb.tokens.slice(0, limit) };
      }
    } else {
      tokens = await fetchTrendingPools(fetchImpl);
      if (tokens.length === 0) {
        const boosted = await fetchBoostedTokens(limit, fetchImpl).catch(() => [] as DiscoverToken[]);
        if (boosted.length > 0) {
          const out = applyDiscoverFilters(dedupeDiscoverTokens(boosted), { chainId });
          return {
            tokens: sortDiscoverTokens(out, TAB_SORT[tab]).slice(0, limit),
            source: 'dexscreener',
            error: null,
            updatedAt: Date.now(),
          };
        }
      }
    }
    if (tokens.length === 0) {
      return {
        tokens: [],
        source: 'unavailable',
        error:
          tab === 'new'
            ? 'New pools are unavailable right now — no data was fabricated.'
            : 'Trending pools are unavailable right now — no data was fabricated.',
        updatedAt: Date.now(),
      };
    }
    const deduped = dedupeDiscoverTokens(tokens);
    const enriched = await enrichWithDexScreener(deduped, fetchImpl);
    const filtered = applyDiscoverFilters(enriched, { chainId });
    return {
      tokens: sortDiscoverTokens(filtered, TAB_SORT[tab]).slice(0, limit),
      source,
      error: null,
      updatedAt: Date.now(),
    };
  } catch (e) {
    return {
      tokens: [],
      source: 'unavailable',
      error: `Discover failed: ${e instanceof Error ? e.message : String(e)}`,
      updatedAt: Date.now(),
    };
  }
}

/** Search live pairs by symbol, name or token address (DexScreener). */
export async function searchTokens(query: string, limit = 20): Promise<DiscoverResult> {
  const q = query.trim();
  if (!q) return { tokens: [], source: 'dexscreener', error: null, updatedAt: Date.now() };
  try {
    const res = await fetchWithTimeout(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
    );
    if (!res.ok) {
      return { tokens: [], source: 'unavailable', error: `DexScreener search returned HTTP ${res.status}.`, updatedAt: Date.now() };
    }
    const json = await res.json();
    const pairs: DexScreenerPairLike[] = Array.isArray(json?.pairs) ? json.pairs : [];
    const tokens = dedupeDiscoverTokens(
      pairs
        .map(mapDexScreenerPair)
        // Search is global upstream — keep active-chain rows only.
        .filter((t) => t.symbol && t.address && isChainActive(t.chainId)),
    ).slice(0, limit);
    return { tokens, source: 'dexscreener', error: null, updatedAt: Date.now() };
  } catch (e) {
    return {
      tokens: [],
      source: 'unavailable',
      error: `DexScreener search failed: ${e instanceof Error ? e.message : String(e)}`,
      updatedAt: Date.now(),
    };
  }
}

/** Trending pools (GeckoTerminal, DexScreener boosts fallback). */
export async function fetchTrending(limit = 20): Promise<DiscoverResult> {
  return fetchDiscoverTab('trending', 'all', limit);
}

/** New pairs/tokens for a chain (GeckoTerminal new pools, DexScreener
 *  profiles fallback). */
export async function fetchNewTokens(
  chainId: string | 'all' = 'all',
  limit = 30,
): Promise<DiscoverResult> {
  return fetchDiscoverTab('new', chainId, limit);
}

/** Full market data for a discovered token (DexScreener, GeckoTerminal fallback). */
export async function fetchDiscoverTokenDetail(
  chainId: string,
  address: string,
): Promise<TokenMarketData | null> {
  return fetchTokenMarketData(chainId, address);
}
