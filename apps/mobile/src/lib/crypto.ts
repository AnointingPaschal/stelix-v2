/**
 * Session-password encryption for the wallet secret — pure JS, no WebCrypto
 * and no React Native imports at module load, so it is unit-testable in
 * Jest (node) and runs identically on web and native.
 *
 * Scheme: PBKDF2-HMAC-SHA-256 (600,000 iterations, 32-byte key) +
 * AES-GCM (96-bit random IV). The stored payload is a base64 JSON blob
 * `{ v: 1, salt, iv, data }`. A wrong password fails AES-GCM
 * authentication and throws — it is NEVER accepted.
 *
 * ROOT CAUSE of the native Import Wallet failure (2026-11-26): the old
 * implementation used WebCrypto (`globalThis.crypto.subtle`). Hermes, the
 * React Native JS engine, ships NO `crypto` global at all — no `subtle`
 * and no `getRandomValues` — so every encrypt/decrypt threw
 * "WebCrypto (crypto.subtle) is unavailable in this environment" on the
 * dev APK, while the same code worked on web and in Jest (Node has
 * WebCrypto). Fix: the KDF and cipher are now pure JS from
 * @noble/hashes / @noble/ciphers, which need no platform API, and random
 * bytes come from `globalThis.crypto.getRandomValues` where it exists
 * (web / Node) and from the expo-crypto native module (SecureRandom) on
 * native. `Math.random` is NEVER used for keys, salts or IVs.
 *
 * FORMAT: unchanged (v1). @noble's PBKDF2-SHA-256 output is byte-identical
 * to WebCrypto's, and its AES-GCM ciphertext is the same layout
 * (ciphertext with the 16-byte auth tag appended), so payloads encrypted
 * by the old WebCrypto build — on web, or in any earlier release — still
 * decrypt with this code. No migration, no wallet loss. Verified by the
 * cross-implementation tests in __tests__/crypto.test.ts.
 */

import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;

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

/**
 * Cryptographically secure random bytes on every platform.
 * Order: WebCrypto `getRandomValues` (web, Node/Jest) → expo-crypto
 * native module (Hermes, where no `crypto` global exists). Throws when
 * no secure source exists — never falls back to Math.random.
 */
async function randomBytes(length: number): Promise<Uint8Array> {
  const g = globalThis.crypto;
  if (typeof g?.getRandomValues === 'function') {
    return g.getRandomValues(new Uint8Array(length));
  }
  // Native (Hermes): dynamic import so this module stays loadable in
  // Jest/Node and on web, where this branch never runs. expo-crypto
  // getRandomBytesAsync is backed by the OS CSPRNG on iOS/Android
  // (max 1024 bytes per call; we need 16 and 12).
  try {
    const ExpoCrypto = await import('expo-crypto');
    if (typeof ExpoCrypto.getRandomBytesAsync === 'function') {
      return ExpoCrypto.getRandomBytesAsync(length);
    }
  } catch {
    // Fall through to the throw below.
  }
  throw new Error(
    'No secure random source is available in this environment — wallet encryption cannot run.',
  );
}

/** PBKDF2-HMAC-SHA-256, 600k iterations — pure JS, byte-identical to WebCrypto. */
function deriveKey(password: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, new TextEncoder().encode(password), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: KEY_LENGTH_BYTES,
  });
}

export function assertStrongPassword(password: string): void {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
}

/** Encrypt a secret (mnemonic or private key) under the session password. */
export async function encryptSecret(secret: string, password: string): Promise<string> {
  assertStrongPassword(password);
  const salt = await randomBytes(SALT_LENGTH_BYTES);
  const iv = await randomBytes(IV_LENGTH_BYTES);
  const key = deriveKey(password, salt);
  // @noble/ciphers AES-GCM appends the 16-byte auth tag to the
  // ciphertext — the same layout WebCrypto produced, so v1 payloads
  // stay interchangeable.
  const ct = gcm(key, iv).encrypt(new TextEncoder().encode(secret));
  const payload: EncryptedPayload = {
    v: 1,
    salt: b64encode(salt),
    iv: b64encode(iv),
    data: b64encode(ct),
  };
  return b64encode(new TextEncoder().encode(JSON.stringify(payload)));
}

/**
 * Decrypt a payload produced by encryptSecret (current or legacy
 * WebCrypto build — same v1 format).
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
  const key = deriveKey(password, b64decode(payload.salt));
  let pt: Uint8Array;
  try {
    pt = gcm(key, b64decode(payload.iv)).decrypt(b64decode(payload.data));
  } catch {
    throw new Error('Wrong password — wallet could not be unlocked.');
  }
  return new TextDecoder().decode(pt);
}
