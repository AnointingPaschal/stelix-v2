/**
 * Swap token catalogue + zero-balance swap helpers (pure — unit-tested).
 *
 * The swap page must work as a full experience even when the wallet holds
 * $0 / 0 tokens: the user can still browse tokens, see live quotes and the
 * pair chart. The wallet's imported-token list is EMPTY by default (see
 * lib/balances.ts), so the pickers cannot rely on owned tokens alone.
 * This catalogue lists the well-known, verified tokens per chain that
 * anyone can swap between — native asset first, then the wrapped native
 * and the major stablecoins. Addresses are the canonical deployments
 * (WBNB / USDT / USDC / WETH / WMATIC); a token not listed here can still
 * be swapped once the user imports it by address — importing adds it to
 * the owned list, which is merged over the catalogue below.
 *
 * Arc lists only USDC (its native gas asset): no other Arc token
 * address is verified, and swaps on Arc refuse honestly anyway
 * (no DEX router confirmed on Arc — see lib/swap.ts).
 */
import type { TokenBalance } from './balances';
import { COINGECKO_IDS_BY_SYMBOL } from './prices';

export interface SwapTokenEntry {
  symbol: string;
  name: string;
  chainId: string;
  /** '' = the chain's native asset. */
  address: string;
  decimals: number;
  coingeckoId?: string;
  /** True when this row comes from the catalogue (not owned). */
  catalogue?: boolean;
}

export interface SwapToken extends SwapTokenEntry {
  /** Spendable balance (0 for catalogue-only rows). */
  balance: number;
  /** Live USD price when known, else null. */
  price: number | null;
  /** 24h change in percent when known, else null. */
  change24h: number | null;
  /** Verified logo URL when the owned token has one. */
  logoUrl?: string | null;
}

/** Well-known swap tokens per Stelix chain id (all chains, restored 2026-11-27). */
export const SWAP_CATALOGUE: Record<string, SwapTokenEntry[]> = {
  'arc-mainnet': [
    { symbol: 'USDC', name: 'USD Coin (Arc gas asset)', chainId: 'arc-mainnet', address: '', decimals: 6, coingeckoId: 'usd-coin' },
  ],
  bnb: [
    { symbol: 'BNB', name: 'BNB', chainId: 'bnb', address: '', decimals: 18, coingeckoId: 'binancecoin' },
    { symbol: 'WBNB', name: 'Wrapped BNB', chainId: 'bnb', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18, coingeckoId: 'binancecoin' },
    { symbol: 'USDT', name: 'Tether USD', chainId: 'bnb', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, coingeckoId: 'tether' },
    { symbol: 'USDC', name: 'USD Coin', chainId: 'bnb', address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18, coingeckoId: 'usd-coin' },
  ],
  base: [
    { symbol: 'ETH', name: 'Ether', chainId: 'base', address: '', decimals: 18, coingeckoId: 'ethereum' },
    { symbol: 'WETH', name: 'Wrapped Ether', chainId: 'base', address: '0x4200000000000000000000000000000000000006', decimals: 18, coingeckoId: 'ethereum' },
    { symbol: 'USDC', name: 'USD Coin', chainId: 'base', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, coingeckoId: 'usd-coin' },
  ],
  ethereum: [
    { symbol: 'ETH', name: 'Ether', chainId: 'ethereum', address: '', decimals: 18, coingeckoId: 'ethereum' },
    { symbol: 'WETH', name: 'Wrapped Ether', chainId: 'ethereum', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, coingeckoId: 'ethereum' },
    { symbol: 'USDT', name: 'Tether USD', chainId: 'ethereum', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, coingeckoId: 'tether' },
    { symbol: 'USDC', name: 'USD Coin', chainId: 'ethereum', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, coingeckoId: 'usd-coin' },
  ],
  polygon: [
    { symbol: 'POL', name: 'Polygon', chainId: 'polygon', address: '', decimals: 18, coingeckoId: 'matic-network' },
    { symbol: 'WMATIC', name: 'Wrapped Matic', chainId: 'polygon', address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', decimals: 18, coingeckoId: 'matic-network' },
    { symbol: 'USDT', name: 'Tether USD', chainId: 'polygon', address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6, coingeckoId: 'tether' },
    { symbol: 'USDC', name: 'USD Coin', chainId: 'polygon', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6, coingeckoId: 'usd-coin' },
  ],
  solana: [
    { symbol: 'SOL', name: 'Solana', chainId: 'solana', address: '', decimals: 9, coingeckoId: 'solana' },
    { symbol: 'USDT', name: 'Tether USD', chainId: 'solana', address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, coingeckoId: 'tether' },
    { symbol: 'USDC', name: 'USD Coin', chainId: 'solana', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, coingeckoId: 'usd-coin' },
  ],
};

export function getSwapCatalogue(chainId: string): SwapTokenEntry[] {
  return SWAP_CATALOGUE[chainId] ?? [];
}

/** Merge the catalogue with the wallet's owned tokens for one chain.
 *  Owned tokens win on symbol (they carry the real balance, price and
 *  logo); catalogue rows the user does not own stay listed with balance
 *  0 so the page is browsable with an empty wallet. Spam is excluded. */
export function mergeSwapTokens(chainId: string, owned: TokenBalance[]): SwapToken[] {
  const bySymbol = new Map<string, SwapToken>();
  for (const c of getSwapCatalogue(chainId)) {
    bySymbol.set(c.symbol, {
      ...c,
      catalogue: true,
      balance: 0,
      price: null,
      change24h: null,
      logoUrl: null,
    });
  }
  for (const t of owned) {
    if (t.chainId !== chainId || t.isSpam) continue;
    const prev = bySymbol.get(t.symbol);
    bySymbol.set(t.symbol, {
      symbol: t.symbol,
      name: t.name,
      chainId: t.chainId,
      address: t.address,
      decimals: t.decimals,
      coingeckoId: prev?.coingeckoId ?? COINGECKO_IDS_BY_SYMBOL[t.symbol],
      balance: t.balance,
      price: t.price,
      change24h: null,
      logoUrl: t.logoUrl ?? null,
    });
  }
  return [...bySymbol.values()];
}

/** How much of `amount` the `balance` cannot cover (0 when covered). */
export function swapShortfall(balance: number, amount: number): number {
  return Math.max(0, amount - balance);
}

/** Label + disabled state for the swap CTA, for every balance state.
 *  With no balance the page stays fully usable and the button says
 *  exactly which token is short and by how much — it never hides the
 *  page or shows a blank/error state. */
export function swapButtonState(args: {
  amount: number;
  balance: number;
  fromSymbol: string;
  hasQuote: boolean;
  quoteLive: boolean;
  executing: boolean;
  chainSwapNote: string | null;
}): { label: string; disabled: boolean } {
  const { amount, balance, fromSymbol, hasQuote, quoteLive, executing, chainSwapNote } = args;
  if (executing) return { label: 'Swapping…', disabled: true };
  if (chainSwapNote) return { label: chainSwapNote, disabled: true };
  if (amount <= 0) return { label: 'Enter Amount', disabled: true };
  const short = swapShortfall(balance, amount);
  if (short > 0) {
    return {
      label: `Insufficient balance — short ${trimNumber(short)} ${fromSymbol}`,
      disabled: true,
    };
  }
  if (!hasQuote) return { label: 'Getting quote…', disabled: true };
  return { label: quoteLive ? 'Review Swap' : 'Review Swap (estimated price)', disabled: false };
}

function trimNumber(n: number): string {
  const s = n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return s === '' ? '0' : s;
}
