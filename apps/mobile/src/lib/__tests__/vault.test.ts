/**
 * Unit tests for the Bull Lock engine (src/lib/vault.ts).
 * Run: npm test
 */
import { ethers } from 'ethers';
import {
  BullLock,
  computeTwap,
  dueLadderStages,
  isPriceTargetHit,
  isTrailingStopBreached,
  breakPenaltyTokens,
  canBreak,
  lockSummarySentence,
  minimumReceive,
  nextRetryDelayMs,
  priceImpactPieces,
  shouldRetrySwap,
  targetProgress,
  unlockReason,
  updatePeak,
  validateLadder,
  disciplineScore,
  createLockOnChain,
  claimMaturedOnChain,
  claimTriggeredStageOnChain,
  requestBreakOnChain,
  executeBreakOnChain,
  executeTriggerOnChain,
  parseOnChainLockId,
  getUserLocksOnChain,
  resolveVaultAddress,
  toOnChainCreateLockParams,
  VAULT_NOT_DEPLOYED_MESSAGE,
} from '../vault';
import { VAULT_ADDRESSES } from '../chains';

const DAY = 86_400_000;
const NOW = Date.now();

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
    minReceiveUsd: 100,
    status: 'active',
    createdAt: NOW,
    ...over,
  };
}

describe('date unlock', () => {
  it('unlocks on the maturity date even with no price target', () => {
    const lock = makeLock({ targetPrice: null, targetMultiple: null, unlockTime: NOW - 1000 });
    expect(unlockReason(lock, NOW, null)).toBe('date');
  });

  it('does not unlock before the date when the target is unmet', () => {
    const lock = makeLock({ unlockTime: NOW + 30 * DAY });
    expect(unlockReason(lock, NOW, 0.03)).toBeNull();
  });

  it('unlocks exactly at the unlock timestamp', () => {
    const lock = makeLock({ targetPrice: null, targetMultiple: null, unlockTime: NOW });
    expect(unlockReason(lock, NOW, null)).toBe('date');
  });
});

describe('price unlock (TWAP guard)', () => {
  it('unlocks on price when the 30-min TWAP holds above target', () => {
    const lock = makeLock();
    expect(isPriceTargetHit(lock, 0.06)).toBe(true);
    expect(unlockReason(lock, NOW, 0.065)).toBe('price');
  });

  it('does NOT unlock on a one-tick wick — spot above target is not TWAP', () => {
    // A single high tick averaged into a 30-min window stays below target.
    const samples = Array.from({ length: 29 }, (_, i) => ({
      price: 0.03,
      at: NOW - (29 - i) * 60_000,
    }));
    samples.push({ price: 0.09, at: NOW }); // one-minute wick to 4.5x
    const twap = computeTwap(samples, 30);
    expect(twap).not.toBeNull();
    expect(twap!).toBeLessThan(0.06);
    const lock = makeLock();
    expect(isPriceTargetHit(lock, twap)).toBe(false);
  });

  it('unlocks when the TWAP genuinely holds above target', () => {
    const samples = Array.from({ length: 30 }, (_, i) => ({
      price: 0.065,
      at: NOW - (29 - i) * 60_000,
    }));
    const twap = computeTwap(samples, 30);
    expect(twap).toBeCloseTo(0.065, 4);
    expect(isPriceTargetHit(makeLock(), twap)).toBe(true);
  });

  it('price beats date: whichever comes first wins', () => {
    const lock = makeLock({ unlockTime: NOW + 300 * DAY });
    expect(unlockReason(lock, NOW, 0.07)).toBe('price');
  });

  it('pure date lock never triggers on price', () => {
    const lock = makeLock({ targetPrice: null, targetMultiple: null });
    expect(isPriceTargetHit(lock, 999)).toBe(false);
  });
});

describe('profit ladder', () => {
  it('sells stages in order as multiples are reached', () => {
    const lock = makeLock();
    expect(dueLadderStages(lock, 0.04).map((s) => s.multiple)).toEqual([2]);
    expect(dueLadderStages(lock, 0.06).map((s) => s.multiple)).toEqual([2, 3]);
    expect(dueLadderStages(lock, 0.21).map((s) => s.multiple)).toEqual([2, 3, 5, 10]);
  });

  it('skips already-sold stages', () => {
    const lock = makeLock({
      ladder: [
        { multiple: 2, percent: 25, status: 'sold', soldUsd: 100 },
        { multiple: 3, percent: 25, status: 'pending' },
      ],
    });
    expect(dueLadderStages(lock, 0.07).map((s) => s.multiple)).toEqual([3]);
  });

  it('rejects ladders that do not total 100%', () => {
    expect(
      validateLadder([
        { multiple: 2, percent: 25, status: 'pending' },
        { multiple: 3, percent: 50, status: 'pending' },
      ]),
    ).toMatch(/100%/);
    expect(
      validateLadder([
        { multiple: 2, percent: 50, status: 'pending' },
        { multiple: 3, percent: 50, status: 'pending' },
      ]),
    ).toBeNull();
  });

  it('target progress is 0 at entry and 1 at target', () => {
    const lock = makeLock();
    expect(targetProgress(lock, 0.02)).toBe(0);
    expect(targetProgress(lock, 0.04)).toBeCloseTo(0.5, 5);
    expect(targetProgress(lock, 0.06)).toBe(1);
    expect(targetProgress(lock, 0.2)).toBe(1);
  });
});

describe('trailing stop', () => {
  it('arms only after a target is hit, then fires on a 15% fall from peak', () => {
    const lock = makeLock({ peakPrice: 0.06 });
    expect(isTrailingStopBreached(lock, 0.05, false)).toBe(false); // not armed
    expect(isTrailingStopBreached(lock, 0.052, true)).toBe(false); // -13.3%
    expect(isTrailingStopBreached(lock, 0.051, true)).toBe(true); // -15%
    expect(isTrailingStopBreached(lock, 0.04, true)).toBe(true);
  });

  it('never fires when trailing stop is off', () => {
    const lock = makeLock({ trailingStopBps: null, peakPrice: 0.06 });
    expect(isTrailingStopBreached(lock, 0.01, true)).toBe(false);
  });

  it('peak only ever moves up', () => {
    const lock = makeLock({ peakPrice: 0.05 });
    expect(updatePeak(lock, 0.04).peakPrice).toBe(0.05);
    expect(updatePeak(lock, 0.07).peakPrice).toBe(0.07);
  });
});

describe('break penalty', () => {
  it('charges the agreed penalty on an early break with no trigger met', () => {
    const lock = makeLock({ penaltyBps: 500 }); // 5% of 10,000
    expect(breakPenaltyTokens(lock, NOW, 0.03)).toBe(500);
  });

  it('penalty is WAIVED when the price target is hit', () => {
    const lock = makeLock();
    expect(breakPenaltyTokens(lock, NOW, 0.07)).toBe(0);
  });

  it('penalty is WAIVED when the maturity date is reached', () => {
    const lock = makeLock({ unlockTime: NOW - 1000 });
    expect(breakPenaltyTokens(lock, NOW, 0.03)).toBe(0);
  });

  it('immutable locks cannot be broken at all', () => {
    const lock = makeLock({ breakMode: 'immutable' });
    expect(canBreak(lock)).toBe(false);
    expect(() => breakPenaltyTokens(lock, NOW, 0.03)).toThrow(/Immutable/);
  });

  it('guardian break has no token penalty', () => {
    const lock = makeLock({ breakMode: 'guardian' });
    expect(breakPenaltyTokens(lock, NOW, 0.03)).toBe(0);
  });
});

describe('exit guards', () => {
  it('minimum receive applies the 1.5% default slippage', () => {
    expect(minimumReceive(1000, 150)).toBeCloseTo(985, 5);
  });

  it('small stage vs deep pool passes the impact guard in one piece', () => {
    const r = priceImpactPieces(5000, 1_000_000, 500);
    expect(r.ok).toBe(true);
    expect(r.pieces).toBe(1);
  });

  it('large stage vs thin pool splits instead of dumping', () => {
    const r = priceImpactPieces(100_000, 500_000, 500);
    expect(r.ok).toBe(false);
    expect(r.pieces).toBeGreaterThan(1);
    expect(r.impactBps).toBeCloseTo(2000, 0);
  });

  it('failed swaps retry with backoff and stay locked', () => {
    expect(shouldRetrySwap({ attempt: 1, maxAttempts: 5 })).toBe(true);
    expect(shouldRetrySwap({ attempt: 5, maxAttempts: 5 })).toBe(false);
    expect(nextRetryDelayMs(1)).toBe(60_000);
    expect(nextRetryDelayMs(2)).toBe(120_000);
    expect(nextRetryDelayMs(10)).toBe(30 * 60_000); // capped
  });
});

describe('review copy and discipline score', () => {
  it('states the plain-English lock sentence with the exit stablecoin', () => {
    const s = lockSummarySentence(makeLock(), 'to USDT');
    expect(s).toContain('cannot be spent until');
    expect(s).toContain('3x');
    expect(s).toContain('to USDT');
  });

  it('pure date lock sentence has no target language', () => {
    const s = lockSummarySentence(makeLock({ targetPrice: null, targetMultiple: null }), 'to USDT');
    expect(s).not.toContain('unless');
  });

  it('discipline score rewards locking, streaks and completion', () => {
    const good = disciplineScore({ lockedRatio: 0.6, streakDays: 24, locksCompleted: 3, locksBroken: 0 });
    const bad = disciplineScore({ lockedRatio: 0.0, streakDays: 0, locksCompleted: 0, locksBroken: 2 });
    expect(good).toBeGreaterThan(bad);
    expect(good).toBeLessThanOrEqual(100);
  });
});

describe('TWAP guard (30-min window)', () => {
  it('returns null with no samples', () => {
    expect(computeTwap([], 30)).toBeNull();
  });

  it('ignores samples older than the window', () => {
    const samples = [
      { price: 999, at: NOW - 60 * 60_000 }, // 1h ago — outside 30m
      { price: 0.04, at: NOW - 10 * 60_000 },
      { price: 0.04, at: NOW },
    ];
    expect(computeTwap(samples, 30)).toBeCloseTo(0.04, 4);
  });

  it('a sustained price above target passes, a brief wick does not', () => {
    const lock = makeLock();
    const wick = Array.from({ length: 30 }, (_, i) => ({
      price: i === 29 ? 0.09 : 0.03,
      at: NOW - (29 - i) * 60_000,
    }));
    expect(isPriceTargetHit(lock, computeTwap(wick, 30))).toBe(false);
    const sustained = Array.from({ length: 30 }, (_, i) => ({
      price: 0.065,
      at: NOW - (29 - i) * 60_000,
    }));
    expect(isPriceTargetHit(lock, computeTwap(sustained, 30))).toBe(true);
  });
});

describe('on-chain vault — not deployed yet', () => {
  it('getUserLocksOnChain returns an empty list with the not-deployed note', async () => {
    const res = await getUserLocksOnChain('bnb', '0x0000000000000000000000000000000000000001');
    expect(res.deployed).toBe(false);
    expect(res.locks).toEqual([]);
    expect(res.lockIds).toEqual([]);
    expect(res.note).toBe(VAULT_NOT_DEPLOYED_MESSAGE);
  });

  it('mainnet chain with no vault refuses locks honestly after a Mainnet mode flip', async () => {
    // The admin mode switch never deploys a vault: Arc Mainnet (5042)
    // has no vault registered, so locks still refuse with the
    // not-deployed note — the mode flip alone makes nothing go live.
    const res = await getUserLocksOnChain('arc-mainnet', '0x0000000000000000000000000000000000000001');
    expect(res.deployed).toBe(false);
    expect(res.locks).toEqual([]);
    expect(res.note).toBe(VAULT_NOT_DEPLOYED_MESSAGE);
    const fakeSigner = {} as never;
    await expect(
      createLockOnChain(fakeSigner, {
        chainId: 'arc-mainnet',
        tokenAddress: '0xabc',
        tokenDecimals: 18,
        stablecoinAddress: '0xdef',
        amount: 100,
        unlockTime: NOW + 30 * 86_400_000,
        entryPriceUsd: 0.02,
        ladder: [{ multiple: 2, percent: 100 }],
        trailingStopBps: null,
        breakMode: 'penalty',
        penaltyBps: 500,
        autoSell: true,
        slippageBps: 150,
        minReceiveUsd: 0,
      }),
    ).rejects.toThrow(/Not deployed on this chain yet/);
  });

  it('an admin-registered vault address wins over the built-in registry; a blank override does not', () => {
    const MOCK = '0x7777777777777777777777777777777777777777';
    expect(resolveVaultAddress('bnb', MOCK)).toBe(MOCK);
    expect(resolveVaultAddress('bnb', '  ' + MOCK + '  ')).toBe(MOCK);
    expect(() => resolveVaultAddress('bnb', null)).toThrow(/Not deployed on this chain yet/);
    expect(() => resolveVaultAddress('bnb', '')).toThrow(/Not deployed on this chain yet/);
    expect(() => resolveVaultAddress('bnb', 'not-an-address')).toThrow(/Not deployed on this chain yet/);
  });

  it('createLockOnChain refuses when the vault is not deployed (no tx sent)', async () => {
    const fakeSigner = {} as never;
    await expect(
      createLockOnChain(fakeSigner, {
        chainId: 'bnb',
        tokenAddress: '0xabc',
        tokenDecimals: 18,
        stablecoinAddress: '0xdef',
        amount: 100,
        unlockTime: NOW + 30 * 86_400_000,
        entryPriceUsd: 0.02,
        ladder: [{ multiple: 2, percent: 100 }],
        trailingStopBps: null,
        breakMode: 'penalty',
        penaltyBps: 500,
        autoSell: true,
        slippageBps: 150,
        minReceiveUsd: 0,
      }),
    ).rejects.toThrow(/Not deployed on this chain yet/);
  });

  it('toOnChainCreateLockParams rejects a ladder over 100% and a bad penalty', () => {
    const base = {
      chainId: 'bnb',
      tokenAddress: '0xabc',
      tokenDecimals: 18,
      stablecoinAddress: '0xdef',
      amount: 100,
      unlockTime: NOW + 30 * 86_400_000,
      entryPriceUsd: 0.02,
      trailingStopBps: null,
      breakMode: 'penalty' as const,
      penaltyBps: 500,
      autoSell: true,
      slippageBps: 150,
      minReceiveUsd: 0,
    };
    expect(() =>
      toOnChainCreateLockParams({ ...base, ladder: [{ multiple: 2, percent: 60 }, { multiple: 3, percent: 50 }] }),
    ).toThrow(/100%/);
    expect(() =>
      toOnChainCreateLockParams({ ...base, ladder: [{ multiple: 2, percent: 100 }], penaltyBps: 100 }),
    ).toThrow(/5–10%/);
    const ok = toOnChainCreateLockParams({ ...base, ladder: [{ multiple: 2, percent: 25 }, { multiple: 3, percent: 75 }] });
    expect(ok.ladderStages).toHaveLength(2);
    expect(ok.ladderStages[0].sellBps).toBe(2500);
    expect(ok.ladderStages[1].sellBps).toBe(7500);
  });
});

describe('on-chain vault — all calls refuse while nothing is deployed', () => {
  const fakeSigner = {} as never;

  it.each([
    ['claimMatured', () => claimMaturedOnChain(fakeSigner, 'bnb', 1)],
    ['claimTriggeredStage', () => claimTriggeredStageOnChain(fakeSigner, 'bnb', 1, 0)],
    ['requestBreak', () => requestBreakOnChain(fakeSigner, 'bnb', 1)],
    ['executeBreak', () => executeBreakOnChain(fakeSigner, 'bnb', 1)],
    ['executeTrigger', () => executeTriggerOnChain(fakeSigner, 'bnb', 1)],
  ])('%s throws the not-deployed message (no tx sent)', async (_name, fn) => {
    await expect(fn()).rejects.toThrow(/Not deployed on this chain yet/);
  });

  it('parseOnChainLockId parses on-chain ids and rejects local ones', () => {
    expect(parseOnChainLockId('onchain-bnb-42')).toEqual({ chainId: 'bnb', lockId: 42 });
    expect(parseOnChainLockId('onchain-arc-7')).toEqual({ chainId: 'arc', lockId: 7 });
    expect(parseOnChainLockId('LCK-123')).toBeNull();
    expect(parseOnChainLockId('')).toBeNull();
  });
});

describe('on-chain vault — wiring against a mock registered address', () => {
  // No vault is deployed yet (VAULT_ADDRESSES is all null in the real
  // registry). These tests register a MOCK address in the in-memory
  // registry for the duration of the test only, to prove the wiring
  // (approve -> createLock, claim, break, trigger) calls the contract
  // correctly. The mock address is never written to chains.ts.
  const MOCK_VAULT = '0x7777777777777777777777777777777777777777';
  const MOCK_TOKEN = '0x8888888888888888888888888888888888888888';
  const MOCK_STABLE = '0x9999999999999999999999999999999999999999';
  const FAKE_HASH = `0x${'ef'.repeat(32)}`;

  beforeEach(() => {
    VAULT_ADDRESSES['bnb'] = MOCK_VAULT;
  });
  afterEach(() => {
    VAULT_ADDRESSES['bnb'] = null;
  });

  function makeFakeSigner() {
    const sent: { to: string; data: string }[] = [];
    const signer = {
      getAddress: async () => '0x1111111111111111111111111111111111111111',
      provider: {
        call: async () => '0x',
        getTransactionReceipt: async (hash: string) => ({
          hash,
          blockNumber: 789,
          blockHash: `0x${'00'.repeat(32)}`,
          index: 0,
          from: '0x1111111111111111111111111111111111111111',
          to: MOCK_VAULT,
          contractAddress: null,
          gasUsed: 100_000n,
          cumulativeGasUsed: 100_000n,
          gasPrice: 1_000_000_000n,
          status: 1,
          logs: [],
          type: 2,
        }),
      },
      call: async () => '0x',
      sendTransaction: async (tx: { to: string; data: string }) => {
        sent.push(tx);
        return {
          hash: FAKE_HASH,
          wait: async () => ({ hash: FAKE_HASH, blockNumber: 789, logs: [] }),
        };
      },
    };
    return { signer: signer as never, sent };
  }

  const params = {
    chainId: 'bnb',
    tokenAddress: MOCK_TOKEN,
    tokenDecimals: 18,
    stablecoinAddress: MOCK_STABLE,
    amount: 100,
    unlockTime: NOW + 30 * 86_400_000,
    entryPriceUsd: 0.02,
    ladder: [{ multiple: 2, percent: 100 }],
    trailingStopBps: null,
    breakMode: 'penalty' as const,
    penaltyBps: 500,
    autoSell: true,
    slippageBps: 150,
    minReceiveUsd: 0,
  };

  it('createLockOnChain approves the vault then calls createLock', async () => {
    const { signer, sent } = makeFakeSigner();
    const res = await createLockOnChain(signer, params);
    expect(res.txHash).toBe(FAKE_HASH);
    expect(res.lockId).toBeNull(); // no Locked event in the fake receipt
    expect(sent).toHaveLength(2);
    expect(sent[0].to).toBe(MOCK_TOKEN); // approve
    const approveIface = new ethers.Interface(['function approve(address spender, uint256 amount) returns (bool)']);
    expect(approveIface.decodeFunctionData('approve', sent[0].data).spender).toBe(MOCK_VAULT);
    expect(sent[1].to).toBe(MOCK_VAULT); // createLock
    const vaultIface = new ethers.Interface([
      'function createLock((address token, uint256 amount, uint256 unlockTime, uint256 entryPrice, (uint256 targetPrice, uint16 sellBps, bool sold)[] ladderStages, uint16 trailingStopBps, uint8 breakMode, uint16 penaltyBps, bool autoSell, address stablecoin, uint16 slippageBps, uint256 minReceivePerStage) params) returns (uint256 lockId)',
    ]);
    const decoded = vaultIface.decodeFunctionData('createLock', sent[1].data);
    expect(decoded.params.token).toBe(MOCK_TOKEN);
    expect(decoded.params.amount).toBe(ethers.parseUnits('100', 18));
    expect(decoded.params.stablecoin).toBe(MOCK_STABLE);
  });

  it('claim / break / trigger calls hit the mock vault address', async () => {
    const { signer, sent } = makeFakeSigner();
    const claimHash = await claimMaturedOnChain(signer, 'bnb', 3);
    expect(claimHash).toBe(FAKE_HASH);
    expect(sent[0].to).toBe(MOCK_VAULT);
    const stageHash = await claimTriggeredStageOnChain(signer, 'bnb', 3, 0);
    expect(stageHash).toBe(FAKE_HASH);
    const breakHash = await requestBreakOnChain(signer, 'bnb', 3);
    expect(breakHash).toBe(FAKE_HASH);
    const execHash = await executeBreakOnChain(signer, 'bnb', 3);
    expect(execHash).toBe(FAKE_HASH);
    const triggerHash = await executeTriggerOnChain(signer, 'bnb', 3);
    expect(triggerHash).toBe(FAKE_HASH);
    expect(sent).toHaveLength(5);
    expect(sent.map((s) => s.to)).toEqual(Array(5).fill(MOCK_VAULT));
  });
});
