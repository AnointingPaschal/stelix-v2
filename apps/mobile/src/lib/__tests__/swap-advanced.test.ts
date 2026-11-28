/**
 * Advanced swap — zero-balance behaviour and the swap token catalogue.
 * Pure logic only (no RN imports), following the existing suite pattern.
 */
import { getSwapCatalogue, mergeSwapTokens, swapButtonState, swapShortfall } from '../swapTokens';
import type { TokenBalance } from '../balances';

function ownedToken(over: Partial<TokenBalance> = {}): TokenBalance {
  return {
    symbol: 'GTAN',
    name: 'Giant Token',
    chainId: 'bnb',
    address: '0x0000000000000000000000000000000000000001',
    decimals: 18,
    balance: 10,
    balanceRaw: '10000000000000000000',
    locked: 0,
    priceUsd: 0.5,
    price: 0.5,
    priceSource: 'dexscreener',
    priceUpdatedAt: Date.now(),
    logoUrl: null,
    isSpam: false,
    ...over,
  };
}

describe('swap catalogue', () => {
  it('lists the native asset first on every chain', () => {
    for (const chainId of ['arc-mainnet', 'bnb', 'base', 'ethereum', 'polygon', 'solana']) {
      const cat = getSwapCatalogue(chainId);
      expect(cat.length).toBeGreaterThan(0);
      expect(cat[0].address).toBe(''); // native asset
    }
  });

  it('Arc lists only USDC — no unverified Arc token is invented', () => {
    expect(getSwapCatalogue('arc-mainnet').map((t) => t.symbol)).toEqual(['USDC']);
  });

  it('BNB lists BNB, WBNB, USDT and USDC with the canonical addresses', () => {
    const bySymbol = Object.fromEntries(getSwapCatalogue('bnb').map((t) => [t.symbol, t.address]));
    expect(bySymbol.WBNB).toBe('0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c');
    expect(bySymbol.USDT).toBe('0x55d398326f99059fF775485246999027B3197955');
    expect(bySymbol.USDC).toBe('0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d');
  });
});

describe('mergeSwapTokens — browsable with a $0 wallet', () => {
  it('returns catalogue rows with 0 balance when the wallet owns nothing', () => {
    const merged = mergeSwapTokens('bnb', []);
    expect(merged.length).toBeGreaterThan(0);
    expect(merged.every((t) => t.balance === 0)).toBe(true);
    expect(merged.map((t) => t.symbol)).toContain('USDT');
  });

  it('owned tokens win on symbol and keep their real balance and price', () => {
    const merged = mergeSwapTokens('bnb', [ownedToken({ symbol: 'USDT', balance: 25, price: 1, priceUsd: 1, address: '0x55d398326f99059fF775485246999027B3197955' })]);
    const usdt = merged.find((t) => t.symbol === 'USDT');
    expect(usdt?.balance).toBe(25);
    expect(usdt?.price).toBe(1);
    expect(merged.filter((t) => t.symbol === 'USDT')).toHaveLength(1);
  });

  it('imported tokens not in the catalogue are added', () => {
    const merged = mergeSwapTokens('bnb', [ownedToken()]);
    expect(merged.map((t) => t.symbol)).toContain('GTAN');
  });

  it('spam tokens are excluded', () => {
    const merged = mergeSwapTokens('bnb', [ownedToken({ isSpam: true })]);
    expect(merged.map((t) => t.symbol)).not.toContain('GTAN');
  });
});

describe('swapShortfall / swapButtonState — zero-balance UX', () => {
  it('shortfall is 0 when the balance covers the amount', () => {
    expect(swapShortfall(5, 2)).toBe(0);
  });

  it('shortfall is the exact missing amount', () => {
    expect(swapShortfall(0, 0.5)).toBe(0.5);
    expect(swapShortfall(0.2, 1)).toBeCloseTo(0.8);
  });

  it('with $0 balance the button names the short token and amount', () => {
    const s = swapButtonState({
      amount: 0.5, balance: 0, fromSymbol: 'BNB',
      hasQuote: true, quoteLive: true, executing: false, chainSwapNote: null,
    });
    expect(s.disabled).toBe(true);
    expect(s.label).toBe('Insufficient balance — short 0.5 BNB');
  });

  it('with a partial balance the button names the shortfall, not a blank error', () => {
    const s = swapButtonState({
      amount: 1, balance: 0.2, fromSymbol: 'BNB',
      hasQuote: true, quoteLive: true, executing: false, chainSwapNote: null,
    });
    expect(s.disabled).toBe(true);
    expect(s.label).toContain('short 0.8 BNB');
  });

  it('with balance and a live quote the button offers Review Swap', () => {
    const s = swapButtonState({
      amount: 0.5, balance: 2, fromSymbol: 'BNB',
      hasQuote: true, quoteLive: true, executing: false, chainSwapNote: null,
    });
    expect(s).toEqual({ label: 'Review Swap', disabled: false });
  });

  it('with no amount entered the button says Enter Amount', () => {
    const s = swapButtonState({
      amount: 0, balance: 0, fromSymbol: 'BNB',
      hasQuote: false, quoteLive: false, executing: false, chainSwapNote: null,
    });
    expect(s).toEqual({ label: 'Enter Amount', disabled: true });
  });

  it('an unavailable chain (Arc / Solana) disables the button with the honest reason', () => {
    const s = swapButtonState({
      amount: 0.5, balance: 2, fromSymbol: 'USDC',
      hasQuote: false, quoteLive: false, executing: false,
      chainSwapNote: 'Swaps unavailable on Arc — no router verified',
    });
    expect(s.disabled).toBe(true);
    expect(s.label).toBe('Swaps unavailable on Arc — no router verified');
  });
});
