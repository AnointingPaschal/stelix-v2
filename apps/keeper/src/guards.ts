// Exit guards (spec Part B): price-impact + minimum-receive. A swap that
// fails either guard is paused + notified + retried — never forced.
import type { SwapSimulation, TriggerDecision } from './types'

/** Constant-product estimate: selling amountIn of reserveIn moves price by this much. */
export function priceImpactBps(amountIn: number, reserveIn: number): number {
  if (reserveIn <= 0 || amountIn <= 0) return Infinity
  return (amountIn / (reserveIn + amountIn)) * 10000
}

export function checkPriceImpact(sim: SwapSimulation, maxImpactBps: number): TriggerDecision {
  if (sim.priceImpactBps > maxImpactBps) {
    return { action: 'pause-and-notify', reason: `Price impact ${sim.priceImpactBps.toFixed(0)} bps exceeds limit ${maxImpactBps} bps — pausing, will retry next run rather than forcing a bad sell.` }
  }
  return { action: 'trigger', reason: `Price impact ${sim.priceImpactBps.toFixed(0)} bps within limit ${maxImpactBps} bps.` }
}

export function checkMinReceive(sim: SwapSimulation, minReceive: number): TriggerDecision {
  if (sim.expectedOut < minReceive) {
    return { action: 'pause-and-notify', reason: `Expected receive ${sim.expectedOut} below minimum ${minReceive} — pausing, will retry next run.` }
  }
  return { action: 'trigger', reason: `Expected receive ${sim.expectedOut} meets minimum ${minReceive}.` }
}

/** Fail-safe retry: exponential backoff, capped; after max attempts, pause + notify. */
export function retryDelayMs(attempt: number, baseMs = 60_000, maxMs = 15 * 60_000): number {
  return Math.min(baseMs * 2 ** attempt, maxMs)
}
export function shouldRetry(attempt: number, maxRetries: number): boolean { return attempt < maxRetries }
