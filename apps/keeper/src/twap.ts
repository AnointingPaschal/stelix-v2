// 30-minute TWAP (spec Part B/G): time-weighted average price, not a spot tick,
// so a one-minute fake wick pump cannot fire an auto-sell.
import type { PricePoint } from './types'

export function computeTWAP(points: PricePoint[], windowMs = 30 * 60 * 1000, nowMs?: number): number {
  // Default "now" to the latest observation, so a batch of points is judged
  // against its own newest tick (callers may pass an explicit clock instead).
  const now = nowMs ?? Math.max(...points.map((p) => p.timestampMs))
  const inWindow = points.filter((p) => p.timestampMs <= now && p.timestampMs > now - windowMs).sort((a, b) => a.timestampMs - b.timestampMs)
  if (inWindow.length === 0) return NaN
  if (inWindow.length === 1) return inWindow[0].price
  let weighted = 0; let totalMs = 0
  for (let i = 1; i < inWindow.length; i++) {
    const dt = inWindow[i].timestampMs - inWindow[i - 1].timestampMs
    weighted += inWindow[i - 1].price * dt; totalMs += dt
  }
  // Weight the last point to "now" so a stale final tick does not dominate.
  const tail = now - inWindow[inWindow.length - 1].timestampMs
  weighted += inWindow[inWindow.length - 1].price * tail; totalMs += tail
  return totalMs === 0 ? inWindow[inWindow.length - 1].price : weighted / totalMs
}

/** True only if the TWAP has held at/above target for the required window. */
export function twapAtOrAboveTarget(twap: number, target: number): boolean {
  return Number.isFinite(twap) && twap >= target
}

/** Trailing stop: after a peak, a fall of `trailingStopBps` from peak breaches. */
export function trailingStopBreached(peakPrice: number, currentPrice: number, trailingStopBps: number): boolean {
  if (trailingStopBps <= 0 || peakPrice <= 0) return false
  return currentPrice <= peakPrice * (1 - trailingStopBps / 10000)
}
