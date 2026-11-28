/**
 * Circle wallet state — provider for the Circle (Arc) wallet.
 *
 * What this holds:
 * - status: the probe result from lib/circle.ts ('ready' is the only
 *   state in which Circle can be used; every other state carries an
 *   honest message — Expo Go, web, not-configured, sdk-missing).
 * - user session: Circle userId + userToken + encryptionKey. The
 *   token + key are SESSION secrets: in-memory state ONLY, never
 *   persisted to kv / SecureStore / logs. The backend issues a fresh
 *   userToken per session (POST /api/circle/users).
 * - wallets: the user's Circle wallets (EOA, Arc testnet first).
 *   Only the wallet id + address are persisted (non-secret, so the
 *   screen can show the last-known address); balances are always
 *   read live from the Arc RPC, never stored.
 *
 * What this NEVER does: talk to api.circle.com, hold the API key,
 * invent a wallet/balance, or auto-sell. Every Circle transaction is
 * a backend-created challenge executed in the Circle PIN UI via the
 * lazily-loaded native SDK — the user approves each one.
 *
 * The provider mounts under AppProvider in src/app/_layout.tsx. It
 * does NOT statically import the Circle SDK (see lib/circle.ts) so
 * Expo Go still launches with Circle disabled.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ethers } from 'ethers';
import { getChain } from '../lib/chains';
import { recordBroadcastTx } from '../lib/localHistory';
import {
  CIRCLE_ARC_TESTNET,
  buildContractExecutionChallengeRequest,
  buildCreateWalletChallengeRequest,
  buildSetPinChallengeRequest,
  buildTransferChallengeRequest,
  createCircleChallenge,
  createCircleUser,
  getCircleConfig,
  listCircleWallets,
  loadCircleSdk,
  probeCircleSupport,
  type CircleChallenge,
  type CircleSdk,
  type CircleStatus,
  type CircleUserSession,
  type CircleWallet,
} from '../lib/circle';
import { buildCircleCreateLockChallenge } from '../lib/circleVault';
import type { CreateLockOnChainParams } from '../lib/vault';
import { kvGet, kvSet } from '../lib/storage';

/** Persisted Circle wallet identifiers only (id + address + chain).
 *  No tokens, no keys, no secrets — those live in memory per session. */
const CIRCLE_WALLETS_KEY = 'stelix.circle.wallets.v1';
const CIRCLE_USER_ID_KEY = 'stelix.circle.userId.v1';

export interface CircleState {
  status: CircleStatus;
  /** Honest human-readable status message (see CIRCLE_STATUS_MESSAGES). */
  statusMessage: string;
  /** True only when status === 'ready'. */
  ready: boolean;
  /** True while the first probe is still running. */
  checking: boolean;
  /** Backend's own view of Circle setup (null = backend not reached). */
  backendConfigured: boolean | null;
  userId: string | null;
  /** True once the Circle PIN has been set in this session. */
  pinSet: boolean;
  wallets: CircleWallet[];
  /** The Arc Circle wallet in use (first ARC-TESTNET EOA wallet). */
  activeWallet: CircleWallet | null;
  busy: boolean;
  error: string | null;
  refreshStatus: () => Promise<void>;
  /** Create / restore the Circle user session (backend userToken). */
  ensureUser: () => Promise<CircleUserSession>;
  /** Set the Circle PIN (first run) via a SET_PIN challenge. */
  setupPin: () => Promise<void>;
  /** Create an EOA Circle wallet on Arc testnet via a challenge. */
  createWallet: () => Promise<CircleWallet | null>;
  refreshWallets: () => Promise<void>;
  /** Send USDC on Arc from the Circle wallet (transfer challenge). */
  sendUsdc: (to: string, amount: number) => Promise<string>;
  /** Create a StelixVault lock via Circle (approve + createLock). */
  createVaultLock: (params: CreateLockOnChainParams) => Promise<string>;
  clearError: () => void;
}

const Ctx = createContext<CircleState | null>(null);

async function loadPersistedWallets(): Promise<CircleWallet[]> {
  try {
    const raw = await kvGet(CIRCLE_WALLETS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (w): w is CircleWallet =>
        typeof w === 'object' &&
        w !== null &&
        typeof (w as { id?: unknown }).id === 'string' &&
        typeof (w as { address?: unknown }).address === 'string',
    );
  } catch {
    return [];
  }
}

async function persistWallets(wallets: CircleWallet[]): Promise<void> {
  try {
    await kvSet(CIRCLE_WALLETS_KEY, JSON.stringify(wallets));
  } catch {
    // Best-effort: the in-memory list still works this session.
  }
}

/** Wrap the callback-style sdk.execute in a promise. Resolves with
 *  the txHash when the challenge completes. */
function executeChallengeWithSdk(
  sdk: CircleSdk,
  session: CircleUserSession,
  challenge: CircleChallenge,
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      sdk.execute(
        session.userToken,
        session.encryptionKey,
        [challenge.challengeId],
        (result) => {
          const data = result.result.data;
          if (result.result.status === 'COMPLETE') {
            resolve(data?.txHash ?? data?.signedTransaction ?? '');
          } else {
            reject(new Error(`Circle challenge did not complete (status: ${result.result.status}). No transaction was sent.`));
          }
        },
        (err) => {
          reject(new Error(err.message || 'Circle challenge failed. No transaction was sent.'));
        },
      );
    } catch (e) {
      reject(e instanceof Error ? e : new Error('Circle SDK execute failed.'));
    }
  });
}

export function CircleWalletProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<CircleStatus>('checking');
  const [statusMessage, setStatusMessage] = useState('Checking Circle support…');
  const [checking, setChecking] = useState(true);
  const [backendConfigured, setBackendConfigured] = useState<boolean | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [pinSet, setPinSet] = useState(false);
  const [wallets, setWallets] = useState<CircleWallet[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Session secrets — memory only, never persisted.
  const sessionRef = useRef<CircleUserSession | null>(null);

  const activeWallet = useMemo(
    () =>
      wallets.find((w) => w.blockchain === CIRCLE_ARC_TESTNET && w.accountType === 'EOA') ??
      wallets.find((w) => w.blockchain === CIRCLE_ARC_TESTNET) ??
      wallets[0] ??
      null,
    [wallets],
  );

  const refreshStatus = useCallback(async () => {
    setChecking(true);
    try {
      const probe = await probeCircleSupport();
      setStatus(probe.status);
      setStatusMessage(probe.message);
      // The backend's own config is a second opinion: if the backend
      // says Circle is not set up, say so even when the app has an
      // App ID (the endpoints are what actually create wallets).
      const cfg = await getCircleConfig();
      setBackendConfigured(cfg ? cfg.configured : null);
      if (cfg && !cfg.configured && probe.status === 'ready') {
        setStatus('not-configured');
        setStatusMessage('Circle is not configured yet.');
      }
    } finally {
      setChecking(false);
    }
  }, []);

  // Probe once on mount, and restore the last-known wallet addresses
  // (identifiers only — balances and session are always re-read live).
  useEffect(() => {
    void (async () => {
      await refreshStatus();
      setWallets(await loadPersistedWallets());
      try {
        setUserId(await kvGet(CIRCLE_USER_ID_KEY));
      } catch {
        // No stored user id — a fresh session starts anonymous.
      }
    })();
  }, [refreshStatus]);

  const requireReady = useCallback((): void => {
    if (status !== 'ready') {
      throw new Error(statusMessage);
    }
  }, [status, statusMessage]);

  const ensureUser = useCallback(async (): Promise<CircleUserSession> => {
    requireReady();
    if (sessionRef.current) return sessionRef.current;
    const session = await createCircleUser();
    sessionRef.current = session;
    setUserId(session.userId);
    try {
      await kvSet(CIRCLE_USER_ID_KEY, session.userId);
    } catch {
      // Best-effort.
    }
    return session;
  }, [requireReady]);

  const executeChallenge = useCallback(
    async (challenge: CircleChallenge): Promise<string> => {
      const session = await ensureUser();
      const sdk = await loadCircleSdk();
      if (!sdk) {
        throw new Error(
          'Circle native module is missing from this build — Circle needs the EAS release build.',
        );
      }
      return executeChallengeWithSdk(sdk, session, challenge);
    },
    [ensureUser],
  );

  const setupPin = useCallback(async (): Promise<void> => {
    requireReady();
    setBusy(true);
    setError(null);
    try {
      const session = await ensureUser();
      const challenge = await createCircleChallenge(buildSetPinChallengeRequest(session.userId));
      await executeChallenge(challenge);
      setPinSet(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'PIN setup failed.';
      setError(msg);
      throw new Error(msg);
    } finally {
      setBusy(false);
    }
  }, [ensureUser, executeChallenge, requireReady]);

  const refreshWallets = useCallback(async (): Promise<void> => {
    if (status !== 'ready') return;
    try {
      const session = sessionRef.current ?? (await ensureUser());
      const list = await listCircleWallets(session.userId);
      setWallets(list);
      await persistWallets(list);
    } catch (e) {
      // A failed refresh keeps the last-known list — never blank it
      // on a network error.
      setError(e instanceof Error ? e.message : 'Could not refresh Circle wallets.');
    }
  }, [ensureUser, status]);

  const createWallet = useCallback(async (): Promise<CircleWallet | null> => {
    requireReady();
    setBusy(true);
    setError(null);
    try {
      const session = await ensureUser();
      const challenge = await createCircleChallenge(
        buildCreateWalletChallengeRequest(session.userId, CIRCLE_ARC_TESTNET),
      );
      await executeChallenge(challenge);
      const list = await listCircleWallets(session.userId);
      setWallets(list);
      await persistWallets(list);
      const created =
        list.find((w) => w.blockchain === CIRCLE_ARC_TESTNET && w.accountType === 'EOA') ??
        list[0] ??
        null;
      if (!created) {
        throw new Error('Circle wallet challenge completed, but no wallet was returned. Please try again later.');
      }
      return created;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Circle wallet creation failed.';
      setError(msg);
      throw new Error(msg);
    } finally {
      setBusy(false);
    }
  }, [ensureUser, executeChallenge, requireReady]);

  const sendUsdc = useCallback(
    async (to: string, amount: number): Promise<string> => {
      requireReady();
      if (!activeWallet) throw new Error('No Circle wallet yet — create one first.');
      setBusy(true);
      setError(null);
      try {
        const session = await ensureUser();
        const challenge = await createCircleChallenge(
          buildTransferChallengeRequest({
            userId: session.userId,
            walletId: activeWallet.id,
            to,
            amount,
            tokenSymbol: 'USDC',
            blockchain: CIRCLE_ARC_TESTNET,
          }),
        );
        const txHash = await executeChallenge(challenge);
        if (!txHash) throw new Error('Circle transfer completed but returned no transaction hash.');
        // The USDC transfer was broadcast on Arc testnet — record it.
        // Never throws into the send flow.
        await recordBroadcastTx({
          hash: txHash,
          chain: 'arc',
          wallet: activeWallet.address,
          type: 'send',
          tokenSymbol: 'USDC',
          tokenAddress: getChain('arc').stablecoins?.USDC ?? null,
          amount: amount.toString(),
          amountRaw: ethers.parseUnits(amount.toString(), 6).toString(),
          from: activeWallet.address,
          to,
          timestamp: Date.now(),
        });
        return txHash;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Circle send failed.';
        setError(msg);
        throw new Error(msg);
      } finally {
        setBusy(false);
      }
    },
    [activeWallet, ensureUser, executeChallenge, requireReady],
  );

  const createVaultLock = useCallback(
    async (params: CreateLockOnChainParams): Promise<string> => {
      requireReady();
      if (!activeWallet) throw new Error('No Circle wallet yet — create one first.');
      // Refuses honestly when no vault is deployed (today: always) or
      // the chain is not Arc — before any challenge is created.
      const built = buildCircleCreateLockChallenge(params);
      if (!built.ok) throw new Error(built.reason);
      setBusy(true);
      setError(null);
      try {
        const session = await ensureUser();
        let lastTxHash = '';
        for (const step of built.steps) {
          const challenge = await createCircleChallenge(
            buildContractExecutionChallengeRequest({
              userId: session.userId,
              walletId: activeWallet.id,
              contractAddress: step.contractAddress,
              abiFunctionSignature: step.abiFunctionSignature,
              abiParameters: step.abiParameters,
              callData: step.callData,
              blockchain: CIRCLE_ARC_TESTNET,
            }),
          );
          const stepHash = await executeChallenge(challenge);
          // Each Circle step is its own broadcast tx: record the
          // approve and the createLock separately, as each completes.
          // A step that returns no hash is not recorded (and the
          // final check below still fails the lock, as before).
          if (stepHash) {
            const amountRaw =
              step.kind === 'approve' ? String(step.abiParameters[1]) : ethers.parseUnits(params.amount.toString(), params.tokenDecimals).toString();
            await recordBroadcastTx({
              hash: stepHash,
              chain: params.chainId,
              wallet: activeWallet.address,
              type: step.kind === 'approve' ? 'approve' : 'lock',
              tokenSymbol: params.tokenSymbol ?? '',
              tokenAddress: params.tokenAddress,
              amount: params.amount.toString(),
              amountRaw,
              from: activeWallet.address,
              to: built.vaultAddress,
              timestamp: Date.now(),
            });
          }
          lastTxHash = stepHash;
        }
        if (!lastTxHash) throw new Error('Circle lock completed but returned no transaction hash.');
        return lastTxHash;
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Circle lock failed.';
        setError(msg);
        throw new Error(msg);
      } finally {
        setBusy(false);
      }
    },
    [activeWallet, ensureUser, executeChallenge, requireReady],
  );

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<CircleState>(
    () => ({
      status,
      statusMessage,
      ready: status === 'ready',
      checking,
      backendConfigured,
      userId,
      pinSet,
      wallets,
      activeWallet,
      busy,
      error,
      refreshStatus,
      ensureUser,
      setupPin,
      createWallet,
      refreshWallets,
      sendUsdc,
      createVaultLock,
      clearError,
    }),
    [
      status, statusMessage, checking, backendConfigured, userId, pinSet,
      wallets, activeWallet, busy, error, refreshStatus, ensureUser,
      setupPin, createWallet, refreshWallets, sendUsdc, createVaultLock, clearError,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCircleWallet(): CircleState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCircleWallet must be used inside CircleWalletProvider');
  return ctx;
}

/** Non-throwing variant for screens that may render without the
 *  provider (e.g. the vault create screen in tests). */
export function useCircleWalletOptional(): CircleState | null {
  return useContext(Ctx);
}
