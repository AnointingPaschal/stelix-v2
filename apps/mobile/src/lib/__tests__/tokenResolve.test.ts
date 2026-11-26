/** Token Detail routing — every asset (default or imported) resolves. */
import { isAddressLike, normalizeChainIdForRoute, resolveTokenRef, tokenDetailRoute } from '../tokenResolve';
import type { TokenBalance } from '../balances';

const WKC = '0x6Ec90334d89dBdc89E08A133271be3d104128Edb';
const USDT = '0x55d398326f99059fF775485246999027B3197955';

function token(partial: Partial<TokenBalance>): TokenBalance {
  return {
    symbol: 'XXX',
    name: 'Test',
    chainId: 'bnb',
    address: '',
    decimals: 18,
    balance: 0,
    balanceRaw: '0',
    locked: 0,
    priceUsd: null,
    price: null,
    priceSource: 'unavailable',
    priceUpdatedAt: null,
    isSpam: false,
    ...partial,
  } as TokenBalance;
}

const TOKENS = [
  token({ symbol: 'BNB', name: 'BNB', chainId: 'bnb', address: '' }),
  token({ symbol: 'WKC', name: 'WIKI CAT', chainId: 'bnb', address: WKC }),
  token({ symbol: 'USDT', name: 'Tether', chainId: 'bnb', address: USDT }),
  token({ symbol: 'DUP', name: 'Dup on BSC', chainId: 'bnb', address: '0x1111111111111111111111111111111111111111' }),
  token({ symbol: 'DUP', name: 'Dup on Base', chainId: 'base', address: '0x2222222222222222222222222222222222222222' }),
];

describe('isAddressLike', () => {
  it('accepts 0x + 40 hex, rejects symbols', () => {
    expect(isAddressLike(WKC)).toBe(true);
    expect(isAddressLike('WKC')).toBe(false);
    expect(isAddressLike('0x123')).toBe(false);
    expect(isAddressLike(undefined)).toBe(false);
  });
});

describe('resolveTokenRef', () => {
  it('resolves a default native token by symbol (BNB)', () => {
    const r = resolveTokenRef({ symbol: 'BNB' }, TOKENS, 'bnb');
    expect(r.found).toBe(true);
    expect(r.symbol).toBe('BNB');
    expect(r.address).toBe('');
    expect(r.chainId).toBe('bnb');
    expect(r.storeToken?.symbol).toBe('BNB');
  });

  it('resolves an imported token by symbol (WKC)', () => {
    const r = resolveTokenRef({ symbol: 'wkc' }, TOKENS, 'bnb');
    expect(r.found).toBe(true);
    expect(r.address).toBe(WKC);
    expect(r.storeToken?.name).toBe('WIKI CAT');
  });

  it('resolves a contract address passed as the route segment', () => {
    const r = resolveTokenRef({ symbol: WKC }, TOKENS, 'bnb');
    expect(r.found).toBe(true);
    expect(r.symbol).toBe('WKC');
    expect(r.address).toBe(WKC);
  });

  it('resolves an unknown contract address as found (live sources can load it)', () => {
    const unknown = '0x9999999999999999999999999999999999999999';
    const r = resolveTokenRef({ symbol: unknown }, TOKENS, 'bnb');
    expect(r.found).toBe(true);
    expect(r.address).toBe(unknown);
    expect(r.storeToken).toBeNull();
  });

  it('prefers the requested chain when two tokens share a symbol', () => {
    const r = resolveTokenRef({ symbol: 'DUP', chainId: 'base' }, TOKENS, 'bnb');
    expect(r.chainId).toBe('base');
    expect(r.storeToken?.name).toBe('Dup on Base');
  });

  it('normalises DexScreener slugs (bsc -> bnb) from Discover', () => {
    const r = resolveTokenRef({ symbol: 'WKC', address: WKC, chainId: 'bsc' }, TOKENS, 'arc');
    expect(r.chainId).toBe('bnb');
    expect(normalizeChainIdForRoute('bsc')).toBe('bnb');
    expect(normalizeChainIdForRoute('eth')).toBe('ethereum');
  });

  it('returns not-found for an unknown symbol with no address', () => {
    const r = resolveTokenRef({ symbol: 'NOPE' }, TOKENS, 'bnb');
    expect(r.found).toBe(false);
    expect(r.storeToken).toBeNull();
  });
});

describe('tokenDetailRoute', () => {
  it('routes contract tokens by address (no symbol collisions)', () => {
    const r = tokenDetailRoute({ symbol: 'WKC', address: WKC, chainId: 'bnb' });
    expect(r.pathname).toBe('/token/[symbol]');
    expect(r.params.symbol).toBe(WKC);
    expect(r.params.address).toBe(WKC);
    expect(r.params.chainId).toBe('bnb');
  });

  it('routes native assets by symbol', () => {
    const r = tokenDetailRoute({ symbol: 'BNB', address: '', chainId: 'bnb' });
    expect(r.params.symbol).toBe('BNB');
    expect(r.params.address).toBeUndefined();
  });

  it('normalises the chain slug in the route', () => {
    const r = tokenDetailRoute({ symbol: 'WKC', address: WKC, chainId: 'bsc' });
    expect(r.params.chainId).toBe('bnb');
  });
});
