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
import { mergeAdminChains } from '../lib/adminChains';
import {
  ADMIN_POLL_INTERVAL_MS,
  resolveModeChange,
  fetchAdminSync,
  filterChainsByMode,
  loadPersistedAdminChainState,
  loadPersistedNetworkMode,
  maintenanceBlocksApp as maintenanceBlocksAppFn,
  maintenanceBlocksSigning,
  mergeWithPersistedState,
  resolveEffectiveFees,
  MAINTENANCE_OFF,
  type AdminAnnouncement,
  type AdminAppConfig,
  type AdminSyncData,
  type AdminTokenEntry,
  type EffectiveFees,
  type MaintenanceState,
  type NetworkMode,
} from '../lib/adminSync';
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
  /** Live admin sync (live polling, not push — see refreshAdmin). */
  refreshAdmin: () => Promise<void>;
  /** Effective fee config: the admin's published fees when one exists,
   *  otherwise the local defaults with source 'default' (the UI must say
   *  so — a hardcoded fee never silently overrides an admin edit). */
  adminFees: EffectiveFees;
  /** Unexpired public announcements from the admin (audience 'all' or a
   *  chain slug); the Home screen filters by chain + dismissals. */
  announcements: AdminAnnouncement[];
  /** Latest signed app config, or null when none is published yet. */
  appConfig: AdminAppConfig | null;
  /** Token/DEX registry entries (verified/allow list). */
  adminTokens: AdminTokenEntry[];
  /** True once at least one admin sync has succeeded; the import screen
   *  only shows "not in the registry" once this is true. */
  adminTokensSynced: boolean;
  /** Maintenance mode from the admin. */
  maintenance: MaintenanceState;
  /** True while maintenance is on (either scope): signing is blocked. */
  signingBlocked: boolean;
  /** True while maintenance is on with scope 'all': the whole wallet is
   *  behind a maintenance screen. */
  maintenanceBlocksApp: boolean;
  /** Wall-clock time of the last successful admin sync, or null. */
  adminLastSyncAt: number | null;
  /** Monotonic sync version from the server, or null before first sync. */
  adminSyncVersion: number | null;
  /** Admin's global network mode: 'testnet' | 'mainnet' | null (never set
   *  = all networks). The admin is the source of truth — the wallet's
   *  network picker cannot override it. */
  networkMode: NetworkMode;
  /** Notice shown after an admin mode flip ("Switched to Mainnet by
   *  admin"), or null. Dismissible. */
  modeNotice: string | null;
  dismissModeNotice: () => void;
  /** True while a signing modal is open (a transaction flow is in
   *  progress). An admin mode flip during this time is deferred until
   *  the flow finishes or is cancelled — never mid-transaction. */
  transactionActive: boolean;
  setTransactionActive: (v: boolean) => void;
  dismissAnnouncement: (id: number) => void;
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
  const [adminFees, setAdminFees] = useState<EffectiveFees>(() => resolveEffectiveFees(null, null));
  const [announcements, setAnnouncements] = useState<AdminAnnouncement[]>([]);
  const [appConfig, setAppConfig] = useState<AdminAppConfig | null>(null);
  const [adminTokens, setAdminTokens] = useState<AdminTokenEntry[]>([]);
  const [adminTokensSynced, setAdminTokensSynced] = useState(false);
  const [maintenance, setMaintenance] = useState<MaintenanceState>(MAINTENANCE_OFF);
  const [adminLastSyncAt, setAdminLastSyncAt] = useState<number | null>(null);
  const [adminSyncVersion, setAdminSyncVersion] = useState<number | null>(null);
  const [dismissedIds, setDismissedIds] = useState<number[]>([]);
  const [networkMode, setNetworkMode] = useState<NetworkMode>(null);
  const [modeNotice, setModeNotice] = useState<string | null>(null);
  const [transactionActive, setTransactionActiveState] = useState(false);
  const chainRef = useRef(chain);
  useEffect(() => {
    chainRef.current = chain;
  }, [chain]);
  const adminSyncVersionRef = useRef<number | null>(null);
  const networkModeRef = useRef<NetworkMode>(null);
  const pendingModeRef = useRef<NetworkMode>(null);
  const transactionActiveRef = useRef(false);
  const lastMergedRef = useRef<ChainConfig[] | null>(null);
  const setTransactionActive = useCallback((v: boolean) => {
    transactionActiveRef.current = v;
    setTransactionActiveState(v);
  }, []);

  /**
   * Live admin sync — LIVE POLLING, not push. One GET /api/sync carries
   * chains (+ tombstones), fees, announcements, signed config, token
   * registry and maintenance, plus the server's monotonic version; state
   * is only re-applied when the version changes, so an admin edit lands
   * within one poll interval (~45s).
   *
   * On ANY fetch failure the last-known state is kept — except the
   * persisted tombstones / disabled ids, which are still applied on top
   * of the built-ins: a chain the admin deleted or disabled stays gone
   * while the API is down and is never resurrected from the fallback.
   */
  const refreshAdmin = useCallback(async () => {
    let data: AdminSyncData | null = null;
    try {
      data = await fetchAdminSync();
    } catch {
      data = null;
    }
    if (data) {
      if (data.version === adminSyncVersionRef.current) return;
      adminSyncVersionRef.current = data.version;
      setAdminSyncVersion(data.version);
      setAdminLastSyncAt(Date.now());
      const merged = mergeAdminChains(CHAINS, data.chains, { deletedIds: data.deletedIds });
      lastMergedRef.current = merged;
      setAdminFees(resolveEffectiveFees(data.fees, data.feeVersion));
      setAnnouncements(data.announcements);
      setAppConfig(data.config);
      setAdminTokens(data.tokens);
      setAdminTokensSynced(true);
      setMaintenance(data.maintenance);
      // Network mode (admin-controlled testnet/mainnet switch). A flip
      // while a transaction is in progress is DEFERRED — the mode and
      // the chain switch wait until the flow finishes or is cancelled
      // (see the transactionActive effect below); the user is never
      // switched mid-transaction.
      const decision = resolveModeChange({
        currentMode: networkModeRef.current,
        nextMode: data.networkMode,
        transactionActive: transactionActiveRef.current,
        chains: merged,
        currentChain: chainRef.current,
      });
      if (decision.deferred) {
        pendingModeRef.current = data.networkMode;
        setAvailableChains(filterChainsByMode(merged, networkModeRef.current));
        return;
      }
      pendingModeRef.current = null;
      const effectiveMode = data.networkMode;
      const visible = filterChainsByMode(merged, effectiveMode);
      setAvailableChains(visible);
      if (effectiveMode !== networkModeRef.current) {
        networkModeRef.current = effectiveMode;
        setNetworkMode(effectiveMode);
        if (decision.notice) setModeNotice(decision.notice);
      }
      if (decision.chain) {
        setChainState(decision.chain);
      } else {
        // If the chain the user is on was deleted or disabled, move them
        // to the default chain instead of leaving them on a dead chain.
        const current = chainRef.current;
        if (!visible.some((c) => c.id === current.id && c.active)) {
          const fallback = visible.find((c) => c.isDefault && c.active) ?? visible.find((c) => c.active) ?? DEFAULT_CHAIN;
          if (fallback.id !== current.id) setChainState(fallback);
        }
      }
      return;
    }
    // API down: keep last-known fees/announcements/config/maintenance,
    // but still apply the persisted tombstones / disabled ids.
    try {
      const persisted = await loadPersistedAdminChainState();
      if (persisted.deletedIds.length > 0 || persisted.disabledIds.length > 0) {
        const merged = mergeWithPersistedState(CHAINS, persisted);
        lastMergedRef.current = merged;
        const visible = filterChainsByMode(merged, networkModeRef.current);
        setAvailableChains(visible);
        const current = chainRef.current;
        if (!visible.some((c) => c.id === current.id && c.active)) {
          const fallback = visible.find((c) => c.isDefault && c.active) ?? visible.find((c) => c.active) ?? DEFAULT_CHAIN;
          if (fallback.id !== current.id) setChainState(fallback);
        }
      }
    } catch {
      // Persistence read failed — keep the current chain list as-is.
    }
  }, []);

  /** Manual refresh / network-picker open: same sync, now. */
  const refreshChains = useCallback(async () => {
    adminSyncVersionRef.current = null; // force re-apply even if the version is unchanged
    await refreshAdmin();
  }, [refreshAdmin]);

  // Initial sync on launch.
  useEffect(() => {
    void refreshAdmin();
  }, [refreshAdmin]);

  // Restore the last-seen admin network mode (persisted across restarts)
  // so the mode chip is correct before the first sync lands.
  useEffect(() => {
    void (async () => {
      const mode = await loadPersistedNetworkMode();
      networkModeRef.current = mode;
      setNetworkMode(mode);
    })();
  }, []);

  // A mode flip deferred mid-transaction applies once the transaction
  // flow ends: force a fresh sync (version check bypassed) so the
  // decision runs with transactionActive false.
  useEffect(() => {
    if (!transactionActive && pendingModeRef.current !== null && pendingModeRef.current !== networkModeRef.current) {
      pendingModeRef.current = null;
      adminSyncVersionRef.current = null;
      void refreshAdmin();
    } else if (!transactionActive) {
      pendingModeRef.current = null;
    }
  }, [transactionActive, refreshAdmin]);

  const dismissModeNotice = useCallback(() => setModeNotice(null), []);

  // Live polling while the app is open: every ADMIN_POLL_INTERVAL_MS,
  // skipped while backgrounded. Foregrounding triggers an immediate sync
  // (see the AppState listener below).
  const appActiveRef = useRef(true);
  useEffect(() => {
    const timer = setInterval(() => {
      if (appActiveRef.current) void refreshAdmin();
    }, ADMIN_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refreshAdmin]);

  // Dismissed announcement ids, persisted so a dismissed banner stays dismissed.
  const DISMISSED_ANNOUNCEMENTS_KEY = 'stelix.admin.dismissedAnnouncements.v1';
  useEffect(() => {
    void (async () => {
      try {
        const raw = await kvGet(DISMISSED_ANNOUNCEMENTS_KEY);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) setDismissedIds(parsed.filter((x): x is number => typeof x === 'number'));
        }
      } catch {
        // Keep an empty dismissal list.
      }
    })();
  }, []);
  const dismissAnnouncement = useCallback(
    (id: number) => {
      setDismissedIds((prev) => {
        if (prev.includes(id)) return prev;
        const next = [...prev, id];
        void kvSet(DISMISSED_ANNOUNCEMENTS_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );
  const visibleAnnouncements = useMemo(
    () => announcements.filter((a) => !dismissedIds.includes(a.id)),
    [announcements, dismissedIds],
  );
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
      // Pass the merged chain's vault address: a vault registered in
      // Contract Studio takes effect here on the next admin sync.
      const res = await getUserLocksOnChain(chain.id, address, chain.vaultContract);
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
  }, [address, chain.id, chain.vaultContract, tokens]);

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
    // Pull-to-refresh refreshes balances/locks/history AND the admin
    // sync, so an admin edit shows immediately on demand.
    await Promise.all([refreshBalances(), refreshLocks(), refreshHistory(), refreshAdmin()]);
  }, [refreshBalances, refreshLocks, refreshHistory, refreshAdmin]);

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
        appActiveRef.current = false;
        backgroundedAt = Date.now();
        if (settingsRef.current.autoLockMinutes === 0 && unlockedRef.current) {
          setUnlocked(false);
        }
      } else if (state === 'active') {
        appActiveRef.current = true;
        // Foreground: sync the admin state immediately (live polling) —
        // an edit made while the app was backgrounded shows at once.
        void refreshAdmin();
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
  }, [refreshAdmin]);

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

  const signingBlocked = maintenanceBlocksSigning(maintenance);
  const maintenanceBlocksAppValue = maintenanceBlocksAppFn(maintenance);

  const value = useMemo<AppState>(
    () => ({
      onboarded, unlocked, address, solanaAddress, chainAddress, chain,
      availableChains, refreshChains, refreshAdmin,
      adminFees, announcements: visibleAnnouncements, appConfig, adminTokens, adminTokensSynced,
      maintenance, signingBlocked, maintenanceBlocksApp: maintenanceBlocksAppValue,
      adminLastSyncAt, adminSyncVersion, dismissAnnouncement,
      networkMode, modeNotice, dismissModeNotice, transactionActive, setTransactionActive,
      tokens, locks, history, allHistory, notifications, settings,
      discipline,
      loading, hydrated, error, balancesError, historyError, vaultNote, showDust,
      setOnboarded, setUnlocked, setAddress, setChain,
      addLock, updateLock, addTx, markNotificationsRead, updateSettings,
      setShowDust, refreshBalances, refreshLocks, refreshAll, resetState,
    }),
    [onboarded, unlocked, address, solanaAddress, chainAddress, chain, availableChains, refreshChains, refreshAdmin,
     adminFees, visibleAnnouncements, appConfig, adminTokens, adminTokensSynced,
     maintenance, signingBlocked, maintenanceBlocksAppValue, adminLastSyncAt, adminSyncVersion, dismissAnnouncement,
     networkMode, modeNotice, dismissModeNotice, transactionActive, setTransactionActive,
     tokens, locks, history, allHistory, notifications, settings,
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

/** Non-throwing variant for components that may render outside the
 *  provider (e.g. SignTransactionModal in tests): returns null instead
 *  of throwing, so the caller can fall back to its props. */
export function useAppOptional(): AppState | null {
  return useContext(Ctx);
}

export { ACTIVE_CHAINS };
