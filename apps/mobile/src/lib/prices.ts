/**
 * LIVE price / market-data layer — DexScreener + CoinGecko + GeckoTerminal.
 * NO demo data, NO hardcoded prices, NO invented values.
 *
 * Verified live from this VM on 2026-11-26 (curl):
 *   - DexScreener  GET https://api.dexscreener.com/latest/dex/tokens/<address>
 *     and /latest/dex/search?q=<query>  -> 200, real pairs (WBNB $552.90)
 *   - CoinGecko    GET https://api.coingecko.com/api/v3/simple/price
 *     -> 200 (binancecoin $552.51, 24h +2.48%)
 *   - GeckoTerminal GET https://api.geckoterminal.com/api/v2/networks/bsc/tokens/<address>
 *     -> 200
 *   - DexScreener /latest/dex/pairs/<chain>/<pair> returns {"pairs":null}
 *     for a token address (it wants a PAIR address) — do not use it with
 *     token addresses.
 * Candles come from GeckoTerminal OHLCV (see fetchCandles); DexScreener's
 * public latest API has no OHLCV endpoint.
 *
 * Every price carries its source + timestamp. When a source is down the
 * value is null with source 'unavailable' — never a stale/demo number
 * presented as live. EMA/RSI are computed from REAL candles only; with
 * too few candles they return null and the UI must show "—".
 */
import { useEffect, useState } from 'react';
import { getChain } from './chains';

export type PriceSource = 'dexscreener' | 'coingecko' | 'geckoterminal' | 'unavailable';

export interface LivePrice {
  price: number | null; // null = no live price available right now
  change24h: number | null;
  source: PriceSource;
  updatedAt: number;
  error?: string;
}

export interface TokenMarketData {
  symbol: string;
  name: string;
  chainId: string; // Stelix chain id, e.g. 'bnb'
  address: string;
  priceUsd: number | null;
  priceNative: number | null;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  /** buys / (buys + sells) over 24h, null when tx counts are missing. */
  buyPressure: number | null;
  pairAddress: string | null;
  dexId: string | null;
  url: string | null;
  source: PriceSource;
  updatedAt: number;
}

export interface Candle {
  time: number; // epoch ms (bucket start)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SafetyScore {
  /** 0..100 when enough real inputs exist, else null. */
  score: number | null;
  label: string;
  /** Every input that went into the score, labelled — or why it is missing. */
  inputs: { name: string; value: string; ok: boolean | null }[];
}

async function fetchWithTimeout(url: string, ms = 8000, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

function signedNum(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// CoinGecko (no key) — majors only, by CoinGecko id.
// ---------------------------------------------------------------------------

export async function fetchCoinGeckoPrice(
  coingeckoId: string,
): Promise<{ price: number | null; change24h: number | null }> {
  try {
    const res = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=usd&include_24hr_change=true`,
    );
    if (!res.ok) return { price: null, change24h: null };
    const json = await res.json();
    const entry = json[coingeckoId];
    return {
      price: typeof entry?.usd === 'number' ? entry.usd : null,
      change24h: typeof entry?.usd_24h_change === 'number' ? entry.usd_24h_change : null,
    };
  } catch {
    return { price: null, change24h: null };
  }
}

export async function fetchMajorPrices(
  coingeckoIds: string[],
): Promise<Record<string, { price: number | null; change24h: number | null; source: PriceSource; updatedAt: number }>> {
  const out: Record<string, { price: number | null; change24h: number | null; source: PriceSource; updatedAt: number }> = {};
  if (coingeckoIds.length === 0) return out;
  try {
    const res = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoIds.map(encodeURIComponent).join(',')}&vs_currencies=usd&include_24hr_change=true`,
    );
    if (!res.ok) {
      coingeckoIds.forEach((id) => {
        out[id] = { price: null, change24h: null, source: 'unavailable', updatedAt: Date.now() };
      });
      return out;
    }
    const json = await res.json();
    coingeckoIds.forEach((id) => {
      const e = json[id];
      out[id] = {
        price: typeof e?.usd === 'number' ? e.usd : null,
        change24h: typeof e?.usd_24h_change === 'number' ? e.usd_24h_change : null,
        source: typeof e?.usd === 'number' ? 'coingecko' : 'unavailable',
        updatedAt: Date.now(),
      };
    });
  } catch {
    coingeckoIds.forEach((id) => {
      out[id] = { price: null, change24h: null, source: 'unavailable', updatedAt: Date.now() };
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// DexScreener (no key) — token market data, by chain slug + token address.
// ---------------------------------------------------------------------------

export async function fetchDexScreenerToken(
  chainId: string,
  address: string,
): Promise<TokenMarketData | null> {
  const chain = getChain(chainId);
  try {
    const res = await fetchWithTimeout(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    const pairs: unknown[] = Array.isArray(json?.pairs) ? json.pairs : [];
    // Prefer a pair on the requested chain, then the highest-liquidity pair.
    const onChain = pairs.filter(
      (p) => (p as { chainId?: string }).chainId === chain.dexScreenerChainId,
    );
    const pool = [...onChain, ...pairs].sort(
      (a, b) =>
        Number((b as { liquidity?: { usd?: number } }).liquidity?.usd ?? 0) -
        Number((a as { liquidity?: { usd?: number } }).liquidity?.usd ?? 0),
    )[0] as
      | {
          baseToken?: { symbol?: string; name?: string; address?: string };
          priceUsd?: string;
          priceNative?: string;
          priceChange?: { h1?: number; h24?: number };
          marketCap?: number;
          liquidity?: { usd?: number };
          volume?: { h24?: number };
          txns?: { h24?: { buys?: number; sells?: number } };
          pairAddress?: string;
          dexId?: string;
          url?: string;
        }
      | undefined;
    if (!pool) return null;
    const buys = pool.txns?.h24?.buys ?? null;
    const sells = pool.txns?.h24?.sells ?? null;
    const buyPressure =
      buys !== null && sells !== null && buys + sells > 0 ? buys / (buys + sells) : null;
    return {
      symbol: pool.baseToken?.symbol ?? '',
      name: pool.baseToken?.name ?? '',
      chainId,
      address: pool.baseToken?.address ?? address,
      priceUsd: num(pool.priceUsd),
      priceNative: num(pool.priceNative),
      change1h: signedNum(pool.priceChange?.h1),
      change24h: signedNum(pool.priceChange?.h24),
      change7d: null, // DexScreener latest API does not return 7d change
      marketCap: num(pool.marketCap),
      liquidityUsd: num(pool.liquidity?.usd),
      volume24h: num(pool.volume?.h24),
      buys24h: buys,
      sells24h: sells,
      buyPressure,
      pairAddress: pool.pairAddress ?? null,
      dexId: pool.dexId ?? null,
      url: pool.url ?? null,
      source: 'dexscreener',
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/** Backwards-compatible name: price only, DexScreener first. */
export async function fetchDexScreenerPrice(chainId: string, address: string): Promise<number | null> {
  const d = await fetchDexScreenerToken(chainId, address);
  return d?.priceUsd ?? null;
}

// ---------------------------------------------------------------------------
// GeckoTerminal (no key) — fallback market data + OHLCV candles.
// ---------------------------------------------------------------------------

export async function fetchGeckoTerminalToken(
  chainId: string,
  address: string,
): Promise<TokenMarketData | null> {
  const chain = getChain(chainId);
  try {
    const res = await fetchWithTimeout(
      `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(chain.geckoTerminalNetwork)}/tokens/${encodeURIComponent(address)}`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    const a = json?.data?.attributes as
      | {
          symbol?: string;
          name?: string;
          price_usd?: string;
          market_cap_usd?: string;
          total_reserve_in_usd?: string;
          volume_usd?: { h24?: string };
        }
      | undefined;
    if (!a) return null;
    return {
      symbol: a.symbol ?? '',
      name: a.name ?? '',
      chainId,
      address,
      priceUsd: num(a.price_usd),
      priceNative: null,
      change1h: null,
      change24h: null,
      change7d: null,
      marketCap: num(a.market_cap_usd),
      liquidityUsd: num(a.total_reserve_in_usd),
      volume24h: num(a.volume_usd?.h24),
      buys24h: null,
      sells24h: null,
      buyPressure: null,
      pairAddress: null,
      dexId: null,
      url: null,
      source: 'geckoterminal',
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/** Token market data: DexScreener first, GeckoTerminal fallback. */
export async function fetchTokenMarketData(
  chainId: string,
  address: string,
): Promise<TokenMarketData | null> {
  return (await fetchDexScreenerToken(chainId, address)) ?? (await fetchGeckoTerminalToken(chainId, address));
}

/** OHLCV candles from GeckoTerminal for a pool. timeframe: 'day' | 'hour' | 'minute'.
 *  Returns [] when the pool/timeframe is unavailable — never invented candles. */
export async function fetchCandles(
  chainId: string,
  poolAddress: string,
  timeframe: 'day' | 'hour' | 'minute' = 'day',
  limit = 100,
): Promise<Candle[]> {
  const chain = getChain(chainId);
  try {
    const res = await fetchWithTimeout(
      `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(chain.geckoTerminalNetwork)}/pools/${encodeURIComponent(poolAddress)}/ohlcv/${timeframe}?limit=${limit}`,
    );
    if (!res.ok) return [];
    const json = await res.json();
    const list: unknown[] = Array.isArray(json?.data?.attributes?.ohlcv_list)
      ? json.data.attributes.ohlcv_list
      : [];
    return list
      .map((row) => {
        const r = row as number[];
        if (!Array.isArray(r) || r.length < 6) return null;
        return {
          time: r[0] * 1000,
          open: r[1],
          high: r[2],
          low: r[3],
          close: r[4],
          volume: r[5],
        } as Candle;
      })
      .filter((c): c is Candle => c !== null && [c.open, c.high, c.low, c.close].every(Number.isFinite));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Indicators — computed from REAL candles only. null = not enough data.
// ---------------------------------------------------------------------------

/** EMA over a close-price series. Returns [] for an empty series. */
export function ema(series: number[], period: number): number[] {
  if (series.length === 0 || period <= 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = series[0];
  for (const p of series) {
    prev = p * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export const computeEma = ema;

/** Last EMA value, or null when there are fewer closes than the period. */
export function lastEma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const values = ema(closes, period);
  return values.length > 0 ? values[values.length - 1] : null;
}

/** RSI(14) over closes. Null when fewer than period+1 closes exist. */
export function computeRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** EMA7 / EMA25 / RSI(14) from real candles, or nulls with a note. */
export function indicatorsFromCandles(candles: Candle[]): {
  ema7: number | null;
  ema25: number | null;
  rsi14: number | null;
  note: string | null;
} {
  const closes = candles.map((c) => c.close);
  const ema7 = lastEma(closes, 7);
  const ema25 = lastEma(closes, 25);
  const rsi14 = computeRsi(closes, 14);
  const note =
    ema7 === null && ema25 === null && rsi14 === null
      ? 'Not enough candle data — indicators unavailable.'
      : null;
  return { ema7, ema25, rsi14, note };
}

// ---------------------------------------------------------------------------
// Safety Score — real inputs only. Missing data => "Insufficient data",
// never a fake score.
// ---------------------------------------------------------------------------

export function computeSafetyScore(data: Partial<TokenMarketData> & { holders?: number | null; top10SharePct?: number | null; honeypot?: boolean | null; mintAuthorityRenounced?: boolean | null }): SafetyScore {
  const inputs: SafetyScore['inputs'] = [];
  let score = 0;
  let weight = 0;

  const liq = data.liquidityUsd ?? null;
  inputs.push({
    name: 'Liquidity',
    value: liq === null ? 'unknown' : `$${Math.round(liq).toLocaleString('en-US')}`,
    ok: liq === null ? null : liq >= 100_000,
  });
  if (liq !== null) {
    score += liq >= 1_000_000 ? 30 : liq >= 100_000 ? 20 : 5;
    weight += 30;
  }

  const vol = data.volume24h ?? null;
  inputs.push({
    name: '24h volume',
    value: vol === null ? 'unknown' : `$${Math.round(vol).toLocaleString('en-US')}`,
    ok: vol === null ? null : vol > 0,
  });
  if (vol !== null) {
    score += vol >= 100_000 ? 15 : vol > 0 ? 8 : 0;
    weight += 15;
  }

  const mc = data.marketCap ?? null;
  inputs.push({
    name: 'Market cap',
    value: mc === null ? 'unknown' : `$${Math.round(mc).toLocaleString('en-US')}`,
    ok: mc === null ? null : mc >= 1_000_000,
  });
  if (mc !== null) {
    score += mc >= 10_000_000 ? 15 : mc >= 1_000_000 ? 10 : 5;
    weight += 15;
  }

  if (data.honeypot !== undefined && data.honeypot !== null) {
    inputs.push({ name: 'Honeypot check', value: data.honeypot ? 'flagged' : 'not flagged', ok: !data.honeypot });
    if (data.honeypot) return { score: 0, label: 'Honeypot flagged', inputs };
    score += 20;
    weight += 20;
  } else {
    inputs.push({ name: 'Honeypot check', value: 'no honeypot API data', ok: null });
  }

  if (data.top10SharePct !== undefined && data.top10SharePct !== null) {
    inputs.push({
      name: 'Top-10 holder share',
      value: `${data.top10SharePct}%`,
      ok: data.top10SharePct < 40,
    });
    score += data.top10SharePct < 20 ? 10 : data.top10SharePct < 40 ? 6 : 0;
    weight += 10;
  } else {
    inputs.push({ name: 'Top-10 holder share', value: 'holder data unavailable', ok: null });
  }

  if (data.mintAuthorityRenounced !== undefined && data.mintAuthorityRenounced !== null) {
    inputs.push({
      name: 'Mint authority',
      value: data.mintAuthorityRenounced ? 'renounced' : 'not renounced',
      ok: data.mintAuthorityRenounced,
    });
    score += data.mintAuthorityRenounced ? 10 : 0;
    weight += 10;
  } else {
    inputs.push({ name: 'Mint authority', value: 'contract data unavailable', ok: null });
  }

  if (weight < 45) {
    return { score: null, label: 'Insufficient data', inputs };
  }
  const normalised = Math.round((score / weight) * 100);
  return {
    score: normalised,
    label: normalised >= 80 ? 'Low risk (from available data)' : normalised >= 50 ? 'Medium risk (from available data)' : 'High risk (from available data)',
    inputs,
  };
}

// ---------------------------------------------------------------------------
// Hook: live price for a token the caller identifies.
// Pass chainId + address (DexScreener) and/or coingeckoId (majors).
// With no identifiers the hook returns price null / 'unavailable' — it
// never falls back to a sample price.
// ---------------------------------------------------------------------------

export function useLivePrice(
  symbol: string,
  opts?: { chainId?: string; address?: string; coingeckoId?: string },
): LivePrice {
  const [state, setState] = useState<LivePrice>({
    price: null,
    change24h: null,
    source: 'unavailable',
    updatedAt: Date.now(),
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let price: number | null = null;
      let change24h: number | null = null;
      let source: PriceSource = 'unavailable';
      if (opts?.address && opts?.chainId) {
        const ds = await fetchDexScreenerToken(opts.chainId, opts.address);
        if (ds?.priceUsd) {
          price = ds.priceUsd;
          change24h = ds.change24h;
          source = 'dexscreener';
        }
      }
      if (price === null && opts?.coingeckoId) {
        const cg = await fetchCoinGeckoPrice(opts.coingeckoId);
        if (cg.price !== null) {
          price = cg.price;
          change24h = cg.change24h;
          source = 'coingecko';
        }
      }
      if (!cancelled) {
        setState({
          price,
          change24h,
          source,
          updatedAt: Date.now(),
          error: price === null ? 'Live price unavailable — check your connection and try again.' : undefined,
        });
      }
    };
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, opts?.chainId, opts?.address, opts?.coingeckoId]);

  return state;
}
