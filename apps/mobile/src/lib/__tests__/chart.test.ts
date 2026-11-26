/** Advanced chart data — live-candle merge, indicators, tiny-price display. */
import {
  bollingerSeries,
  bucketMsFor,
  lastMacd,
  macdSeries,
  mergeLivePrice,
  TIMEFRAME_CONFIG,
} from '../chart';
import type { Candle } from '../prices';

function candle(time: number, close: number, volume = 100): Candle {
  return { time, open: close, high: close, low: close, close, volume };
}

describe('mergeLivePrice — last candle updates live, history never invented', () => {
  const bucket = 15 * 60_000;
  const base = 1_800_000_000_000; // a 15m bucket boundary
  const series = [candle(base, 100), candle(base + bucket, 102), candle(base + 2 * bucket, 101)];

  it('updates the last candle close/high/low for a tick inside its bucket', () => {
    const out = mergeLivePrice(series, 105, bucket, base + 2 * bucket + 60_000);
    expect(out).toHaveLength(3);
    expect(out[2].close).toBe(105);
    expect(out[2].high).toBe(105);
    expect(out[2].low).toBe(101);
    expect(out[2].open).toBe(101);
    // Earlier candles untouched.
    expect(out[0]).toEqual(series[0]);
    expect(out[1]).toEqual(series[1]);
  });

  it('a lower tick moves the low but not the high', () => {
    const out = mergeLivePrice(series, 99, bucket, base + 2 * bucket + 60_000);
    expect(out[2].close).toBe(99);
    expect(out[2].high).toBe(101);
    expect(out[2].low).toBe(99);
  });

  it('opens a new bucket at the last known close when the tick is past it', () => {
    const out = mergeLivePrice(series, 104, bucket, base + 3 * bucket + 30_000);
    expect(out).toHaveLength(4);
    expect(out[3].open).toBe(101); // continuity from the real last close
    expect(out[3].close).toBe(104);
    expect(out[3].high).toBe(104);
    expect(out[3].low).toBe(104);
    expect(out[3].time).toBe(base + 3 * bucket);
  });

  it('never invents history: an empty series stays empty', () => {
    expect(mergeLivePrice([], 100, bucket, base)).toEqual([]);
  });

  it('ignores a tick older than the last candle and a non-positive price', () => {
    expect(mergeLivePrice(series, 200, bucket, base + bucket)).toEqual(series);
    expect(mergeLivePrice(series, 0, bucket, base + 2 * bucket + 1)).toEqual(series);
    expect(mergeLivePrice(series, NaN, bucket, base + 2 * bucket + 1)).toEqual(series);
  });

  it('does not mutate the input array', () => {
    const copy = series.map((c) => ({ ...c }));
    mergeLivePrice(series, 105, bucket, base + 2 * bucket + 60_000);
    expect(series).toEqual(copy);
  });
});

describe('timeframe config', () => {
  it('maps 5m/15m/1h/4h/1d to GeckoTerminal granularity + aggregate', () => {
    expect(TIMEFRAME_CONFIG['5m']).toEqual({ granularity: 'minute', aggregate: 5, bucketMs: 5 * 60_000 });
    expect(TIMEFRAME_CONFIG['15m']).toEqual({ granularity: 'minute', aggregate: 15, bucketMs: 15 * 60_000 });
    expect(TIMEFRAME_CONFIG['1h']).toEqual({ granularity: 'hour', aggregate: 1, bucketMs: 3_600_000 });
    expect(TIMEFRAME_CONFIG['4h']).toEqual({ granularity: 'hour', aggregate: 4, bucketMs: 14_400_000 });
    expect(TIMEFRAME_CONFIG['1d']).toEqual({ granularity: 'day', aggregate: 1, bucketMs: 86_400_000 });
    expect(bucketMsFor('1h')).toBe(3_600_000);
  });
});

describe('Bollinger + MACD series', () => {
  const closes = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);

  it('bollinger bands bracket the price with middle = rolling mean', () => {
    const bb = bollingerSeries(closes);
    expect(bb.upper).toHaveLength(40);
    expect(bb.middle).toHaveLength(40);
    expect(bb.lower).toHaveLength(40);
    const i = 39;
    expect(bb.upper[i]).toBeGreaterThan(bb.middle[i]);
    expect(bb.lower[i]).toBeLessThan(bb.middle[i]);
    expect(bb.upper[i] - bb.lower[i]).toBeGreaterThan(0);
  });

  it('macd is positive on a rising series and nulls with too few closes', () => {
    const m = macdSeries(closes);
    expect(m.macd).toHaveLength(40);
    expect(m.signal).toHaveLength(40);
    expect(m.histogram).toHaveLength(40);
    expect(m.macd[39]).toBeGreaterThan(0);
    expect(lastMacd([1, 2, 3]).macd).toBeNull();
    const last = lastMacd(closes);
    expect(last.macd).not.toBeNull();
    expect(last.histogram).toBeCloseTo(last.macd! - last.signal!, 10);
  });
});
