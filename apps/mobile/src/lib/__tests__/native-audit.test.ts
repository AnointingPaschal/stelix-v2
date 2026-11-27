/**
 * Native-platform audit regressions (2026-11-26).
 *
 * The mobile app is a NATIVE app (Expo SDK 58, Hermes). Web-only APIs
 * must never sit on a native code path:
 *  - storage: AsyncStorage on native (durable), never localStorage —
 *    the old kv store fell back to an in-memory map on native, so the
 *    address book, imported tokens, watchlist, notification state and
 *    the wallet itself (when SecureStore failed) were lost on restart.
 *  - crypto: pure-JS base64 — the old code used Buffer (Node-only)
 *    with a btoa/atob fallback (browser-only); neither exists in
 *    Hermes, so encrypt/decrypt threw on a real phone.
 *  - feedback: no Alert.alert anywhere in app/components — on
 *    react-native-web it is an empty no-op, so the user saw nothing.
 *  - no crypto.subtle / window.crypto / navigator.clipboard /
 *    document / window / direct localStorage (outside storage.ts's
 *    explicitly web-gated branch) in production src.
 *
 * Mocks: @react-native-async-storage/async-storage is mocked with a
 * map kept on globalThis so it survives jest.resetModules (which is
 * how "restart the app" is simulated here); expo-secure-store is
 * mocked to throw on import (native module absent in Jest), forcing
 * the kv fallback path exactly as on a device without SecureStore.
 */

import * as fs from 'fs';
import * as path from 'path';

// PBKDF2-HMAC-SHA-256 at 600,000 iterations (async, so it yields) takes
// seconds per encrypt/decrypt on a throttled VM, and several tests here
// do 2 KDFs each — Jest's 5s default is not a product limit (same
// rationale as crypto.test.ts). The iteration count must not be lowered.
jest.setTimeout(120_000);

type GlobalWithMock = typeof globalThis & {
  __stelixMockAsyncMap?: Map<string, string>;
  navigator?: { product?: string };
  localStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
  };
};

jest.mock('@react-native-async-storage/async-storage', () => {
  const g = globalThis as GlobalWithMock;
  if (!g.__stelixMockAsyncMap) g.__stelixMockAsyncMap = new Map<string, string>();
  const map = g.__stelixMockAsyncMap;
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => map.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        map.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        map.delete(key);
      }),
    },
  };
});

// The SecureStore native module does not exist in Jest — importing it
// throws, which is exactly the "SecureStore unavailable" path.
jest.mock('expo-secure-store', () => {
  throw new Error('expo-secure-store native module unavailable in Jest');
});

function mockAsyncMap(): Map<string, string> {
  const g = globalThis as GlobalWithMock;
  if (!g.__stelixMockAsyncMap) g.__stelixMockAsyncMap = new Map<string, string>();
  return g.__stelixMockAsyncMap;
}

/** Fresh copy of a lib module, as after an app restart. */
function fresh<T>(rel: string): T {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(rel) as T;
}

function setNative(): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { product: 'ReactNative' },
    configurable: true,
  });
}

function clearNavigator(): void {
  delete (globalThis as unknown as Record<string, unknown>).navigator;
}

/** A localStorage that FAILS the test if anything touches it. */
function setThrowingLocalStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: () => {
        throw new Error('localStorage touched on native');
      },
      setItem: () => {
        throw new Error('localStorage touched on native');
      },
      removeItem: () => {
        throw new Error('localStorage touched on native');
      },
    },
    configurable: true,
  });
}

function setWebLocalStorage(backing: Map<string, string>): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => {
        backing.set(key, value);
      },
      removeItem: (key: string) => {
        backing.delete(key);
      },
    },
    configurable: true,
  });
}

function clearLocalStorage(): void {
  delete (globalThis as unknown as Record<string, unknown>).localStorage;
}

describe('native kv storage — AsyncStorage, never localStorage', () => {
  beforeEach(() => {
    mockAsyncMap().clear();
    clearNavigator();
    clearLocalStorage();
  });

  afterEach(() => {
    clearNavigator();
    clearLocalStorage();
  });

  it('persists via AsyncStorage on native and never touches localStorage', async () => {
    setNative();
    setThrowingLocalStorage(); // any localStorage touch throws
    const storage = fresh<typeof import('../storage')>('../storage');
    expect(storage.isNativeApp()).toBe(true);
    await storage.kvSet('stelix_test_key', 'hello');
    expect(mockAsyncMap().get('stelix_test_key')).toBe('hello');
    expect(await storage.kvGet('stelix_test_key')).toBe('hello');
    await storage.kvDelete('stelix_test_key');
    expect(mockAsyncMap().has('stelix_test_key')).toBe(false);
    expect(await storage.kvGet('stelix_test_key')).toBeNull();
  });

  it('survives a fresh module load on native (durable, not in-memory)', async () => {
    setNative();
    const first = fresh<typeof import('../storage')>('../storage');
    await first.kvSet('stelix_restart_key', 'survives');
    // Simulate an app restart: brand-new module instances, empty memory.
    const second = fresh<typeof import('../storage')>('../storage');
    expect(await second.kvGet('stelix_restart_key')).toBe('survives');
  });

  it('web branch still uses localStorage when not native', async () => {
    clearNavigator();
    const webStore = new Map<string, string>();
    setWebLocalStorage(webStore);
    const storage = fresh<typeof import('../storage')>('../storage');
    expect(storage.isNativeApp()).toBe(false);
    await storage.kvSet('stelix_web_key', 'web-value');
    expect(webStore.get('stelix_web_key')).toBe('web-value');
    expect(mockAsyncMap().has('stelix_web_key')).toBe(false);
    expect(await storage.kvGet('stelix_web_key')).toBe('web-value');
  });
});

describe('wallet falls back to durable AsyncStorage on native', () => {
  beforeEach(() => {
    mockAsyncMap().clear();
    clearNavigator();
    clearLocalStorage();
  });

  afterEach(() => {
    clearNavigator();
    clearLocalStorage();
  });

  it('create + unlock survive a restart when SecureStore is absent', async () => {
    setNative();
    const wallet = fresh<typeof import('../wallet')>('../wallet');
    const { address } = await wallet.createWallet('StelixPass123');
    // The encrypted payload reached AsyncStorage, not memory/localStorage.
    expect(mockAsyncMap().get('stelix_encrypted_wallet_v2')).toMatch(/^.{20,}$/);
    expect(mockAsyncMap().has('stelix_wallet_meta_v2')).toBe(true);
    expect(await wallet.hasWallet()).toBe(true);

    // Restart: fresh modules, empty memory — wallet must still be there.
    const wallet2 = fresh<typeof import('../wallet')>('../wallet');
    expect(await wallet2.hasWallet()).toBe(true);
    const unlocked = await wallet2.unlockWallet('StelixPass123');
    expect(unlocked?.address).toBe(address);
  });
});

describe('crypto base64 without platform APIs', () => {
  it('encrypt/decrypt round-trips with Buffer, btoa and atob removed', async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const savedBuffer = g.Buffer;
    const savedBtoa = g.btoa;
    const savedAtob = g.atob;
    try {
      delete g.Buffer;
      delete g.btoa;
      delete g.atob;
      expect((globalThis as unknown as Record<string, unknown>).Buffer).toBeUndefined();
      expect((globalThis as unknown as Record<string, unknown>).btoa).toBeUndefined();
      const { encryptSecret, decryptSecret } = fresh<typeof import('../crypto')>('../crypto');
      const payload = await encryptSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', 'StelixPass123');
      expect(await decryptSecret(payload, 'StelixPass123')).toBe(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
      );
      await expect(decryptSecret(payload, 'wrong-password')).rejects.toThrow('Wrong password');
    } finally {
      g.Buffer = savedBuffer;
      g.btoa = savedBtoa;
      g.atob = savedAtob;
    }
    // The payload is standard base64 (decodable by Node's Buffer, which
    // the implementation itself never uses) — v1 format unchanged.
    const { encryptSecret } = await import('../crypto');
    const payload = await encryptSecret('round-trip-check', 'StelixPass123');
    const outer = JSON.parse(
      (globalThis as unknown as { Buffer: { from(s: string, e: string): { toString(e: string): string } } }).Buffer.from(
        payload,
        'base64',
      ).toString('utf8'),
    ) as { v: number; salt: string; iv: string; data: string };
    expect(outer.v).toBe(1);
    expect(typeof outer.salt).toBe('string');
    expect(typeof outer.iv).toBe('string');
    expect(typeof outer.data).toBe('string');
  });
});

describe('no web-only APIs in production src', () => {
  function stripComments(code: string): string {
    const noBlock = code.replace(/\/\*[\s\S]*?\*\//g, '');
    return noBlock
      .split('\n')
      .map((line) => line.replace(/(^|[\s;{>(])\/\/.*$/, '$1'))
      .join('\n');
  }

  function srcFiles(): string[] {
    const root = path.resolve(__dirname, '..', '..');
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) out.push(full);
      }
    };
    walk(root);
    return out;
  }

  it('no crypto.subtle / window.crypto / navigator.clipboard / document / window / btoa / atob / Buffer / Alert.alert', () => {
    const forbidden: [RegExp, string][] = [
      [/crypto\.subtle/, 'crypto.subtle'],
      [/window\.crypto/, 'window.crypto'],
      [/navigator\.clipboard/, 'navigator.clipboard'],
      [/document\./, 'document.*'],
      [/(^|[^\w$.])window\./, 'window.*'],
      [/\bbtoa\s*\(/, 'btoa()'],
      [/\batob\s*\(/, 'atob()'],
      [/\bBuffer\./, 'Buffer.*'],
      [/Alert\.alert\s*\(/, 'Alert.alert()'],
      [/from\s+['"]react-native-web['"]/, 'react-native-web import'],
      [/from\s+['"]react-dom['"]/, 'react-dom import'],
    ];
    const offenders: string[] = [];
    for (const file of srcFiles()) {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      for (const [re, label] of forbidden) {
        if (re.test(code)) offenders.push(`${path.relative(process.cwd(), file)}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('localStorage appears only in storage.ts (the labelled web branch)', () => {
    const offenders: string[] = [];
    for (const file of srcFiles()) {
      if (path.basename(file) === 'storage.ts') continue;
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      if (code.includes('localStorage')) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
