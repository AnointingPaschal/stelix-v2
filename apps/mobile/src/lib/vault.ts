/**
 * Bull Lock engine — pure TypeScript, no React Native imports.
 * Mirrors the StelixVault contract rules from spec Part B / F.
 *
 * Core rule: Unlock = whichever comes first — the unlock date OR the price
 * target (30-min TWAP must hold above target). At the date, tokens return
 * to the wallet. At the price, the due share is auto-sold to the chain's
 * exit stablecoin (registry-driven) and delivered to the wallet.
 *
 * No early-break penalty is ever charged when a price target or the
 * maturity date triggers the exit — a penalty only applies to breaking
 * discipline early with no trigger met.
 */

export type BreakMode = 'immutable' | 'penalty' | 'guardian';
export type LockStatus =
  | 'active'
  | 'partially-sold'
  | 'target-triggered'
  | 'matured'
  | 'completed'
  | 'broken';

export interface LadderStage {
  /** Multiple of entry price, e.g. 2 = 2x. */
  multiple: number;
  /** Share of the ORIGINAL lock amount sold at this stage (percent). */
  percent: number;
  status: 'pending' | 'sold';
  soldUsd?: number;
  soldAt?: number;
}

export interface BullLock {
  id: string;
  chainId: string;
  tokenSymbol: string;
  tokenAddress: string;
  amount: number; // original locked amount (tokens)
  amountRemaining: number;
  entryPrice: number; // USD price recorded at lock time
  unlockTime: number; // epoch ms
  targetPrice: number | null; // null = pure date lock
  targetMultiple: number | null;
  ladder: LadderStage[];
  trailingStopBps: number | null; // e.g. 1500 = 15%
  peakPrice: number; // highest TWAP seen since lock / since last target hit
  breakMode: BreakMode;
  penaltyBps: number; // e.g. 500 = 5% — only on early break, never on trigger
  autoSell: boolean; // sell to stablecoin on target, else unlock to wallet
  slippageBps: number; // default 150 = 1.5%
  minReceiveUsd: number; // minimum acceptable stablecoin for a stage
  status: LockStatus;
  createdAt: number;
  txHash?: string;
}

export interface TwapSample {
  price: number;
  at: number; // epoch ms
}

/** 30-minute time-weighted average price. Returns null with too few samples. */
export function computeTwap(samples: TwapSample[], windowMinutes = 30): number | null {
  if (samples.length === 0) return null;
  const now = Math.max(...samples.map((s) => s.at));
  const cutoff = now - windowMinutes * 60_000;
  const inWindow = samples.filter((s) => s.at >= cutoff);
  if (inWindow.length === 0) return null;
  // Time-weighted: weight each sample by the gap to the next sample.
  const sorted = [...inWindow].sort((a, b) => a.at - b.at);
  let weighted = 0;
  let totalWeight = 0;
  for (let i = 0; i < sorted.length; i++) {
    const nextAt = i + 1 < sorted.length ? sorted[i + 1].at : now;
    const w = Math.max(nextAt - sorted[i].at, 1);
    weighted += sorted[i].price * w;
    totalWeight += w;
  }
  if (totalWeight === 0) return null;
  return weighted / totalWeight;
}

/** Has the maturity date been reached? */
export function isDateReached(lock: BullLock, now = Date.now()): boolean {
  return now >= lock.unlockTime;
}

/** Has the TWAP held at/above the price target? (guards against fake wicks) */
export function isPriceTargetHit(lock: BullLock, twapPrice: number | null): boolean {
  if (lock.targetPrice === null || twapPrice === null) return false;
  return twapPrice >= lock.targetPrice;
}

/** Unlock = whichever comes first: date OR price target. */
export function unlockReason(
  lock: BullLock,
  now: number,
  twapPrice: number | null,
): 'date' | 'price' | null {
  if (isPriceTargetHit(lock, twapPrice)) return 'price';
  if (isDateReached(lock, now)) return 'date';
  return null;
}

export function isUnlocked(lock: BullLock, now: number, twapPrice: number | null): boolean {
  return unlockReason(lock, now, twapPrice) !== null;
}

/** Progress (0..1) towards the price target from the entry price. */
export function targetProgress(lock: BullLock, currentPrice: number): number {
  if (lock.targetPrice === null || lock.targetPrice <= lock.entryPrice) return 0;
  const p = (currentPrice - lock.entryPrice) / (lock.targetPrice - lock.entryPrice);
  return Math.min(1, Math.max(0, p));
}

/** Ladder stages whose multiple has been reached by the TWAP and are pending. */
export function dueLadderStages(lock: BullLock, twapPrice: number | null): LadderStage[] {
  if (twapPrice === null) return [];
  return lock.ladder.filter(
    (s) => s.status === 'pending' && twapPrice >= lock.entryPrice * s.multiple,
  );
}

/** Validate a ladder: percentages must total 100. */
export function validateLadder(stages: LadderStage[]): string | null {
  if (stages.length === 0) return null;
  const total = stages.reduce((sum, s) => sum + s.percent, 0);
  if (total !== 100) return `Ladder stages must total 100% (currently ${total}%).`;
  if (stages.some((s) => s.percent <= 0)) return 'Every ladder stage must sell more than 0%.';
  if (stages.some((s) => s.multiple <= 1)) return 'Ladder multiples must be above 1x.';
  return null;
}

/**
 * Trailing stop: after any target is hit, the vault tracks the peak price.
 * A fall of the chosen % from the peak auto-sells the remainder.
 * Returns true when the stop is breached.
 */
export function isTrailingStopBreached(
  lock: BullLock,
  currentPrice: number,
  anyTargetHit: boolean,
): boolean {
  if (lock.trailingStopBps === null || !anyTargetHit) return false;
  const peak = Math.max(lock.peakPrice, currentPrice);
  if (peak <= 0) return false;
  const dropBps = ((peak - currentPrice) / peak) * 10_000;
  return dropBps >= lock.trailingStopBps;
}

/** Update the tracked peak price (never moves down). */
export function updatePeak(lock: BullLock, currentPrice: number): BullLock {
  return { ...lock, peakPrice: Math.max(lock.peakPrice, currentPrice) };
}

/**
 * Break penalty. Returns the penalty in TOKENS (0 when no penalty applies).
 * - Immutable: breaking is not allowed at all (throws).
 * - Penalty is WAIVED when a price target or the maturity date has triggered.
 * - Guardian: no token penalty, but requires approval + 48h delay (enforced
 *   by the contract / app flow, not by this amount calc).
 */
export function breakPenaltyTokens(
  lock: BullLock,
  now: number,
  twapPrice: number | null,
): number {
  if (lock.breakMode === 'immutable') {
    throw new Error('This lock is Immutable: it cannot be broken early.');
  }
  if (unlockReason(lock, now, twapPrice) !== null) return 0; // trigger met: waived
  if (lock.breakMode === 'guardian') return 0; // guardian break has no token penalty
  return (lock.amountRemaining * lock.penaltyBps) / 10_000;
}

export function canBreak(lock: BullLock): boolean {
  return lock.breakMode !== 'immutable';
}

/** Minimum acceptable stablecoin for a stage, after slippage. */
export function minimumReceive(stageUsdValue: number, slippageBps: number): number {
  return stageUsdValue * (1 - slippageBps / 10_000);
}

/**
 * Price-impact guard. If selling this stage would move the pool price
 * beyond the configured limit (default 5%), the stage must be split into
 * smaller pieces or paused — never dumped. Returns the number of pieces.
 */
export function priceImpactPieces(
  stageUsdValue: number,
  poolLiquidityUsd: number,
  maxImpactBps = 500,
): { ok: boolean; pieces: number; impactBps: number } {
  if (poolLiquidityUsd <= 0) return { ok: false, pieces: 0, impactBps: Infinity };
  const impactBps = (stageUsdValue / poolLiquidityUsd) * 10_000;
  if (impactBps <= maxImpactBps) return { ok: true, pieces: 1, impactBps };
  const pieces = Math.ceil(impactBps / maxImpactBps);
  return { ok: false, pieces, impactBps };
}

/** Fail-safe retry: a failed swap leaves the lock locked; retry on schedule. */
export interface SwapAttempt {
  attempt: number;
  maxAttempts: number;
  lastError?: string;
}

export function shouldRetrySwap(attempt: SwapAttempt): boolean {
  return attempt.attempt < attempt.maxAttempts;
}

export function nextRetryDelayMs(attempt: number): number {
  // Backoff: 1m, 2m, 4m, 8m ... capped at 30m.
  return Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));
}

/** Plain-English lock sentence shown on the review screen (spec Part D). */
export function lockSummarySentence(lock: BullLock, exitLabel: string): string {
  const date = new Date(lock.unlockTime).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  if (lock.targetPrice === null || lock.targetMultiple === null) {
    return `These funds cannot be spent until ${date}.`;
  }
  if (lock.autoSell) {
    const pct = lock.ladder.length > 0 ? 'the due ladder stage' : '100%';
    return (
      `These funds cannot be spent until ${date}, unless ${lock.targetMultiple}x ` +
      `($${lock.targetPrice.toFixed(2)}) is reached, when ${pct} will be sold ${exitLabel} automatically.`
    );
  }
  return (
    `These funds cannot be spent until ${date}, unless ${lock.targetMultiple}x ` +
    `($${lock.targetPrice.toFixed(2)}) is reached, when the funds unlock to your wallet.`
  );
}

/** Discipline score inputs: locked ratio, streak, break rate. 0..100. */
export function disciplineScore(args: {
  lockedRatio: number; // 0..1 locked / total portfolio
  streakDays: number;
  locksCompleted: number;
  locksBroken: number;
}): number {
  const { lockedRatio, streakDays, locksCompleted, locksBroken } = args;
  const total = locksCompleted + locksBroken;
  const completion = total === 0 ? 0.5 : locksCompleted / total;
  const score =
    lockedRatio * 40 + Math.min(streakDays, 30) * 1 + completion * 30;
  return Math.round(Math.min(100, Math.max(0, score)));
}
