/**
 * LIVE app state — wallet, balances, locks, history, settings.
 * Backed by SecureStore-encrypted wallet + on-chain reads + live price
 * APIs. No placeholder data: a new wallet starts with an empty token list,
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
  /** Solana address derived from the same mnemonic ('' when none — e.g.
   *  wallets imported from a raw private key). Used for Solana balances
   *  and history; the EVM address is meaningless on Solana. */
  solanaAddress: string;
  chain: ChainConfig;
  tokens: TokenBalance[];
  locks: BullLock[];
  history: TxRecord[];
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

  /** Address for the active chain: the derived Solana address on Solana,
   *  the EVM address everywhere else. */
  const chainAddress = chain.kind === 'solana' ? solanaAddress : address;

  const refreshBalances = useCallback(async () => {
    if (!chainAddress) return;
    setLoading(true);
    try {
      const imported = await loadImportedTokens();
      const res = await fetchBalances(chain.id, chainAddress, imported);
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
  }, [chainAddress, chain.id]);

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
  useEffect(() => {
    let cancelled = false;
    // Safety net: never hold the splash longer than 5s even if storage hangs.
    const fallback = setTimeout(() => {
      if (!cancelled) setHydrated(true);
    }, 5000);
    void (async () => {
      try {
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
      onboarded, unlocked, address, solanaAddress, chain,
      tokens, locks, history, notifications, settings,
      discipline,
      loading, hydrated, error, balancesError, historyError, vaultNote, showDust,
      setOnboarded, setUnlocked, setAddress, setChain,
      addLock, updateLock, addTx, markNotificationsRead, updateSettings,
      setShowDust, refreshBalances, refreshLocks, refreshAll, resetState,
    }),
    [onboarded, unlocked, address, solanaAddress, chain, tokens, locks, history, notifications, settings,
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

export { CHAINS };
