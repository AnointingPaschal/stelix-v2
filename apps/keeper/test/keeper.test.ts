import { describe, expect, it } from 'vitest'
import { computeTWAP, trailingStopBreached, twapAtOrAboveTarget } from '../src/twap'
import { checkMinReceive, checkPriceImpact, priceImpactBps, retryDelayMs, shouldRetry } from '../src/guards'
import { decideLock } from '../src/keeper'
import type { LockInput, PricePoint } from '../src/types'

const NOW = 1_800_000_000_000
const flat = (price: number, minutes = 30): PricePoint[] =>
  Array.from({ length: minutes + 1 }, (_, i) => ({ price, timestampMs: NOW - (minutes - i) * 60_000 }))
const baseLock: LockInput = { lockId: 'LK-1', chain: 'arc', owner: '0xOwner', token: '0xToken', amountRemaining: 1000, targetPrice: 3, peakPrice: 3.2, trailingStopBps: 1000, autoSell: true, status: 'Active', minReceivePerStage: 100, slippageBps: 150 }

describe('TWAP guard', () => {
  it('averages over 30 minutes — a 1-minute wick does not move it above target', () => {
    const points = flat(2) // 29 min at 2.0…
    points.push({ price: 10, timestampMs: NOW }) // …then a 1-min spike to 10
    const twap = computeTWAP(points, 30 * 60_000, NOW)
    expect(twap).toBeLessThan(3)
    expect(twapAtOrAboveTarget(twap, 3)).toBe(false)
  })
  it('holds above target when price genuinely stays above it', () => {
    const twap = computeTWAP(flat(3.5), 30 * 60_000, NOW)
    expect(twapAtOrAboveTarget(twap, 3)).toBe(true)
  })
  it('returns NaN with no points in window', () => {
    expect(computeTWAP([], 30 * 60_000, NOW)).toBeNaN()
  })
})

describe('price-impact guard', () => {
  it('blocks a stage that would move price beyond the 5% limit', () => {
    // Selling 100 into a 1000 reserve = ~9.1% impact
    expect(priceImpactBps(100, 1000)).toBeGreaterThan(500)
    const d = checkPriceImpact({ expectedOut: 500, priceImpactBps: priceImpactBps(100, 1000), reserveIn: 1000, reserveOut: 5000 }, 500)
    expect(d.action).toBe('pause-and-notify')
  })
  it('allows a small stage in a deep pool', () => {
    const d = checkPriceImpact({ expectedOut: 500, priceImpactBps: priceImpactBps(10, 100_000), reserveIn: 100_000, reserveOut: 500_000 }, 500)
    expect(d.action).toBe('trigger')
  })
})

describe('minimum-receive guard', () => {
  it('pauses when expected receive is below the minimum', () => {
    expect(checkMinReceive({ expectedOut: 50, priceImpactBps: 100, reserveIn: 1000, reserveOut: 1000 }, 100).action).toBe('pause-and-notify')
    expect(checkMinReceive({ expectedOut: 150, priceImpactBps: 100, reserveIn: 1000, reserveOut: 1000 }, 100).action).toBe('trigger')
  })
})

describe('trailing stop', () => {
  it('breaches after a 10% fall from peak', () => {
    expect(trailingStopBreached(10, 9, 1000)).toBe(true)
    expect(trailingStopBreached(10, 9.5, 1000)).toBe(false)
    expect(trailingStopBreached(10, 9, 0)).toBe(false) // trailing stop off
  })
})

describe('retry / fail-safe', () => {
  it('backs off exponentially and stops after max retries', () => {
    expect(retryDelayMs(0)).toBe(60_000)
    expect(retryDelayMs(1)).toBe(120_000)
    expect(retryDelayMs(10)).toBe(15 * 60_000) // capped
    expect(shouldRetry(2, 3)).toBe(true)
    expect(shouldRetry(3, 3)).toBe(false)
  })
})

describe('decideLock end-to-end', () => {
  it('triggers when TWAP is above target and guards pass', () => {
    const d = decideLock(baseLock, flat(3.5), { expectedOut: 200, priceImpactBps: 100, reserveIn: 100_000, reserveOut: 100_000 }, 500)
    expect(d.action).toBe('trigger')
  })
  it('skips when TWAP is below target and no stop breach', () => {
    // Peak 2.1 so price 2.0 is NOT a 10% trailing-stop fall (2.0 > 2.1 x 0.9).
    const d = decideLock({ ...baseLock, peakPrice: 2.1 }, flat(2), { expectedOut: 200, priceImpactBps: 100, reserveIn: 100_000, reserveOut: 100_000 }, 500)
    expect(d.action).toBe('skip')
  })
  it('pauses instead of forcing a bad sell when impact is too high', () => {
    const d = decideLock(baseLock, flat(3.5), { expectedOut: 200, priceImpactBps: 900, reserveIn: 1000, reserveOut: 1000 }, 500)
    expect(d.action).toBe('pause-and-notify')
  })
  it('triggers on trailing-stop breach even below target', () => {
    const d = decideLock({ ...baseLock, peakPrice: 5 }, flat(4.4), { expectedOut: 200, priceImpactBps: 100, reserveIn: 100_000, reserveOut: 100_000 }, 500)
    expect(d.action).toBe('trigger')
  })
  it('skips when auto-sell is off', () => {
    const d = decideLock({ ...baseLock, autoSell: false }, flat(3.5), { expectedOut: 200, priceImpactBps: 100, reserveIn: 100_000, reserveOut: 100_000 }, 500)
    expect(d.action).toBe('skip')
  })
})
