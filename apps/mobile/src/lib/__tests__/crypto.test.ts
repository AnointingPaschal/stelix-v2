/** Session-password encryption — wrong password must FAIL.
 *
 * The legacy WebCrypto helpers below rebuild the OLD (pre-fix) v1 payload
 * format with Node's WebCrypto, exactly as the previous crypto.ts did.
 * They prove the new pure-JS implementation is byte-compatible: wallets
 * encrypted by the old build still unlock, and vice versa.
 */
import * as nodeCrypto from 'crypto';
import { decryptSecret, encryptSecret } from '../crypto';

const PASSWORD = 'correct horse battery staple';
const SECRET = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

/** Encrypt exactly the way the old WebCrypto crypto.ts did (v1 format). */
async function legacyWebCryptoEncrypt(secret: string, password: string): Promise<string> {
  const salt = nodeCrypto.getRandomValues(new Uint8Array(16));
  const iv = nodeCrypto.getRandomValues(new Uint8Array(12));
  const base = await nodeCrypto.webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await nodeCrypto.webcrypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const ct = await nodeCrypto.webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(secret),
  );
  const payload = {
    v: 1,
    salt: Buffer.from(salt).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
    data: Buffer.from(ct).toString('base64'),
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/** Decrypt a v1 payload exactly the way the old WebCrypto crypto.ts did. */
async function legacyWebCryptoDecrypt(payloadB64: string, password: string): Promise<string> {
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8')) as {
    salt: string;
    iv: string;
    data: string;
  };
  const base = await nodeCrypto.webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await nodeCrypto.webcrypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(Buffer.from(payload.salt, 'base64')),
      iterations: 600_000,
      hash: 'SHA-256',
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const pt = await nodeCrypto.webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(Buffer.from(payload.iv, 'base64')) },
    key,
    new Uint8Array(Buffer.from(payload.data, 'base64')),
  );
  return new TextDecoder().decode(pt);
}

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

describe('PBKDF2/AES-GCM wallet encryption', () => {
  it('round-trips a mnemonic under the right password', async () => {
    const enc = await encryptSecret(SECRET, PASSWORD);
    expect(enc).not.toContain('abandon');
    await expect(decryptSecret(enc, PASSWORD)).resolves.toBe(SECRET);
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

  it('uses a fresh random salt/IV every time (same secret, different ciphertext)', async () => {
    const a = await encryptSecret(SECRET, PASSWORD);
    const b = await encryptSecret(SECRET, PASSWORD);
    expect(a).not.toBe(b);
    await expect(decryptSecret(a, PASSWORD)).resolves.toBe(SECRET);
    await expect(decryptSecret(b, PASSWORD)).resolves.toBe(SECRET);
  });

  it('round-trips a non-ASCII secret', async () => {
    const secret = 's3cret wörds 🔐 ünïcode';
    const enc = await encryptSecret(secret, PASSWORD);
    await expect(decryptSecret(enc, PASSWORD)).resolves.toBe(secret);
  });

  it('decrypts payloads encrypted by the legacy WebCrypto build (v1 format is unchanged)', async () => {
    const legacy = await legacyWebCryptoEncrypt(SECRET, PASSWORD);
    await expect(decryptSecret(legacy, PASSWORD)).resolves.toBe(SECRET);
    await expect(decryptSecret(legacy, 'wrong-password-1234')).rejects.toThrow(/Wrong password/);
  });

  it('produces payloads the legacy WebCrypto build can decrypt (PBKDF2 is deterministic and standard)', async () => {
    const enc = await encryptSecret(SECRET, PASSWORD);
    await expect(legacyWebCryptoDecrypt(enc, PASSWORD)).resolves.toBe(SECRET);
    await expect(legacyWebCryptoDecrypt(enc, 'wrong-password-1234')).rejects.toThrow();
  });

  it('works with NO crypto.subtle — the Hermes regression (getRandomValues only)', async () => {
    // Hermes ships no `crypto` global at all; the old code threw the
    // reported "WebCrypto (crypto.subtle) is unavailable" error here.
    // Simulate a runtime with secure random but no subtle.
    const restore = stubGlobalCrypto({
      getRandomValues: <T extends Uint8Array<ArrayBuffer>>(arr: T): T =>
        nodeCrypto.getRandomValues(arr),
    });
    try {
      expect((globalThis as unknown as { crypto?: { subtle?: unknown } }).crypto?.subtle).toBeUndefined();
      const enc = await encryptSecret(SECRET, PASSWORD);
      await expect(decryptSecret(enc, PASSWORD)).resolves.toBe(SECRET);
    } finally {
      restore();
    }
  });

  it('fails closed — never Math.random — when NO secure random source exists', async () => {
    // Hermes-like: no `crypto` global, and expo-crypto's native module
    // is absent in Jest, so the expo-crypto fallback cannot run either.
    const restore = stubGlobalCrypto(undefined);
    try {
      await expect(encryptSecret(SECRET, PASSWORD)).rejects.toThrow(/No secure random source/);
    } finally {
      restore();
    }
  });
});
