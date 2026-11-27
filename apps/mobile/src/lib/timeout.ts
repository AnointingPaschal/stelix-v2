/**
 * withTimeout — bound every unbounded await in the wallet import path.
 *
 * ROOT CAUSE (2026-11-27 Import Wallet hang): `await importWallet(...)`
 * never settled — not a throw, a promise that never resolves. The prime
 * suspect is SecureStore: `await import('expo-secure-store')` (an
 * on-demand Metro chunk fetch in Termux-on-phone dev) followed by
 * `await isAvailableAsync()` / `await setItemAsync()`, with try/catch
 * that only fires on REJECTION, never on a hang. If any of those
 * promises never settles, the import screen spins forever with no
 * error and setBusy(false) never runs.
 *
 * Fix: race every such await against a timer. On timeout the caller
 * treats the step as unavailable/failed and falls through to its
 * existing fallback (kv store, DRBG, in-memory map) — exactly the
 * same path as a rejection — instead of hanging. The timer is always
 * cleared on settle so a resolved promise never leaks a timer.
 */
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`Timed out after ${ms}ms: ${label}`);
    this.name = 'TimeoutError';
  }
}

/** Race `promise` against a timer; rejects with a TimeoutError naming
 *  the step when the timer wins. Timer is cleared on settle. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
