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
 * @noble/hashes / @noble/ciphers, which need no platform API.
 *
 * ROOT CAUSE of the Expo Go crash (2026-11-27): the next fix loaded the
 * Expo crypto package at runtime (dynamic import / require of it).
 * That package's JS calls
 * `requireNativeModule('ExpoCrypto')` AT MODULE LOAD, which THROWS
 * "Cannot find native module 'ExpoCrypto'" when the host Expo Go does
 * not expose that native module — and the user's Expo Go (unknown
 * version, possibly older than SDK 58) does not, despite the docs saying
 * the package is "Included in Expo Go". So any import of it crashed the
 * app on launch of a wallet flow. The package has been REMOVED from the
 * app entirely (uninstalled; no code path in this file or wallet.ts
 * loads it). Random bytes now come from the chain in `randomBytes` /
 * `randomBytesSync` below, and the polyfill installed as the FIRST
 * import of src/app/_layout.tsx (`react-native-get-random-values`,
 * which never touches a native module at import time) supplies
 * `global.crypto.getRandomValues` on Hermes.
 *
 * FORMAT: unchanged (v1). @noble's PBKDF2-SHA-256 output is byte-identical
 * to WebCrypto's, and its AES-GCM ciphertext is the same layout
 * (ciphertext with the 16-byte auth tag appended), so payloads encrypted
 * by the old WebCrypto build — on web, or in any earlier release — still
 * decrypt with this code. No migration, no wallet loss. Verified by the
 * cross-implementation tests in __tests__/crypto.test.ts.
 */

import { gcm } from '@noble/ciphers/aes.js';
import { rngChacha20 } from '@noble/ciphers/chacha.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
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

/**
 * Base64 without ANY platform API — pure JS over a lookup table.
 * The old code used `Buffer` (Node-only) with a `btoa`/`atob` fallback
 * (browser-only). Neither exists in Hermes, the native JS engine, so
 * on a real phone the fallback threw `ReferenceError: btoa is not
 * defined` the first time a wallet was created or unlocked. This
 * implementation runs identically on native, web and Node, and is
 * byte-compatible with the v1 payload format (verified by the
 * cross-implementation tests in __tests__/crypto.test.ts).
 */
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function b64encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 0x3f] : '=';
  }
  return out;
}

function b64decode(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, '');
  const lookup = new Map<string, number>();
  for (let i = 0; i < B64_ALPHABET.length; i++) lookup.set(B64_ALPHABET[i], i);
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = lookup.get(clean[i]) ?? 0;
    const c1 = lookup.get(clean[i + 1]) ?? 0;
    const c2 = clean[i + 2] === '=' ? 0 : (lookup.get(clean[i + 2]) ?? 0);
    const c3 = clean[i + 3] === '=' ? 0 : (lookup.get(clean[i + 3]) ?? 0);
    bytes.push((c0 << 2) | (c1 >> 4));
    if (clean[i + 2] !== '=') bytes.push(((c1 & 0x0f) << 4) | (c2 >> 2));
    if (clean[i + 3] !== '=') bytes.push(((c2 & 0x03) << 6) | c3);
  }
  return new Uint8Array(bytes);
}

// ---------------------------------------------------------------------------
// Random bytes — the order matters, and NO step may throw at load or
// crash the app. Every step is inside try/catch; the chain always ends
// in a usable source (see the DEGRADED fallback).
//
//   (a) globalThis.crypto.getRandomValues — web, Node/Jest, and native
//       once the `react-native-get-random-values` polyfill (first import
//       of src/app/_layout.tsx) has installed it on Hermes. Wrapped in
//       try/catch because it may EXIST but throw at call time when its
//       backing native module is missing (the polyfill's
//       TurboModuleRegistry.getEnforcing throw).
//   (b) The Expo native crypto module, probed with
//       expo-modules-core's requireOptionalNativeModule('ExpoCrypto'),
//       which returns null instead of throwing when the module is
//       absent — never the throwing requireNativeModule, and never an
//       import of the Expo crypto package (its JS throws at load, see
//       header). Probed via a LAZY dynamic import of expo-modules-core
//       (never a top-level import) so Jest/node and web never break.
//       Async-only: the probe result is cached, so the sync path can
//       reuse it once it has resolved, but the sync path never waits.
//   (c) LAST RESORT — DEGRADED ChaCha20 DRBG (see getDrbg below).
// ---------------------------------------------------------------------------

/** True once the DEGRADED fallback has been used in this app launch. */
let degradedRandomUsed = false;
let degradedWarned = false;

export function isRandomSourceDegraded(): boolean {
  return degradedRandomUsed;
}

type ExpoCryptoLike = { getRandomValues: (array: Uint8Array) => void };

/** Cached probe result: undefined = not probed yet, null = absent. */
let expoCryptoCached: ExpoCryptoLike | null | undefined;
let expoCryptoProbe: Promise<ExpoCryptoLike | null> | null = null;

/** Lazy, never-throwing probe of the Expo native crypto module. */
function probeExpoCrypto(): Promise<ExpoCryptoLike | null> {
  if (!expoCryptoProbe) {
    expoCryptoProbe = (async () => {
      try {
        // Dynamic import: a static import would load expo-modules-core
        // (and its react-native linkage) in Jest/node and on web.
        const core = (await import('expo-modules-core')) as {
          requireOptionalNativeModule?: (name: string) => unknown;
        };
        const mod = core.requireOptionalNativeModule?.('ExpoCrypto') as ExpoCryptoLike | null;
        if (mod && typeof mod.getRandomValues === 'function') {
          expoCryptoCached = mod;
          return mod;
        }
      } catch {
        // No expo-modules-core / no native module here — fall through.
      }
      expoCryptoCached = null;
      return null;
    })();
  }
  return expoCryptoProbe;
}

function tryGlobalRandom(out: Uint8Array): Uint8Array | null {
  const g = globalThis.crypto as { getRandomValues?: (arr: Uint8Array) => Uint8Array } | undefined;
  if (typeof g?.getRandomValues !== 'function') return null;
  try {
    return g.getRandomValues(out);
  } catch {
    // Installed but backed by a missing native module — fall through.
    return null;
  }
}

function tryExpoCryptoRandom(out: Uint8Array): Uint8Array | null {
  if (!expoCryptoCached || typeof expoCryptoCached.getRandomValues !== 'function') return null;
  try {
    expoCryptoCached.getRandomValues(out);
    return out;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DEGRADED last resort — ChaCha20 DRBG (rngChacha20 from
// @noble/ciphers/chacha.js). Used ONLY when no platform random source
// exists at all: no global getRandomValues, and no Expo native crypto
// module — i.e. a broken/old Expo Go with no native random module.
//
// SEED (harvested ONCE per app launch, never reused across launches):
//   - 32 bytes from Math.random (4 bytes per call x 8), and
//   - high-resolution timing jitter: 256 rounds of small busy work,
//     measuring performance.now() (Date.now() fallback) deltas and
//     mixing the raw float64 bits of each delta, and
//   - Date.now() and a per-launch counter.
// All of it is hashed with SHA-256 into the 32-byte DRBG seed.
// Math.random output is NEVER used directly as salt / IV / key
// material — it is only one input to the seed hash.
//
// TRADE-OFF, STATED PLAINLY: this is NOT a platform CSPRNG. Its
// security rests entirely on how unpredictable the harvested seed is,
// and Math.random + timing jitter on a phone is far weaker entropy
// than the OS CSPRNG. @noble's own docs say to limit this DRBG to
// "non-production, non-critical cases... test-only". Wallets created
// while degraded should be treated as TEST-ONLY until re-created in a
// dev/EAS build or an updated Expo Go with a real native random
// module. The app therefore warns once (console.warn) and exposes
// isRandomSourceDegraded() so the UI can say so. The alternative —
// refusing to create a wallet at all in old Expo Go — was the crash
// this fix replaces; degraded-but-working with an honest label is the
// better failure mode.
// ---------------------------------------------------------------------------

let drbg: { randomBytes: (n: number) => Uint8Array } | null = null;

function harvestSeed(): Uint8Array {
  const bytes: number[] = [];
  const pushU32 = (v: number): void => {
    bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
  };
  const pushF64 = (v: number): void => {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, v);
    for (const b of new Uint8Array(buf)) bytes.push(b);
  };
  // 1) Math.random — one seed input among several, never used raw.
  for (let i = 0; i < 8; i++) pushU32(Math.floor(Math.random() * 0x100000000));
  // 2) Timing jitter.
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? () => performance.now()
      : () => Date.now();
  let prev = now();
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    // Small variable busy work so successive deltas actually differ.
    for (let j = 0; j < 200; j++) acc = (acc * 1103515245 + 12345 + i) & 0x7fffffff;
    const t = now();
    pushF64(t - prev);
    prev = t;
  }
  pushU32(acc);
  // 3) Wall clock + per-launch counter.
  pushU32(Date.now() & 0xffffffff);
  pushU32(Math.floor(Date.now() / 1000));
  return sha256(new Uint8Array(bytes));
}

function getDrbg(): { randomBytes: (n: number) => Uint8Array } {
  if (!drbg) {
    drbg = rngChacha20(harvestSeed());
    degradedRandomUsed = true;
    if (!degradedWarned) {
      degradedWarned = true;
      console.warn(
        '[stelix] DEGRADED random source: no platform CSPRNG is available ' +
          '(no crypto.getRandomValues, no Expo native crypto module). ' +
          'Using a best-effort ChaCha20 DRBG seeded from Math.random + timing ' +
          'jitter. Wallets created now are TEST-ONLY — re-create them in a ' +
          'dev/EAS build or an updated Expo Go.',
      );
    }
  }
  return drbg;
}

/**
 * Random bytes, sync — what ethers needs (`ethers.randomBytes`).
 * Order: global getRandomValues → previously-probed Expo native module
 * → DEGRADED ChaCha20 DRBG. Never throws.
 */
export function randomBytesSync(length: number): Uint8Array {
  const out = new Uint8Array(length);
  return tryGlobalRandom(out) ?? tryExpoCryptoRandom(out) ?? getDrbg().randomBytes(length);
}

/**
 * Random bytes, async — same order, plus the live Expo native-module
 * probe (which the sync path cannot await). Never throws.
 */
export async function randomBytes(length: number): Promise<Uint8Array> {
  const out = new Uint8Array(length);
  const viaGlobal = tryGlobalRandom(out);
  if (viaGlobal) return viaGlobal;
  try {
    const mod = await probeExpoCrypto();
    if (mod) {
      const viaExpo = tryExpoCryptoRandom(out);
      if (viaExpo) return viaExpo;
    }
  } catch {
    // Probe failure is already a fall-through — ignore.
  }
  return getDrbg().randomBytes(length);
}

/** PBKDF2-HMAC-SHA-256, 600k iterations — pure JS, byte-identical to WebCrypto.
 *  Async variant: same work, but yields to the event loop between
 *  blocks instead of blocking the JS thread for the whole ~1-3s run. */
async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return pbkdf2Async(sha256, new TextEncoder().encode(password), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: KEY_LENGTH_BYTES,
  });
}

/** Let the UI paint first: a macrotask yield so the caller's busy state
 *  ("Generating Keys…", "Import & Secure") actually renders before the
 *  ~1-3s KDF blocks the thread. */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function assertStrongPassword(password: string): void {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters.');
  }
}

/** Encrypt a secret (mnemonic or private key) under the session password. */
export async function encryptSecret(secret: string, password: string): Promise<string> {
  await yieldToPaint();
  assertStrongPassword(password);
  const salt = await randomBytes(SALT_LENGTH_BYTES);
  const iv = await randomBytes(IV_LENGTH_BYTES);
  const key = await deriveKey(password, salt);
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
  await yieldToPaint();
  let payload: EncryptedPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64decode(payloadB64))) as EncryptedPayload;
  } catch {
    throw new Error('Stored wallet data is corrupt or in an unknown format.');
  }
  if (payload.v !== 1 || !payload.salt || !payload.iv || !payload.data) {
    throw new Error('Stored wallet data is corrupt or in an unknown format.');
  }
  const key = await deriveKey(password, b64decode(payload.salt));
  let pt: Uint8Array;
  try {
    pt = gcm(key, b64decode(payload.iv)).decrypt(b64decode(payload.data));
  } catch {
    throw new Error('Wrong password — wallet could not be unlocked.');
  }
  return new TextDecoder().decode(pt);
}
