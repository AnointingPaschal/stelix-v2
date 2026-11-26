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

const memory = new Map<string, string>();

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
    const mod = await import('@react-native-async-storage/async-storage');
    const store = (mod as unknown as { default?: AsyncStorageLike }).default;
    asyncStorage =
      store && typeof store.getItem === 'function' && typeof store.setItem === 'function'
        ? store
        : null;
  } catch {
    asyncStorage = null;
  }
  return asyncStorage;
}

export async function kvGet(key: string): Promise<string | null> {
  if (isNativeApp()) {
    const store = await getAsyncStorage();
    if (store) {
      try {
        return await store.getItem(key);
      } catch {
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
        await store.setItem(key, value);
        return;
      } catch {
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
        await store.removeItem(key);
      } catch {
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
        const keys = await store.getAllKeys();
        const ours = keys.filter((k) => k.startsWith(prefix));
        if (ours.length > 0) await store.multiRemove(ours);
      } catch {
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
