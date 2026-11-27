/**
 * Circle User-Controlled Wallets (UCW) — Arc, hybrid with self-custody.
 *
 * Circle UCW is non-custodial MPC: the user holds a key share and every
 * transaction is approved by the user in the Circle PIN / challenge UI.
 * This module is the mobile-side client for it. It NEVER talks to
 * api.circle.com directly and NEVER holds the Circle API key — the API
 * key is server-only. Every Circle call goes through the admin Worker
 * (same base as adminSync.ts, https://stelix-admin.pages.dev by
 * default) at:
 *   POST /api/circle/users        — create / get-or-create a Circle user
 *   POST /api/circle/challenges   — create a challenge (PIN, wallet, tx)
 *   GET  /api/circle/wallets      — list the user's Circle wallets
 *   GET  /api/circle/transactions/:id — poll one transaction
 *   GET  /api/circle/config       — does the backend have Circle set up?
 * Those endpoints are being built in parallel by another agent: until
 * they exist, every call below fails honestly (see CircleApiError) and
 * the UI shows "Set up Circle in admin" — it never fakes a wallet.
 *
 * Expo Go gating (read this before touching the imports):
 * The Circle RN SDK (@circle-fin/w3s-pw-react-native-sdk) is a native
 * module — `requireNativeModule('ProgrammablewalletRnSdk')` runs at
 * import time — and Expo Go does not ship it. A STATIC import anywhere
 * in the app graph would crash Expo Go on launch. So:
 *   - This file has NO static import of the SDK (only a TYPE import,
 *     which is erased at compile time) and NO static import of
 *     expo-constants.
 *   - The SDK is loaded ONLY by loadCircleSdk(), a dynamic import with
 *     a 10s bound, called only after probeCircleSupport() has already
 *     ruled out web and Expo Go. On Expo Go / web it is never loaded
 *     at all, so the app launches exactly as before with Circle
 *     disabled and an honest message.
 *   - Circle works ONLY in an EAS release APK / development build
 *     (which includes the native module), NOT in Expo Go Termux
 *     testing. The UI must say that everywhere Circle appears.
 *
 * Wallet model: EOA first (cheaper, broad, gas is USDC on Arc). SCA /
 * Gas Station is NOT built — labelled "not yet built" in the UI and
 * docs. Gas Station supports Arc Mainnet + Testnet when it lands.
 *
 * App ID: the user's Circle App ID, d15deb9f-8d3c-5c06-be01-de05897d30ea
 * (supplied 2026-11-27), is the default in DEFAULT_CIRCLE_APP_ID and
 * in app.json extra.circleAppId. An App ID is a public identifier,
 * not a secret. EXPO_PUBLIC_CIRCLE_APP_ID still overrides it when set.
 * The Circle API key is separate, server-only, and never in this repo.
 * Until the backend endpoints are live, the Circle option is disabled
 * with an honest message.
 *
 * Circle UCW alone CANNOT auto-sell: every transaction needs user
 * approval in the Circle UI. Auto-sell happens only in StelixVault,
 * executed by the keeper (see lib/circleVault.ts). Never claim Circle
 * alone auto-sells.
 */
import { getAdminApiBase } from './adminChains';
import { isNativeApp } from './storage';
import { TimeoutError, withTimeout } from './timeout';
import type { IWalletSdk } from '@circle-fin/w3s-pw-react-native-sdk';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** The user's Circle App ID, supplied 2026-11-27.
 *  An App ID is a PUBLIC identifier, not a secret — it is safe to ship
 *  in the app bundle (the Circle API key is the secret, and it lives
 *  server-only in the admin Worker, never here). Do NOT invent any
 *  other App ID: this is the only one. An env var still wins when set,
 *  so a different Circle app can be pointed at without a code change. */
export const DEFAULT_CIRCLE_APP_ID = 'd15deb9f-8d3c-5c06-be01-de05897d30ea';

/** Where to put the Circle App ID (app.json extra.circleAppId). Kept
 *  in sync with DEFAULT_CIRCLE_APP_ID above. */
export const CIRCLE_APP_ID_PLACEHOLDER = DEFAULT_CIRCLE_APP_ID;

/** Sync read: EXPO_PUBLIC_CIRCLE_APP_ID baked into the bundle at build
 *  time (the same process.env pattern as the rest of this codebase),
 *  falling back to the App ID above. */
export function getCircleAppId(): string {
  const v =
    typeof process !== 'undefined'
      ? (process.env as Record<string, string | undefined>).EXPO_PUBLIC_CIRCLE_APP_ID
      : undefined;
  return (v ?? '').trim() || DEFAULT_CIRCLE_APP_ID;
}

/** Async read: app.json extra.circleAppId via expo-constants (dynamic
 *  import — expo-constants is a native module and must never be
 *  statically imported into a Jest / web-safe module). Falls back to
 *  the env var. Returns '' when neither is set. Never throws. */
let extraAppIdCache: string | null | undefined;
export async function getCircleAppIdAsync(): Promise<string> {
  const fromEnv = getCircleAppId();
  if (fromEnv) return fromEnv;
  if (extraAppIdCache !== undefined) return extraAppIdCache ?? '';
  try {
    const mod = await withTimeout(
      import('expo-constants'),
      10_000,
      'expo-constants dynamic import',
    );
    const extra = (mod as unknown as { default?: { expoConfig?: { extra?: Record<string, unknown> } } })
      .default?.expoConfig?.extra;
    const v = extra && typeof extra.circleAppId === 'string' ? extra.circleAppId.trim() : '';
    extraAppIdCache = v;
    return v;
  } catch {
    extraAppIdCache = '';
    return '';
  }
}

/** Test escape hatch for the expo-constants cache. */
export function clearCircleAppIdCache(): void {
  extraAppIdCache = undefined;
}

/** True when a Circle App ID is configured (env var or app.json extra).
 *  `appId` is an injectable override for tests; production passes none. */
export function isCircleConfigured(appId?: string): boolean {
  return (appId ?? getCircleAppId()).trim() !== '';
}

/** The Circle SDK talks to Circle's API through the SDK's own endpoint.
 *  The mobile app never calls it directly — only WalletSdk.init does,
 *  after the native module loads. */
export const CIRCLE_SDK_ENDPOINT = 'https://api.circle.com';

// ---------------------------------------------------------------------------
// Runtime support detection — pure decision + async probe
// ---------------------------------------------------------------------------

/** Circle availability states. 'ready' is the ONLY state in which a
 *  Circle wallet can be created or used. */
export type CircleStatus =
  | 'checking'
  | 'web'
  | 'expo-go'
  | 'not-configured'
  | 'sdk-missing'
  | 'ready';

export const CIRCLE_STATUS_MESSAGES: Record<CircleStatus, string> = {
  checking: 'Checking Circle support…',
  web: 'Circle wallets are not available on web — use the Stelix app (EAS build) on your phone.',
  'expo-go':
    'Circle wallet needs the EAS build — not available in Expo Go. Install the release APK to use it.',
  'not-configured':
    'Set up Circle in admin — no Circle App ID is configured yet and the Circle backend is not live.',
  'sdk-missing':
    'Circle is configured but the Circle native module is missing from this build — use the EAS release build.',
  ready: 'Circle is ready.',
};

/**
 * Pure support decision, unit-tested. Order matters: web and Expo Go
 * are ruled out before anything else, so the native SDK is never even
 * attempted there.
 */
export function decideCircleSupport(args: {
  isWeb: boolean;
  isExpoGo: boolean;
  configured: boolean;
  sdkAvailable: boolean;
}): { status: CircleStatus; message: string } {
  if (args.isWeb) return { status: 'web', message: CIRCLE_STATUS_MESSAGES.web };
  if (args.isExpoGo) return { status: 'expo-go', message: CIRCLE_STATUS_MESSAGES['expo-go'] };
  if (!args.configured) return { status: 'not-configured', message: CIRCLE_STATUS_MESSAGES['not-configured'] };
  if (!args.sdkAvailable) return { status: 'sdk-missing', message: CIRCLE_STATUS_MESSAGES['sdk-missing'] };
  return { status: 'ready', message: CIRCLE_STATUS_MESSAGES.ready };
}

/**
 * True on the web build. Native detection is `navigator.product ===
 * 'ReactNative'` (see lib/storage.ts) — no react-native import, so
 * this stays loadable in Jest/Node and on web.
 */
export function isWebRuntime(): boolean {
  return !isNativeApp();
}

/**
 * True inside Expo Go. The check is `Constants.executionEnvironment
 * === 'storeClient'` (Expo Go), read via a dynamic import of
 * expo-constants with a 10s bound. Cached per launch. Never throws:
 * any failure means "unknown" (false) — the SDK load below is the
 * second line of defence and also fails safely on Expo Go.
 */
let expoGoCache: boolean | null = null;
export async function detectExpoGo(): Promise<boolean> {
  if (expoGoCache !== null) return expoGoCache;
  try {
    const mod = await withTimeout(
      import('expo-constants'),
      10_000,
      'expo-constants dynamic import',
    );
    const c = (mod as unknown as { default?: Record<string, unknown> }).default ?? {};
    const env = c.executionEnvironment;
    const ownership = c.appOwnership;
    const isGo = env === 'storeClient' || ownership === 'expo';
    expoGoCache = isGo;
    return isGo;
  } catch {
    expoGoCache = false;
    return false;
  }
}

/** Test escape hatch for the Expo Go cache. */
export function clearExpoGoCache(): void {
  expoGoCache = null;
}

// ---------------------------------------------------------------------------
// Lazy native SDK loader — the ONLY place the SDK is imported (value)
// ---------------------------------------------------------------------------

/** The loaded Circle SDK, or null when the native module is absent
 *  (Expo Go / web / a build without the module). Never throws. */
export type CircleSdk = Pick<IWalletSdk, 'init' | 'execute' | 'setBiometricsPin'>;

let sdkPromise: Promise<CircleSdk | null> | null = null;

/**
 * Dynamically import the Circle SDK and verify its native module
 * actually loaded. A missing native module makes the import reject
 * (requireNativeModule throws) — that rejection is caught here and
 * reported as null, never a crash. 10s bound: a Metro chunk fetch that
 * never settles is treated exactly like a missing module.
 *
 * `loader` is an injectable override for tests — production passes
 * none and the real dynamic import runs.
 */
export function loadCircleSdk(
  loader?: () => Promise<unknown>,
): Promise<CircleSdk | null> {
  if (sdkPromise) return sdkPromise;
  const run = (async (): Promise<CircleSdk | null> => {
    try {
      const mod = await withTimeout(
        loader ? loader() : import('@circle-fin/w3s-pw-react-native-sdk'),
        10_000,
        'Circle SDK dynamic import',
      );
      const sdk = (mod as { WalletSdk?: unknown }).WalletSdk as
        | CircleSdk
        | undefined;
      if (
        !sdk ||
        typeof sdk.init !== 'function' ||
        typeof sdk.execute !== 'function'
      ) {
        return null;
      }
      return sdk;
    } catch (e) {
      if (e instanceof TimeoutError) {
        console.warn('[stelix] Circle SDK unavailable: dynamic import timed out after 10s — Circle stays disabled.');
      }
      return null;
    }
  })();
  sdkPromise = run;
  return run;
}

/** Test escape hatch for the SDK loader cache. */
export function clearCircleSdkCache(): void {
  sdkPromise = null;
}

/** Initialise the loaded SDK with the App ID. Call once, after
 *  loadCircleSdk() returns non-null. Throws when the App ID is empty
 *  or init rejects — the caller surfaces it honestly. */
export async function initCircleSdk(sdk: CircleSdk, appId: string): Promise<void> {
  const id = appId.trim();
  if (!id) throw new Error('No Circle App ID configured — set EXPO_PUBLIC_CIRCLE_APP_ID or app.json extra.circleAppId.');
  await sdk.init({ endpoint: CIRCLE_SDK_ENDPOINT, appId: id });
}

/**
 * Full async probe used by the Circle provider on mount. Never throws:
 * any failure lands on a non-'ready' status with an honest message.
 * Injectable detectors keep it unit-testable without loading the SDK.
 */
export async function probeCircleSupport(deps?: {
  isWeb?: () => boolean;
  isExpoGo?: () => Promise<boolean>;
  getAppId?: () => Promise<string>;
  loadSdk?: () => Promise<CircleSdk | null>;
}): Promise<{ status: CircleStatus; message: string; appId: string }> {
  const isWeb = deps?.isWeb ? deps.isWeb() : isWebRuntime();
  const isExpoGo = deps?.isExpoGo ? await deps.isExpoGo() : await detectExpoGo();
  const appId = deps?.getAppId ? await deps.getAppId() : await getCircleAppIdAsync();
  const configured = isCircleConfigured(appId);
  // Short-circuit BEFORE the SDK load: on web / Expo Go / unconfigured
  // the native module is never even attempted.
  const early = decideCircleSupport({ isWeb, isExpoGo, configured, sdkAvailable: false });
  if (early.status !== 'sdk-missing') return { ...early, appId };
  const sdk = deps?.loadSdk ? await deps.loadSdk() : await loadCircleSdk();
  const decided = decideCircleSupport({ isWeb, isExpoGo, configured, sdkAvailable: sdk !== null });
  if (decided.status === 'ready' && sdk) {
    try {
      await initCircleSdk(sdk, appId);
    } catch (e) {
      return {
        status: 'sdk-missing',
        message: e instanceof Error ? e.message : 'Circle SDK failed to initialise.',
        appId,
      };
    }
  }
  return { ...decided, appId };
}

// ---------------------------------------------------------------------------
// Admin Worker API client — the ONLY Circle backend the app talks to
// ---------------------------------------------------------------------------

export class CircleApiError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'CircleApiError';
    this.status = status;
  }
}

const CIRCLE_API_TIMEOUT_MS = 15_000;

/** Backend not built / not reachable yet — the honest message every
 *  Circle call surfaces until the Worker endpoints are live. */
export const CIRCLE_BACKEND_NOT_READY_MESSAGE =
  'Circle backend is not set up yet — the admin Worker endpoints (/api/circle/*) are not live. No Circle wallet was created.';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * One call to the admin Worker. Never throws a raw fetch error: any
 * failure becomes a CircleApiError with a message safe to show the
 * user. A 404 / 501 means the endpoint does not exist yet (backend
 * still being built) — that is reported as "not set up yet", never as
 * a wallet error.
 */
export async function circleApi<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getAdminApiBase()}${path}`;
  let res: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CIRCLE_API_TIMEOUT_MS);
    try {
      res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    throw new CircleApiError(
      'Could not reach the Stelix admin server. Check your connection and try again.',
    );
  }
  if (res.status === 404 || res.status === 501) {
    throw new CircleApiError(CIRCLE_BACKEND_NOT_READY_MESSAGE, res.status);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON error body — fall through to the status check below.
  }
  if (!res.ok) {
    const msg =
      isRecord(body) && typeof body.error === 'string' && body.error.trim() !== ''
        ? body.error
        : isRecord(body) && typeof body.message === 'string' && body.message.trim() !== ''
          ? body.message
          : `Circle request failed (HTTP ${res.status}).`;
    throw new CircleApiError(msg, res.status);
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// Types — Circle user, wallets, challenges, transactions
// ---------------------------------------------------------------------------

/** Circle user session. userToken + encryptionKey are SESSION secrets:
 *  keep them in memory only (the provider holds them in state), never
 *  persist them to kv / SecureStore / logs. The backend issues a fresh
 *  userToken per session. */
export interface CircleUserSession {
  userId: string;
  userToken: string;
  encryptionKey: string;
}

export interface CircleWallet {
  id: string;
  address: string;
  /** Circle blockchain id, e.g. 'ARC-TESTNET' (Arc testnet first). */
  blockchain: string;
  state: string;
  /** 'EOA' first — SCA is not built yet (see CIRCLE.md). */
  accountType: string;
}

export type CircleChallengeType =
  | 'SET_PIN'
  | 'CREATE_WALLET'
  | 'TRANSFER'
  | 'CONTRACT_EXECUTION';

export interface CircleChallenge {
  challengeId: string;
  /** The challenge type the backend created. */
  type: CircleChallengeType;
}

export interface CircleConfigResponse {
  configured: boolean;
  /** True when the backend has a Circle App ID + API key. */
  appIdConfigured?: boolean;
  /** Blockchains the backend allows Circle wallets on, e.g. ['ARC-TESTNET']. */
  blockchains?: string[];
}

/** Parse a POST /api/circle/users body. Returns null on wrong shape. */
export function parseCircleUserSession(body: unknown): CircleUserSession | null {
  if (!isRecord(body)) return null;
  const userId = typeof body.userId === 'string' ? body.userId : typeof body.id === 'string' ? body.id : null;
  const userToken = typeof body.userToken === 'string' ? body.userToken : null;
  const encryptionKey = typeof body.encryptionKey === 'string' ? body.encryptionKey : null;
  if (!userId || !userToken || !encryptionKey) return null;
  return { userId, userToken, encryptionKey };
}

/** Parse a POST /api/circle/challenges body. Returns null on wrong shape. */
export function parseCircleChallenge(body: unknown): CircleChallenge | null {
  if (!isRecord(body)) return null;
  const challengeId =
    typeof body.challengeId === 'string' ? body.challengeId : typeof body.id === 'string' ? body.id : null;
  if (!challengeId) return null;
  const type = typeof body.type === 'string' ? body.type : 'CREATE_WALLET';
  const known: CircleChallengeType[] = ['SET_PIN', 'CREATE_WALLET', 'TRANSFER', 'CONTRACT_EXECUTION'];
  return {
    challengeId,
    type: (known as string[]).includes(type) ? (type as CircleChallengeType) : 'CREATE_WALLET',
  };
}

/** Parse a GET /api/circle/wallets body (array, or { wallets: [...] }). */
export function parseCircleWallets(body: unknown): CircleWallet[] {
  const list = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.wallets) ? body.wallets : [];
  const out: CircleWallet[] = [];
  for (const item of list as unknown[]) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === 'string' ? item.id : typeof item.walletId === 'string' ? item.walletId : null;
    const address = typeof item.address === 'string' ? item.address : null;
    if (!id || !address) continue;
    out.push({
      id,
      address,
      blockchain: typeof item.blockchain === 'string' ? item.blockchain : 'ARC-TESTNET',
      state: typeof item.state === 'string' ? item.state : 'LIVE',
      accountType: typeof item.accountType === 'string' ? item.accountType : 'EOA',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Backend calls — create user / challenge / wallets / transaction / config
// ---------------------------------------------------------------------------

/** POST /api/circle/users — create (or get-or-create) the Circle user
 *  for this device. The backend returns a fresh userToken +
 *  encryptionKey for this session. Throws CircleApiError when the
 *  backend is not live yet. */
export async function createCircleUser(): Promise<CircleUserSession> {
  const body = await circleApi<unknown>('/api/circle/users', { method: 'POST', body: JSON.stringify({}) });
  const session = parseCircleUserSession(body);
  if (!session) throw new CircleApiError('Circle backend returned an unexpected user response. No Circle wallet was created.');
  return session;
}

/** POST /api/circle/challenges — ask the backend to create a Circle
 *  challenge of the given type. The backend calls Circle's server API
 *  with the API key (never the app). Returns the challengeId the SDK
 *  must execute. */
export async function createCircleChallenge(
  input: Record<string, unknown>,
): Promise<CircleChallenge> {
  const body = await circleApi<unknown>('/api/circle/challenges', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const challenge = parseCircleChallenge(body);
  if (!challenge) throw new CircleApiError('Circle backend returned an unexpected challenge response.');
  return challenge;
}

/** GET /api/circle/wallets — the user's Circle wallets (empty list
 *  when none exist yet — never a fake wallet). */
export async function listCircleWallets(userId?: string): Promise<CircleWallet[]> {
  const qs = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  const body = await circleApi<unknown>(`/api/circle/wallets${qs}`);
  return parseCircleWallets(body);
}

/** GET /api/circle/transactions/:id — poll one Circle transaction
 *  (status + txHash when mined). Returns the raw parsed body. */
export async function getCircleTransaction(id: string): Promise<Record<string, unknown> | null> {
  const body = await circleApi<unknown>(`/api/circle/transactions/${encodeURIComponent(id)}`);
  return isRecord(body) ? body : null;
}

/** GET /api/circle/config — does the backend have Circle set up?
 *  Returns null on ANY failure (backend down / endpoint not built):
 *  the caller treats that as "not configured", never as ready. */
export async function getCircleConfig(): Promise<CircleConfigResponse | null> {
  try {
    const body = await circleApi<unknown>('/api/circle/config');
    if (!isRecord(body)) return null;
    return {
      configured: body.configured === true,
      appIdConfigured: typeof body.appIdConfigured === 'boolean' ? body.appIdConfigured : undefined,
      blockchains: Array.isArray(body.blockchains)
        ? (body.blockchains as unknown[]).filter((b): b is string => typeof b === 'string')
        : undefined,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Challenge request builders — the intent the Worker turns into a
// Circle server-API challenge. Pure functions, unit-tested.
// ---------------------------------------------------------------------------

/** Arc testnet first — the only Circle blockchain Stelix offers until
 *  the admin enables Arc mainnet. EOA only (SCA not built). */
export const CIRCLE_ARC_TESTNET = 'ARC-TESTNET';
export const CIRCLE_ARC_MAINNET = 'ARC';
export const CIRCLE_SUPPORTED_BLOCKCHAINS = [CIRCLE_ARC_TESTNET] as const;

/** POST /api/circle/challenges body for a SET_PIN challenge (first
 *  run: the user sets the Circle PIN in the SDK UI). */
export function buildSetPinChallengeRequest(userId: string): Record<string, unknown> {
  return { type: 'SET_PIN', userId };
}

/** POST /api/circle/challenges body for a CREATE_WALLET challenge.
 *  EOA on Arc testnet first. */
export function buildCreateWalletChallengeRequest(
  userId: string,
  blockchain: string = CIRCLE_ARC_TESTNET,
): Record<string, unknown> {
  return { type: 'CREATE_WALLET', userId, blockchain, accountType: 'EOA' };
}

/**
 * POST /api/circle/challenges body for a USDC transfer on Arc.
 * `amount` is in USDC token units (Arc USDC = 6 decimals; the backend
 * converts to base units). The backend creates the Circle TRANSFER
 * challenge; the user approves it in the Circle PIN UI, and the SDK
 * execute() returns the txHash.
 */
export function buildTransferChallengeRequest(args: {
  userId: string;
  walletId: string;
  to: string;
  amount: number;
  tokenSymbol?: string;
  blockchain?: string;
}): Record<string, unknown> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(args.to.trim())) {
    throw new Error('That does not look like a valid recipient address.');
  }
  if (!(args.amount > 0)) throw new Error('Enter an amount greater than 0.');
  return {
    type: 'TRANSFER',
    userId: args.userId,
    walletId: args.walletId,
    blockchain: args.blockchain ?? CIRCLE_ARC_TESTNET,
    tokenSymbol: args.tokenSymbol ?? 'USDC',
    destinationAddress: args.to.trim(),
    amount: String(args.amount),
  };
}

/**
 * POST /api/circle/challenges body for a contract execution (e.g. a
 * StelixVault call). `abiFunctionSignature` + `abiParameters` are what
 * Circle's contract-execution challenge expects; `callData` is the
 * pre-encoded calldata (built by lib/circleVault.ts with ethers) so
 * the backend can verify / pass it through. The user approves the call
 * in the Circle PIN UI — Circle UCW cannot execute without that
 * approval, so this can never auto-sell on its own.
 */
export function buildContractExecutionChallengeRequest(args: {
  userId: string;
  walletId: string;
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: unknown[];
  callData: string;
  blockchain?: string;
}): Record<string, unknown> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(args.contractAddress.trim())) {
    throw new Error('That does not look like a valid contract address.');
  }
  if (!args.abiFunctionSignature.trim()) throw new Error('A contract function signature is required.');
  if (!/^0x[0-9a-fA-F]*$/.test(args.callData.trim())) {
    throw new Error('Contract calldata must be a 0x hex string.');
  }
  return {
    type: 'CONTRACT_EXECUTION',
    userId: args.userId,
    walletId: args.walletId,
    blockchain: args.blockchain ?? CIRCLE_ARC_TESTNET,
    contractAddress: args.contractAddress.trim(),
    abiFunctionSignature: args.abiFunctionSignature.trim(),
    abiParameters: args.abiParameters,
    callData: args.callData.trim(),
  };
}
