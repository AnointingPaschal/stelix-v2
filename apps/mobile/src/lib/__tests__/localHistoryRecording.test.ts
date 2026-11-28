/**
 * Phase B — recording at signing sites: every app-signed broadcast
 * lands in the local history ledger, and nothing is recorded when the
 * broadcast never happens (validation failure, refused quote, signer
 * rejection / cancelled signing).
 *
 * Fake signers return a DISTINCT hash per broadcast so an approve +
 * its follow-on tx do not collapse into one record (recordLocalTx
 * dedupes by hash within a scope — as it should for a real re-record).
 */
import { ethers } from 'ethers';
import { sendToken, type SendRequest } from '../send';
import {
  executeSwap,
  PANCAKESWAP_V2_ROUTER,
  WBNB_ADDRESS,
  type SwapQuote,
} from '../swap';
import {
  claimMaturedOnChain,
  claimTriggeredStageOnChain,
  createLockOnChain,
  executeBreakOnChain,
  requestBreakOnChain,
} from '../vault';
import { VAULT_ADDRESSES } from '../chains';
import {
  clearAllLocalHistory,
  listLocalTxs,
} from '../localHistory';

const FROM = '0x1111111111111111111111111111111111111111';
const TO = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const MOCK_VAULT = '0x7777777777777777777777777777777777777777';
const MOCK_TOKEN = '0x8888888888888888888888888888888888888888';
const MOCK_STABLE = '0x9999999999999999999999999999999999999999';
const USDT_BNB = '0x55d398326f99059fF775485246999027B3197955';

let hashSeq = 0;
function nextHash(): string {
  hashSeq += 1;
  return `0x${hashSeq.toString(16).padStart(64, '0')}`;
}

beforeEach(async () => {
  await clearAllLocalHistory();
  hashSeq = 0;
});

/** Fake signer whose sendTransaction returns a fresh hash per call. */
function makeCountingSigner(provider?: Record<string, unknown>) {
  const sent: Record<string, unknown>[] = [];
  const signer = {
    getAddress: async () => FROM,
    provider,
    call: async (tx: { data?: string }) =>
      (provider as { call?: (tx: { data?: string }) => Promise<string> } | undefined)?.call?.(tx) ?? '0x',
    sendTransaction: async (tx: Record<string, unknown>) => {
      sent.push(tx);
      const hash = nextHash();
      return { hash, wait: async () => ({ hash, blockNumber: 123, logs: [] }) };
    },
  };
  return { signer: signer as never, sent };
}

describe('sendToken records on broadcast only', () => {
  function makeSendProvider(tokenBalance: bigint) {
    return {
      getBalance: async () => ethers.parseEther('10'),
      estimateGas: async () => 21_000n,
      getFeeData: async () => ({ gasPrice: 1_000_000_000n, maxFeePerGas: null, maxPriorityFeePerGas: null }),
      call: async (tx: { data?: string }) => {
        if (tx.data?.startsWith('0x70a08231')) {
          return ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [tokenBalance]);
        }
        return '0x';
      },
    };
  }

  const nativeReq: SendRequest = {
    chainId: 'bnb', tokenAddress: '', tokenSymbol: 'BNB', tokenDecimals: 18, to: TO, amount: 0.5,
  };
  const tokenReq: SendRequest = {
    chainId: 'bnb', tokenAddress: TOKEN, tokenSymbol: 'USDT', tokenDecimals: 6, to: TO, amount: 10,
  };

  it('records a native send as pending with the right fields', async () => {
    const { signer } = makeCountingSigner(makeSendProvider(100n));
    const res = await sendToken(signer, nativeReq);
    const txs = await listLocalTxs(FROM, 'bnb');
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      hash: res.hash,
      type: 'send',
      tokenSymbol: 'BNB',
      tokenAddress: null,
      amount: '0.5',
      amountRaw: ethers.parseEther('0.5').toString(),
      from: FROM,
      to: TO,
      status: 'pending',
    });
  });

  it('records a token send with the token address and raw amount', async () => {
    const { signer } = makeCountingSigner(makeSendProvider(ethers.parseUnits('100', 6)));
    const res = await sendToken(signer, tokenReq);
    const txs = await listLocalTxs(FROM, 'bnb');
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      hash: res.hash,
      type: 'send',
      tokenSymbol: 'USDT',
      tokenAddress: TOKEN,
      amount: '10',
      amountRaw: ethers.parseUnits('10', 6).toString(),
    });
  });

  it('records nothing when validation rejects the send', async () => {
    const { signer } = makeCountingSigner(makeSendProvider(100n));
    await expect(sendToken(signer, { ...nativeReq, to: 'not-an-address' })).rejects.toThrow();
    expect(await listLocalTxs(FROM, 'bnb')).toHaveLength(0);
  });

  it('records nothing when the signer rejects / broadcast throws', async () => {
    const signer = {
      getAddress: async () => FROM,
      provider: makeSendProvider(100n),
      sendTransaction: async () => {
        throw new Error('user rejected');
      },
    } as never;
    await expect(sendToken(signer, nativeReq)).rejects.toThrow(/user rejected/);
    expect(await listLocalTxs(FROM, 'bnb')).toHaveLength(0);
  });
});

describe('executeSwap records on broadcast only', () => {
  function makeQuote(over: Partial<SwapQuote> = {}): SwapQuote {
    return {
      chainId: 'bnb',
      fromTokenAddress: WBNB_ADDRESS,
      toTokenAddress: USDT_BNB,
      amountIn: ethers.parseEther('0.1').toString(),
      amountOut: '60000000',
      amountOutHuman: 60,
      minReceive: '59100000',
      minReceiveHuman: 59.1,
      priceImpactBps: null,
      slippageBps: 150,
      source: 'pancakeswap',
      quotedAt: Date.now(),
      ...over,
    };
  }

  function makeSwapSigner(allowance: bigint) {
    const provider = {
      getTransactionReceipt: async (hash: string) => ({
        hash, blockNumber: 456, blockHash: `0x${'00'.repeat(32)}`, index: 0,
        from: FROM, to: PANCAKESWAP_V2_ROUTER, contractAddress: null,
        gasUsed: 100_000n, cumulativeGasUsed: 100_000n, gasPrice: 1_000_000_000n,
        status: 1, logs: [], type: 2,
      }),
      call: async (tx: { data?: string }) => {
        if (tx.data?.startsWith('0xdd62ed3e')) {
          return ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [allowance]);
        }
        return '0x';
      },
    };
    return makeCountingSigner(provider);
  }

  it('records a BNB -> token swap, no approve tx', async () => {
    const { signer } = makeSwapSigner(ethers.MaxUint256);
    const res = await executeSwap(signer, makeQuote({ fromTokenAddress: '' }), {
      fromSymbol: 'BNB', toSymbol: 'USDT', amountInHuman: '0.1',
    });
    const txs = await listLocalTxs(FROM, 'bnb');
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      hash: res.hash,
      type: 'swap',
      tokenSymbol: 'BNB',
      tokenAddress: null,
      amount: '0.1',
      amountRaw: ethers.parseEther('0.1').toString(),
      to: PANCAKESWAP_V2_ROUTER,
      status: 'pending',
    });
  });

  it('records the approve AND the swap when the allowance is short', async () => {
    const { signer } = makeSwapSigner(0n);
    const res = await executeSwap(signer, makeQuote({ fromTokenAddress: USDT_BNB, toTokenAddress: '' }), {
      fromSymbol: 'USDT', toSymbol: 'BNB', amountInHuman: '60',
    });
    expect(res.approveHash).not.toBeNull();
    const txs = await listLocalTxs(FROM, 'bnb');
    expect(txs).toHaveLength(2);
    const byType = Object.fromEntries(txs.map((t) => [t.type, t]));
    expect(byType.approve).toMatchObject({
      hash: res.approveHash,
      tokenSymbol: 'USDT',
      tokenAddress: USDT_BNB,
      amount: '60',
      to: PANCAKESWAP_V2_ROUTER,
    });
    expect(byType.swap).toMatchObject({ hash: res.hash, tokenSymbol: 'USDT', amount: '60' });
  });

  it('records nothing when the quote is stale and the swap is refused', async () => {
    const { signer } = makeSwapSigner(ethers.MaxUint256);
    await expect(
      executeSwap(signer, makeQuote({ quotedAt: Date.now() - 6 * 60_000 })),
    ).rejects.toThrow(/stale/);
    expect(await listLocalTxs(FROM, 'bnb')).toHaveLength(0);
  });
});

describe('vault on-chain calls record on broadcast only', () => {
  const lockParams = {
    chainId: 'bnb',
    tokenAddress: MOCK_TOKEN,
    tokenSymbol: 'BSCT',
    tokenDecimals: 18,
    stablecoinAddress: MOCK_STABLE,
    amount: 100,
    unlockTime: Date.now() + 30 * 86_400_000,
    entryPriceUsd: 0.02,
    ladder: [{ multiple: 2, percent: 100 }],
    trailingStopBps: null,
    breakMode: 'penalty' as const,
    penaltyBps: 500,
    autoSell: true,
    slippageBps: 150,
    minReceiveUsd: 0,
  };
  const meta = {
    tokenSymbol: 'BSCT',
    tokenAddress: MOCK_TOKEN,
    amount: 100,
    tokenDecimals: 18,
  };

  beforeEach(() => {
    VAULT_ADDRESSES['bnb'] = MOCK_VAULT;
  });
  afterEach(() => {
    VAULT_ADDRESSES['bnb'] = null;
  });

  /** Vault contract calls resolve tx.wait() through the signer provider. */
  function makeVaultSigner() {
    const provider = {
      call: async () => '0x',
      getTransactionReceipt: async (hash: string) => ({
        hash,
        blockNumber: 789,
        blockHash: `0x${'00'.repeat(32)}`,
        index: 0,
        from: FROM,
        to: MOCK_VAULT,
        contractAddress: null,
        gasUsed: 100_000n,
        cumulativeGasUsed: 100_000n,
        gasPrice: 1_000_000_000n,
        status: 1,
        logs: [],
        type: 2,
      }),
    };
    return makeCountingSigner(provider);
  }

  it('createLock records the approve and the lock', async () => {
    const { signer } = makeVaultSigner();
    const res = await createLockOnChain(signer, lockParams);
    const txs = await listLocalTxs(FROM, 'bnb');
    expect(txs).toHaveLength(2);
    const byType = Object.fromEntries(txs.map((t) => [t.type, t]));
    expect(byType.approve).toMatchObject({
      tokenSymbol: 'BSCT',
      tokenAddress: MOCK_TOKEN,
      amount: '100',
      amountRaw: ethers.parseUnits('100', 18).toString(),
      to: MOCK_VAULT,
    });
    expect(byType.lock).toMatchObject({
      hash: res.txHash,
      tokenSymbol: 'BSCT',
      amount: '100',
      to: MOCK_VAULT,
    });
  });

  it('createLock records nothing when the vault is not deployed', async () => {
    VAULT_ADDRESSES['bnb'] = null;
    const { signer } = makeVaultSigner();
    await expect(createLockOnChain(signer, lockParams)).rejects.toThrow(/Not deployed/);
    expect(await listLocalTxs(FROM, 'bnb')).toHaveLength(0);
  });

  it('claimMatured records a claim with the meta amount', async () => {
    const { signer } = makeVaultSigner();
    const hash = await claimMaturedOnChain(signer, 'bnb', 3, null, { ...meta, type: 'claim' });
    const txs = await listLocalTxs(FROM, 'bnb');
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      hash, type: 'claim', tokenSymbol: 'BSCT', amount: '100',
      amountRaw: ethers.parseUnits('100', 18).toString(), to: MOCK_VAULT,
    });
  });

  it('claimTriggeredStage records a claim for the stage amount', async () => {
    const { signer } = makeVaultSigner();
    const hash = await claimTriggeredStageOnChain(signer, 'bnb', 3, 0, null, {
      ...meta, type: 'claim', amount: 50,
    });
    const txs = await listLocalTxs(FROM, 'bnb');
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ hash, type: 'claim', amount: '50' });
  });

  it('requestBreak records a break with amount 0 (no tokens move yet)', async () => {
    const { signer } = makeVaultSigner();
    const hash = await requestBreakOnChain(signer, 'bnb', 3, null, { ...meta, type: 'break', amount: 0 });
    const txs = await listLocalTxs(FROM, 'bnb');
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ hash, type: 'break', amount: '0', amountRaw: '0' });
  });

  it('executeBreak records a break for the amount received', async () => {
    const { signer } = makeVaultSigner();
    const hash = await executeBreakOnChain(signer, 'bnb', 3, null, { ...meta, type: 'break', amount: 95 });
    const txs = await listLocalTxs(FROM, 'bnb');
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ hash, type: 'break', amount: '95' });
  });

  it('a vault call without meta still executes but records nothing', async () => {
    const { signer } = makeVaultSigner();
    const hash = await claimMaturedOnChain(signer, 'bnb', 3);
    expect(hash).toBeTruthy();
    expect(await listLocalTxs(FROM, 'bnb')).toHaveLength(0);
  });

  it('a vault call that is refused records nothing', async () => {
    VAULT_ADDRESSES['bnb'] = null;
    const { signer } = makeVaultSigner();
    await expect(
      claimMaturedOnChain(signer, 'bnb', 3, null, { ...meta, type: 'claim' }),
    ).rejects.toThrow(/Not deployed/);
    expect(await listLocalTxs(FROM, 'bnb')).toHaveLength(0);
  });
});
