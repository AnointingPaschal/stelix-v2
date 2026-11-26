/**
 * Lock-derived notifications (src/lib/notifications.ts) — Group B.
 * The Notifications screen must show real alerts from the user's own
 * locks, never invented events.
 */
import { deriveLockNotifications } from '../notifications';
import type { BullLock } from '../vault';

const DAY = 86_400_000;
const NOW = Date.now();

function makeLock(over: Partial<BullLock> = {}): BullLock {
  return {
    id: 'TEST-1',
    chainId: 'bnb',
    tokenSymbol: 'WKC',
    tokenAddress: '0xabc',
    amount: 10000,
    amountRemaining: 10000,
    entryPrice: 0.02,
    unlockTime: NOW + 365 * DAY,
    targetPrice: 0.06,
    targetMultiple: 3,
    ladder: [
      { multiple: 2, percent: 25, status: 'pending' },
      { multiple: 3, percent: 25, status: 'pending' },
      { multiple: 5, percent: 25, status: 'pending' },
      { multiple: 10, percent: 25, status: 'pending' },
    ],
    trailingStopBps: 1500,
    peakPrice: 0.02,
    breakMode: 'penalty',
    penaltyBps: 500,
    autoSell: true,
    slippageBps: 150,
    minReceiveUsd: 100,
    status: 'active',
    createdAt: NOW,
    ...over,
  };
}

const priceOf = (price: number | null) => () => price;

describe('deriveLockNotifications', () => {
  it('is empty when there are no locks', () => {
    expect(deriveLockNotifications([], priceOf(0.02), NOW)).toEqual([]);
  });

  it('flags a matured lock as claimable', () => {
    const rows = deriveLockNotifications(
      [makeLock({ unlockTime: NOW - 1000 })],
      priceOf(0.02),
      NOW,
    );
    expect(rows.some((r) => r.kind === 'maturity' && /matured/.test(r.title))).toBe(true);
  });

  it('flags a lock maturing within 7 days', () => {
    const rows = deriveLockNotifications(
      [makeLock({ unlockTime: NOW + 3 * DAY })],
      priceOf(0.02),
      NOW,
    );
    expect(rows.some((r) => /matures in 3 days/.test(r.title))).toBe(true);
  });

  it('does not flag a lock maturing in a year', () => {
    const rows = deriveLockNotifications([makeLock()], priceOf(0.02), NOW);
    expect(rows.filter((r) => r.kind === 'maturity')).toEqual([]);
  });

  it('flags 50% / 80% / 100% target progress', () => {
    // Entry 0.02, target 0.06 (3x). Progress is (price - entry) / (target - entry).
    const half = deriveLockNotifications([makeLock()], priceOf(0.04), NOW);
    expect(half.some((r) => /Halfway/.test(r.title))).toBe(true);
    const eighty = deriveLockNotifications([makeLock()], priceOf(0.052), NOW);
    expect(eighty.some((r) => /80%/.test(r.title))).toBe(true);
    const hit = deriveLockNotifications([makeLock()], priceOf(0.06), NOW);
    expect(hit.some((r) => /Target reached/.test(r.title))).toBe(true);
  });

  it('flags a breached trailing stop after a target hit', () => {
    const lock = makeLock({
      ladder: [
        { multiple: 2, percent: 25, status: 'sold' },
        { multiple: 3, percent: 25, status: 'pending' },
        { multiple: 5, percent: 25, status: 'pending' },
        { multiple: 10, percent: 25, status: 'pending' },
      ],
      peakPrice: 0.06,
    });
    // 15% trailing stop: peak 0.06 -> breach below 0.051.
    const rows = deriveLockNotifications([lock], priceOf(0.05), NOW);
    expect(rows.some((r) => r.kind === 'trailing')).toBe(true);
  });

  it('flags a break cooling-off in progress', () => {
    const rows = deriveLockNotifications(
      [makeLock({ breakRequestedAt: NOW - 1000 })],
      priceOf(0.02),
      NOW,
    );
    expect(rows.some((r) => r.kind === 'break' && /cooling-off/.test(r.title))).toBe(true);
  });

  it('skips completed and broken locks entirely', () => {
    const rows = deriveLockNotifications(
      [makeLock({ status: 'completed', unlockTime: NOW - 1000 }), makeLock({ id: 'TEST-2', status: 'broken', unlockTime: NOW - 1000 })],
      priceOf(0.02),
      NOW,
    );
    expect(rows).toEqual([]);
  });
});
