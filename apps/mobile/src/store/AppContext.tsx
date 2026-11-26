/**
 * LIVE app state — wallet, balances, locks, history, settings.
 * Backed by SecureStore-encrypted wallet + on-chain reads + live price
 * APIs. NO demo data: a new wallet starts with an empty token list,
 * $0.00, no locks and no history until real on-chain data exists.
 * Locks are read from StelixVault via getUserLocksOnChain when deployed;
 * otherwise the list is empty with vaultNote set to the not-deployed
 * message (see lib/chains.ts / lib/vault.ts).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CHAINS, DEFAULT_CHAIN, VAULT_NOT_DEPLOYED_MESSAGE, type ChainConfig } from '../lib/chains';
import { fetchBalances, loadImportedTokens, type TokenBalance } from '../lib/balances';
import { fetchHistory, filterHistory, type TxRecord } from '../lib/history';
import { getUserLocksOnChain, mapChainLockToBullLock, type BullLock } from '../lib/vault';
import { getWalletMeta, hasWallet } from '../lib/wallet';

export interface AppSettings {
  biometrics: boolean;
  autoLockMinutes: number; // 0 = immediately
  currency: string;
  language: string;
  hideSpam: boolean;
  maturityReminders: boolean;
}

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
  chain: ChainConfig;
  tokens: TokenBalance[];
  locks: BullLock[];
  history: TxRecord[];
  notifications: AppNotification[];
  settings: AppSettings;
  discipline: DisciplineStats;
  /** Live-data loading / error state (never hidden behind sample data). */
  loading: boolean;
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
  /** Kept name for the settings screen: resets live state to empty. */
  resetDemo: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [onboarded, setOnboarded] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [address, setAddress] = useState('');
  const [chain, setChainState] = useState<ChainConfig>(DEFAULT_CHAIN);
  const [tokens, setTokens] = useState<TokenBalance[]>([]);
  const [locks, setLocks] = useState<BullLock[]>([]);
  const [allHistory, setAllHistory] = useState<TxRecord[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balancesError, setBalancesError] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [vaultNote, setVaultNote] = useState<string | null>(VAULT_NOT_DEPLOYED_MESSAGE);
  const [showDust, setShowDust] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({
    biometrics: true,
    autoLockMinutes: 1,
    currency: 'USD',
    language: 'English',
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

  const refreshBalances = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const imported = await loadImportedTokens();
      const res = await fetchBalances(chain.id, address, imported);
      setTokens(res.tokens);
      setBalancesError(res.error);
      if (res.error) setError(res.error);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBalancesError(msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [address, chain.id]);

  const refreshLocks = useCallback(async () => {
    if (!address) return;
    try {
      const res = await getUserLocksOnChain(chain.id, address);
      setVaultNote(res.deployed ? null : res.note);
      if (!res.deployed) {
        setLocks([]);
        return;
      }
      const mapped = res.locks.map((l) => {
        const token = tokens.find((t) => t.address.toLowerCase() === l.token.toLowerCase());
        return mapChainLockToBullLock(l, token?.decimals ?? 18, token?.symbol ?? '');
      });
      setLocks(mapped);
    } catch (e) {
      setVaultNote(e instanceof Error ? e.message : String(e));
      setLocks([]);
    }
  }, [address, chain.id, tokens]);

  const refreshHistory = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetchHistory(chain.id, address);
      setAllHistory(res.txs);
      setHistoryError(res.error);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    }
  }, [address, chain.id]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshBalances(), refreshLocks(), refreshHistory()]);
  }, [refreshBalances, refreshLocks, refreshHistory]);

  // On launch: if a wallet is stored, surface its address (locked until
  // the user unlocks with the session password).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (await hasWallet()) {
        const meta = await getWalletMeta();
        if (!cancelled && meta) {
          setAddress(meta.address);
          setOnboarded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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
    (p: Partial<AppSettings>) => setSettings((prev) => ({ ...prev, ...p })),
    [],
  );
  const resetDemo = useCallback(() => {
    setTokens([]);
    setLocks([]);
    setAllHistory([]);
    setNotifications([]);
    setUnlocked(false);
    setOnboarded(false);
    setAddress('');
    setError(null);
    setBalancesError(null);
    setHistoryError(null);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      onboarded, unlocked, address, chain,
      tokens, locks, history, notifications, settings,
      discipline,
      loading, error, balancesError, historyError, vaultNote, showDust,
      setOnboarded, setUnlocked, setAddress, setChain,
      addLock, updateLock, addTx, markNotificationsRead, updateSettings,
      setShowDust, refreshBalances, refreshLocks, refreshAll, resetDemo,
    }),
    [onboarded, unlocked, address, chain, tokens, locks, history, notifications, settings,
     discipline, loading, error, balancesError, historyError, vaultNote, showDust,
     setChain, addLock, updateLock, addTx, markNotificationsRead, updateSettings,
     refreshBalances, refreshLocks, refreshAll, resetDemo],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export { CHAINS };
