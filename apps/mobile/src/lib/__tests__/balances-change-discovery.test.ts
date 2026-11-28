/**
 * Balances: 24h change / P&L, auto-discovery dedupe, default stables.
 * Pure logic + injected-dependency discovery (no network, no RPC).
 * The Solana fetchBalances change24h check mocks '../solana' and
 * '../prices' following solana-balances.test.ts.
 */
import { getChain } from '../chains';

jest.mock('../solana', () => {
  const actual = jest.requireActual('../solana') as Record<string, unknown>;
  return {
    ...actual,
    fetchSolanaBalances: jest.fn(async (address: string) => ({
      address,
      lamports: 2_000_000_000,
      sol: 2,
      tokens: [{ mint: 'Mint111111111111111111111111111111111111111', balance: 10, balanceRaw: '10000000', decimals: 6 }],
    })),
  };
});

jest.mock('../prices', () => ({
  fetchMajorPrices: jest.fn(async () => ({
    solana: { price: 100, change24h: 5, source: 'coingecko', updatedAt: 1 },
  })),
  fetchDexScreenerToken: jest.fn(async () => ({
    symbol: 'SPL',
    name: 'SPL Token',
    priceUsd: 2,
    change24h: -10,
    updatedAt: 1,
  })),
}));

import {
  calcPnl,
  discoverTokens,
  fetchBalances,
  mergeDiscoveredTokens,
  mergeRegistryTokens,
  parseBlockscoutTokenList,
  parseEtherscanTokenList,
  parseEtherscanTokenTx,
  type DiscoveredToken,
  type ImportedToken,
  type RegistryTokenInput,
} from '../balances';

const ADDR = '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383';
const TOKEN_A = '0x1111111111111111111111111111111111111111';
const TOKEN_B = '0x2222222222222222222222222222222222222222';

const imported = (over: Partial<ImportedToken> & { address: string; symbol: string }): ImportedToken => ({
  chainId: 'bnb',
  name: over.symbol,
  decimals: 18,
  ...over,
});

const registry = (over: Partial<RegistryTokenInput> & { address: string; symbol: string }): RegistryTokenInput => ({
  chainId: 'bnb',
  decimals: 18,
  logoUrl: null,
  verified: true,
  sortOrder: 0,
  ...over,
});

const discovered = (over: Partial<DiscoveredToken> & { address: string; symbol: string }): DiscoveredToken => ({
  chainId: 'bnb',
  name: over.symbol,
  decimals: 18,
  ...over,
});

function fakeResponse(json: unknown, ok = true): Response {
  return { ok, json: async () => json } as unknown as Response;
}

describe('calcPnl', () => {
  it('is value * change / (100 + change): +10% on $100 is +$9.09', () => {
    expect(calcPnl(100, 10)).toBeCloseTo(9.0909, 4);
  });

  it('is negative when the change is negative: -50% on $100 is -$100', () => {
    expect(calcPnl(100, -50)).toBeCloseTo(-100, 4);
  });

  it('is $0 when the change is 0 and null when the change is unknown', () => {
    expect(calcPnl(100, 0)).toBe(0);
    expect(calcPnl(100, null)).toBeNull();
    expect(calcPnl(100, undefined)).toBeNull();
  });

  it('returns null at -100% instead of dividing by zero', () => {
    expect(calcPnl(100, -100)).toBeNull();
  });
});

describe('mergeDiscoveredTokens precedence: registry > imported > discovered', () => {
  it('drops a discovered token already in the registry, keeping registry data', () => {
    const merged = mergeRegistryTokens(
      [],
      [registry({ address: TOKEN_A, symbol: 'REG', name: 'Registry Token', verified: true, sortOrder: 0 })],
      'bnb',
    );
    const out = mergeDiscoveredTokens(merged, [discovered({ address: TOKEN_A, symbol: 'DSC', name: 'Discovered' })], 'bnb');
    expect(out).toHaveLength(1);
    expect(out[0].symbol).toBe('REG');
    expect(out[0].discovered).toBeUndefined();
  });

  it('drops a discovered token the user already imported', () => {
    const out = mergeDiscoveredTokens(
      [imported({ address: TOKEN_A, symbol: 'MINE' })],
      [discovered({ address: TOKEN_A, symbol: 'DSC' })],
      'bnb',
    );
    expect(out).toHaveLength(1);
    expect(out[0].symbol).toBe('MINE');
  });

  it('appends a genuinely new discovered token, marked discovered', () => {
    const out = mergeDiscoveredTokens(
      [imported({ address: TOKEN_A, symbol: 'MINE' })],
      [discovered({ address: TOKEN_B, symbol: 'NEW' })],
      'bnb',
    );
    expect(out.map((t) => t.symbol)).toEqual(['MINE', 'NEW']);
    expect(out[1].discovered).toBe(true);
  });

  it('dedupes case-insensitively and ignores other chains', () => {
    const out = mergeDiscoveredTokens(
      [imported({ address: TOKEN_A, symbol: 'MINE' })],
      [
        discovered({ address: TOKEN_A.toLowerCase(), symbol: 'DUP' }),
        discovered({ chainId: 'base', address: TOKEN_B, symbol: 'OTHER' }),
      ],
      'bnb',
    );
    expect(out).toHaveLength(1);
  });
});

describe('discovery parsers', () => {
  it('parseBlockscoutTokenList keeps only balance > 0 and reads token metadata', () => {
    const out = parseBlockscoutTokenList({
      items: [
        { token: { address: TOKEN_A, symbol: 'AAA', name: 'AAA Token', decimals: 6 }, value: '1500000' },
        { token: { address: TOKEN_B, symbol: 'BBB', name: 'BBB Token', decimals: 18 }, value: '0' },
        { token: { address: 'not-an-address', symbol: 'BAD' }, value: '5' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ address: TOKEN_A, symbol: 'AAA', name: 'AAA Token', decimals: 6 });
  });

  it('parseEtherscanTokenList dedupes contracts and keeps metadata', () => {
    const out = parseEtherscanTokenList({
      status: '1',
      result: [
        { contractAddress: TOKEN_A, tokenSymbol: 'AAA', tokenName: 'AAA Token', tokenDecimal: '6' },
        { contractAddress: TOKEN_A.toLowerCase(), tokenSymbol: 'AAA', tokenName: 'AAA Token', tokenDecimal: '6' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ address: TOKEN_A, symbol: 'AAA', decimals: 6 });
  });

  it('parseEtherscanTokenTx returns unique contract addresses', () => {
    const out = parseEtherscanTokenTx({
      status: '1',
      result: [
        { contractAddress: TOKEN_A },
        { contractAddress: TOKEN_B },
        { contractAddress: TOKEN_A },
        { contractAddress: '' },
      ],
    });
    expect(out).toEqual([TOKEN_A, TOKEN_B]);
  });
});

describe('discoverTokens (injected deps)', () => {
  it('uses keyless Blockscout on Arc and returns only balance > 0', async () => {
    const out = await discoverTokens(getChain('arc-mainnet'), ADDR, {
      fetchFn: async (url) => {
        expect(url).toContain('/api/v2/addresses/');
        expect(url).toContain('type=ERC-20');
        return fakeResponse({
          items: [
            { token: { address: TOKEN_A, symbol: 'AAA', name: 'AAA', decimals: 18 }, value: '10' },
            { token: { address: TOKEN_B, symbol: 'BBB', name: 'BBB', decimals: 18 }, value: '0' },
          ],
        });
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].symbol).toBe('AAA');
    expect(out[0].chainId).toBe('arc-mainnet');
  });

  it('uses tokenlist on BNB and keeps only tokens with balance > 0', async () => {
    const out = await discoverTokens(getChain('bnb'), ADDR, {
      getApiKey: async () => 'key123',
      balanceOf: async (a) => (a.toLowerCase() === TOKEN_A.toLowerCase() ? 5n : 0n),
      fetchFn: async (url) => {
        expect(url).toContain('action=tokenlist');
        expect(url).toContain('apikey=key123');
        return fakeResponse({
          status: '1',
          result: [
            { contractAddress: TOKEN_A, tokenSymbol: 'AAA', tokenName: 'AAA', tokenDecimal: '6' },
            { contractAddress: TOKEN_B, tokenSymbol: 'BBB', tokenName: 'BBB', tokenDecimal: '18' },
          ],
        });
      },
    });
    expect(out.map((t) => t.symbol)).toEqual(['AAA']);
  });

  it('falls back to tokentx when tokenlist lists nothing, resolving metadata for held tokens', async () => {
    const urls: string[] = [];
    const out = await discoverTokens(getChain('bnb'), ADDR, {
      getApiKey: async () => 'key123',
      balanceOf: async () => 7n,
      resolveMetadata: async () => ({ symbol: 'TXN', name: 'Tx Token', decimals: 18 }),
      fetchFn: async (url) => {
        urls.push(url);
        if (url.includes('action=tokenlist')) return fakeResponse({ status: '0', message: 'No transactions found', result: [] });
        return fakeResponse({ status: '1', result: [{ contractAddress: TOKEN_A }, { contractAddress: TOKEN_A }] });
      },
    });
    expect(urls.some((u) => u.includes('action=tokentx'))).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0].symbol).toBe('TXN');
  });

  it('returns [] with no explorer key, on a failed endpoint, and on non-EVM chains', async () => {
    expect(
      await discoverTokens(getChain('bnb'), ADDR, {
        getApiKey: async () => null,
        fetchFn: async () => {
          throw new Error('must not be called without a key');
        },
      }),
    ).toEqual([]);
    expect(
      await discoverTokens(getChain('arc'), ADDR, {
        fetchFn: async () => fakeResponse({}, false),
      }),
    ).toEqual([]);
    expect(await discoverTokens(getChain('solana'), 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK', {})).toEqual([]);
  });
});

describe('default stablecoins (chain.stablecoins)', () => {
  it('BNB, Ethereum and Polygon list verified USDT + USDC', () => {
    expect(getChain('bnb').stablecoins).toEqual({
      USDT: '0x55d398326f99059fF775485246999027B3197955',
      USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    });
    expect(getChain('ethereum').stablecoins).toEqual({
      USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    });
    expect(getChain('polygon').stablecoins).toEqual({
      USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    });
  });

  it('Base lists verified USDC and null USDT (no verified address — never guessed)', () => {
    expect(getChain('base').stablecoins).toEqual({
      USDT: null,
      USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    });
  });

  it('Arc Mainnet lists USDC (native gas asset) and null USDT', () => {
    expect(getChain('arc-mainnet').stablecoins?.USDC).toBe('0x3600000000000000000000000000000000000000');
    expect(getChain('arc-mainnet').stablecoins?.USDT).toBeNull();
  });

  it('Plasma lists USDT0 under USDT plus verified USDC', () => {
    expect(getChain('plasma').stablecoins).toEqual({
      USDT: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',
      USDC: '0x2d661c89d812261039af9764eceaaee884f5f67f',
    });
  });
});

describe('fetchBalances populates change24h on Solana', () => {
  it('SOL gets the CoinGecko 24h change and SPL tokens get the DexScreener change', async () => {
    const res = await fetchBalances('solana', 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK');
    expect(res.error).toBeNull();
    expect(res.tokens).toHaveLength(2);
    expect(res.tokens[0].symbol).toBe('SOL');
    expect(res.tokens[0].change24h).toBe(5);
    expect(res.tokens[1].symbol).toBe('SPL');
    expect(res.tokens[1].change24h).toBe(-10);
  });
});
