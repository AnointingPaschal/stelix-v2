/**
 * Non-custodial wallet — ethers v6 + Expo SecureStore.
 * Keys are generated on-device and stored encrypted; the server never sees
 * a seed phrase or private key. No real keys exist in code — demo wallets
 * are generated at runtime only and are clearly labelled DEMO.
 *
 * On web, SecureStore is unavailable, so storage falls back to an
 * in-memory store (demo only — never for real funds).
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ethers } from 'ethers';

const WALLET_KEY = 'stelix_encrypted_wallet_v2';
const WALLET_META_KEY = 'stelix_wallet_meta_v2';

export interface WalletMeta {
  address: string;
  createdAt: number;
  isDemo: boolean;
  hasBiometrics: boolean;
}

const memoryStore = new Map<string, string>();

async function storeSet(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    memoryStore.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function storeGet(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return memoryStore.get(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function storeDelete(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    memoryStore.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

/** Generate a fresh random wallet (ethers v6). Returns the mnemonic — the
 *  caller must show it once for backup and never log it. */
export async function createWallet(password: string): Promise<{ mnemonic: string; address: string }> {
  const wallet = ethers.Wallet.createRandom();
  const phrase = wallet.mnemonic?.phrase ?? '';
  const encrypted = await wallet.encrypt(password);
  await storeSet(WALLET_KEY, encrypted);
  const meta: WalletMeta = {
    address: wallet.address,
    createdAt: Date.now(),
    isDemo: true,
    hasBiometrics: false,
  };
  await storeSet(WALLET_META_KEY, JSON.stringify(meta));
  return { mnemonic: phrase, address: wallet.address };
}

/** Import from a seed phrase or private key. Throws on invalid input. */
export async function importWallet(secret: string, password: string): Promise<string> {
  const trimmed = secret.trim();
  let wallet: ethers.Wallet | ethers.HDNodeWallet;
  if (trimmed.split(/\s+/).length >= 12) {
    wallet = ethers.Wallet.fromPhrase(trimmed);
  } else {
    wallet = new ethers.Wallet(trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`);
  }
  const encrypted = await wallet.encrypt(password);
  await storeSet(WALLET_KEY, encrypted);
  const meta: WalletMeta = {
    address: wallet.address,
    createdAt: Date.now(),
    isDemo: true,
    hasBiometrics: false,
  };
  await storeSet(WALLET_META_KEY, JSON.stringify(meta));
  return wallet.address;
}

/** Unlock the stored wallet with the app password. Returns null if none. */
export async function unlockWallet(password: string): Promise<ethers.Wallet | ethers.HDNodeWallet | null> {
  const encrypted = await storeGet(WALLET_KEY);
  if (!encrypted) return null;
  return ethers.Wallet.fromEncryptedJson(encrypted, password);
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
