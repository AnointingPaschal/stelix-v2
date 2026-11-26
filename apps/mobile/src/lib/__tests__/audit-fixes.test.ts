/**
 * Regression tests for the mobile audit fixes (2026-11-26).
 *
 * Every test here pins a bug that was found live in the app and fixed in
 * the same pass — a regression must fail here, not on a user's phone.
 * Pure-lib helpers only (no RN imports, per jest.config.js).
 */
import { lockedByToken, minReceivePerStageUsd, type BullLock } from '../vault';
import { DEFAULT_SETTINGS, parseStoredSettings } from '../settings';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function makeLock(over: Partial<BullLock> = {}): BullLock {
  return {
    id: 'TEST-1',
    chainId: 'bnb',
    tokenSymbol: 'WKC',
    tokenAddress: '0xabc',
    amount: 10000,
    amountRemaining: 10000,
    entryPrice: 0.02,
    unlockTime: NOW + 365 * DAY,
    targetPrice: 0.06,
    targetMultiple: 3,
    ladder: [
      { multiple: 2, percent: 25, status: 'pending' },
      { multiple: 3, percent: 25, status: 'pending' },
      { multiple: 5, percent: 25, status: 'pending' },
      { multiple: 10, percent: 25, status: 'pending' },
    ],
    trailingStopBps: 1500,
    peakPrice: 0.02,
    breakMode: 'penalty',
    penaltyBps: 500,
    autoSell: true,
    slippageBps: 150,
    minReceiveUsd: 0,
    status: 'active',
    createdAt: NOW,
    ...over,
  };
}

describe('lockedByToken — locked amounts are real, not always 0', () => {
  it('sums remaining amounts per chain+symbol', () => {
    const out = lockedByToken([
      makeLock({ id: 'A', amountRemaining: 4000 }),
      makeLock({ id: 'B', amountRemaining: 1500 }),
      makeLock({ id: 'C', chainId: 'arc', tokenSymbol: 'USDC', amountRemaining: 250 }),
    ]);
    expect(out).toEqual({ 'bnb:WKC': 5500, 'arc:USDC': 250 });
  });

  it('ignores completed and broken locks', () => {
    const out = lockedByToken([
      makeLock({ id: 'A', status: 'completed', amountRemaining: 9000 }),
      makeLock({ id: 'B', status: 'broken', amountRemaining: 9000 }),
      makeLock({ id: 'C', amountRemaining: 100 }),
    ]);
    expect(out).toEqual({ 'bnb:WKC': 100 });
  });

  it('clamps a negative remaining amount to 0 and returns {} for no locks', () => {
    expect(lockedByToken([makeLock({ amountRemaining: -5 })])).toEqual({ 'bnb:WKC': 0 });
    expect(lockedByToken([])).toEqual({});
  });
});

describe('minReceivePerStageUsd — no hardcoded $100 floor', () => {
  it('sizes the minimum to the FIRST ladder stage (the binding one)', () => {
    // 100 WKC at $0.02 entry, first stage 2x / 25% = $1.00, minus 1.5%
    // slippage = $0.985. The old code wrote $100 here, which would
    // revert any lock whose stage is worth less than $100.
    const got = minReceivePerStageUsd({
      amount: 100,
      entryPrice: 0.02,
      targetPrice: 0.06,
      ladder: [
        { multiple: 2, percent: 25 },
        { multiple: 3, percent: 25 },
      ],
      ladderOn: true,
      slippageBps: 150,
    });
    expect(got).toBeCloseTo(0.985, 6);
  });

  it('uses the single target for a non-ladder lock', () => {
    const got = minReceivePerStageUsd({
      amount: 100,
      entryPrice: 0.02,
      targetPrice: 0.06,
      ladder: [],
      ladderOn: false,
      slippageBps: 150,
    });
    expect(got).toBeCloseTo(100 * 0.06 * 0.985, 6);
  });

  it('is 0 for a date-only lock and for a zero amount/entry', () => {
    const base = {
      amount: 100,
      entryPrice: 0.02,
      targetPrice: null as number | null,
      ladder: [],
      ladderOn: false,
      slippageBps: 150,
    };
    expect(minReceivePerStageUsd(base)).toBe(0);
    expect(minReceivePerStageUsd({ ...base, amount: 0, targetPrice: 0.06 })).toBe(0);
    expect(minReceivePerStageUsd({ ...base, entryPrice: 0, targetPrice: 0.06 })).toBe(0);
  });
});

describe('parseStoredSettings — settings survive a restart', () => {
  it('returns defaults for null, garbage and non-objects', () => {
    expect(parseStoredSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseStoredSettings('42')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields and defaults the rest', () => {
    const got = parseStoredSettings(JSON.stringify({ autoLockMinutes: 5, hideSpam: false }));
    expect(got).toEqual({ ...DEFAULT_SETTINGS, autoLockMinutes: 5, hideSpam: false });
  });

  it('rejects an out-of-range auto-lock value instead of trusting it', () => {
    const got = parseStoredSettings(JSON.stringify({ autoLockMinutes: 99 }));
    expect(got.autoLockMinutes).toBe(DEFAULT_SETTINGS.autoLockMinutes);
  });

  it('accepts the 0-minute (lock immediately) option', () => {
    const got = parseStoredSettings(JSON.stringify({ autoLockMinutes: 0 }));
    expect(got.autoLockMinutes).toBe(0);
  });
});

// The watchlist resolves market data through lib/prices (network) —
// mocked here so the tests stay offline. The held-token and
// symbol-only paths never touch the network.
jest.mock('../prices', () => ({
  fetchTokenMarketData: jest.fn(async () => ({
    symbol: 'MOCK',
    name: 'Mock Token',
    priceUsd: 1.5,
    change24h: 2,
  })),
}));

type WatchlistModule = typeof import('../watchlist');
type TokenBalance = import('../balances').TokenBalance;

function makeToken(over: Partial<TokenBalance> = {}): TokenBalance {
  return {
    chainId: 'bnb',
    address: '',
    symbol: 'BNB',
    name: 'BNB',
    decimals: 18,
    balance: 2,
    balanceRaw: '2000000000000000000',
    locked: 0,
    priceUsd: 600,
    price: 600,
    priceSource: 'dexscreener',
    priceUpdatedAt: null,
    isSpam: false,
    ...over,
  };
}

describe('watchlist — the star has a screen that lists it (Home)', () => {
  let wl: WatchlistModule;

  beforeEach(async () => {
    // Fresh module registry = fresh in-memory kv store, so each test
    // starts with an empty watchlist (the "restart the app" isolation).
    jest.resetModules();
    wl = await import('../watchlist');
  });

  it('watchKey uses chain:address-or-symbol, the format old stars saved', () => {
    expect(wl.watchKey('bnb', '0xabc', 'WKC')).toBe('bnb:0xabc');
    expect(wl.watchKey('bnb', '', 'BNB')).toBe('bnb:BNB');
  });

  it('toggle adds then removes, and load/isWatched agree', async () => {
    expect(await wl.loadWatchlist()).toEqual([]);
    expect(await wl.toggleWatchlist('bnb:0xabc')).toBe(true);
    expect(await wl.isWatched('bnb:0xabc')).toBe(true);
    expect(await wl.loadWatchlist()).toEqual(['bnb:0xabc']);
    expect(await wl.toggleWatchlist('bnb:0xabc')).toBe(false);
    expect(await wl.isWatched('bnb:0xabc')).toBe(false);
    expect(await wl.loadWatchlist()).toEqual([]);
  });

  it('resolveWatchlistEntries uses the held token row when the token is in the wallet', async () => {
    const entries = await wl.resolveWatchlistEntries(['bnb:BNB'], [makeToken()]);
    expect(entries).toEqual([
      {
        key: 'bnb:BNB',
        chainId: 'bnb',
        address: '',
        symbol: 'BNB',
        name: 'BNB',
        priceUsd: 600,
        change24h: null,
        held: true,
        balance: 2,
      },
    ]);
  });

  it('resolveWatchlistEntries resolves an unknown contract address from the market (mocked)', async () => {
    const entries = await wl.resolveWatchlistEntries(['bnb:0x1234567890abcdef1234567890abcdef12345678'], []);
    expect(entries[0]).toMatchObject({
      key: 'bnb:0x1234567890abcdef1234567890abcdef12345678',
      symbol: 'MOCK',
      name: 'Mock Token',
      priceUsd: 1.5,
      held: false,
    });
  });

  it('resolveWatchlistEntries never invents a price for an unresolvable symbol', async () => {
    const entries = await wl.resolveWatchlistEntries(['bnb:UNKNOWN'], []);
    expect(entries[0]).toMatchObject({ symbol: 'UNKNOWN', priceUsd: null, held: false });
  });
});

