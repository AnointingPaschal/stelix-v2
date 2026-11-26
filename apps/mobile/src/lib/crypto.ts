/**
 * Session-password encryption for the wallet secret — pure, no RN imports
 * so it is unit-testable in Jest (node).
 *
 * Scheme: PBKDF2-HMAC-SHA-256 (600,000 iterations, 32-byte key) +
 * AES-GCM (96-bit random IV). The stored payload is a base64 JSON blob
 * `{ v: 1, salt, iv, data }`. A wrong password fails AES-GCM
 * authentication and throws — it is NEVER accepted.
 *
 * Uses WebCrypto (`globalThis.crypto.subtle`), available on web, iOS/Android
 * (Expo / Hermes exposes it in SDK 58) and Node 18+. No secret is ever
 * stored or logged in plaintext by this module.
 */

export interface EncryptedPayload {
  v: 1;
  salt: string; // base64
  iv: string; // base64
  data: string; // base64 ciphertext (AES-GCM, auth tag appended)
}

function b64encode(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function getSubtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error(
      'WebCrypto (crypto.subtle) is unavailable in this environment — wallet encryption cannot run.',
    );
  }
  return c.subtle;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const subtle = getSubtle();
  const base = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 600_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function assertStrongPassword(password: string): void {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
}

/** Encrypt a secret (mnemonic or private key) under the session password. */
export async function encryptSecret(secret: string, password: string): Promise<string> {
  assertStrongPassword(password);
  const subtle = getSubtle();
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(secret),
  );
  const payload: EncryptedPayload = {
    v: 1,
    salt: b64encode(salt),
    iv: b64encode(iv),
    data: b64encode(new Uint8Array(ct)),
  };
  return b64encode(new TextEncoder().encode(JSON.stringify(payload)));
}

/**
 * Decrypt a payload produced by encryptSecret.
 * THROWS on a wrong password (AES-GCM auth failure) — never returns a
 * secret for the wrong password.
 */
export async function decryptSecret(payloadB64: string, password: string): Promise<string> {
  let payload: EncryptedPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64decode(payloadB64))) as EncryptedPayload;
  } catch {
    throw new Error('Stored wallet data is corrupt or in an unknown format.');
  }
  if (payload.v !== 1 || !payload.salt || !payload.iv || !payload.data) {
    throw new Error('Stored wallet data is corrupt or in an unknown format.');
  }
  const subtle = getSubtle();
  const key = await deriveKey(password, b64decode(payload.salt));
  let pt: ArrayBuffer;
  try {
    pt = await subtle.decrypt(
      { name: 'AES-GCM', iv: b64decode(payload.iv) as BufferSource },
      key,
      b64decode(payload.data) as BufferSource,
    );
  } catch {
    throw new Error('Wrong password — wallet could not be unlocked.');
  }
  return new TextDecoder().decode(pt);
}
