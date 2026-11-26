// Pure mapping helpers for the keeper's on-chain reads — no network, fully
// unit-tested in test/keeper-wiring.test.ts. Amounts arrive as bigint (raw
// smallest units); the decision engine works in floats, so conversions are
// explicit and documented here, not hidden in the worker.
import type { LockInput } from './types'

export type GetLockResult = {
  owner: string
  token: string
  amountRemaining: bigint
  amountTotal: bigint
  entryPrice: bigint
  unlockTime: bigint
  ladderStages: ReadonlyArray<{ targetPrice: bigint; sellBps: number; sold: boolean }>
  trailingStopBps: number
  peakPrice: bigint
  breakMode: number
  penaltyBps: number
  autoSell: boolean
  stablecoin: string
  stablecoinDecimals: number
  router: string
  slippageBps: number
  minReceivePerStage: bigint
  status: number // 0 Active, 1 PartiallySold, 2 Completed, 3 Matured, 4 Broken
  feeBps: number
  penaltyRecipient: string
  breakRequestedAt: bigint
}

/** Parse a D1 locks.id into a numeric lockId. The indexer writes either a
 * bare number ("12") or a composite id ("arc:12"); both are accepted. */
export function parseLockId(id: string): bigint | null {
  const tail = id.includes(':') ? id.split(':').pop() ?? '' : id
  if (!/^\d+$/.test(tail)) return null
  try {
    return BigInt(tail)
  } catch {
    return null
  }
}

/** Map a vault getLock() result to the keeper's LockInput.
 * Returns null when the lock cannot trigger (terminal status, or no unsold
 * stage and no trailing stop) so the worker skips it instead of calling
 * executeTrigger on a lock that can only revert. Prices are 18-dec USD on
 * chain and become USD floats here; amounts stay in raw smallest units as
 * floats (consistent with the existing decision-engine tests). */
export function lockInputFromGetLock(lock: GetLockResult, lockId: string, chain: string): LockInput | null {
  if (lock.status !== 0 && lock.status !== 1) return null
  const nextStage = lock.ladderStages.find((s) => !s.sold)
  const hasTarget = nextStage !== undefined
  const hasTrailing = lock.trailingStopBps > 0 && lock.ladderStages.some((s) => s.sold)
  if (!hasTarget && !hasTrailing) return null
  return {
    lockId,
    chain,
    owner: lock.owner,
    token: lock.token,
    amountRemaining: Number(lock.amountRemaining),
    targetPrice: hasTarget ? Number(nextStage.targetPrice) / 1e18 : 0,
    peakPrice: Number(lock.peakPrice) / 1e18,
    trailingStopBps: lock.trailingStopBps,
    autoSell: lock.autoSell,
    status: lock.status === 0 ? 'Active' : 'PartiallySold',
    minReceivePerStage: Number(lock.minReceivePerStage),
    slippageBps: lock.slippageBps,
  }
}

/** Next unsold stage's token amount (raw smallest units), from the raw lock. */
export function nextStageAmount(amountTotal: bigint, nextSellBps: number): bigint {
  return (amountTotal * BigInt(nextSellBps)) / 10000n
}

/** Price impact of a quoted swap vs the TWAP reference price, in bps.
 * impliedOut is the TWAP-implied stablecoin output for the stage amount
 * (whole tokens x USD price x stablecoin decimals); a quote below it means
 * the swap itself moves the price. Returns Infinity when the reference
 * value is zero (quote unusable -> pause). */
export function impactVsTwap(expectedOut: number, stageAmount: bigint, twapUsd: number, tokenDecimals: number, stablecoinDecimals: number): number {
  const wholeTokens = Number(stageAmount) / 10 ** tokenDecimals
  const impliedStable = wholeTokens * twapUsd * 10 ** stablecoinDecimals
  if (!(impliedStable > 0) || !Number.isFinite(impliedStable)) return Infinity
  if (expectedOut >= impliedStable) return 0
  return ((impliedStable - expectedOut) / impliedStable) * 10000
}
