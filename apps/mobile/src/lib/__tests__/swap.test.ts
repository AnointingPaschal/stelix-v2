/** Swap quotes — no key + non-BNB chain must fail clearly, never fake a quote. */
import { getSwapQuote, SwapQuoteUnavailableError } from '../swap';

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
