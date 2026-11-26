/**
 * Lock-derived notifications — the Notifications screen is fed by the
 * user's own locks, so it is never an empty dead end while locks exist.
 *
 * Derived from live lock state only (no invented events): a lock that
 * has matured, one maturing within 7 days, target progress crossing
 * 50% / 80% / 100%, a breached trailing stop, and a break cooling-off
 * in progress. The screen merges these with the stored notifications
 * from AppContext; read state for derived items lives on the screen
 * (kv storage) because the store has no setter for them.
 */
import { isTrailingStopBreached, targetProgress, type BullLock } from './vault';

export type DerivedNotificationKind = 'maturity' | 'target' | 'trailing' | 'break';

export interface DerivedNotification {
  id: string;
  title: string;
  body: string;
  at: number;
  kind: DerivedNotificationKind;
}

const DAY_MS = 86_400_000;

function daysUntil(ms: number): number {
  return Math.max(0, Math.ceil(ms / DAY_MS));
}

export function deriveLockNotifications(
  locks: BullLock[],
  priceOf: (symbol: string) => number | null,
  now: number = Date.now(),
): DerivedNotification[] {
  const out: DerivedNotification[] = [];
  for (const lock of locks) {
    if (lock.status === 'completed' || lock.status === 'broken') continue;
    const price = priceOf(lock.tokenSymbol) ?? lock.entryPrice;
    const matured = now >= lock.unlockTime;

    if (matured) {
      out.push({
        id: `matured-${lock.id}`,
        title: 'Lock matured — claim available',
        body: `${lock.amountRemaining} ${lock.tokenSymbol} unlocked. Open the lock to claim it back to your wallet.`,
        at: lock.unlockTime,
        kind: 'maturity',
      });
    } else if (lock.unlockTime - now <= 7 * DAY_MS) {
      const days = daysUntil(lock.unlockTime - now);
      out.push({
        id: `maturing-${lock.id}`,
        title: `Lock matures in ${days} day${days === 1 ? '' : 's'}`,
        body: `${lock.amountRemaining} ${lock.tokenSymbol} unlocks on ${new Date(lock.unlockTime).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.`,
        at: now,
        kind: 'maturity',
      });
    }

    if (lock.targetPrice && lock.targetMultiple) {
      const progress = targetProgress(lock, price);
      if (progress >= 1) {
        out.push({
          id: `target-hit-${lock.id}`,
          title: `Target reached — ${lock.targetMultiple}x`,
          body: `${lock.tokenSymbol} hit its ${lock.targetMultiple}x target. The exit runs on the confirmed 30-minute average price.`,
          at: now,
          kind: 'target',
        });
      } else if (progress >= 0.8) {
        out.push({
          id: `target-80-${lock.id}`,
          title: `80% to your ${lock.targetMultiple}x target`,
          body: `${lock.tokenSymbol} is 80% of the way to its ${lock.targetMultiple}x target.`,
          at: now,
          kind: 'target',
        });
      } else if (progress >= 0.5) {
        out.push({
          id: `target-50-${lock.id}`,
          title: `Halfway to your ${lock.targetMultiple}x target`,
          body: `${lock.tokenSymbol} is halfway to its ${lock.targetMultiple}x target.`,
          at: now,
          kind: 'target',
        });
      }
    }

    const anyTargetHit = lock.ladder.some((s) => s.status === 'sold');
    if (lock.trailingStopBps !== null && isTrailingStopBreached(lock, price, anyTargetHit)) {
      out.push({
        id: `trailing-${lock.id}`,
        title: 'Trailing stop breached',
        body: `${lock.tokenSymbol} fell ${lock.trailingStopBps / 100}% from its peak — the remainder auto-sells.`,
        at: now,
        kind: 'trailing',
      });
    }

    if (lock.breakRequestedAt !== undefined) {
      const coolingOffMs = lock.breakMode === 'guardian' ? 48 * 3_600_000 : 24 * 3_600_000;
      const readyAt = lock.breakRequestedAt + coolingOffMs;
      if (now < readyAt) {
        out.push({
          id: `break-${lock.id}`,
          title: 'Break cooling-off running',
          body: `Your ${lock.tokenSymbol} lock break can be executed in ${daysUntil(readyAt - now)} day${daysUntil(readyAt - now) === 1 ? '' : 's'} (cooling-off ends ${new Date(readyAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}).`,
          at: lock.breakRequestedAt,
          kind: 'break',
        });
      }
    }
  }
  return out.sort((a, b) => b.at - a.at);
}
