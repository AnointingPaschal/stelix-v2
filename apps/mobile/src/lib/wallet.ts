/**
 * Non-custodial wallet — ethers v6.
 *
 * LIVE ONLY. No placeholder wallets, no sample balances, no fallback seed.
 * - Create: a real 12-word mnemonic from ethers (Wallet.createRandom),
 *   derived address, stored ONLY as a PBKDF2/AES-GCM encrypted payload
 *   (see crypto.ts) under the user's session password.
 * - Import: 12- or 24-word seed phrase (BIP-39 validated) or a 64-hex
 *   private key. Anything else throws.
 * - Unlock: decrypts the stored payload with the password. A WRONG
 *   password throws (AES-GCM auth failure) — it is never accepted, however
 *   long it is. There is no password bypass.
 * - Export: only after password re-entry (decrypt), never from a cached
 *   plaintext copy.
 * - Solana: the Solana address is derived from the same mnemonic at the
 *   standard path m/44'/501'/0'/0' (see lib/solana.ts) and stored as a
 *   PUBLIC address in the wallet meta. Wallets imported from a raw
 *   private key have no mnemonic, so they have no Solana address.
 *
 * Storage: expo-secure-store on native (where available — it is a native
 * module, so a development build is required; it is NOT in Expo Go).
 * When SecureStore is unavailable the ENCRYPTED payload falls back to
 * the durable kv store in lib/storage.ts — AsyncStorage on native,
 * localStorage on the web build — clearly labelled there. The payload
 * is encrypted before storage either way, so the fallback never holds a
 * plaintext secret. Nothing here logs a mnemonic or private key.
 */
import { ethers } from 'ethers';
import { assertStrongPassword, decryptSecret, encryptSecret } from './crypto';
import { deriveSolanaAddress } from './solana';
import { isNativeApp, kvDelete, kvGet, kvSet } from './storage';

/** "Web" here means "not the native app" — SecureStore is a native
 *  module and must never be attempted off native. Detection is
 *  `navigator.product === 'ReactNative'` (see lib/storage.ts): no
 *  `document` / `localStorage` sniffing, no react-native import (which
 *  Jest cannot transform in this setup). In Node/Jest this is true,
 *  which is the safe side — SecureStore is skipped and the kv store
 *  (in-memory there) is used. */
function isWeb(): boolean {
  return !isNativeApp();
}

const WALLET_KEY = 'stelix_encrypted_wallet_v2';
const WALLET_META_KEY = 'stelix_wallet_meta_v2';

export interface WalletMeta {
  address: string;
  createdAt: number;
  hasBiometrics: boolean;
  /** Optional display name given at create/import time. */
  name?: string;
  /** Solana address derived from the same mnemonic (m/44'/501'/0'/0').
   *  Null when the wallet was imported from a raw private key. */
  solanaAddress?: string | null;
}

/** Best-effort Solana derivation: never fails wallet creation/import.
 *  Returns null when there is no mnemonic to derive from. */
function tryDeriveSolanaAddress(phrase: string | null): string | null {
  if (!phrase) return null;
  try {
    return deriveSolanaAddress(phrase);
  } catch {
    return null;
  }
}

/**
 * Whether SecureStore could be loaded in this runtime.
 *
 * ROOT CAUSE of the web Create Wallet bug (2026-11-26): on web the
 * dynamic `import('expo-secure-store')` SUCCEEDS, but the web build of
 * the native module (`ExpoSecureStore.web.js`) is literally
 * `export default {}` — an empty object. The old code treated a
 * successful import as "SecureStore is available", so `storeSet` called
 * `SecureStore.setItemAsync`, which calls the missing
 * `ExpoSecureStore.setValueWithKeyAsync` and throws a TypeError on every
 * save. The handler caught it and called `Alert.alert`, which on
 * react-native-web is an empty no-op class — so the user saw nothing.
 * Fix: never use SecureStore on web, verify `isAvailableAsync()` and
 * that the methods exist, and fall back to the durable encrypted kv
 * store (AsyncStorage on native, localStorage on web) whenever
 * SecureStore fails for any reason.
 */
let secureStoreAvailable: boolean | null = null;

async function secureStore(): Promise<typeof import('expo-secure-store') | null> {
  if (isWeb()) return null;
  if (secureStoreAvailable === false) return null;
  try {
    // Dynamic import: static import breaks Jest/node and web bundles
    // where the native module is absent.
    const mod = await import('expo-secure-store');
    if (typeof mod.setItemAsync !== 'function' || typeof mod.getItemAsync !== 'function') {
      secureStoreAvailable = false;
      return null;
    }
    if (typeof mod.isAvailableAsync === 'function') {
      const available = await mod.isAvailableAsync().catch(() => false);
      if (!available) {
        secureStoreAvailable = false;
        return null;
      }
    }
    secureStoreAvailable = true;
    return mod;
  } catch {
    secureStoreAvailable = false;
    return null;
  }
}

async function storeSet(key: string, value: string): Promise<void> {
  const ss = await secureStore();
  if (ss) {
    try {
      await ss.setItemAsync(key, value);
      return;
    } catch {
      // SecureStore failed at runtime — fall through to the durable
      // encrypted kv fallback (AsyncStorage on native) instead of
      // losing the wallet.
      secureStoreAvailable = false;
    }
  }
  // FALLBACK (labelled): encrypted payload in the kv store
  // (AsyncStorage on native, localStorage on web — see lib/storage.ts).
  // The value is already PBKDF2/AES-GCM encrypted (wallet.ts/crypto.ts);
  // plaintext secrets are never written here.
  await kvSet(key, value);
}

async function storeGet(key: string): Promise<string | null> {
  const ss = await secureStore();
  if (ss) {
    try {
      const value = await ss.getItemAsync(key);
      if (value !== null) return value;
    } catch {
      secureStoreAvailable = false;
    }
  }
  return kvGet(key);
}

async function storeDelete(key: string): Promise<void> {
  const ss = await secureStore();
  if (ss) {
    try {
      await ss.deleteItemAsync(key);
    } catch {
      secureStoreAvailable = false;
    }
  }
  await kvDelete(key);
}

/**
 * ethers' mnemonic generation (`Wallet.createRandom`) draws entropy from
 * `ethers.randomBytes`, which on the ESM build reads
 * `globalThis.crypto.getRandomValues` — a global Hermes does not ship.
 * On native, Create Wallet would therefore fail with the same missing-
 * crypto root cause as Import did (see lib/crypto.ts). Register a secure
 * random source backed by the expo-crypto native module (OS CSPRNG) when
 * — and only when — the platform has no `crypto.getRandomValues`. On web
 * and in Jest the default already works, so nothing is registered there
 * and `expo-crypto` is never loaded. Never Math.random.
 */
let ethersRandomRegistered = false;

function ensureEthersSecureRandom(): void {
  if (ethersRandomRegistered) return;
  ethersRandomRegistered = true;
  if (typeof globalThis.crypto?.getRandomValues === 'function') return;
  try {
    // Lazy require: static import would load the native module in Jest /
    // Node, where this branch never runs. Metro bundles expo-crypto
    // because the require is statically analyzable.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoCrypto = require('expo-crypto') as typeof import('expo-crypto');
    if (typeof ExpoCrypto.getRandomBytes !== 'function') {
      throw new Error('expo-crypto getRandomBytes is unavailable');
    }
    ethers.randomBytes.register((length: number) => ExpoCrypto.getRandomBytes(length));
  } catch {
    throw new Error(
      'No secure random source is available in this environment — wallet creation cannot run.',
    );
  }
}

/** Generate a fresh random 12-word mnemonic (ethers v6). Returns the
 *  mnemonic — the caller must show it once for backup and never log it. */
export function generateMnemonic(): string {
  ensureEthersSecureRandom();
  const wallet = ethers.Wallet.createRandom();
  const phrase = wallet.mnemonic?.phrase ?? '';
  if (phrase.split(/\s+/).length !== 12 || !ethers.Mnemonic.isValidMnemonic(phrase)) {
    throw new Error('Failed to generate a valid 12-word mnemonic.');
  }
  return phrase;
}

export async function createWallet(password: string, name?: string): Promise<{ mnemonic: string; address: string }> {
  assertStrongPassword(password);
  const phrase = generateMnemonic();
  const wallet = ethers.Wallet.fromPhrase(phrase);
  const encrypted = await encryptSecret(phrase, password);
  await storeSet(WALLET_KEY, encrypted);
  const meta: WalletMeta = {
    address: wallet.address,
    createdAt: Date.now(),
    hasBiometrics: false,
    name: name?.trim() || undefined,
    solanaAddress: tryDeriveSolanaAddress(phrase),
  };
  await storeSet(WALLET_META_KEY, JSON.stringify(meta));
  return { mnemonic: phrase, address: wallet.address };
}

function walletFromSecret(secret: string): ethers.Wallet | ethers.HDNodeWallet {
  const trimmed = secret.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 12 || words.length === 24) {
    if (!ethers.Mnemonic.isValidMnemonic(trimmed)) {
      throw new Error('Invalid seed phrase — check the words and their order.');
    }
    return ethers.Wallet.fromPhrase(trimmed);
  }
  // Private key: 64 hex chars, with or without 0x.
  const hex = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'Invalid secret — enter a 12- or 24-word seed phrase or a 64-character hex private key.',
    );
  }
  return new ethers.Wallet(hex);
}

/** Import from a seed phrase or private key. Throws on invalid input. */
export async function importWallet(secret: string, password: string, name?: string): Promise<string> {
  assertStrongPassword(password);
  const wallet = walletFromSecret(secret);
  // Store the canonical secret (phrase when available, else private key)
  // encrypted under the session password — never plaintext.
  const canonical = (wallet as ethers.HDNodeWallet).mnemonic?.phrase ?? wallet.privateKey;
  const encrypted = await encryptSecret(canonical, password);
  await storeSet(WALLET_KEY, encrypted);
  const meta: WalletMeta = {
    address: wallet.address,
    createdAt: Date.now(),
    hasBiometrics: false,
    name: name?.trim() || undefined,
    solanaAddress: tryDeriveSolanaAddress((wallet as ethers.HDNodeWallet).mnemonic?.phrase ?? null),
  };
  await storeSet(WALLET_META_KEY, JSON.stringify(meta));
  return wallet.address;
}

/**
 * Unlock the stored wallet with the session password.
 * Returns null when no wallet is stored. THROWS on a wrong password.
 */
export async function unlockWallet(password: string): Promise<ethers.Wallet | ethers.HDNodeWallet | null> {
  const encrypted = await storeGet(WALLET_KEY);
  if (!encrypted) return null;
  const secret = await decryptSecret(encrypted, password); // throws on wrong password
  return walletFromSecret(secret);
}

/**
 * Export the stored secret (mnemonic or private key) — ONLY after the
 * caller re-enters the password, which is verified by decryption.
 * THROWS on a wrong password. The caller must never log the result.
 */
export async function exportSecret(password: string): Promise<string> {
  const encrypted = await storeGet(WALLET_KEY);
  if (!encrypted) throw new Error('No wallet stored on this device.');
  return decryptSecret(encrypted, password); // throws on wrong password
}

/**
 * Change the session password: decrypts the stored secret with the old
 * password (THROWS on a wrong old password) and re-encrypts it under the
 * new password. The plaintext secret is never written to storage.
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  assertStrongPassword(newPassword);
  const encrypted = await storeGet(WALLET_KEY);
  if (!encrypted) throw new Error('No wallet stored on this device.');
  const secret = await decryptSecret(encrypted, oldPassword); // throws on wrong password
  await storeSet(WALLET_KEY, await encryptSecret(secret, newPassword));
  // The biometric-gated copy holds the OLD password — it can no longer
  // decrypt anything, so wipe it; the next password sign re-saves it.
  await clearBiometricSessionPassword();
}

// ---------------------------------------------------------------------------
// Biometric signing — the signing modal's alternative to typing the
// session password (see components/SignTransactionModal.tsx).
//
// How it works, honestly: the wallet secret is encrypted under the
// session password, so biometrics alone cannot decrypt it. After a
// successful password sign, the modal may store the SESSION PASSWORD
// itself in the OS keychain (expo-secure-store) with
// requireAuthentication — the OS only releases it after a biometric
// check, and only on native (SecureStore is an empty object on web, so
// this always returns false there and the modal hides the biometric
// option). The stored value is the password, never the seed or private
// key, and it is wiped by clearBiometricSessionPassword() (called when
// biometrics are switched off in Settings or the wallet is wiped).
// Nothing here logs the password.
// ---------------------------------------------------------------------------
const BIOMETRIC_PASSWORD_KEY = 'stelix_biometric_session_password_v1';

/** Best-effort: store the session password behind a biometric gate.
 *  Returns false on web / when SecureStore is unavailable — the caller
 *  then just keeps asking for the typed password. */
export async function saveBiometricSessionPassword(password: string): Promise<boolean> {
  if (isWeb()) return false;
  try {
    const mod = await import('expo-secure-store');
    if (typeof mod.setItemAsync !== 'function') return false;
    await mod.setItemAsync(BIOMETRIC_PASSWORD_KEY, password, {
      requireAuthentication: true,
      authenticationPrompt: 'Authenticate to enable biometric signing',
    });
    return true;
  } catch {
    return false;
  }
}

/** Release the stored session password after the OS biometric prompt.
 *  Returns null when nothing is stored, biometrics fail/cancel, or on
 *  web. The caller uses the returned password exactly like a typed one
 *  (decrypt → sign once) and never stores it elsewhere. */
export async function readBiometricSessionPassword(): Promise<string | null> {
  if (isWeb()) return null;
  try {
    const mod = await import('expo-secure-store');
    if (typeof mod.getItemAsync !== 'function') return null;
    return await mod.getItemAsync(BIOMETRIC_PASSWORD_KEY, {
      requireAuthentication: true,
      authenticationPrompt: 'Authenticate to sign this transaction',
    });
  } catch {
    return null;
  }
}

export async function clearBiometricSessionPassword(): Promise<void> {
  if (isWeb()) return;
  try {
    const mod = await import('expo-secure-store');
    if (typeof mod.deleteItemAsync === 'function') {
      await mod.deleteItemAsync(BIOMETRIC_PASSWORD_KEY);
    }
  } catch {
    // Best-effort cleanup — a missing key is already clean.
  }
}

export async function getWalletMeta(): Promise<WalletMeta | null> {
  const raw = await storeGet(WALLET_META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WalletMeta;
  } catch {
    return null;
  }
}

export async function hasWallet(): Promise<boolean> {
  return (await storeGet(WALLET_KEY)) !== null;
}

export async function wipeWallet(): Promise<void> {
  await storeDelete(WALLET_KEY);
  await storeDelete(WALLET_META_KEY);
  await clearBiometricSessionPassword();
}

/** Validate a recipient address (EVM). Solana addresses are base58 — the
 *  Receive screen states the format explicitly per chain. */
export function isValidEvmAddress(addr: string): boolean {
  return ethers.isAddress(addr);
}

export function isValidMnemonic(phrase: string): boolean {
  return ethers.Mnemonic.isValidMnemonic(phrase.trim());
}

/** Solana address validation lives in lib/solana.ts (PublicKey-based). */
export { isValidSolanaAddress } from './solana';
