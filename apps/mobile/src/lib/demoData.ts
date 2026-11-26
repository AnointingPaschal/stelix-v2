/**
 * Demo data — realistic v1-style sample data, clearly labelled DEMO in the
 * UI. Live prices are fetched where possible (see prices.ts); these values
 * are the graceful offline fallback. Nothing here is a real balance.
 */
import type { BullLock } from './vault';

export interface DemoToken {
  symbol: string;
  name: string;
  chainId: string;
  address: string;
  price: number;
  change24h: number;
  change1h: number;
  change7d: number;
  balance: number; // spendable
  locked: number;
  marketCap: number;
  liquidity: number;
  volume24h: number;
  totalSupply: number;
  safetyScore: number;
  safetyReasons: string[];
  buys24h: number;
  sells24h: number;
  coingeckoId: string;
  dexscreenerPair?: string;
  isSpam?: boolean;
}

export const DEMO_TOKENS: DemoToken[] = [
  {
    symbol: 'BNB', name: 'BNB', chainId: 'bnb',
    address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    price: 612.40, change24h: 2.4, change1h: 0.3, change7d: 5.1,
    balance: 1.842, locked: 2.5, marketCap: 89_400_000_000,
    liquidity: 412_000_000, volume24h: 1_850_000_000, totalSupply: 145_887_576,
    safetyScore: 96, safetyReasons: ['Verified contract', 'Deep liquidity', 'No mint authority'],
    buys24h: 18420, sells24h: 15210, coingeckoId: 'binancecoin',
  },
  {
    symbol: 'WBNB', name: 'Wrapped BNB', chainId: 'bnb',
    address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    price: 612.40, change24h: 2.4, change1h: 0.3, change7d: 5.1,
    balance: 0.35, locked: 1.0, marketCap: 89_400_000_000,
    liquidity: 412_000_000, volume24h: 1_850_000_000, totalSupply: 145_887_576,
    safetyScore: 96, safetyReasons: ['Verified contract', 'Deep liquidity', 'No mint authority'],
    buys24h: 18420, sells24h: 15210, coingeckoId: 'binancecoin',
  },
  {
    symbol: 'USDT', name: 'Tether USD', chainId: 'bnb',
    address: '0x55d398326f99059fF775485246999027B3197955',
    price: 1.0, change24h: 0.0, change1h: 0.0, change7d: 0.0,
    balance: 412.5, locked: 0, marketCap: 148_000_000_000,
    liquidity: 2_100_000_000, volume24h: 62_000_000_000, totalSupply: 148_000_000_000,
    safetyScore: 98, safetyReasons: ['Verified contract', 'Deep liquidity', 'Audited'],
    buys24h: 0, sells24h: 0, coingeckoId: 'tether',
  },
  {
    symbol: 'WKC', name: 'Wakanda Coin', chainId: 'bnb',
    address: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
    price: 0.0421, change24h: 8.7, change1h: 1.2, change7d: 18.4,
    balance: 12400, locked: 50000, marketCap: 42_100_000,
    liquidity: 1_240_000, volume24h: 386_000, totalSupply: 1_000_000_000,
    safetyScore: 71, safetyReasons: ['Liquidity partly locked', 'Holder concentration: top 10 hold 38%', 'Mint authority renounced'],
    buys24h: 312, sells24h: 198, coingeckoId: 'wakanda-coin',
  },
  {
    symbol: 'GTAN', name: 'GTA Network', chainId: 'bnb',
    address: '0x9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
    price: 0.118, change24h: -3.2, change1h: -0.4, change7d: 6.8,
    balance: 8600, locked: 0, marketCap: 11_800_000,
    liquidity: 420_000, volume24h: 94_000, totalSupply: 100_000_000,
    safetyScore: 64, safetyReasons: ['Thin liquidity — impact guard applies', 'Holder concentration: top 10 hold 44%'],
    buys24h: 96, sells24h: 121, coingeckoId: 'gta-network',
  },
  {
    symbol: 'ETH', name: 'Ethereum', chainId: 'ethereum',
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    price: 3248.10, change24h: 1.8, change1h: 0.2, change7d: 3.9,
    balance: 0.62, locked: 0.5, marketCap: 391_000_000_000,
    liquidity: 8_400_000_000, volume24h: 18_200_000_000, totalSupply: 120_440_000,
    safetyScore: 97, safetyReasons: ['Verified contract', 'Deep liquidity', 'No mint authority'],
    buys24h: 48200, sells24h: 44100, coingeckoId: 'ethereum',
  },
  {
    symbol: 'SOL', name: 'Solana', chainId: 'solana',
    address: 'So11111111111111111111111111111111111111112',
    price: 212.75, change24h: 4.1, change1h: 0.6, change7d: 9.2,
    balance: 3.4, locked: 0, marketCap: 109_000_000_000,
    liquidity: 3_100_000_000, volume24h: 4_600_000_000, totalSupply: 512_000_000,
    safetyScore: 95, safetyReasons: ['Verified program', 'Deep liquidity'],
    buys24h: 31200, sells24h: 27400, coingeckoId: 'solana',
  },
  {
    symbol: 'USDC', name: 'USD Coin', chainId: 'arc',
    address: '0x0000000000000000000000000000000000000000',
    price: 1.0, change24h: 0.0, change1h: 0.0, change7d: 0.0,
    balance: 250.0, locked: 0, marketCap: 74_000_000_000,
    liquidity: 1_800_000_000, volume24h: 9_400_000_000, totalSupply: 74_000_000_000,
    safetyScore: 98, safetyReasons: ['Verified contract', 'Deep liquidity', 'Audited'],
    buys24h: 0, sells24h: 0, coingeckoId: 'usd-coin',
  },
  // Spam / dust — auto-hidden into the Spam folder, never in the main list.
  {
    symbol: 'FREE$$', name: 'Free Money Token', chainId: 'bnb',
    address: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    price: 0.000001, change24h: 999.0, change1h: 0, change7d: 0,
    balance: 1000000, locked: 0, marketCap: 0, liquidity: 1200,
    volume24h: 0, totalSupply: 0, safetyScore: 4,
    safetyReasons: ['Likely scam — unsolicited airdrop', 'No liquidity lock', 'Honeypot risk'],
    buys24h: 0, sells24h: 0, coingeckoId: '', isSpam: true,
  },
];

export function demoToken(symbol: string): DemoToken {
  return DEMO_TOKENS.find((t) => t.symbol === symbol) ?? DEMO_TOKENS[0];
}

/** Deterministic pseudo-history for charts (seeded by symbol). */
export function demoChartSeries(symbol: string, points = 48): number[] {
  let seed = 0;
  for (const ch of symbol) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
  const base = demoToken(symbol).price;
  const out: number[] = [];
  let v = base * 0.94;
  for (let i = 0; i < points; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const drift = ((seed / 2147483648) - 0.48) * base * 0.012;
    v = Math.max(base * 0.5, v + drift);
    out.push(v);
  }
  out[points - 1] = base;
  return out;
}

/** EMA over a price series. */
export function ema(series: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = series[0];
  for (const p of series) {
    prev = p * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

const now = Date.now();
const DAY = 86_400_000;

export const DEMO_LOCKS: BullLock[] = [
  {
    id: 'LCK-1001', chainId: 'bnb', tokenSymbol: 'WKC',
    tokenAddress: demoToken('WKC').address,
    amount: 50000, amountRemaining: 50000, entryPrice: 0.021,
    unlockTime: now + 274 * DAY, targetPrice: 0.063, targetMultiple: 3,
    ladder: [
      { multiple: 2, percent: 25, status: 'sold', soldUsd: 525.0, soldAt: now - 12 * DAY },
      { multiple: 3, percent: 25, status: 'pending' },
      { multiple: 5, percent: 25, status: 'pending' },
      { multiple: 10, percent: 25, status: 'pending' },
    ],
    trailingStopBps: 1500, peakPrice: 0.045, breakMode: 'penalty', penaltyBps: 500,
    autoSell: true, slippageBps: 150, minReceiveUsd: 100,
    status: 'partially-sold', createdAt: now - 96 * DAY,
    txHash: '0x8f2a1c4d9e6b7a3c5d8f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
  },
  {
    id: 'LCK-1002', chainId: 'bnb', tokenSymbol: 'BNB',
    tokenAddress: demoToken('BNB').address,
    amount: 2.5, amountRemaining: 2.5, entryPrice: 540.0,
    unlockTime: now + 32 * DAY, targetPrice: null, targetMultiple: null,
    ladder: [], trailingStopBps: null, peakPrice: 612.4,
    breakMode: 'immutable', penaltyBps: 0,
    autoSell: false, slippageBps: 150, minReceiveUsd: 50,
    status: 'active', createdAt: now - 58 * DAY,
    txHash: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
  },
  {
    id: 'LCK-1003', chainId: 'ethereum', tokenSymbol: 'ETH',
    tokenAddress: demoToken('ETH').address,
    amount: 0.5, amountRemaining: 0, entryPrice: 2400.0,
    unlockTime: now - 3 * DAY, targetPrice: 4800.0, targetMultiple: 2,
    ladder: [{ multiple: 2, percent: 100, status: 'sold', soldUsd: 2412.5, soldAt: now - 3 * DAY }],
    trailingStopBps: 1000, peakPrice: 4860.0, breakMode: 'penalty', penaltyBps: 500,
    autoSell: true, slippageBps: 150, minReceiveUsd: 100,
    status: 'completed', createdAt: now - 190 * DAY,
    txHash: '0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d',
  },
];

export interface DemoTx {
  id: string;
  kind: 'sent' | 'received' | 'swap' | 'lock' | 'unlock' | 'autosell';
  token: string;
  amount: number;
  usd: number;
  counterparty?: string;
  note?: string;
  at: number;
  status: 'confirmed' | 'pending' | 'failed';
  isSpam?: boolean;
}

export const DEMO_HISTORY: DemoTx[] = [
  { id: 'tx1', kind: 'autosell', token: 'WKC', amount: 12500, usd: 525.0, note: 'Target hit — sold 25% at 2x to USDT', at: now - 12 * DAY, status: 'confirmed' },
  { id: 'tx2', kind: 'lock', token: 'WKC', amount: 50000, usd: 1050.0, note: 'Locked 50,000 WKC until Aug 2027 or 3x', at: now - 96 * DAY, status: 'confirmed' },
  { id: 'tx3', kind: 'received', token: 'BNB', amount: 0.5, usd: 306.2, counterparty: '0x7a…9f2c', at: now - 5 * DAY, status: 'confirmed' },
  { id: 'tx4', kind: 'swap', token: 'USDT', amount: 200, usd: 200.0, note: 'Swapped 0.32 BNB → 200 USDT', at: now - 2 * DAY, status: 'confirmed' },
  { id: 'tx5', kind: 'sent', token: 'USDT', amount: 50, usd: 50.0, counterparty: '0x3f…81ab', at: now - 1 * DAY, status: 'confirmed' },
  { id: 'tx6', kind: 'autosell', token: 'ETH', amount: 0.5, usd: 2412.5, note: 'Target hit — sold to USDT', at: now - 3 * DAY, status: 'confirmed' },
  { id: 'tx7', kind: 'received', token: 'FREE$$', amount: 1000000, usd: 0.0, counterparty: '0xde…beef', note: 'Unsolicited airdrop', at: now - 6 * DAY, status: 'confirmed', isSpam: true },
];

export interface DemoNotification {
  id: string;
  title: string;
  body: string;
  at: number;
  read: boolean;
  kind: 'target' | 'maturity' | 'autosell' | 'security' | 'info';
}

export const DEMO_NOTIFICATIONS: DemoNotification[] = [
  { id: 'n1', kind: 'autosell', title: 'Target hit — sold to USDT', body: '25% of your WKC lock sold at 2x. 525.00 USDT received.', at: now - 12 * DAY, read: false },
  { id: 'n2', kind: 'target', title: 'WKC is 82% to your 3x target', body: 'Current price $0.0421 — target $0.0630. TWAP guard active.', at: now - 2 * 3600_000, read: false },
  { id: 'n3', kind: 'maturity', title: 'BNB lock matures in 32 days', body: 'Your 2.5 BNB goal lock unlocks on 28 Dec 2026.', at: now - 1 * DAY, read: true },
  { id: 'n4', kind: 'security', title: 'New device sign-in', body: 'Your wallet was unlocked on a new device. If this was not you, wipe the wallet from Settings.', at: now - 4 * DAY, read: true },
  { id: 'n5', kind: 'info', title: 'Arc is now the default chain', body: 'Stelix 2.0 opens on Arc. Your BNB locks are unchanged.', at: now - 9 * DAY, read: true },
];

export const DEMO_DISCIPLINE = {
  score: 82,
  streakDays: 24,
  lockedRatio: 0.58,
  totalAutoSoldUsd: 2937.5,
  locksCompleted: 3,
  locksBroken: 0,
  monthLockedUsd: 1240,
  monthAutoSoldUsd: 525,
};
