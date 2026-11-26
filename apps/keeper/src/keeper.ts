// Keeper decision engine (spec Part G, steps 1–5). Pure functions — tested in test/.
import { computeTWAP, trailingStopBreached, twapAtOrAboveTarget } from './twap'
import { checkMinReceive, checkPriceImpact } from './guards'
import type { LockInput, PricePoint, SwapSimulation, TriggerDecision } from './types'

export function decideLock(lock: LockInput, points: PricePoint[], sim: SwapSimulation | null, maxImpactBps: number): TriggerDecision {
  if (!lock.autoSell) return { action: 'skip', reason: 'Auto-sell off for this lock.' }
  if (lock.status !== 'Active' && lock.status !== 'PartiallySold') return { action: 'skip', reason: `Lock status ${lock.status} is not triggerable.` }
  const twap = computeTWAP(points)
  const targetHit = twapAtOrAboveTarget(twap, lock.targetPrice)
  const stopHit = trailingStopBreached(lock.peakPrice, points[points.length - 1]?.price ?? NaN, lock.trailingStopBps)
  if (!targetHit && !stopHit) return { action: 'skip', reason: `TWAP ${Number.isFinite(twap) ? twap.toFixed(4) : 'n/a'} below target ${lock.targetPrice}; trailing stop not breached.` }
  if (!sim) return { action: 'retry', reason: 'No swap simulation available — retry next run.', retryInMs: 60_000 }
  const impact = checkPriceImpact(sim, maxImpactBps)
  if (impact.action !== 'trigger') return impact
  const receive = checkMinReceive(sim, lock.minReceivePerStage)
  if (receive.action !== 'trigger') return receive
  return { action: 'trigger', reason: `${targetHit ? 'TWAP at/above target' : 'Trailing stop breached'}; guards passed. Calling executeTrigger.` }
}
