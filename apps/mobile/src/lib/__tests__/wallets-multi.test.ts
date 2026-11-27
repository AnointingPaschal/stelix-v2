/**
 * Multi-wallet storage (2026-11-27): every created or imported wallet
 * is kept, and the user switches between them. Creating or importing
 * never replaces the wallet already on the device.
 *
 * KDF budget: same rationale as wallet.test.ts — 600,000-iteration
 * PBKDF2 in pure JS is seconds per op; the suite gets 180s. The
 * iteration count itself is the security parameter and must not be
 * lowered.
 */
jest.setTimeout(180_000);

import { ethers } from 'ethers';
import {
  changePassword,
  createWallet,
  exportSecret,
  generateMnemonic,
  getActiveWalletId,
  getActiveWalletMeta,
  hasWallet,
  importWallet,
  listWallets,
  removeWallet,
  renameWallet,
  setActiveWalletId,
  unlockWallet,
  verifySessionPassword,
  walletIdFor,
  wipeWallet,
} from '../wallet';
import { encryptSecret } from '../crypto';
import { kvSet } from '../storage';
import {
  addImportedToken,
  loadImportedTokens,
  migrateImportedTokensForWallet,
} from '../balances';

const PASSWORD = 'test-password-123';

beforeEach(async () => {
  await wipeWallet();
});

describe('multi-wallet create/import', () => {
  it('creates two wallets and keeps both, newest active', async () => {
    const a = await createWallet(PASSWORD, 'Savings');
    const b = await createWallet(PASSWORD, 'Vault');
    const list = await listWallets();
    expect(list).toHaveLength(2);
    expect(list[0].address).toBe(a.address);
    expect(list[0].name).toBe('Savings');
    expect(list[1].address).toBe(b.address);
    expect(await getActiveWalletId()).toBe(walletIdFor(b.address));
    // Both unlock with the same session password.
    expect((await unlockWallet(PASSWORD, walletIdFor(a.address)))?.address).toBe(a.address);
    expect((await unlockWallet(PASSWORD))?.address).toBe(b.address);
  });

  it('re-importing the same address updates it in place instead of duplicating', async () => {
    const phrase = generateMnemonic();
    await importWallet(phrase, PASSWORD, 'First');
    await importWallet(phrase, PASSWORD, 'Renamed');
    const list = await listWallets();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Renamed');
  });

  it('exports the right secret per wallet id', async () => {
    const phraseA = generateMnemonic();
    const phraseB = generateMnemonic();
    const addressA = await importWallet(phraseA, PASSWORD, 'A');
    const addressB = await importWallet(phraseB, PASSWORD, 'B');
    expect(await exportSecret(PASSWORD, walletIdFor(addressA))).toBe(phraseA);
    expect(await exportSecret(PASSWORD, walletIdFor(addressB))).toBe(phraseB);
  });

  it('switches the active wallet and unlock defaults to it', async () => {
    const a = await createWallet(PASSWORD, 'A');
    await createWallet(PASSWORD, 'B');
    await setActiveWalletId(walletIdFor(a.address));
    expect((await getActiveWalletMeta())?.address).toBe(a.address);
    expect((await unlockWallet(PASSWORD))?.address).toBe(a.address);
  });

  it('removing the active wallet activates the oldest remaining; removing the last leaves none', async () => {
    const a = await createWallet(PASSWORD, 'A');
    const b = await createWallet(PASSWORD, 'B');
    const afterFirst = await removeWallet(walletIdFor(b.address));
    expect(afterFirst.wallets).toHaveLength(1);
    expect(afterFirst.active?.address).toBe(a.address);
    expect((await getActiveWalletMeta())?.address).toBe(a.address);
    const afterLast = await removeWallet(walletIdFor(a.address));
    expect(afterLast.wallets).toHaveLength(0);
    expect(afterLast.active).toBeNull();
    expect(await hasWallet()).toBe(false);
  });

  it('throws when removing or activating an unknown wallet', async () => {
    await createWallet(PASSWORD, 'A');
    await expect(
      removeWallet('w_0x0000000000000000000000000000000000000000'),
    ).rejects.toThrow(/not saved/);
    await expect(
      setActiveWalletId('w_0x0000000000000000000000000000000000000000'),
    ).rejects.toThrow(/not saved/);
  });

  it('renames a wallet', async () => {
    const a = await createWallet(PASSWORD, 'Old');
    const renamed = await renameWallet(walletIdFor(a.address), 'New Name');
    expect(renamed.name).toBe('New Name');
    expect((await listWallets())[0].name).toBe('New Name');
  });
});

describe('changePassword across wallets', () => {
  it('re-encrypts every wallet so the new password unlocks all and the old one fails all', async () => {
    const a = await createWallet(PASSWORD, 'A');
    const b = await createWallet(PASSWORD, 'B');
    await changePassword(PASSWORD, 'new-password-456');
    expect((await unlockWallet('new-password-456', walletIdFor(a.address)))?.address).toBe(a.address);
    expect((await unlockWallet('new-password-456', walletIdFor(b.address)))?.address).toBe(b.address);
    await expect(unlockWallet(PASSWORD, walletIdFor(a.address))).rejects.toThrow(/Wrong password/);
    await expect(unlockWallet(PASSWORD, walletIdFor(b.address))).rejects.toThrow(/Wrong password/);
  });

  it('throws on a wrong old password and leaves every wallet usable', async () => {
    const a = await createWallet(PASSWORD, 'A');
    await createWallet(PASSWORD, 'B');
    await expect(changePassword('wrong-password-1', 'new-password-456')).rejects.toThrow();
    expect((await unlockWallet(PASSWORD, walletIdFor(a.address)))?.address).toBe(a.address);
    expect((await unlockWallet(PASSWORD))?.address).not.toBeNull();
  });

  it('verifySessionPassword accepts the current password and rejects a wrong one', async () => {
    await createWallet(PASSWORD, 'A');
    expect(await verifySessionPassword(PASSWORD)).toBe(true);
    expect(await verifySessionPassword('wrong-password-1')).toBe(false);
  });
});

describe('legacy v2 migration', () => {
  it('moves the old single wallet into the list and deletes the v2 keys', async () => {
    const phrase = generateMnemonic();
    const wallet = ethers.Wallet.fromPhrase(phrase);
    const encrypted = await encryptSecret(phrase, PASSWORD);
    await kvSet('stelix_encrypted_wallet_v2', encrypted);
    await kvSet(
      'stelix_wallet_meta_v2',
      JSON.stringify({
        address: wallet.address,
        createdAt: 123456789,
        hasBiometrics: false,
        name: 'Legacy',
        solanaAddress: null,
      }),
    );
    const list = await listWallets();
    expect(list).toHaveLength(1);
    expect(list[0].address).toBe(wallet.address);
    expect(list[0].name).toBe('Legacy');
    expect(list[0].createdAt).toBe(123456789);
    expect((await unlockWallet(PASSWORD))?.address).toBe(wallet.address);
    // The v2 keys are gone — a second list call does not resurrect a copy.
    expect(await listWallets()).toHaveLength(1);
  });
});

describe('imported tokens are per wallet', () => {
  it('an import on one wallet does not appear on another', async () => {
    const a = await createWallet(PASSWORD, 'A');
    const b = await createWallet(PASSWORD, 'B');
    await addImportedToken(
      {
        chainId: 'arc',
        address: '0xC4d720e630d8aeC1F0718a1d30Ab0e5A802F74e7',
        symbol: 'STX',
        name: 'Stelix',
        decimals: 18,
        logoUrl: null,
      },
      a.address,
    );
    expect(await loadImportedTokens(a.address)).toHaveLength(1);
    expect(await loadImportedTokens(b.address)).toHaveLength(0);
  });

  it('moves the legacy device-wide list onto the active wallet once', async () => {
    const a = await createWallet(PASSWORD, 'A');
    await addImportedToken({
      chainId: 'arc',
      address: '0xC4d720e630d8aeC1F0718a1d30Ab0e5A802F74e7',
      symbol: 'STX',
      name: 'Stelix',
      decimals: 18,
      logoUrl: null,
    });
    // Legacy list (no owner) has the token; the wallet-scoped list is empty.
    expect(await loadImportedTokens()).toHaveLength(1);
    expect(await loadImportedTokens(a.address)).toHaveLength(0);
    await migrateImportedTokensForWallet(a.address);
    expect(await loadImportedTokens(a.address)).toHaveLength(1);
    expect(await loadImportedTokens()).toHaveLength(0);
    // Second migration is a no-op.
    await migrateImportedTokensForWallet(a.address);
    expect(await loadImportedTokens(a.address)).toHaveLength(1);
  });
});
