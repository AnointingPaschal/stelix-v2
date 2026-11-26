/** Wallet password change — decrypt with old, re-encrypt under new. */
import { changePassword, createWallet, exportSecret, getWalletMeta, unlockWallet, wipeWallet } from '../wallet';

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
