/** Session-password encryption — wrong password must FAIL. */
import { decryptSecret, encryptSecret } from '../crypto';

describe('PBKDF2/AES-GCM wallet encryption', () => {
  it('round-trips a mnemonic under the right password', async () => {
    const secret = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const enc = await encryptSecret(secret, 'correct horse battery staple');
    expect(enc).not.toContain('abandon');
    await expect(decryptSecret(enc, 'correct horse battery staple')).resolves.toBe(secret);
  });

  it('FAILS on a wrong password — even a long one', async () => {
    const enc = await encryptSecret('some secret phrase', 'right-password-123');
    await expect(decryptSecret(enc, 'wrong-password-123456')).rejects.toThrow(/Wrong password/);
    await expect(decryptSecret(enc, 'right-password-124')).rejects.toThrow(/Wrong password/);
  });

  it('rejects passwords shorter than 8 characters at encrypt time', async () => {
    await expect(encryptSecret('secret', 'short')).rejects.toThrow(/at least 8/);
  });

  it('rejects corrupt payloads', async () => {
    await expect(decryptSecret('not-base64!!!', 'password123')).rejects.toThrow();
  });
});
