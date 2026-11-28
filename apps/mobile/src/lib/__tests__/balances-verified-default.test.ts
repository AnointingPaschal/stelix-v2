/**
 * Verified-by-default rule: the native asset and the default
 * stablecoins (USDT / USDC / USDT0) show the verified badge in My
 * Assets unless the admin registry explicitly unverifies that address
 * (verified = false). Every other token is verified only when the
 * admin set verified = 1. Pure helpers + injected-metadata stable
 * resolution + the Solana fetchBalances native row (mocked, no RPC).
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
      tokens: [],
    })),
  };
});

jest.mock('../prices', () => ({
  fetchMajorPrices: jest.fn(async () => ({
    solana: { price: 100, change24h: 5, source: 'coingecko', updatedAt: 1 },
  })),
  fetchDexScreenerToken: jest.fn(async () => null),
}));

import {
  fetchBalances,
  mergeRegistryTokens,
  nativeAssetVerified,
  registryVerifiedOverride,
  resolveDefaultStables,
  verifiedByDefault,
  type RegistryTokenInput,
} from '../balances';

const USDT_BNB = '0x55d398326f99059fF775485246999027B3197955';
const USDC_ARC = '0x3600000000000000000000000000000000000000';
const STX = '0xC4d720e630d8aeC1F0718a1d30Ab0e5A802F74e7';
const OTHER = '0x1111111111111111111111111111111111111111';

const registry = (over: Partial<RegistryTokenInput> & { address: string; symbol: string }): RegistryTokenInput => ({
  chainId: 'bnb',
  decimals: 18,
  logoUrl: null,
  verified: true,
  sortOrder: 0,
  ...over,
});

describe('registryVerifiedOverride', () => {
  it('returns undefined when the registry has no row for the address', () => {
    expect(registryVerifiedOverride([], 'bnb', USDT_BNB)).toBeUndefined();
    expect(registryVerifiedOverride([registry({ address: OTHER, symbol: 'OTH', verified: false })], 'bnb', USDT_BNB)).toBeUndefined();
  });

  it('returns the row value, matching case-insensitively and per chain', () => {
    const rows = [
      registry({ address: USDT_BNB.toLowerCase(), symbol: 'USDT', verified: false }),
      registry({ chainId: 'base', address: USDT_BNB, symbol: 'USDT', verified: true }),
    ];
    expect(registryVerifiedOverride(rows, 'bnb', USDT_BNB)).toBe(false);
    expect(registryVerifiedOverride(rows, 'base', USDT_BNB)).toBe(true);
  });
});

describe('verifiedByDefault (natives + default stables)', () => {
  it('is verified with no registry row', () => {
    expect(verifiedByDefault([], 'bnb', USDT_BNB)).toBe(true);
  });

  it('stays verified when the registry row says verified = true', () => {
    expect(verifiedByDefault([registry({ address: USDT_BNB, symbol: 'USDT', verified: true })], 'bnb', USDT_BNB)).toBe(true);
  });

  it('is NOT verified when the registry explicitly unverifies that address', () => {
    expect(verifiedByDefault([registry({ address: USDT_BNB, symbol: 'USDT', verified: false })], 'bnb', USDT_BNB)).toBe(false);
  });

  it('an unverified row for a DIFFERENT address does not affect this token', () => {
    expect(
      verifiedByDefault([registry({ address: OTHER, symbol: 'OTH', verified: false })], 'bnb', USDT_BNB),
    ).toBe(true);
  });

  it('an unverified row on a DIFFERENT chain does not affect this chain', () => {
    expect(
      verifiedByDefault([registry({ chainId: 'base', address: USDT_BNB, symbol: 'USDT', verified: false })], 'bnb', USDT_BNB),
    ).toBe(true);
  });
});

describe('nativeAssetVerified', () => {
  it('native asset is verified by default with no registry rows', () => {
    expect(nativeAssetVerified([], getChain('bnb'))).toBe(true);
    expect(nativeAssetVerified([], getChain('arc-mainnet'))).toBe(true);
    expect(nativeAssetVerified([], getChain('solana'))).toBe(true);
  });

  it('Arc native (USDC) is unverified when the admin unverifies the USDC token row', () => {
    expect(
      nativeAssetVerified(
        [registry({ chainId: 'arc-mainnet', address: USDC_ARC, symbol: 'USDC', decimals: 6, verified: false })],
        getChain('arc-mainnet'),
      ),
    ).toBe(false);
  });

  it('Arc native stays verified when the USDC row is verified, or only another token is unverified', () => {
    const arcChain = getChain('arc-mainnet');
    expect(
      nativeAssetVerified(
        [registry({ chainId: 'arc-mainnet', address: USDC_ARC, symbol: 'USDC', decimals: 6, verified: true })],
        arcChain,
      ),
    ).toBe(true);
    expect(
      nativeAssetVerified(
        [registry({ chainId: 'arc-mainnet', address: STX, symbol: 'STX', verified: false })],
        arcChain,
      ),
    ).toBe(true);
  });

  it('BNB native stays verified when only a token row is unverified', () => {
    expect(
      nativeAssetVerified([registry({ address: STX, symbol: 'STX', verified: false })], getChain('bnb')),
    ).toBe(true);
  });
});

describe('resolveDefaultStables verified flag', () => {
  const fakeMeta = async (_chain: unknown, address: string) => ({
    symbol: address.toLowerCase() === USDT_BNB.toLowerCase() ? 'USDT' : 'USDC',
    name: address.toLowerCase() === USDT_BNB.toLowerCase() ? 'Tether USD' : 'USD Coin',
    decimals: 18,
  });

  it('marks USDT + USDC verified by default on BNB', async () => {
    const rows = await resolveDefaultStables(getChain('bnb'), [], [], { resolveMetadata: fakeMeta });
    expect(rows.map((r) => r.symbol)).toEqual(['USDT', 'USDC']);
    expect(rows.every((r) => r.verified === true)).toBe(true);
  });

  it('hides the badge for the stable the admin explicitly unverified, only that one', async () => {
    const rows = await resolveDefaultStables(
      getChain('bnb'),
      [],
      [registry({ address: USDT_BNB, symbol: 'USDT', verified: false })],
      { resolveMetadata: fakeMeta },
    );
    expect(rows.find((r) => r.symbol === 'USDT')?.verified).toBe(false);
    expect(rows.find((r) => r.symbol === 'USDC')?.verified).toBe(true);
  });

  it('an unverified non-stable registry row does not affect the stables', async () => {
    const rows = await resolveDefaultStables(
      getChain('bnb'),
      [],
      [registry({ address: STX, symbol: 'STX', verified: false })],
      { resolveMetadata: fakeMeta },
    );
    expect(rows.every((r) => r.verified === true)).toBe(true);
  });
});

describe('other tokens still need admin verified = 1', () => {
  it('mergeRegistryTokens keeps the admin value exactly for non-stable tokens', () => {
    const unverified = mergeRegistryTokens(
      [],
      [registry({ address: STX, symbol: 'STX', verified: false, sortOrder: 0 })],
      'bnb',
    );
    expect(unverified).toHaveLength(1);
    expect(unverified[0].verified).toBe(false);
    const verified = mergeRegistryTokens(
      [],
      [registry({ address: STX, symbol: 'STX', verified: true, sortOrder: 0 })],
      'bnb',
    );
    expect(verified[0].verified).toBe(true);
  });
});

describe('fetchBalances native row (Solana, mocked)', () => {
  it('SOL native row is verified by default', async () => {
    const res = await fetchBalances('solana', 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK');
    expect(res.error).toBeNull();
    expect(res.tokens).toHaveLength(1);
    expect(res.tokens[0].symbol).toBe('SOL');
    expect(res.tokens[0].verified).toBe(true);
  });
});
