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
 * On web, SecureStore is unavailable, so the ENCRYPTED payload falls back
 * to localStorage — clearly labelled below and in the README. The payload
 * is encrypted before storage either way, so the fallback never holds a
 * plaintext secret. Nothing here logs a mnemonic or private key.
 */
import { ethers } from 'ethers';
import { assertStrongPassword, decryptSecret, encryptSecret } from './crypto';
import { deriveSolanaAddress } from './solana';
import { kvDelete, kvGet, kvSet } from './storage';

/** Web detection without importing react-native (which Jest cannot
 *  transform in this setup): web has document + localStorage, native
 *  and Node do not. */
function isWeb(): boolean {
  try {
    return typeof document !== 'undefined' && typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
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
 * that the methods exist, and fall back to encrypted localStorage
 * whenever SecureStore fails for any reason.
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
      // SecureStore failed at runtime — fall through to the encrypted
      // localStorage fallback instead of losing the wallet.
      secureStoreAvailable = false;
    }
  }
  // WEB FALLBACK (labelled): encrypted payload in localStorage. The value
  // is already PBKDF2/AES-GCM encrypted (wallet.ts/crypto.ts); plaintext
  // secrets are never written here.
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

/** Generate a fresh random 12-word mnemonic (ethers v6). Returns the
 *  mnemonic — the caller must show it once for backup and never log it. */
export function generateMnemonic(): string {
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
