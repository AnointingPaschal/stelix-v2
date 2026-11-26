/**
 * Non-secret local key/value storage for the live-data layer.
 *
 * - Web: localStorage (values stored here are NOT secrets — the wallet
 *   secret itself is PBKDF2/AES-GCM encrypted in wallet.ts before it ever
 *   reaches storage; see that file for the SecureStore path on native).
 * - Native: the same localStorage-style API is unavailable, so this falls
 *   back to an in-memory map for the current session only. Callers that
 *   need durable native storage must use SecureStore (wallet.ts) or
 *   AsyncStorage — do NOT persist imported-token lists etc. here on native
 *   and expect them to survive a restart.
 * - Node/Jest: in-memory map.
 *
 * Nothing in this file stores a mnemonic, private key or password.
 */

const memory = new Map<string, string>();

function hasLocalStorage(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

export async function kvGet(key: string): Promise<string | null> {
  if (hasLocalStorage()) {
    try {
      return localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  }
  return memory.get(key) ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  if (hasLocalStorage()) {
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
  if (hasLocalStorage()) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
  memory.delete(key);
}
