/** Import Wallet hang fix (2026-11-27) — regression tests.
 *
 * The hang was a promise that NEVER settled (SecureStore dynamic
 * import / setItemAsync in Termux-on-phone Metro), so the import
 * screen spun forever with no error. The fix bounds every unbounded
 * await with withTimeout and bounds the whole import at 90s with an
 * error naming the step. KDF stays at 600,000 iterations.
 *
 * Solana derivation is mocked to THROW in this file so the
 * "Solana failure must not block import" case is exercised.
 */
jest.setTimeout(180_000);

// Mocked slow KDF: the real PBKDF2, with an extra 500ms delay, so the
// "completes despite a slow KDF" case is genuine, not just fast-Node.
jest.mock('@noble/hashes/pbkdf2.js', () => {
  const actual = jest.requireActual('@noble/hashes/pbkdf2.js') as {
    pbkdf2Async: (...args: unknown[]) => Promise<unknown>;
  };
  return {
    ...actual,
    pbkdf2Async: async (...args: unknown[]) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return actual.pbkdf2Async(...(args as never[]));
    },
  };
});

jest.mock('../solana', () => ({
  deriveSolanaAddress: () => {
    throw new Error('solana boom (mocked derivation failure)');
  },
  isValidSolanaAddress: () => false,
}));

import { ethers } from 'ethers';
import { withTimeout, TimeoutError } from '../timeout';
import {
  getWalletMeta,
  importWallet,
  wipeWallet,
  IMPORT_STEP_LABELS,
} from '../wallet';
import type { ImportStep } from '../wallet';

describe('withTimeout', () => {
  it('resolves a fast promise with its value', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'fast')).resolves.toBe(42);
  });

  it('rejects with a TimeoutError naming the step when the promise never settles', async () => {
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 50, 'SecureStore.setItemAsync(wallet)')).rejects.toThrow(
      TimeoutError,
    );
    await expect(withTimeout(never, 50, 'SecureStore.setItemAsync(wallet)')).rejects.toThrow(
      /SecureStore\.setItemAsync\(wallet\)/,
    );
  });
});

describe('importWallet hang fix', () => {
  beforeEach(async () => {
    await wipeWallet();
  });

  afterEach(async () => {
    await wipeWallet();
  });

  it('completes with a mocked slow KDF and reports steps in order', async () => {
    const phrase = ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
    const seen: ImportStep[] = [];
    const address = await importWallet(phrase, 'import-password-123', 'Imported', {
      onProgress: (s) => seen.push(s),
    });
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(seen[0]).toBe('deriving-address');
    expect(seen).toContain('deriving-key');
    expect(seen).toContain('saving-wallet');
    expect(seen).toContain('saving-meta');
    expect(seen[seen.length - 1]).toBe('saving-meta');
    const meta = await getWalletMeta();
    expect(meta?.address).toBe(address);
  });

  it('times out with a clear error naming the step when the KDF cannot finish in time', async () => {
    const phrase = ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
    // 1ms overall bound: the real (mocked-slow) KDF cannot finish.
    // The timer fires while still deriving the address (the sync
    // phrase parse alone takes longer than 1ms) — either step name
    // proves the timeout names the step in progress.
    await expect(
      importWallet(phrase, 'import-password-123', 'Imported', { timeoutMs: 1 }),
    ).rejects.toThrow(/Import timed out at (Deriving address|Deriving encryption key)/);
    // Let the orphaned background run finish so it cannot write a
    // wallet into a later test's store, then clean up.
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await wipeWallet();
  });

  it('does not let a Solana derivation failure block import', async () => {
    const phrase = ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
    const address = await importWallet(phrase, 'import-password-123');
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const meta = await getWalletMeta();
    expect(meta?.address).toBe(address);
    expect(meta?.solanaAddress).toBeNull();
  });

  it('shows step progress labels, with the KDF wait stated honestly', () => {
    expect(IMPORT_STEP_LABELS['deriving-address']).toBe('Deriving address…');
    expect(IMPORT_STEP_LABELS['deriving-key']).toMatch(/10–30 s/);
    expect(IMPORT_STEP_LABELS['saving-wallet']).toBe('Saving wallet…');
    expect(Object.keys(IMPORT_STEP_LABELS)).toHaveLength(6);
  });
});
