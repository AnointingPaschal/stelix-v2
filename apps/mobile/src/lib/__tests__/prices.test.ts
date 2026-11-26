/** Price indicators + safety score — real-data-only rules. */
import { computeRsi, computeSafetyScore, ema, indicatorsFromCandles, lastEma, type Candle } from '../prices';

function candles(closes: number[]): Candle[] {
  return closes.map((c, i) => ({ time: i * 86_400_000, open: c, high: c, low: c, close: c, volume: 100 }));
}

describe('EMA / RSI from real candles', () => {
  it('ema is empty for an empty series and stable for a flat series', () => {
    expect(ema([], 7)).toEqual([]);
    expect(ema([10, 10, 10, 10], 7).every((v) => v === 10)).toBe(true);
  });

  it('lastEma returns null with fewer closes than the period', () => {
    expect(lastEma([1, 2, 3], 7)).toBeNull();
    expect(lastEma([1, 2, 3, 4, 5, 6, 7], 7)).not.toBeNull();
  });

  it('RSI is null with too few closes, 100 for an all-up series, ~50 for flat', () => {
    expect(computeRsi([1, 2, 3], 14)).toBeNull();
    expect(computeRsi(Array.from({ length: 15 }, (_, i) => i + 1))).toBe(100);
    expect(computeRsi(Array.from({ length: 15 }, () => 5))).toBe(50);
  });

  it('indicatorsFromCandles returns nulls + a note when candles are missing', () => {
    const r = indicatorsFromCandles([]);
    expect(r.ema7).toBeNull();
    expect(r.ema25).toBeNull();
    expect(r.rsi14).toBeNull();
    expect(r.note).toMatch(/Not enough candle data/);
  });

  it('indicatorsFromCandles computes EMA7/EMA25/RSI from 30 real candles', () => {
    const r = indicatorsFromCandles(candles(Array.from({ length: 30 }, (_, i) => 100 + i)));
    expect(r.ema7).not.toBeNull();
    expect(r.ema25).not.toBeNull();
    expect(r.rsi14).toBe(100);
    expect(r.note).toBeNull();
  });
});

describe('safety score — real data only', () => {
  it('returns "Insufficient data" (null score) when inputs are missing', () => {
    const s = computeSafetyScore({});
    expect(s.score).toBeNull();
    expect(s.label).toBe('Insufficient data');
    expect(s.inputs.length).toBeGreaterThan(0);
  });

  it('scores deep-liquidity majors high and labels every input', () => {
    const s = computeSafetyScore({ liquidityUsd: 5_000_000, volume24h: 1_000_000, marketCap: 100_000_000, honeypot: false });
    expect(s.score).not.toBeNull();
    expect(s.score!).toBeGreaterThanOrEqual(70);
    expect(s.inputs.map((i) => i.name)).toContain('Liquidity');
  });

  it('a flagged honeypot scores 0', () => {
    const s = computeSafetyScore({ liquidityUsd: 5_000_000, honeypot: true });
    expect(s.score).toBe(0);
    expect(s.label).toMatch(/Honeypot/);
  });
});
