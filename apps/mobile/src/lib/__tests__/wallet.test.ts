/** Wallet password change — decrypt with old, re-encrypt under new. */
import { ethers } from 'ethers';

// PBKDF2-HMAC-SHA-256 at 600,000 iterations in pure JS takes seconds
// per encrypt/decrypt on a throttled CI VM, and several tests do 2–3
// KDFs each — Jest's 5s default is not a product limit, so the wallet
// suite gets a longer budget (same as crypto.test.ts). Under a full
// parallel run on a shared-CPU VM the async KDF stretches further, so
// the budget is 180s. The iteration count itself is the security
// parameter and must not be lowered.
jest.setTimeout(180_000);

import {
  changePassword,
  createWallet,
  exportSecret,
  generateMnemonic,
  getWalletMeta,
  importWallet,
  unlockWallet,
  wipeWallet,
} from '../wallet';

/** Temporarily replace globalThis.crypto (e.g. to simulate Hermes, which
 *  has no `crypto` global at all). Restored by the returned function. */
function stubGlobalCrypto(value: unknown): () => void {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    value,
    configurable: true,
    writable: true,
  });
  return () => {
    if (desc) Object.defineProperty(globalThis, 'crypto', desc);
    else delete (globalThis as unknown as Record<string, unknown>).crypto;
  };
}

describe('createWallet', () => {
  beforeEach(async () => {
    await wipeWallet();
  });

  it('creates a real 12-word wallet, stores the name, and unlocks with it', async () => {
    const { mnemonic, address } = await createWallet('test-password-123', 'Savings');
    expect(mnemonic.split(' ').length).toBe(12);
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const meta = await getWalletMeta();
    expect(meta?.address).toBe(address);
    expect(meta?.name).toBe('Savings');
    const unlocked = await unlockWallet('test-password-123');
    expect(unlocked?.address).toBe(address);
  });

  it('rejects a password shorter than 8 characters', async () => {
    await expect(createWallet('short')).rejects.toThrow(/at least 8/);
  });
});

describe('changePassword', () => {
  beforeEach(async () => {
    await wipeWallet();
  });

  it('re-encrypts so the new password unlocks and the old one fails', async () => {
    const { address } = await createWallet('old-password-123');
    await changePassword('old-password-123', 'new-password-456');
    const unlocked = await unlockWallet('new-password-456');
    expect(unlocked?.address).toBe(address);
    await expect(unlockWallet('old-password-123')).rejects.toThrow(/Wrong password/);
    await expect(exportSecret('new-password-456')).resolves.toMatch(/ /); // mnemonic words
  });

  it('throws on a wrong old password and leaves the wallet usable', async () => {
    await createWallet('old-password-123');
    await expect(changePassword('not-the-password', 'new-password-456')).rejects.toThrow(/Wrong password/);
    const unlocked = await unlockWallet('old-password-123');
    expect(unlocked).not.toBeNull();
  });

  it('rejects a new password shorter than 8 characters', async () => {
    await createWallet('old-password-123');
    await expect(changePassword('old-password-123', 'short')).rejects.toThrow(/at least 8/);
  });
});

describe('importWallet (fresh mnemonic generated per run — never a reused phrase)', () => {
  beforeEach(async () => {
    await wipeWallet();
  });

  it('imports a freshly generated 12-word mnemonic and unlocks with it', async () => {
    const phrase = ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
    expect(phrase.split(' ').length).toBe(12);
    expect(ethers.Mnemonic.isValidMnemonic(phrase)).toBe(true);
    const address = await importWallet(phrase, 'import-password-123', 'Imported');
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const meta = await getWalletMeta();
    expect(meta?.address).toBe(address);
    expect(meta?.name).toBe('Imported');
    const unlocked = await unlockWallet('import-password-123');
    expect(unlocked?.address).toBe(address);
    await expect(unlockWallet('wrong-password-1234')).rejects.toThrow(/Wrong password/);
    // The stored secret round-trips exactly.
    await expect(exportSecret('import-password-123')).resolves.toBe(phrase);
  });

  it('imports a freshly generated 24-word mnemonic', async () => {
    const phrase = ethers.Mnemonic.fromEntropy(ethers.randomBytes(32)).phrase;
    expect(phrase.split(' ').length).toBe(24);
    const address = await importWallet(phrase, 'import-password-123');
    const unlocked = await unlockWallet('import-password-123');
    expect(unlocked?.address).toBe(address);
  });

  it('imports a raw 64-hex private key', async () => {
    const key = ethers.Wallet.createRandom().privateKey;
    const address = await importWallet(key, 'import-password-123');
    const unlocked = await unlockWallet('import-password-123');
    expect(unlocked?.address).toBe(address);
  });

  it('rejects an invalid seed phrase or private key', async () => {
    await expect(importWallet('abandon abandon abandon', 'import-password-123')).rejects.toThrow();
    await expect(
      importWallet('not a real seed phrase at all just words here', 'import-password-123'),
    ).rejects.toThrow();
    await expect(importWallet('zzzz', 'import-password-123')).rejects.toThrow();
  });

  it('rejects a password shorter than 8 characters at import time', async () => {
    const phrase = ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
    await expect(importWallet(phrase, 'short')).rejects.toThrow(/at least 8/);
  });
});

describe('generateMnemonic with NO platform random source (degraded DRBG path)', () => {
  it('still generates a valid 12-word mnemonic and flags the source degraded', () => {
    // Hermes-like + old Expo Go: no `crypto` global, no native module.
    // ethers draws entropy through the registered randomBytesSync,
    // which falls back to the labelled ChaCha20 DRBG instead of
    // throwing. Fresh module instances so the degraded flag and the
    // ethers registration do not leak into the other tests.
    const restore = stubGlobalCrypto(undefined);
    try {
      jest.resetModules();
      const freshWallet = require('../wallet') as typeof import('../wallet');
      const freshCrypto = require('../crypto') as typeof import('../crypto');
      expect(freshCrypto.isRandomSourceDegraded()).toBe(false);
      const phrase = freshWallet.generateMnemonic();
      expect(phrase.split(' ').length).toBe(12);
      expect(ethers.Mnemonic.isValidMnemonic(phrase)).toBe(true);
      expect(freshCrypto.isRandomSourceDegraded()).toBe(true);
    } finally {
      restore();
    }
  });
});
