/**
 * Regression test for the 2026-11-26 web bug: on web, the dynamic
 * `import('expo-secure-store')` succeeds but the web build of the native
 * module is an empty object, so saving through SecureStore threw a
 * TypeError on every create/import — and Alert.alert is a no-op on web,
 * so the button looked silently dead.
 *
 * This simulates the web runtime (document + localStorage present) and
 * proves createWallet stores the encrypted wallet in localStorage and
 * unlocks it again, without ever touching SecureStore.
 */

// PBKDF2-HMAC-SHA-256 at 600,000 iterations (async, so it yields) takes
// seconds per encrypt/decrypt on a throttled VM, and create + unlock is
// 2 KDFs — Jest's 5s default is not a product limit (same rationale as
// crypto.test.ts). The iteration count must not be lowered.
jest.setTimeout(120_000);

describe('createWallet on web (SecureStore skipped)', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    jest.resetModules();
    store.clear();
    (globalThis as unknown as Record<string, unknown>).document = {};
    (globalThis as unknown as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).document;
    delete (globalThis as unknown as Record<string, unknown>).localStorage;
  });

  it('creates a wallet, persists it to localStorage, and unlocks it', async () => {
    const { createWallet, getWalletMeta, unlockWallet } = await import('../wallet');
    const { mnemonic, address } = await createWallet('test-password-123', 'Web Wallet');
    expect(mnemonic.split(' ').length).toBe(12);
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Persisted via the localStorage fallback, encrypted (not the phrase).
    expect(store.size).toBeGreaterThan(0);
    for (const value of store.values()) {
      expect(value).not.toContain(mnemonic);
    }
    const meta = await getWalletMeta();
    expect(meta?.address).toBe(address);
    expect(meta?.name).toBe('Web Wallet');
    const unlocked = await unlockWallet('test-password-123');
    expect(unlocked?.address).toBe(address);
    await expect(unlockWallet('wrong-password-1')).rejects.toThrow(/Wrong password/);
  });
});
