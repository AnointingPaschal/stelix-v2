/** Swap quotes — no key + non-BNB chain must fail clearly, never fake a quote. */
import { ethers } from 'ethers';
import {
  executeSwap,
  getSwapQuote,
  pancakeSwapPath,
  PANCAKESWAP_V2_ROUTER,
  SwapExecutionUnavailableError,
  SwapQuoteUnavailableError,
  WBNB_ADDRESS,
  type SwapQuote,
} from '../swap';

const USDT_BNB = '0x55d398326f99059fF775485246999027B3197955';
const WBNB = WBNB_ADDRESS;

function makeQuote(over: Partial<SwapQuote> = {}): SwapQuote {
  return {
    chainId: 'bnb',
    fromTokenAddress: WBNB,
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

describe('pancakeSwapPath', () => {
  it('routes native via WBNB', () => {
    expect(pancakeSwapPath('', USDT_BNB)).toEqual([WBNB, USDT_BNB]);
    expect(pancakeSwapPath(USDT_BNB, '')).toEqual([USDT_BNB, WBNB]);
  });

  it('routes token-to-token via WBNB', () => {
    expect(pancakeSwapPath(USDT_BNB, '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d')).toEqual([
      USDT_BNB,
      WBNB,
      '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    ]);
  });

  it('rejects same-token swaps', () => {
    expect(() => pancakeSwapPath(USDT_BNB, USDT_BNB)).toThrow(/same token/);
  });
});

describe('executeSwap refusals — never a fake swap', () => {
  const fakeSigner = {} as never;

  it('refuses a stale quote (older than 5 minutes)', async () => {
    await expect(
      executeSwap(fakeSigner, makeQuote({ quotedAt: Date.now() - 6 * 60_000 })),
    ).rejects.toThrow(/stale/);
  });

  it('refuses Arc — router not confirmed on testnet', async () => {
    await expect(
      executeSwap(
        fakeSigner,
        makeQuote({ chainId: 'arc', fromTokenAddress: '0x3600000000000000000000000000000000000000', toTokenAddress: USDT_BNB }),
      ),
    ).rejects.toThrow(/no DEX router address has been verified on Arc testnet/i);
  });

  it('refuses Solana — no EVM execution path', async () => {
    await expect(
      executeSwap(fakeSigner, makeQuote({ chainId: 'solana' })),
    ).rejects.toThrow(/Solana swaps are not wired/);
  });

  it('refuses a chain with no router and no 1inch key', async () => {
    expect(process.env.EXPO_PUBLIC_ONEINCH_API_KEY).toBeUndefined();
    await expect(
      executeSwap(fakeSigner, makeQuote({ chainId: 'polygon' })),
    ).rejects.toThrow(/No DEX router is confirmed for Polygon/);
  });
});

describe('executeSwap on BNB (fake signer + fake provider)', () => {
  const FROM = '0x1111111111111111111111111111111111111111';
  const FAKE_HASH = `0x${'cd'.repeat(32)}`;

  function makeFakeSigner() {
    const sent: Record<string, unknown>[] = [];
    const provider = {
      getTransactionReceipt: async (hash: string) => ({
        hash,
        blockNumber: 456,
        blockHash: `0x${'00'.repeat(32)}`,
        index: 0,
        from: FROM,
        to: PANCAKESWAP_V2_ROUTER,
        contractAddress: null,
        gasUsed: 100_000n,
        cumulativeGasUsed: 100_000n,
        gasPrice: 1_000_000_000n,
        status: 1,
        logs: [],
        type: 2,
      }),
      call: async (tx: { data?: string }) => {
        // allowance(address,address) selector 0xdd62ed3e -> max allowance
        if (tx.data?.startsWith('0xdd62ed3e')) {
          return ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [ethers.MaxUint256]);
        }
        return '0x';
      },
    };
    const signer = {
      getAddress: async () => FROM,
      provider,
      call: async (tx: { data?: string }) => provider.call(tx),
      sendTransaction: async (tx: Record<string, unknown>) => {
        sent.push(tx);
        return { hash: FAKE_HASH, wait: async () => ({ hash: FAKE_HASH, blockNumber: 456 }) };
      },
    };
    return { signer: signer as never, sent };
  }

  it('swaps BNB -> USDT via swapExactETHForTokens with min-receive + deadline', async () => {
    const { signer, sent } = makeFakeSigner();
    const quote = makeQuote({ fromTokenAddress: '' }); // native BNB in
    const res = await executeSwap(signer, quote);
    expect(res.hash).toBe(FAKE_HASH);
    expect(res.blockNumber).toBe(456);
    expect(res.approveHash).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(PANCAKESWAP_V2_ROUTER);
    expect(sent[0].value).toBe(BigInt(quote.amountIn));
    const iface = new ethers.Interface([
      'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
    ]);
    const decoded = iface.decodeFunctionData('swapExactETHForTokens', sent[0].data as string);
    expect(decoded.amountOutMin).toBe(BigInt(quote.minReceive));
    expect(decoded.path).toEqual([WBNB, USDT_BNB]);
    expect(decoded.to).toBe(FROM);
    expect(Number(decoded.deadline)).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('swaps USDT -> BNB via swapExactTokensForETH (no approve when allowance is max)', async () => {
    const { signer, sent } = makeFakeSigner();
    const quote = makeQuote({ fromTokenAddress: USDT_BNB, toTokenAddress: '' });
    const res = await executeSwap(signer, quote);
    expect(res.hash).toBe(FAKE_HASH);
    expect(res.approveHash).toBeNull();
    expect(sent).toHaveLength(1); // no approve tx sent
    const iface = new ethers.Interface([
      'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
    ]);
    const decoded = iface.decodeFunctionData('swapExactTokensForETH', sent[0].data as string);
    expect(decoded.amountIn).toBe(BigInt(quote.amountIn));
    expect(decoded.amountOutMin).toBe(BigInt(quote.minReceive));
    expect(decoded.path).toEqual([USDT_BNB, WBNB]);
  });
});

describe('swap quotes', () => {
  it('throws a clear no-quote error on Ethereum with no 1inch key set', async () => {
    expect(process.env.EXPO_PUBLIC_ONEINCH_API_KEY).toBeUndefined();
    await expect(
      getSwapQuote({
        chainId: 'ethereum',
        fromTokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        toTokenAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        amountIn: 0.5,
        fromDecimals: 18,
        toDecimals: 6,
      }),
    ).rejects.toThrow(SwapQuoteUnavailableError);
    await expect(
      getSwapQuote({
        chainId: 'ethereum',
        fromTokenAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        toTokenAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        amountIn: 0.5,
        fromDecimals: 18,
        toDecimals: 6,
      }),
    ).rejects.toThrow(/No live swap quote available/);
  });

  it('rejects a zero amount', async () => {
    await expect(
      getSwapQuote({
        chainId: 'bnb',
        fromTokenAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        toTokenAddress: '0x55d398326f99059fF775485246999027B3197955',
        amountIn: 0,
        fromDecimals: 18,
        toDecimals: 18,
      }),
    ).rejects.toThrow(/greater than 0/);
  });
});
