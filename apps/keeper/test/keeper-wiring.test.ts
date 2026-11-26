// Keeper wiring tests — pure mapping helpers (no network, no keys).
// Covers: D1 lock-id parsing, getLock -> LockInput mapping (including the
// skip cases), next-stage amounts, and TWAP-reference price impact.
import { describe, expect, it } from 'vitest'
import { parseLockId, lockInputFromGetLock, nextStageAmount, impactVsTwap } from '../src/mapping'
import type { GetLockResult } from '../src/mapping'

function lock(over: Partial<GetLockResult> = {}): GetLockResult {
  return {
    owner: '0xOwner',
    token: '0xToken',
    amountRemaining: 1000n * 10n ** 18n,
    amountTotal: 1000n * 10n ** 18n,
    entryPrice: 10n ** 18n,
    unlockTime: 1893456000n,
    ladderStages: [
      { targetPrice: 2n * 10n ** 18n, sellBps: 5000, sold: false },
      { targetPrice: 3n * 10n ** 18n, sellBps: 5000, sold: false },
    ],
    trailingStopBps: 1000,
    peakPrice: 2n * 10n ** 18n,
    breakMode: 0,
    penaltyBps: 0,
    autoSell: true,
    stablecoin: '0xStable',
    stablecoinDecimals: 6,
    router: '0xRouter',
    slippageBps: 150,
    minReceivePerStage: 0n,
    status: 0,
    feeBps: 0,
    penaltyRecipient: '0x0000000000000000000000000000000000000000',
    breakRequestedAt: 0n,
    ...over,
  }
}

describe('parseLockId', () => {
  it('accepts a bare number and a composite chain:id', () => {
    expect(parseLockId('12')).toBe(12n)
    expect(parseLockId('arc:12')).toBe(12n)
    expect(parseLockId('arc:locks:7')).toBe(7n)
  })
  it('rejects non-numeric ids', () => {
    expect(parseLockId('abc')).toBeNull()
    expect(parseLockId('arc:')).toBeNull()
    expect(parseLockId('')).toBeNull()
  })
})

describe('lockInputFromGetLock', () => {
  it('maps the next unsold stage as the target', () => {
    const input = lockInputFromGetLock(lock(), '5', 'arc')
    expect(input?.lockId).toBe('5')
    expect(input?.targetPrice).toBe(2)
    expect(input?.peakPrice).toBe(2)
    expect(input?.status).toBe('Active')
    expect(input?.amountRemaining).toBe(1000 * 1e18)
  })
  it('uses the second stage once the first is sold', () => {
    const l = lock()
    l.ladderStages[0].sold = true
    const input = lockInputFromGetLock(l, '5', 'arc')
    expect(input?.targetPrice).toBe(3)
  })
  it('returns null for terminal locks', () => {
    expect(lockInputFromGetLock(lock({ status: 2 }), '5', 'arc')).toBeNull()
    expect(lockInputFromGetLock(lock({ status: 4 }), '5', 'arc')).toBeNull()
  })
  it('returns null for a pure date lock with no target and no armed trailing stop', () => {
    const input = lockInputFromGetLock(lock({ ladderStages: [], trailingStopBps: 0 }), '5', 'arc')
    expect(input).toBeNull()
  })
  it('keeps a trailing-stop-only lock (stages sold, stop armed)', () => {
    const l = lock()
    l.ladderStages = [{ targetPrice: 2n * 10n ** 18n, sellBps: 10000, sold: true }]
    const input = lockInputFromGetLock(l, '5', 'arc')
    expect(input).not.toBeNull()
    expect(input?.targetPrice).toBe(0)
    expect(input?.trailingStopBps).toBe(1000)
  })
})

describe('nextStageAmount', () => {
  it('takes the bps share of the original amount', () => {
    expect(nextStageAmount(1000n * 10n ** 18n, 2500)).toBe(250n * 10n ** 18n)
  })
})

describe('impactVsTwap', () => {
  it('is 0 when the quote meets the TWAP-implied value', () => {
    // 100 tokens at $2 = $200 = 200_000_000 micro-USDC (6 dec)
    expect(impactVsTwap(200_000_000, 100n * 10n ** 18n, 2, 18, 6)).toBe(0)
  })
  it('measures the shortfall in bps', () => {
    // Quote 190 USDC vs 200 implied = 5% = 500 bps
    expect(impactVsTwap(190_000_000, 100n * 10n ** 18n, 2, 18, 6)).toBeCloseTo(500, 6)
  })
  it('is Infinity when the reference value is zero', () => {
    expect(impactVsTwap(100, 0n, 2, 18, 6)).toBe(Infinity)
    expect(impactVsTwap(100, 100n * 10n ** 18n, 0, 18, 6)).toBe(Infinity)
  })
})
