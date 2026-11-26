/**
 * Demo app state — wallet, locks, history, notifications, settings.
 * In production this is backed by SecureStore + on-chain reads + the
 * Cloudflare admin config; here it is seeded with clearly-labelled DEMO
 * data so every screen works end to end without a backend.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { CHAINS, DEFAULT_CHAIN, type ChainConfig } from '../lib/chains';
import {
  DEMO_DISCIPLINE,
  DEMO_HISTORY,
  DEMO_LOCKS,
  DEMO_NOTIFICATIONS,
  DEMO_TOKENS,
  type DemoNotification,
  type DemoToken,
  type DemoTx,
} from '../lib/demoData';
import type { BullLock } from '../lib/vault';

export interface AppSettings {
  biometrics: boolean;
  autoLockMinutes: number; // 0 = immediately
  currency: string;
  language: string;
  hideSpam: boolean;
  maturityReminders: boolean;
}

interface AppState {
  onboarded: boolean;
  unlocked: boolean;
  address: string;
  chain: ChainConfig;
  tokens: DemoToken[];
  locks: BullLock[];
  history: DemoTx[];
  notifications: DemoNotification[];
  settings: AppSettings;
  discipline: typeof DEMO_DISCIPLINE;
  setOnboarded: (v: boolean) => void;
  setUnlocked: (v: boolean) => void;
  setAddress: (a: string) => void;
  setChain: (c: ChainConfig) => void;
  addLock: (l: BullLock) => void;
  updateLock: (l: BullLock) => void;
  addTx: (t: DemoTx) => void;
  markNotificationsRead: () => void;
  updateSettings: (p: Partial<AppSettings>) => void;
  resetDemo: () => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [onboarded, setOnboarded] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [address, setAddress] = useState('0x8f2a1c4d9e6b7a3c5d8f0a1b2c3d4e5f6a7b8c9d');
  const [chain, setChainState] = useState<ChainConfig>(DEFAULT_CHAIN);
  const [locks, setLocks] = useState<BullLock[]>(DEMO_LOCKS);
  const [history, setHistory] = useState<DemoTx[]>(DEMO_HISTORY);
  const [notifications, setNotifications] = useState<DemoNotification[]>(DEMO_NOTIFICATIONS);
  const [settings, setSettings] = useState<AppSettings>({
    biometrics: true,
    autoLockMinutes: 1,
    currency: 'USD',
    language: 'English',
    hideSpam: true,
    maturityReminders: true,
  });

  const setChain = useCallback((c: ChainConfig) => setChainState(c), []);
  const addLock = useCallback((l: BullLock) => setLocks((prev) => [l, ...prev]), []);
  const updateLock = useCallback(
    (l: BullLock) => setLocks((prev) => prev.map((x) => (x.id === l.id ? l : x))),
    [],
  );
  const addTx = useCallback((t: DemoTx) => setHistory((prev) => [t, ...prev]), []);
  const markNotificationsRead = useCallback(
    () => setNotifications((prev) => prev.map((n) => ({ ...n, read: true }))),
    [],
  );
  const updateSettings = useCallback(
    (p: Partial<AppSettings>) => setSettings((prev) => ({ ...prev, ...p })),
    [],
  );
  const resetDemo = useCallback(() => {
    setLocks(DEMO_LOCKS);
    setHistory(DEMO_HISTORY);
    setNotifications(DEMO_NOTIFICATIONS);
    setUnlocked(false);
    setOnboarded(false);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      onboarded, unlocked, address, chain,
      tokens: DEMO_TOKENS,
      locks, history, notifications, settings,
      discipline: DEMO_DISCIPLINE,
      setOnboarded, setUnlocked, setAddress, setChain,
      addLock, updateLock, addTx, markNotificationsRead, updateSettings, resetDemo,
    }),
    [onboarded, unlocked, address, chain, locks, history, notifications, settings,
     setChain, addLock, updateLock, addTx, markNotificationsRead, updateSettings, resetDemo],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export { CHAINS };
