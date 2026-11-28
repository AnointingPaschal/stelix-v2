/**
 * Portfolio P&L total (Home card): the sum of calcPnl over holdings
 * with a live price + 24h change, and the return on those holdings'
 * starting value. Pure — the Home screen renders calcPortfolioPnl
 * from lib/balances.ts.
 */
import { calcPortfolioPnl } from '../balances';

describe('calcPortfolioPnl', () => {
  it('sums P&L and returns the % on starting value', () => {
    // $110 now, +10% in 24h: was worth $100, P&L +$10, +10%.
    const r = calcPortfolioPnl([{ valueUsd: 110, change24h: 10 }]);
    expect(r.pnl).toBeCloseTo(10, 4);
    expect(r.pct).toBeCloseTo(10, 4);
  });

  it('sums across holdings, mixing gains and losses', () => {
    const r = calcPortfolioPnl([
      { valueUsd: 100, change24h: 10 }, // +9.0909
      { valueUsd: 50, change24h: -50 }, // -50
    ]);
    expect(r.pnl).toBeCloseTo(-40.9091, 4);
    // Starting value 100/1.1 + 50/0.5 = 90.909 + 100 = 190.909.
    expect(r.pct).toBeCloseTo(-21.4286, 4);
  });

  it('is null when no holding has price data', () => {
    expect(calcPortfolioPnl([])).toEqual({ pnl: null, pct: null });
    expect(
      calcPortfolioPnl([
        { valueUsd: null, change24h: 10 },
        { valueUsd: 100, change24h: null },
        { valueUsd: 100, change24h: undefined },
      ]),
    ).toEqual({ pnl: null, pct: null });
  });

  it('ignores holdings without a price or a change, keeps the rest', () => {
    const r = calcPortfolioPnl([
      { valueUsd: null, change24h: 10 },
      { valueUsd: 110, change24h: 10 },
      { valueUsd: 55, change24h: null },
    ]);
    expect(r.pnl).toBeCloseTo(10, 4);
    expect(r.pct).toBeCloseTo(10, 4);
  });

  it('a zero-value holding contributes $0 P&L and no % (start value 0)', () => {
    const r = calcPortfolioPnl([{ valueUsd: 0, change24h: 10 }]);
    expect(r.pnl).toBe(0);
    expect(r.pct).toBeNull();
  });

  it('skips the -100% edge instead of dividing by zero', () => {
    expect(calcPortfolioPnl([{ valueUsd: 100, change24h: -100 }])).toEqual({
      pnl: null,
      pct: null,
    });
  });
});
