/**
 * LIVE app state — wallet, balances, locks, history, settings.
 * Backed by SecureStore-encrypted wallet + on-chain reads + live price
 * APIs. No placeholder data: a new wallet starts with an empty token list,
 * $0.00, no locks and no history until real on-chain data exists.
 * Locks are read from StelixVault via getUserLocksOnChain when deployed;
 * otherwise the list is empty with vaultNote set to the not-deployed
 * message (see lib/chains.ts / lib/vault.ts).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as RNAppState } from 'react-native';
import { ACTIVE_CHAINS, CHAINS, DEFAULT_CHAIN, VAULT_NOT_DEPLOYED_MESSAGE, type ChainConfig } from '../lib/chains';
import { fetchAdminChains, mergeAdminChains } from '../lib/adminChains';
import { fetchBalances, loadImportedTokens, type TokenBalance } from '../lib/balances';
import { fetchHistory, filterHistory, type TxRecord } from '../lib/history';
import { getUserLocksOnChain, lockedByToken, mapChainLockToBullLock, type BullLock } from '../lib/vault';
import { getWalletMeta, hasWallet } from '../lib/wallet';
import { kvGet, kvSet } from '../lib/storage';
import { parseStoredSettings, SETTINGS_KEY, type AppSettings } from '../lib/settings';

/** Re-exported for screens that type against the store's settings. */
export type { AppSettings };

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  at: number;
  read: boolean;
  kind: 'target' | 'maturity' | 'autosell' | 'security' | 'info';
}

export interface DisciplineStats {
  score: number;
  streakDays: number;
  lockedRatio: number;
  totalAutoSoldUsd: number;
  locksCompleted: number;
  locksBroken: number;
  monthLockedUsd: number;
  monthAutoSoldUsd: number;
}

export const EMPTY_DISCIPLINE: DisciplineStats = {
  score: 0,
  streakDays: 0,
  lockedRatio: 0,
  totalAutoSoldUsd: 0,
  locksCompleted: 0,
  locksBroken: 0,
  monthLockedUsd: 0,
  monthAutoSoldUsd: 0,
};

/** Discipline stats derived from REAL locks only (all zero when no locks). */
export function disciplineFromLocks(locks: BullLock[], lockedUsd: number, totalUsd: number): DisciplineStats {
  const completed = locks.filter((l) => l.status === 'completed' || l.status === 'matured').length;
  const broken = locks.filter((l) => l.status === 'broken').length;
  const lockedRatio = totalUsd > 0 ? lockedUsd / totalUsd : 0;
  const total = completed + broken;
  const completion = total === 0 ? 0 : completed / total;
  // Streak / monthly totals have no on-chain source yet — 0 until a
  // keeper/admin feed provides them; never invented.
  const score = Math.round(Math.min(100, Math.max(0, lockedRatio * 40 + completion * 30)));
  return {
    score,
    streakDays: 0,
    lockedRatio,
    totalAutoSoldUsd: 0,
    locksCompleted: completed,
    locksBroken: broken,
    monthLockedUsd: 0,
    monthAutoSoldUsd: 0,
  };
}

interface AppState {
  onboarded: boolean;
  unlocked: boolean;
  address: string;
  /** Solana address derived from the same mnemonic ('' when none — e.g.
   *  wallets imported from a raw private key). Used for Solana balances
   *  and history; the EVM address is meaningless on Solana. */
  solanaAddress: string;
  /** Address for the active chain (Solana address on Solana, EVM address
   *  everywhere else) — what Receive shows and what balances/history
   *  are fetched for. */
  chainAddress: string;
  chain: ChainConfig;
  /** All chains the picker may show: built-in registry merged with the
   *  admin registry (admin-added chains appear here after a refresh, no
   *  rebuild; built-ins are the fallback when the admin API is down). */
  availableChains: ChainConfig[];
  refreshChains: () => Promise<void>;
  tokens: TokenBalance[];
  locks: BullLock[];
  history: TxRecord[];
  /** Unfiltered history (spam included) — the History screen needs the
   *  real spam count for its Show-spam toggle; `history` above is the
   *  filtered view the rest of the app reads. */
  allHistory: TxRecord[];
  notifications: AppNotification[];
  settings: AppSettings;
  discipline: DisciplineStats;
  /** Live-data loading / error state (never hidden behind sample data). */
  loading: boolean;
  /** True once the stored-wallet check has finished (or timed out). Until
   *  then the root layout shows the splash — never a blank white page. */
  hydrated: boolean;
  error: string | null;
  balancesError: string | null;
  historyError: string | null;
  /** Vault deployment note for the active chain, or null when deployed. */
  vaultNote: string | null;
  /** Dust/spam transfers hidden by default; toggle reveals them. */
  showDust: boolean;
  setOnboarded: (v: boolean) => void;
  setUnlocked: (v: boolean) => void;
  setAddress: (a: string) => void;
  setChain: (c: ChainConfig) => void;
  addLock: (l: BullLock) => void;
  updateLock: (l: BullLock) => void;
  addTx: (t: TxRecord) => void;
  markNotificationsRead: () => void;
  updateSettings: (p: Partial<AppSettings>) => void;
  setShowDust: (v: boolean) => void;
  refreshBalances: () => Promise<void>;
  refreshLocks: () => Promise<void>;
  refreshAll: () => Promise<void>;
  /** Resets live state to empty (used by the settings wipe flow). */
  resetState: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [onboarded, setOnboarded] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [address, setAddress] = useState('');
  const [solanaAddress, setSolanaAddress] = useState('');
  const [chain, setChainState] = useState<ChainConfig>(DEFAULT_CHAIN);
  const [availableChains, setAvailableChains] = useState<ChainConfig[]>(ACTIVE_CHAINS);

  /** Pull the admin chain registry once and merge it over the built-in
   *  registry. On ANY failure fetchAdminChains returns null and the
   *  merge returns the built-ins unchanged — the app never breaks
   *  because the admin is down. A chain added in admin appears in the
   *  picker after this runs; its vault/router still need verified
   *  contract addresses before locks/swaps go live on it. */
  const refreshChains = useCallback(async () => {
    try {
      const remote = await fetchAdminChains();
      setAvailableChains(mergeAdminChains(CHAINS, remote));
    } catch {
      setAvailableChains(ACTIVE_CHAINS);
    }
  }, []);

  useEffect(() => {
    void refreshChains();
  }, [refreshChains]);
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [locks, setLocks] = useState<BullLock[]>([]);
  const [allHistory, setAllHistory] = useState<TxRecord[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balancesError, setBalancesError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [vaultNote, setVaultNote] = useState<string | null>(VAULT_NOT_DEPLOYED_MESSAGE);
  const [showDust, setShowDust] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    biometrics: true,
    autoLockMinutes: 1,
    hideSpam: true,
    maturityReminders: true,
  });

  const history = useMemo(
    () => filterHistory(allHistory, { showDust: showDust || !settings.hideSpam }),
    [allHistory, showDust, settings.hideSpam],
  );

  const discipline = useMemo(() => {
    const totalUsd = tokens.reduce((s, t) => s + (t.priceUsd !== null ? t.balance * t.priceUsd : 0), 0);
    const lockedUsd = tokens.reduce((s, t) => s + (t.priceUsd !== null ? t.locked * t.priceUsd : 0), 0);
    return disciplineFromLocks(locks, lockedUsd, totalUsd);
  }, [locks, tokens]);

  /** Address for the active chain: the derived Solana address on Solana,
   *  the EVM address everywhere else. */
  const chainAddress = chain.kind === 'solana' ? solanaAddress : address;

  const refreshBalances = useCallback(async () => {
    if (!chainAddress) return;
    setLoading(true);
    try {
      const imported = await loadImportedTokens();
      const res = await fetchBalances(chain.id, chainAddress, imported);
      // Balances come back with locked: 0 (the RPC layer does not know
      // about locks) — keep the locked figures refreshLocks filled in,
      // or a balance refresh would silently zero the Locked split.
      setTokens((prev) => {
        const locked = new Map(prev.map((t) => [`${t.chainId}:${t.symbol}`, t.locked]));
        return res.tokens.map((t) => ({
          ...t,
          locked: locked.get(`${t.chainId}:${t.symbol}`) ?? 0,
        }));
      });
      setBalancesError(res.error);
      if (res.error) setError(res.error);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBalancesError(msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [chainAddress, chain.id]);

  const refreshLocks = useCallback(async () => {
    if (!address) return;
    try {
      const res = await getUserLocksOnChain(chain.id, address);
      setVaultNote(res.deployed ? null : res.note);
      if (!res.deployed) {
        setLocks([]);
        // No vault on this chain means nothing is locked: clear any
        // stale `locked` figures instead of showing phantom locks.
        setTokens((prev) => (prev.some((t) => t.locked > 0) ? prev.map((t) => ({ ...t, locked: 0 })) : prev));
        return;
      }
      const mapped = res.locks.map((l) => {
        const token = tokens.find((t) => t.address.toLowerCase() === l.token.toLowerCase());
        return mapChainLockToBullLock(l, token?.decimals ?? 18, token?.symbol ?? '');
      });
      setLocks(mapped);
      // Fill each token's `locked` from the on-chain locks, so Home's
      // Spendable / Locked split, the Discipline locked ratio, Send's
      // spendable check and the TokenRow lock icon all use real figures
      // instead of the always-0 placeholder this used to be.
      const locked = lockedByToken(mapped);
      setTokens((prev) =>
        prev.map((t) => ({ ...t, locked: locked[`${t.chainId}:${t.symbol}`] ?? 0 })),
      );
    } catch (e) {
      setVaultNote(e instanceof Error ? e.message : String(e));
      setLocks([]);
    }
  }, [address, chain.id, tokens]);

  const refreshHistory = useCallback(async () => {
    if (!chainAddress) return;
    try {
      const res = await fetchHistory(chain.id, chainAddress);
      setAllHistory(res.txs);
      setHistoryError(res.error);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    }
  }, [chainAddress, chain.id]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshBalances(), refreshLocks(), refreshHistory()]);
  }, [refreshBalances, refreshLocks, refreshHistory]);

  // On launch: if a wallet is stored, surface its address (locked until
  // the user unlocks with the session password). The SecureStore read is
  // async — until it resolves the root layout shows the splash, so the
  // user never sees a blank white page on first load / reload.
  // Settings are loaded here too (kv: AsyncStorage on native,
  // localStorage on web) — the old code kept them in memory only, so
  // every restart reset the biometrics / auto-lock / spam toggles.
  useEffect(() => {
    let cancelled = false;
    // Safety net: never hold the splash longer than 5s even if storage hangs.
    const fallback = setTimeout(() => {
      if (!cancelled) setHydrated(true);
    }, 5000);
    void (async () => {
      try {
        const stored = await kvGet(SETTINGS_KEY);
        if (!cancelled && stored) setSettings(parseStoredSettings(stored));
        if (await hasWallet()) {
          const meta = await getWalletMeta();
          if (!cancelled && meta) {
            setAddress(meta.address);
            setSolanaAddress(meta.solanaAddress ?? '');
            setOnboarded(true);
          }
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, []);

  // Auto-lock: when the app goes to the background, note the time; on
  // return, lock the wallet if it was away longer than the Auto-Lock
  // Timer (0 = lock immediately on background). The old setting only
  // changed a label — nothing ever enforced it.
  const unlockedRef = useRef(unlocked);
  const settingsRef = useRef(settings);
  // Synced in effects, not during render: the AppState listener below
  // reads the latest values without re-subscribing on every render.
  useEffect(() => {
    unlockedRef.current = unlocked;
  }, [unlocked]);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    let backgroundedAt: number | null = null;
    const sub = RNAppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundedAt = Date.now();
        if (settingsRef.current.autoLockMinutes === 0 && unlockedRef.current) {
          setUnlocked(false);
        }
      } else if (state === 'active') {
        if (backgroundedAt !== null && unlockedRef.current) {
          const mins = settingsRef.current.autoLockMinutes;
          if (mins > 0 && Date.now() - backgroundedAt >= mins * 60_000) {
            setUnlocked(false);
          }
        }
        backgroundedAt = null;
      }
    });
    return () => sub.remove();
  }, []);

  // Live refresh when the wallet unlocks or the chain changes.
  useEffect(() => {
    if (unlocked && address) void refreshAll();
    else {
      setTokens([]);
      setLocks([]);
      setAllHistory([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, address, chain.id]);

  const setChain = useCallback((c: ChainConfig) => setChainState(c), []);
  const addLock = useCallback((l: BullLock) => setLocks((prev) => [l, ...prev]), []);
  const updateLock = useCallback(
    (l: BullLock) => setLocks((prev) => prev.map((x) => (x.id === l.id ? l : x))),
    [],
  );
  const addTx = useCallback((t: TxRecord) => setAllHistory((prev) => [t, ...prev]), []);
  const markNotificationsRead = useCallback(
    () => setNotifications((prev) => prev.map((n) => ({ ...n, read: true }))),
    [],
  );
  const updateSettings = useCallback(
    (p: Partial<AppSettings>) =>
      setSettings((prev) => {
        const next = { ...prev, ...p };
        // Persisted (kv: AsyncStorage on native, localStorage on web) —
        // the write is idempotent, so a StrictMode double-invoke is harmless.
        void kvSet(SETTINGS_KEY, JSON.stringify(next));
        return next;
      }),
    [],
  );
  const resetState = useCallback(() => {
    setTokens([]);
    setLocks([]);
    setAllHistory([]);
    setNotifications([]);
    setUnlocked(false);
    setOnboarded(false);
    setAddress('');
    setSolanaAddress('');
    setError(null);
    setBalancesError(null);
    setHistoryError(null);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      onboarded, unlocked, address, solanaAddress, chainAddress, chain,
      availableChains, refreshChains,
      tokens, locks, history, allHistory, notifications, settings,
      discipline,
      loading, hydrated, error, balancesError, historyError, vaultNote, showDust,
      setOnboarded, setUnlocked, setAddress, setChain,
      addLock, updateLock, addTx, markNotificationsRead, updateSettings,
      setShowDust, refreshBalances, refreshLocks, refreshAll, resetState,
    }),
    [onboarded, unlocked, address, solanaAddress, chainAddress, chain, availableChains, refreshChains, tokens, locks, history, allHistory, notifications, settings,
     discipline, loading, hydrated, error, balancesError, historyError, vaultNote, showDust,
     setChain, addLock, updateLock, addTx, markNotificationsRead, updateSettings,
     refreshBalances, refreshLocks, refreshAll, resetState],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export { ACTIVE_CHAINS };
