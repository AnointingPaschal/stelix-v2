/**
 * Non-custodial wallet — ethers v6.
 *
 * LIVE ONLY. No demo wallets, no sample balances, no fallback seed.
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
import { kvDelete, kvGet, kvSet } from './storage';

const WALLET_KEY = 'stelix_encrypted_wallet_v2';
const WALLET_META_KEY = 'stelix_wallet_meta_v2';

export interface WalletMeta {
  address: string;
  createdAt: number;
  /** Kept for backwards compatibility with the old demo-era field.
   *  Always false now — Stelix no longer creates demo wallets. */
  isDemo: boolean;
  hasBiometrics: boolean;
}

/** Whether SecureStore could be loaded in this runtime. */
let secureStoreAvailable: boolean | null = null;

async function secureStore(): Promise<typeof import('expo-secure-store') | null> {
  if (secureStoreAvailable === false) return null;
  try {
    // Dynamic import: static import breaks Jest/node and web bundles
    // where the native module is absent.
    const mod = await import('expo-secure-store');
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
    await ss.setItemAsync(key, value);
    return;
  }
  // WEB FALLBACK (labelled): encrypted payload in localStorage. The value
  // is already PBKDF2/AES-GCM encrypted (wallet.ts/crypto.ts); plaintext
  // secrets are never written here.
  await kvSet(key, value);
}

async function storeGet(key: string): Promise<string | null> {
  const ss = await secureStore();
  if (ss) return ss.getItemAsync(key);
  return kvGet(key);
}

async function storeDelete(key: string): Promise<void> {
  const ss = await secureStore();
  if (ss) {
    await ss.deleteItemAsync(key);
    return;
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

export async function createWallet(password: string): Promise<{ mnemonic: string; address: string }> {
  assertStrongPassword(password);
  const phrase = generateMnemonic();
  const wallet = ethers.Wallet.fromPhrase(phrase);
  const encrypted = await encryptSecret(phrase, password);
  await storeSet(WALLET_KEY, encrypted);
  const meta: WalletMeta = {
    address: wallet.address,
    createdAt: Date.now(),
    isDemo: false,
    hasBiometrics: false,
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
export async function importWallet(secret: string, password: string): Promise<string> {
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
    isDemo: false,
    hasBiometrics: false,
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
    const meta = JSON.parse(raw) as WalletMeta;
    return { ...meta, isDemo: false };
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

/** Validate a Solana base58 address format (32–44 base58 chars).
 *  Format-only check — it does not prove the account exists on-chain. */
export function isValidSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr.trim());
}
