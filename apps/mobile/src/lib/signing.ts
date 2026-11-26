/**
 * Shared signing-modal helpers (pure — unit-tested).
 *
 * Every on-chain activity in the wallet (Send, Swap, Create Lock, Claim,
 * Claim Stage, Request/Execute Break) signs through ONE bottom-sheet
 * modal (components/SignTransactionModal.tsx). The session password is
 * typed ONLY inside that modal — never in a field sitting on a page —
 * and is never stored, logged or kept after the modal closes. A wrong
 * password throws at decrypt time (see lib/wallet.ts unlockWallet /
 * lib/crypto.ts decryptSecret) and nothing is sent.
 */

/** The session password is at least 8 characters (see lib/crypto.ts
 *  assertStrongPassword). Shorter input cannot be right — reject it in
 *  the modal before touching the wallet. */
export function validateSignPassword(password: string): string | null {
  if (!password || password.length < 8) return 'Enter your session password (at least 8 characters).';
  return null;
}

/** True when an error is a wrong-password decrypt failure: the modal
 *  shows "Wrong password — nothing was sent" and keeps the user on the
 *  review step instead of treating it as a chain error. */
export function isWrongPasswordError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /wrong password/i.test(msg);
}

/** True only for 0x addresses — labels like "Set when the swap is
 *  built" are shown whole. */
export function shortAddr(addr: string, chars = 6): string {
  if (!addr || !addr.startsWith('0x') || addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}…${addr.slice(-4)}`;
}
