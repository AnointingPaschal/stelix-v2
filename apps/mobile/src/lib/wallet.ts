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
 *   Restored 2026-11-27 (all chains active again).
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
import { assertStrongPassword, decryptSecret, encryptSecret, randomBytesSync } from './crypto';
import type { EncryptStep } from './crypto';
import { deriveSolanaAddress } from './solana';
import { isNativeApp, kvDelete, kvGet, kvSet } from './storage';
import { TimeoutError, withTimeout } from './timeout';

/** Import progress steps, in order. Reported to the import screen via
 *  importWallet's onProgress callback and named in the overall-timeout
 *  error, so a hang always says WHERE it stopped. */
export type ImportStep =
  | 'deriving-address'
  | 'deriving-key'
  | 'encrypting'
  | 'saving-wallet'
  | 'deriving-solana';

export const IMPORT_STEP_LABELS: Record<ImportStep, string> = {
  'deriving-address': 'Deriving address…',
  'deriving-key': 'Deriving encryption key… this can take ~10–30 s on this device',
  encrypting: 'Encrypting…',
  'saving-wallet': 'Saving wallet…',
  'deriving-solana': 'Deriving Solana address…',
};

/** Default overall bound for an import (see importWallet). */
export const IMPORT_TIMEOUT_MS = 90_000;

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

/** Multi-wallet storage (2026-11-27): EVERY created or imported wallet
 *  is kept, and the user switches between them — creating or importing
 *  NEVER replaces the wallet already on the device (the old single-
 *  wallet keys below are migrated once, then deleted).
 *
 *  Every wallet's secret is encrypted under the SAME session password
 *  (the app password): the create/import screens ask for the current
 *  password when wallets already exist and verify it before adding, so
 *  all stored wallets always decrypt with the one current password.
 *  changePassword re-encrypts every wallet, never just one. */
const WALLETS_KEY = 'stelix_encrypted_wallets_v3';
const ACTIVE_WALLET_KEY = 'stelix_active_wallet_v3';

/** Legacy single-wallet keys (v2) — read once by the migration, then deleted. */
const LEGACY_WALLET_KEY = 'stelix_encrypted_wallet_v2';
const LEGACY_WALLET_META_KEY = 'stelix_wallet_meta_v2';

export interface WalletMeta {
  /** Stable id: `w_` + lowercase address — dedupes by address. */
  id: string;
  address: string;
  createdAt: number;
  hasBiometrics: boolean;
  /** Optional display name given at create/import time. */
  name?: string;
  /** Solana address derived from the same mnemonic (m/44'/501'/0'/0').
   *  Null when the wallet was imported from a raw private key. */
  solanaAddress?: string | null;
}

/** A stored wallet: its meta plus the encrypted secret. The secret is
 *  never exposed outside this module except through decrypt-on-demand
 *  (unlockWallet / exportSecret). */
interface StoredWallet extends WalletMeta {
  encryptedSecret: string;
}

export function walletIdFor(address: string): string {
  return `w_${address.toLowerCase()}`;
}

function toMeta(w: StoredWallet): WalletMeta {
  return {
    id: w.id,
    address: w.address,
    createdAt: w.createdAt,
    hasBiometrics: w.hasBiometrics,
    name: w.name,
    solanaAddress: w.solanaAddress ?? null,
  };
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

/** Last import step reached in this launch — read by the overall
 *  timeout so its error names the step that was in progress. */
let lastImportStep: ImportStep | null = null;

export function getLastImportStep(): ImportStep | null {
  return lastImportStep;
}

function devLogStep(label: string, startedAt: number): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(`[stelix] importWallet ${label}: ${Date.now() - startedAt}ms`);
  }
}

async function secureStore(): Promise<typeof import('expo-secure-store') | null> {
  if (isWeb()) return null;
  if (secureStoreAvailable === false) return null;
  try {
    // Dynamic import: static import breaks Jest/node and web bundles
    // where the native module is absent. 10s bound — an on-demand
    // Metro chunk fetch that never settles used to hang the whole
    // import forever (2026-11-27); a timeout is treated exactly like
    // an unavailable module and falls through to the kv store.
    const mod = await withTimeout(
      import('expo-secure-store'),
      10_000,
      'expo-secure-store dynamic import',
    );
    if (typeof mod.setItemAsync !== 'function' || typeof mod.getItemAsync !== 'function') {
      secureStoreAvailable = false;
      return null;
    }
    if (typeof mod.isAvailableAsync === 'function') {
      const available = await withTimeout(
        mod.isAvailableAsync().catch(() => false),
        10_000,
        'SecureStore.isAvailableAsync()',
      );
      if (!available) {
        secureStoreAvailable = false;
        return null;
      }
    }
    secureStoreAvailable = true;
    return mod;
  } catch (e) {
    if (e instanceof TimeoutError) {
      console.warn('[stelix] SecureStore unavailable: import/isAvailable timed out after 10s — using encrypted kv fallback.');
    }
    secureStoreAvailable = false;
    return null;
  }
}

async function storeSet(key: string, value: string): Promise<void> {
  const ss = await secureStore();
  if (ss) {
    try {
      // 10s bound: a setItemAsync that never settles used to hang the
      // import forever. A timeout falls through to kv, as a rejection
      // already did — the payload is encrypted either way.
      await withTimeout(ss.setItemAsync(key, value), 10_000, `SecureStore.setItemAsync(${key})`);
      return;
    } catch (e) {
      if (e instanceof TimeoutError) {
        console.warn(`[stelix] SecureStore.setItemAsync(${key}) timed out after 10s — using encrypted kv fallback.`);
      }
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
      const value = await withTimeout(ss.getItemAsync(key), 10_000, `SecureStore.getItemAsync(${key})`);
      if (value !== null) return value;
    } catch (e) {
      if (e instanceof TimeoutError) {
        console.warn(`[stelix] SecureStore.getItemAsync(${key}) timed out after 10s — reading encrypted kv fallback.`);
      }
      secureStoreAvailable = false;
    }
  }
  return kvGet(key);
}

async function storeDelete(key: string): Promise<void> {
  const ss = await secureStore();
  if (ss) {
    try {
      await withTimeout(ss.deleteItemAsync(key), 10_000, `SecureStore.deleteItemAsync(${key})`);
    } catch {
      secureStoreAvailable = false;
    }
  }
  await kvDelete(key);
}

/** One-time migration from the old single-wallet keys: the v2 encrypted
 *  payload is already encrypted under the session password, so it moves
 *  across as-is — no re-encryption, no password needed. The v2 keys are
 *  deleted after the v3 write succeeds, so a later wipe can never
 *  resurrect the wallet through them. Stateless on purpose (no
 *  module-level "done" flag): readWallets runs it on every call, so a
 *  failed attempt retries and tests can seed legacy keys at any time. */
async function migrateLegacyWallet(): Promise<void> {
  try {
    const existing = await storeGet(WALLETS_KEY);
    if (existing !== null) return; // already migrated (or already multi-wallet)
    const encrypted = await storeGet(LEGACY_WALLET_KEY);
    const rawMeta = await storeGet(LEGACY_WALLET_META_KEY);
    if (!encrypted || !rawMeta) return; // nothing to migrate
    let meta: { address: string; createdAt: number; hasBiometrics: boolean; name?: string; solanaAddress?: string | null };
    try {
      meta = JSON.parse(rawMeta) as typeof meta;
    } catch {
      return;
    }
    if (!meta || typeof meta.address !== 'string') return;
    const wallet: StoredWallet = {
      id: walletIdFor(meta.address),
      address: meta.address,
      createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : Date.now(),
      hasBiometrics: meta.hasBiometrics === true,
      name: meta.name,
      solanaAddress: meta.solanaAddress ?? null,
      encryptedSecret: encrypted,
    };
    await storeSet(WALLETS_KEY, JSON.stringify([wallet]));
    await storeSet(ACTIVE_WALLET_KEY, wallet.id);
    await storeDelete(LEGACY_WALLET_KEY);
    await storeDelete(LEGACY_WALLET_META_KEY);
  } catch {
    // Migration is best-effort: a failure leaves the v2 keys in place
    // (the next listWallets call retries) and never deletes anything.
  }
}

async function readWallets(): Promise<StoredWallet[]> {
  await migrateLegacyWallet();
  const raw = await storeGet(WALLETS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredWallet[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (w) => w && typeof w.address === 'string' && typeof w.encryptedSecret === 'string',
    );
  } catch {
    return [];
  }
}

async function writeWallets(wallets: StoredWallet[]): Promise<void> {
  await storeSet(WALLETS_KEY, JSON.stringify(wallets));
}

function sortByCreated(wallets: StoredWallet[]): StoredWallet[] {
  return wallets.slice().sort((a, b) => a.createdAt - b.createdAt);
}

/** All saved wallets, oldest first (so "Wallet 1" is the first wallet
 *  ever created/imported on the device). Runs the v2 migration first. */
export async function listWallets(): Promise<WalletMeta[]> {
  return sortByCreated(await readWallets()).map(toMeta);
}

/** Id of the active wallet, or null when none is saved. A stale stored
 *  id (wallet removed) falls back to the oldest wallet. */
export async function getActiveWalletId(): Promise<string | null> {
  const wallets = await readWallets();
  if (wallets.length === 0) return null;
  const activeId = await storeGet(ACTIVE_WALLET_KEY);
  if (activeId && wallets.some((w) => w.id === activeId)) return activeId;
  return sortByCreated(wallets)[0].id;
}

export async function getActiveWalletMeta(): Promise<WalletMeta | null> {
  const wallets = await readWallets();
  if (wallets.length === 0) return null;
  const activeId = await getActiveWalletId();
  const active = wallets.find((w) => w.id === activeId) ?? sortByCreated(wallets)[0];
  return toMeta(active);
}

/** Kept for existing callers: the active wallet's meta. */
export async function getWalletMeta(): Promise<WalletMeta | null> {
  return getActiveWalletMeta();
}

/** Make a saved wallet the active one (balances, locks, history and
 *  signing all follow the active wallet). Throws on an unknown id. */
export async function setActiveWalletId(id: string): Promise<WalletMeta> {
  const wallets = await readWallets();
  const wallet = wallets.find((w) => w.id === id);
  if (!wallet) throw new Error('That wallet is not saved on this device.');
  await storeSet(ACTIVE_WALLET_KEY, id);
  return toMeta(wallet);
}

export async function hasWallet(): Promise<boolean> {
  return (await readWallets()).length > 0;
}

/** True when the password decrypts the active wallet (i.e. it is the
 *  current app password). Never throws — the create/import screens use
 *  this to prove the typed password is the current one before adding
 *  another wallet under it. */
export async function verifySessionPassword(password: string): Promise<boolean> {
  try {
    const wallets = await readWallets();
    if (wallets.length === 0) return false;
    const activeId = await getActiveWalletId();
    const wallet = wallets.find((w) => w.id === activeId) ?? sortByCreated(wallets)[0];
    await decryptSecret(wallet.encryptedSecret, password);
    return true;
  } catch {
    return false;
  }
}

/** Remove one wallet from this device. Returns the remaining wallets
 *  and the new active wallet (null when none remain). The caller must
 *  warn the user to back up the seed phrase first — removal is final
 *  on this device; the funds stay on-chain and return only by re-import. */
export async function removeWallet(
  id: string,
): Promise<{ wallets: WalletMeta[]; active: WalletMeta | null }> {
  const wallets = await readWallets();
  const next = wallets.filter((w) => w.id !== id);
  if (next.length === wallets.length) throw new Error('That wallet is not saved on this device.');
  await writeWallets(next);
  if (next.length === 0) {
    await storeDelete(ACTIVE_WALLET_KEY);
    await clearBiometricSessionPassword();
    return { wallets: [], active: null };
  }
  const activeId = await getActiveWalletId();
  const active = next.find((w) => w.id === activeId) ?? sortByCreated(next)[0];
  await storeSet(ACTIVE_WALLET_KEY, active.id);
  return { wallets: sortByCreated(next).map(toMeta), active: toMeta(active) };
}

export async function renameWallet(id: string, name: string): Promise<WalletMeta> {
  const wallets = await readWallets();
  const wallet = wallets.find((w) => w.id === id);
  if (!wallet) throw new Error('That wallet is not saved on this device.');
  wallet.name = name.trim() || undefined;
  await writeWallets(wallets);
  return toMeta(wallet);
}

/**
 * ethers' mnemonic generation (`Wallet.createRandom`) draws entropy from
 * `ethers.randomBytes`, which on the ESM build reads
 * `globalThis.crypto.getRandomValues` — a global Hermes does not ship.
 * On native, Create Wallet would therefore fail with the same missing-
 * crypto root cause as Import did (see lib/crypto.ts). ALWAYS register
 * ethers' random source to crypto.ts's `randomBytesSync`, which itself
 * tries the platform CSPRNG first — global getRandomValues (supplied on
 * Hermes by the `react-native-get-random-values` polyfill, first import
 * of src/app/_layout.tsx) and the probed Expo native crypto module —
 * so good environments are unchanged, and only a host with no native
 * random module at all falls back to the clearly-labelled DEGRADED
 * ChaCha20 DRBG in crypto.ts. This registration never throws, never
 * runs at module load (only on first mnemonic generation), and never
 * loads the Expo crypto package — the package whose JS throws at load
 * when its native module is absent was the Expo Go crash of 2026-11-27
 * (see lib/crypto.ts) and has been removed from the app entirely.
 * Never Math.random.
 */
let ethersRandomRegistered = false;

function ensureEthersSecureRandom(): void {
  if (ethersRandomRegistered) return;
  ethersRandomRegistered = true;
  ethers.randomBytes.register((length: number) => randomBytesSync(length));
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

/** Create a fresh wallet and ADD it alongside any wallets already saved
 *  — it never replaces them. The new wallet becomes the active one. */
export async function createWallet(password: string, name?: string): Promise<{ mnemonic: string; address: string }> {
  assertStrongPassword(password);
  const phrase = generateMnemonic();
  const wallet = ethers.Wallet.fromPhrase(phrase);
  const encrypted = await encryptSecret(phrase, password);
  const record: StoredWallet = {
    id: walletIdFor(wallet.address),
    address: wallet.address,
    createdAt: Date.now(),
    hasBiometrics: false,
    name: name?.trim() || undefined,
    solanaAddress: tryDeriveSolanaAddress(phrase),
    encryptedSecret: encrypted,
  };
  const wallets = await readWallets();
  await writeWallets([...wallets, record]);
  await storeSet(ACTIVE_WALLET_KEY, record.id);
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

export interface ImportWalletOptions {
  /** Called with each step as it starts — drives the import screen's
   *  step label so the user sees progress during the slow KDF. */
  onProgress?: (step: ImportStep) => void;
  /** Overall bound for the whole import (default 90s). On expiry the
   *  import rejects with `Import timed out at <step>` — the screen's
   *  existing catch shows it inline and finally setBusy(false) runs,
   *  so the button can never spin forever again. Tests pass a small
   *  value; production must not pass a smaller one. */
  timeoutMs?: number;
}

/** Import from a seed phrase or private key. Throws on invalid input.
 *  APPENDS the wallet alongside any already saved — it never replaces
 *  them — and makes it the active wallet. Importing an address that is
 *  already saved updates that wallet in place (same secret, new name)
 *  instead of duplicating it.
 *  KDF: native subtle 600,000 when available, pure JS 10,000 in
 *  Expo Go / Hermes (see lib/crypto.ts) — 600,000 in pure JS on a
 *  phone is >90s and Import timed out. */
export async function importWallet(
  secret: string,
  password: string,
  name?: string,
  opts?: ImportWalletOptions,
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? IMPORT_TIMEOUT_MS;
  const onProgress = opts?.onProgress;
  let currentStep: ImportStep = 'deriving-address';
  const report = (step: ImportStep): void => {
    currentStep = step;
    lastImportStep = step;
    onProgress?.(step);
  };
  const run = async (): Promise<string> => {
    assertStrongPassword(password);
    const t0 = Date.now();
    report('deriving-address');
    const wallet = walletFromSecret(secret);
    devLogStep('fromPhrase', t0);
    // Store the canonical secret (phrase when available, else private key)
    // encrypted under the session password — never plaintext.
    const canonical = (wallet as ethers.HDNodeWallet).mnemonic?.phrase ?? wallet.privateKey;
    const onEncryptStep = (s: EncryptStep): void => {
      report(s === 'deriveKey' ? 'deriving-key' : s === 'gcm' ? 'encrypting' : 'deriving-key');
    };
    const encrypted = await encryptSecret(canonical, password, onEncryptStep);
    report('deriving-solana');
    const tSol = Date.now();
    // Best-effort: a Solana derivation failure must never block import.
    const solanaAddress = tryDeriveSolanaAddress(
      (wallet as ethers.HDNodeWallet).mnemonic?.phrase ?? null,
    );
    devLogStep('solana', tSol);
    report('saving-wallet');
    const tSave = Date.now();
    const record: StoredWallet = {
      id: walletIdFor(wallet.address),
      address: wallet.address,
      createdAt: Date.now(),
      hasBiometrics: false,
      name: name?.trim() || undefined,
      solanaAddress,
      encryptedSecret: encrypted,
    };
    const wallets = await readWallets();
    const existing = wallets.find((w) => w.id === record.id);
    if (existing) {
      // Re-import of a saved wallet: refresh the secret + name in place,
      // keep its original createdAt (so its "Wallet N" position is stable).
      existing.encryptedSecret = encrypted;
      existing.name = record.name;
      existing.solanaAddress = solanaAddress;
      await writeWallets(wallets);
    } else {
      await writeWallets([...wallets, record]);
    }
    await storeSet(ACTIVE_WALLET_KEY, record.id);
    devLogStep('storeSet:wallet', tSave);
    return wallet.address;
  };
  // Overall timeout: the timer's rejection reads currentStep LIVE, so
  // the error names the step that was actually in progress.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `Import timed out at ${IMPORT_STEP_LABELS[currentStep]} — the device did not finish that step within ${Math.max(1, Math.round(timeoutMs / 1000))}s. Check your connection and try again.`,
            ),
          ),
        timeoutMs,
      );
    });
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Unlock a stored wallet with the session password — the ACTIVE wallet
 * by default, or the wallet id given. Returns null when no wallet is
 * stored. THROWS on a wrong password.
 */
export async function unlockWallet(
  password: string,
  walletId?: string,
): Promise<ethers.Wallet | ethers.HDNodeWallet | null> {
  const wallets = await readWallets();
  if (wallets.length === 0) return null;
  let wallet: StoredWallet | undefined;
  if (walletId) {
    wallet = wallets.find((w) => w.id === walletId);
    if (!wallet) throw new Error('That wallet is not saved on this device.');
  } else {
    const activeId = await getActiveWalletId();
    wallet = wallets.find((w) => w.id === activeId) ?? sortByCreated(wallets)[0];
  }
  const secret = await decryptSecret(wallet.encryptedSecret, password); // throws on wrong password
  return walletFromSecret(secret);
}

/**
 * Export a wallet's secret (mnemonic or private key) — ONLY after the
 * caller re-enters the password, which is verified by decryption.
 * THROWS on a wrong password. The caller must never log the result.
 * Defaults to the active wallet.
 */
export async function exportSecret(password: string, walletId?: string): Promise<string> {
  const wallets = await readWallets();
  if (wallets.length === 0) throw new Error('No wallet stored on this device.');
  let wallet: StoredWallet | undefined;
  if (walletId) {
    wallet = wallets.find((w) => w.id === walletId);
    if (!wallet) throw new Error('That wallet is not saved on this device.');
  } else {
    const activeId = await getActiveWalletId();
    wallet = wallets.find((w) => w.id === activeId) ?? sortByCreated(wallets)[0];
  }
  return decryptSecret(wallet.encryptedSecret, password); // throws on wrong password
}

/**
 * Change the session password: decrypts EVERY stored wallet's secret
 * with the old password (THROWS on a wrong old password) and re-encrypts
 * them all under the new password. All secrets are decrypted BEFORE
 * anything is written, so a failed change can never leave half the
 * wallets on the old password and half on the new one. The plaintext
 * secrets are never written to storage.
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  assertStrongPassword(newPassword);
  const wallets = await readWallets();
  if (wallets.length === 0) throw new Error('No wallet stored on this device.');
  const secrets = await Promise.all(
    wallets.map((w) => decryptSecret(w.encryptedSecret, oldPassword)), // throws on wrong password
  );
  const next = await Promise.all(
    wallets.map(async (w, i) => ({ ...w, encryptedSecret: await encryptSecret(secrets[i], newPassword) })),
  );
  await writeWallets(next);
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
    const mod = await withTimeout(
      import('expo-secure-store'),
      10_000,
      'expo-secure-store dynamic import (biometric save)',
    );
    if (typeof mod.setItemAsync !== 'function') return false;
    await withTimeout(
      mod.setItemAsync(BIOMETRIC_PASSWORD_KEY, password, {
        requireAuthentication: true,
        authenticationPrompt: 'Authenticate to enable biometric signing',
      }),
      10_000,
      'SecureStore.setItemAsync(biometric password)',
    );
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
    const mod = await withTimeout(
      import('expo-secure-store'),
      10_000,
      'expo-secure-store dynamic import (biometric read)',
    );
    if (typeof mod.getItemAsync !== 'function') return null;
    return await withTimeout(
      mod.getItemAsync(BIOMETRIC_PASSWORD_KEY, {
        requireAuthentication: true,
        authenticationPrompt: 'Authenticate to sign this transaction',
      }),
      10_000,
      'SecureStore.getItemAsync(biometric password)',
    );
  } catch {
    return null;
  }
}

export async function clearBiometricSessionPassword(): Promise<void> {
  if (isWeb()) return;
  try {
    const mod = await withTimeout(
      import('expo-secure-store'),
      10_000,
      'expo-secure-store dynamic import (biometric clear)',
    );
    if (typeof mod.deleteItemAsync === 'function') {
      await withTimeout(
        mod.deleteItemAsync(BIOMETRIC_PASSWORD_KEY),
        10_000,
        'SecureStore.deleteItemAsync(biometric password)',
      );
    }
  } catch {
    // Best-effort cleanup — a missing key is already clean.
  }
}

/** Wipe EVERY wallet from this device (the Settings / unlock "erase
 *  everything" path). The legacy v2 keys are deleted too — otherwise
 *  the next listWallets() would resurrect the wiped wallet through the
 *  migration. */
export async function wipeWallet(): Promise<void> {
  await storeDelete(WALLETS_KEY);
  await storeDelete(ACTIVE_WALLET_KEY);
  await storeDelete(LEGACY_WALLET_KEY);
  await storeDelete(LEGACY_WALLET_META_KEY);
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
