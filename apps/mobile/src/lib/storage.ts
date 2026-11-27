/**
 * Non-secret local key/value storage for the live-data layer.
 *
 * Platform routing (native-first — NO web API is ever touched on native):
 * - Native (iOS/Android, React Native): @react-native-async-storage/
 *   async-storage — durable, on-device, survives restarts. This is the
 *   native equivalent of localStorage. Values stored here are NOT
 *   secrets — the wallet secret itself is PBKDF2/AES-GCM encrypted in
 *   wallet.ts before it ever reaches storage (SecureStore is tried
 *   first for the wallet; this kv store is its durable fallback when
 *   SecureStore is unavailable, and the fallback value is already
 *   encrypted, so it is safe in AsyncStorage's unencrypted store).
 * - Web (this same package also ships the live web build): localStorage,
 *   clearly labelled and ONLY behind the web branch below. The web
 *   build keeps working exactly as before.
 * - Node/Jest: in-memory map.
 *
 * Native detection uses `navigator.product === 'ReactNative'` — the
 * marker the React Native runtime sets — instead of sniffing for
 * `document`/`localStorage` (web globals that must never be referenced
 * on the native path) and without importing react-native (which Jest
 * cannot transform in this setup). Nothing in this file stores a
 * mnemonic, private key or password.
 */

import { TimeoutError, withTimeout } from './timeout';

const memory = new Map<string, string>();

/** True once a native storage backend timed out in this launch — the
 *  kv layer fell back to the in-memory map for that call. Surfaced
 *  via console.warn at the time (never a hang) and readable here so
 *  the UI / wallet layer can say so honestly. */
let storageDegraded = false;

export function isStorageDegraded(): boolean {
  return storageDegraded;
}

function markDegraded(message: string): void {
  storageDegraded = true;
  console.warn(`[stelix] storage degraded: ${message}`);
}

/** True only inside the React Native runtime (Hermes / JSC on device). */
export function isNativeApp(): boolean {
  try {
    return (
      typeof navigator !== 'undefined' &&
      (navigator as unknown as { product?: unknown }).product === 'ReactNative'
    );
  } catch {
    return false;
  }
}

/** True on the web build (browser globals present, not React Native). */
export function isWebApp(): boolean {
  if (isNativeApp()) return false;
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

type AsyncStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys?(): Promise<string[]>;
  multiRemove?(keys: string[]): Promise<void>;
};

let asyncStorage: AsyncStorageLike | null | undefined;
/** Lazily loaded so this module stays loadable in Jest/Node and on web,
 *  where the native branch never runs. Metro bundles the package
 *  because the import specifier is statically analyzable. */
async function getAsyncStorage(): Promise<AsyncStorageLike | null> {
  if (asyncStorage !== undefined) return asyncStorage;
  try {
    // 10s bound: a dynamic import that never settles (on-demand Metro
    // chunk fetch in dev) must fall through to the in-memory map with
    // a warning, never hang the caller. Do NOT cache a timeout as
    // null — the next call retries the import.
    const mod = await withTimeout(
      import('@react-native-async-storage/async-storage'),
      10_000,
      'AsyncStorage dynamic import',
    );
    const store = (mod as unknown as { default?: AsyncStorageLike }).default;
    asyncStorage =
      store && typeof store.getItem === 'function' && typeof store.setItem === 'function'
        ? store
        : null;
  } catch (e) {
    if (e instanceof TimeoutError) {
      markDegraded('AsyncStorage import timed out after 10s — using in-memory store for this call.');
      return null;
    }
    asyncStorage = null;
  }
  return asyncStorage;
}

export async function kvGet(key: string): Promise<string | null> {
  if (isNativeApp()) {
    const store = await getAsyncStorage();
    if (store) {
      try {
        return await withTimeout(store.getItem(key), 10_000, `AsyncStorage.getItem(${key})`);
      } catch (e) {
        if (e instanceof TimeoutError) {
          markDegraded(`AsyncStorage.getItem(${key}) timed out after 10s — using in-memory store.`);
        }
        // fall through to memory
      }
    }
    return memory.get(key) ?? null;
  }
  // WEB BRANCH ONLY (labelled): the web build's localStorage. Never
  // reached on native — isNativeApp() above takes precedence even if a
  // localStorage global were polyfilled into the native runtime.
  if (isWebApp()) {
    try {
      return localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  }
  return memory.get(key) ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  if (isNativeApp()) {
    const store = await getAsyncStorage();
    if (store) {
      try {
        await withTimeout(store.setItem(key, value), 10_000, `AsyncStorage.setItem(${key})`);
        return;
      } catch (e) {
        if (e instanceof TimeoutError) {
          markDegraded(`AsyncStorage.setItem(${key}) timed out after 10s — kept in memory only for this session.`);
        }
        // fall through to memory
      }
    }
    memory.set(key, value);
    return;
  }
  // WEB BRANCH ONLY (labelled) — see kvGet.
  if (isWebApp()) {
    try {
      localStorage.setItem(key, value);
      return;
    } catch {
      // fall through to memory
    }
  }
  memory.set(key, value);
}

export async function kvDelete(key: string): Promise<void> {
  if (isNativeApp()) {
    const store = await getAsyncStorage();
    if (store) {
      try {
        await withTimeout(store.removeItem(key), 10_000, `AsyncStorage.removeItem(${key})`);
      } catch (e) {
        if (e instanceof TimeoutError) {
          markDegraded(`AsyncStorage.removeItem(${key}) timed out after 10s.`);
        }
        // ignore
      }
    }
    memory.delete(key);
    return;
  }
  // WEB BRANCH ONLY (labelled) — see kvGet.
  if (isWebApp()) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
  memory.delete(key);
}

/**
 * Remove every Stelix-namespaced local value (imported tokens, address
 * book, watchlist, settings, read-notification state, logo cache,
 * unlock lockout). Used by the Settings wipe and the Unlock screen's
 * factory reset, so "remove the wallet from this device" really removes
 * the wallet's local data too — on web the old wipe left imported
 * tokens and the address book behind in localStorage.
 *
 * The wallet secret itself lives in SecureStore and is wiped by
 * wallet.ts wipeWallet(); this only clears the non-secret kv layer.
 * Best-effort: a failure to enumerate one backend never throws.
 */
export async function wipeLocalData(): Promise<void> {
  const prefix = 'stelix';
  if (isNativeApp()) {
    const store = await getAsyncStorage();
    if (store && typeof store.getAllKeys === 'function' && typeof store.multiRemove === 'function') {
      try {
        const keys = await withTimeout(store.getAllKeys(), 10_000, 'AsyncStorage.getAllKeys()');
        const ours = keys.filter((k) => k.startsWith(prefix));
        if (ours.length > 0) {
          await withTimeout(store.multiRemove(ours), 10_000, 'AsyncStorage.multiRemove()');
        }
      } catch (e) {
        if (e instanceof TimeoutError) markDegraded('AsyncStorage wipe timed out after 10s.');
        // fall through to the memory sweep below
      }
    }
  } else if (isWebApp()) {
    // WEB BRANCH ONLY (labelled) — see kvGet.
    try {
      const ours: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(prefix)) ours.push(k);
      }
      for (const k of ours) localStorage.removeItem(k);
    } catch {
      // fall through to the memory sweep below
    }
  }
  for (const k of [...memory.keys()]) {
    if (k.startsWith(prefix)) memory.delete(k);
  }
}
