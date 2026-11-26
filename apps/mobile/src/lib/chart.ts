/**
 * Pure chart math for the advanced Token Detail chart — no React Native
 * imports, so it is unit testable under Jest (node).
 *
 * Rules:
 *  - Candles come only from real OHLCV (GeckoTerminal, see prices.ts).
 *    mergeLivePrice() updates the CURRENT bucket's close/high/low from a
 *    live tick, or opens a new bucket seeded from the last known close.
 *    It never invents history: an empty series stays empty, and a tick
 *    older than the last candle is ignored.
 *  - Indicators (EMA / Bollinger / MACD / RSI via prices.ts) are computed
 *    from real closes only.
 */
import type { Candle } from './prices';

export type ChartTimeframe = '5m' | '15m' | '1h' | '4h' | '1d';
export const CHART_TIMEFRAMES: ChartTimeframe[] = ['5m', '15m', '1h', '4h', '1d'];

export interface TimeframeConfig {
  /** GeckoTerminal OHLCV granularity. */
  granularity: 'minute' | 'hour' | 'day';
  /** GeckoTerminal aggregate for that granularity. */
  aggregate: number;
  /** Bucket length in ms — also the live-merge bucket. */
  bucketMs: number;
}

export const TIMEFRAME_CONFIG: Record<ChartTimeframe, TimeframeConfig> = {
  '5m': { granularity: 'minute', aggregate: 5, bucketMs: 5 * 60_000 },
  '15m': { granularity: 'minute', aggregate: 15, bucketMs: 15 * 60_000 },
  '1h': { granularity: 'hour', aggregate: 1, bucketMs: 60 * 60_000 },
  '4h': { granularity: 'hour', aggregate: 4, bucketMs: 4 * 60 * 60_000 },
  '1d': { granularity: 'day', aggregate: 1, bucketMs: 24 * 60 * 60_000 },
};

export function bucketMsFor(tf: ChartTimeframe): number {
  return TIMEFRAME_CONFIG[tf].bucketMs;
}

/**
 * Merge a live price tick into a candle series.
 *  - Tick inside the last bucket: close/high/low of that candle move.
 *  - Tick past the last bucket: a new candle opens at the last known
 *    close (real continuity, not invented history).
 *  - Empty series, a non-positive price, or a tick older than the last
 *    candle: the series is returned unchanged.
 * The input array is never mutated; a new array is returned.
 */
export function mergeLivePrice(
  candles: Candle[],
  price: number,
  bucketMs: number,
  now: number = Date.now(),
): Candle[] {
  if (!Number.isFinite(price) || price <= 0 || bucketMs <= 0) return candles;
  if (candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  if (now < last.time) return candles;
  if (now < last.time + bucketMs) {
    const updated: Candle = {
      ...last,
      close: price,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
    };
    return [...candles.slice(0, -1), updated];
  }
  const bucketStart = Math.floor(now / bucketMs) * bucketMs;
  const next: Candle = {
    time: bucketStart,
    open: last.close,
    high: price,
    low: price,
    close: price,
    volume: 0,
  };
  return [...candles, next];
}

// ---------------------------------------------------------------------------
// Indicators (series form, for drawing). Seeded like prices.ema() so a
// value exists from the first candle; the UI shows "—" until enough
// candles exist (see prices.indicatorsFromCandles for the honest gate).
// ---------------------------------------------------------------------------

/** Bollinger Bands (period 20, ±2σ) over closes. */
export function bollingerSeries(
  closes: number[],
  period = 20,
  mult = 2,
): { upper: number[]; middle: number[]; lower: number[] } {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const start = Math.max(0, i - period + 1);
    const window = closes.slice(start, i + 1);
    const mean = window.reduce((s, v) => s + v, 0) / window.length;
    const variance = window.reduce((s, v) => s + (v - mean) * (v - mean), 0) / window.length;
    const sd = Math.sqrt(variance);
    middle.push(mean);
    upper.push(mean + mult * sd);
    lower.push(mean - mult * sd);
  }
  return { upper, middle, lower };
}

/** MACD (12/26/9): macd line, signal line and histogram, aligned to closes. */
export function macdSeries(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): { macd: number[]; signal: number[]; histogram: number[] } {
  const emaOf = (series: number[], period: number): number[] => {
    if (series.length === 0 || period <= 0) return [];
    const k = 2 / (period + 1);
    const out: number[] = [];
    let prev = series[0];
    for (const p of series) {
      prev = p * k + prev * (1 - k);
      out.push(prev);
    }
    return out;
  };
  const fastEma = emaOf(closes, fast);
  const slowEma = emaOf(closes, slow);
  const macd = closes.map((_, i) => fastEma[i] - slowEma[i]);
  const signal = emaOf(macd, signalPeriod);
  const histogram = macd.map((m, i) => m - signal[i]);
  return { macd, signal, histogram };
}

/** Last MACD values, or nulls when there are too few closes to trust. */
export function lastMacd(
  closes: number[],
): { macd: number | null; signal: number | null; histogram: number | null } {
  if (closes.length < 26 + 9) return { macd: null, signal: null, histogram: null };
  const { macd, signal, histogram } = macdSeries(closes);
  const i = closes.length - 1;
  return { macd: macd[i], signal: signal[i], histogram: histogram[i] };
}
