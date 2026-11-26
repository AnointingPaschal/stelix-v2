/** Wallet password change — decrypt with old, re-encrypt under new. */
import { changePassword, createWallet, exportSecret, unlockWallet, wipeWallet } from '../wallet';

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
