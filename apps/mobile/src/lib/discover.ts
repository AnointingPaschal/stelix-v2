/**
 * LIVE Discover — trending + search from real market APIs. No static list.
 *
 * Endpoints (verified live from this VM on 2026-11-26 unless noted):
 *   - Search: GET https://api.dexscreener.com/latest/dex/search?q=<query>
 *     -> 200, real pairs. This is the documented DexScreener latest API.
 *   - Token lookup: GET https://api.dexscreener.com/latest/dex/tokens/<address>
 *     -> 200 (see prices.ts).
 *   - Trending: GET https://api.geckoterminal.com/api/v2/networks/trending_pools
 *     — NOT verified from this VM (no curl test returned for it in this
 *     session); if it fails, fetchTrending returns an empty list with a
 *     clear error instead of a fabricated trending list. DexScreener's
 *     public latest API has no documented trending endpoint.
 */
import { fetchTokenMarketData, type TokenMarketData } from './prices';

export interface DiscoverToken {
  symbol: string;
  name: string;
  chainId: string; // DexScreener chain slug, e.g. 'bsc' / 'solana'
  address: string;
  pairAddress: string | null;
  priceUsd: number | null;
  change24h: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  dexId: string | null;
  url: string | null;
}

export interface DiscoverResult {
  tokens: DiscoverToken[];
  source: 'dexscreener' | 'geckoterminal' | 'unavailable';
  error: string | null;
  updatedAt: number;
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

function mapPair(p: {
  chainId?: string;
  baseToken?: { symbol?: string; name?: string; address?: string };
  priceUsd?: string;
  priceChange?: { h24?: number };
  marketCap?: number;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  pairAddress?: string;
  dexId?: string;
  url?: string;
}): DiscoverToken {
  return {
    symbol: p.baseToken?.symbol ?? '',
    name: p.baseToken?.name ?? '',
    chainId: p.chainId ?? '',
    address: p.baseToken?.address ?? '',
    pairAddress: p.pairAddress ?? null,
    priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
    change24h: typeof p.priceChange?.h24 === 'number' ? p.priceChange.h24 : null,
    marketCap: typeof p.marketCap === 'number' ? p.marketCap : null,
    liquidityUsd: typeof p.liquidity?.usd === 'number' ? p.liquidity.usd : null,
    volume24h: typeof p.volume?.h24 === 'number' ? p.volume.h24 : null,
    dexId: p.dexId ?? null,
    url: p.url ?? null,
  };
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
    const pairs: unknown[] = Array.isArray(json?.pairs) ? json.pairs : [];
    const tokens = pairs
      .map((p) => mapPair(p as Parameters<typeof mapPair>[0]))
      .filter((t) => t.symbol && t.address)
      .slice(0, limit);
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

/** Trending pools (GeckoTerminal). Unverified endpoint — see header. */
export async function fetchTrending(limit = 20): Promise<DiscoverResult> {
  try {
    const res = await fetchWithTimeout('https://api.geckoterminal.com/api/v2/networks/trending_pools');
    if (!res.ok) {
      return {
        tokens: [],
        source: 'unavailable',
        error: `Trending pools returned HTTP ${res.status} — trending is unavailable, not fabricated.`,
        updatedAt: Date.now(),
      };
    }
    const json = await res.json();
    const pools: unknown[] = Array.isArray(json?.data) ? json.data : [];
    const tokens: DiscoverToken[] = pools
      .map((pool) => {
        const p = pool as {
          attributes?: {
            name?: string;
            address?: string;
            base_token_price_usd?: string;
            market_cap_usd?: string;
            reserve_in_usd?: string;
            volume_usd?: { h24?: string };
          };
          relationships?: { base_token?: { data?: { id?: string } } };
        };
        const a = p.attributes ?? {};
        const baseId = p.relationships?.base_token?.data?.id ?? '';
        const address = baseId.includes('_') ? baseId.split('_').slice(1).join('_') : '';
        const name = a.name ?? '';
        const symbol = name.split('/')[0]?.trim() ?? '';
        return {
          symbol,
          name,
          chainId: '',
          address,
          pairAddress: a.address ?? null,
          priceUsd: a.base_token_price_usd ? Number(a.base_token_price_usd) : null,
          change24h: null,
          marketCap: a.market_cap_usd ? Number(a.market_cap_usd) : null,
          liquidityUsd: a.reserve_in_usd ? Number(a.reserve_in_usd) : null,
          volume24h: a.volume_usd?.h24 ? Number(a.volume_usd.h24) : null,
          dexId: null,
          url: null,
        } as DiscoverToken;
      })
      .filter((t) => t.symbol && t.pairAddress)
      .slice(0, limit);
    return { tokens, source: 'geckoterminal', error: null, updatedAt: Date.now() };
  } catch (e) {
    return {
      tokens: [],
      source: 'unavailable',
      error: `Trending pools failed: ${e instanceof Error ? e.message : String(e)}`,
      updatedAt: Date.now(),
    };
  }
}

/** Full market data for a discovered token (DexScreener, GeckoTerminal fallback). */
export async function fetchDiscoverTokenDetail(
  chainId: string,
  address: string,
): Promise<TokenMarketData | null> {
  return fetchTokenMarketData(chainId, address);
}
