/**
 * Unit tests for the Circle UCW client (src/lib/circle.ts).
 * Pure config gating, support decisions, challenge payload shapes and
 * the admin-Worker API client. The native SDK is NEVER loaded here —
 * loadCircleSdk is a stub that always returns null (Expo Go fix
 * 2026-11-27), and probeCircleSupport only with injected detectors,
 * so Expo Go gating is tested without touching a native module.
 * Run: npm test
 */
import {
  CIRCLE_ARC_MAINNET,
  CIRCLE_BACKEND_NOT_READY_MESSAGE,
  buildContractExecutionChallengeRequest,
  buildCreateWalletChallengeRequest,
  buildSetPinChallengeRequest,
  buildTransferChallengeRequest,
  circleApi,
  CircleApiError,
  clearCircleSdkCache,
  decideCircleSupport,
  getCircleAppId,
  isCircleConfigured,
  listCircleWallets,
  loadCircleSdk,
  parseCircleChallenge,
  parseCircleUserSession,
  parseCircleWallets,
  probeCircleSupport,
} from '../circle';

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  clearCircleSdkCache();
  delete (process.env as Record<string, string | undefined>).EXPO_PUBLIC_CIRCLE_APP_ID;
});

describe('config gating', () => {
  it('defaults to the user-supplied Circle App ID when no env var is set', () => {
    expect(getCircleAppId()).toBe('d15deb9f-8d3c-5c06-be01-de05897d30ea');
    expect(isCircleConfigured()).toBe(true);
    expect(isCircleConfigured('')).toBe(false);
  });

  it('isCircleConfigured is true when an App ID is provided', () => {
    process.env.EXPO_PUBLIC_CIRCLE_APP_ID = 'test-app-id';
    expect(isCircleConfigured()).toBe(true);
    expect(isCircleConfigured('  other-id  ')).toBe(true);
  });

  it('never invents an App ID — the only default is the user-supplied one', () => {
    // No other default / fallback App ID exists anywhere in the module.
    expect(getCircleAppId()).toBe('d15deb9f-8d3c-5c06-be01-de05897d30ea');
  });
});

describe('decideCircleSupport', () => {
  it('web is ruled out first, even when configured with an SDK', () => {
    const d = decideCircleSupport({ isWeb: true, isExpoGo: false, configured: true, sdkAvailable: true });
    expect(d.status).toBe('web');
    expect(d.message).toMatch(/not available on web/i);
  });

  it('Expo Go is ruled out before the SDK is ever attempted', () => {
    const d = decideCircleSupport({ isWeb: false, isExpoGo: true, configured: true, sdkAvailable: true });
    expect(d.status).toBe('expo-go');
    expect(d.message).toMatch(/EAS build/i);
    expect(d.message).toMatch(/not available in Expo Go/i);
  });

  it('unconfigured beats sdk-missing: no App ID means "set up Circle"', () => {
    const d = decideCircleSupport({ isWeb: false, isExpoGo: false, configured: false, sdkAvailable: false });
    expect(d.status).toBe('not-configured');
    expect(d.message).toMatch(/Set up Circle in admin/i);
  });

  it('configured but no SDK means sdk-missing', () => {
    const d = decideCircleSupport({ isWeb: false, isExpoGo: false, configured: true, sdkAvailable: false });
    expect(d.status).toBe('sdk-missing');
  });

  it('ready only when native, configured and the SDK loaded', () => {
    const d = decideCircleSupport({ isWeb: false, isExpoGo: false, configured: true, sdkAvailable: true });
    expect(d.status).toBe('ready');
  });
});

describe('probeCircleSupport (injected detectors — Expo Go gating never crashes)', () => {
  it('Expo Go short-circuits: the SDK loader is never called', async () => {
    const loader = jest.fn(async () => {
      throw new Error('SDK loader must not run on Expo Go');
    });
    const res = await probeCircleSupport({
      isWeb: () => false,
      isExpoGo: async () => true,
      getAppId: async () => 'some-app-id',
      loadSdk: loader,
    });
    expect(res.status).toBe('expo-go');
    expect(loader).not.toHaveBeenCalled();
  });

  it('web short-circuits: the SDK loader is never called', async () => {
    const loader = jest.fn(async () => null);
    const res = await probeCircleSupport({
      isWeb: () => true,
      isExpoGo: async () => false,
      getAppId: async () => 'some-app-id',
      loadSdk: loader,
    });
    expect(res.status).toBe('web');
    expect(loader).not.toHaveBeenCalled();
  });

  it('no App ID short-circuits before the SDK load', async () => {
    const loader = jest.fn(async () => null);
    const res = await probeCircleSupport({
      isWeb: () => false,
      isExpoGo: async () => false,
      getAppId: async () => '',
      loadSdk: loader,
    });
    expect(res.status).toBe('not-configured');
    expect(loader).not.toHaveBeenCalled();
  });

  it('ready when native + configured + SDK loads and init succeeds', async () => {
    const init = jest.fn(async () => undefined);
    const res = await probeCircleSupport({
      isWeb: () => false,
      isExpoGo: async () => false,
      getAppId: async () => 'app-id-123',
      loadSdk: async () => ({ init, execute: jest.fn(), setBiometricsPin: jest.fn() }),
    });
    expect(res.status).toBe('ready');
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'app-id-123' }),
    );
  });

  it('sdk-missing when the SDK loader returns null', async () => {
    const res = await probeCircleSupport({
      isWeb: () => false,
      isExpoGo: async () => false,
      getAppId: async () => 'app-id-123',
      loadSdk: async () => null,
    });
    expect(res.status).toBe('sdk-missing');
  });
});

describe('loadCircleSdk (stubbed for Expo Go, 2026-11-27)', () => {
  it('always returns null and never calls the loader', async () => {
    // The real dynamic import crashed Expo Go on launch: Metro
    // preloads the SDK and its top-level requireNativeModule throws
    // before any try/catch. The loader is accepted for signature
    // compatibility and ignored — even a fake SDK is never returned.
    const loader = jest.fn(async () => ({
      WalletSdk: { init: jest.fn(), execute: jest.fn() },
    }));
    const sdk = await loadCircleSdk(loader);
    expect(sdk).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it('returns null when called with no loader', async () => {
    const sdk = await loadCircleSdk();
    expect(sdk).toBeNull();
  });
});

describe('challenge payload shapes', () => {
  it('SET_PIN challenge request', () => {
    expect(buildSetPinChallengeRequest('user-1')).toEqual({ type: 'SET_PIN', userId: 'user-1' });
  });

  it('CREATE_WALLET is EOA on ARC (Arc Mainnet)', () => {
    expect(buildCreateWalletChallengeRequest('user-1')).toEqual({
      type: 'CREATE_WALLET',
      userId: 'user-1',
      blockchain: CIRCLE_ARC_MAINNET,
      accountType: 'EOA',
    });
  });

  it('TRANSFER request carries wallet, destination, amount and USDC', () => {
    const req = buildTransferChallengeRequest({
      userId: 'user-1',
      walletId: 'wallet-1',
      to: '0x1111111111111111111111111111111111111111',
      amount: 12.5,
    });
    expect(req).toEqual({
      type: 'TRANSFER',
      userId: 'user-1',
      walletId: 'wallet-1',
      blockchain: CIRCLE_ARC_MAINNET,
      tokenSymbol: 'USDC',
      destinationAddress: '0x1111111111111111111111111111111111111111',
      amount: '12.5',
    });
  });

  it('TRANSFER rejects a bad recipient and a non-positive amount', () => {
    expect(() =>
      buildTransferChallengeRequest({ userId: 'u', walletId: 'w', to: 'not-an-address', amount: 1 }),
    ).toThrow(/valid recipient address/i);
    expect(() =>
      buildTransferChallengeRequest({ userId: 'u', walletId: 'w', to: '0x1111111111111111111111111111111111111111', amount: 0 }),
    ).toThrow(/greater than 0/i);
  });

  it('CONTRACT_EXECUTION request carries contract, signature, params and calldata', () => {
    const req = buildContractExecutionChallengeRequest({
      userId: 'user-1',
      walletId: 'wallet-1',
      contractAddress: '0x2222222222222222222222222222222222222222',
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: ['0x3333333333333333333333333333333333333333', '1000000'],
      callData: '0x095ea7b3',
    });
    expect(req).toMatchObject({
      type: 'CONTRACT_EXECUTION',
      contractAddress: '0x2222222222222222222222222222222222222222',
      abiFunctionSignature: 'approve(address,uint256)',
      callData: '0x095ea7b3',
    });
    expect(req.abiParameters).toEqual(['0x3333333333333333333333333333333333333333', '1000000']);
  });

  it('CONTRACT_EXECUTION rejects a bad contract address and non-hex calldata', () => {
    const base = {
      userId: 'u',
      walletId: 'w',
      contractAddress: '0x2222222222222222222222222222222222222222',
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [] as unknown[],
      callData: '0x095ea7b3',
    };
    expect(() => buildContractExecutionChallengeRequest({ ...base, contractAddress: 'bad' })).toThrow(/valid contract address/i);
    expect(() => buildContractExecutionChallengeRequest({ ...base, callData: 'not-hex' })).toThrow(/0x hex/i);
  });
});

describe('response parsing', () => {
  it('parseCircleUserSession accepts a full session, rejects partial ones', () => {
    expect(
      parseCircleUserSession({ userId: 'u1', userToken: 'tok', encryptionKey: 'key' }),
    ).toEqual({ userId: 'u1', userToken: 'tok', encryptionKey: 'key' });
    expect(parseCircleUserSession({ userId: 'u1', userToken: 'tok' })).toBeNull();
    expect(parseCircleUserSession(null)).toBeNull();
  });

  it('parseCircleChallenge requires a challengeId', () => {
    expect(parseCircleChallenge({ challengeId: 'c1', type: 'TRANSFER' })).toEqual({
      challengeId: 'c1',
      type: 'TRANSFER',
    });
    expect(parseCircleChallenge({})).toBeNull();
    expect(parseCircleChallenge({ challengeId: 'c1', type: 'UNKNOWN_TYPE' })?.type).toBe('CREATE_WALLET');
  });

  it('parseCircleWallets returns only well-formed wallets, never fakes one', () => {
    expect(parseCircleWallets([])).toEqual([]);
    expect(parseCircleWallets({ wallets: [] })).toEqual([]);
    expect(
      parseCircleWallets([
        { id: 'w1', address: '0xabc', blockchain: 'ARC', state: 'LIVE', accountType: 'EOA' },
        { id: 'w2' },
        'junk',
      ]),
    ).toEqual([
      { id: 'w1', address: '0xabc', blockchain: 'ARC', state: 'LIVE', accountType: 'EOA' },
    ]);
  });
});

describe('circleApi (admin Worker client)', () => {
  it('a 404 means the backend is not set up yet — honest, not a wallet error', async () => {
    global.fetch = jest.fn(async () => new Response('Not Found', { status: 404 }));
    await expect(circleApi('/api/circle/users', { method: 'POST' })).rejects.toThrow(
      CIRCLE_BACKEND_NOT_READY_MESSAGE,
    );
  });

  it('a 501 is the same honest "not set up yet"', async () => {
    global.fetch = jest.fn(async () => new Response('', { status: 501 }));
    const err = await circleApi('/api/circle/config').catch((e) => e);
    expect(err).toBeInstanceOf(CircleApiError);
    expect((err as CircleApiError).message).toBe(CIRCLE_BACKEND_NOT_READY_MESSAGE);
  });

  it('an offline fetch becomes a CircleApiError, never a raw TypeError', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(circleApi('/api/circle/wallets')).rejects.toBeInstanceOf(CircleApiError);
  });

  it('a non-200 with an error body surfaces the backend message', async () => {
    global.fetch = jest.fn(
      async () => new Response(JSON.stringify({ error: 'Circle App ID missing on server' }), { status: 500 }),
    );
    await expect(circleApi('/api/circle/users', { method: 'POST' })).rejects.toThrow(
      'Circle App ID missing on server',
    );
  });

  it('a 200 returns the parsed body', async () => {
    global.fetch = jest.fn(
      async () => new Response(JSON.stringify({ configured: true }), { status: 200 }),
    );
    await expect(circleApi('/api/circle/config')).resolves.toEqual({ configured: true });
  });

  it('listCircleWallets returns [] when the backend has no wallets (never a fake)', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    await expect(listCircleWallets('user-1')).resolves.toEqual([]);
  });
});
