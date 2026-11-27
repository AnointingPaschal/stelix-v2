import { mergeRegistryTokens, type ImportedToken, type RegistryTokenInput } from '../balances';

const STX = '0xC4d720e630d8aeC1F0718a1d30Ab0e5A802F74e7';
const USDC = '0x3600000000000000000000000000000000000000';
const BSCT = '0x6AD77e153f6D4Dd7c0F2e194A385e625274dE794';

const registry = (over: Partial<RegistryTokenInput> & { address: string; symbol: string }): RegistryTokenInput => ({
  chainId: 'arc-mainnet',
  decimals: 18,
  logoUrl: null,
  verified: true,
  sortOrder: 0,
  ...over,
});

const imported = (over: Partial<ImportedToken> & { address: string; symbol: string }): ImportedToken => ({
  chainId: 'arc-mainnet',
  name: over.symbol,
  decimals: 18,
  ...over,
});

describe('mergeRegistryTokens', () => {
  it('shows every registry token for the chain, in the admin order', () => {
    const merged = mergeRegistryTokens(
      [],
      [
        registry({ address: STX, symbol: 'STX', sortOrder: 2 }),
        registry({ address: USDC, symbol: 'USDC', decimals: 6, sortOrder: 1 }),
      ],
      'arc-mainnet',
    );
    expect(merged.map((t) => t.symbol)).toEqual(['USDC', 'STX']);
    expect(merged[0].verified).toBe(true);
    expect(merged[0].sortOrder).toBe(1);
  });

  it('puts user-imported tokens after registry tokens, in saved order', () => {
    const merged = mergeRegistryTokens(
      [imported({ address: BSCT, symbol: 'BSCT' })],
      [registry({ address: STX, symbol: 'STX', sortOrder: 0 })],
      'arc-mainnet',
    );
    expect(merged.map((t) => t.symbol)).toEqual(['STX', 'BSCT']);
  });

  it('shows a token imported by the user once, with the registry data winning', () => {
    const merged = mergeRegistryTokens(
      [imported({ address: STX, symbol: 'STX-OLD', name: 'Old name', decimals: 6, logoUrl: 'https://example.com/old.png' })],
      [registry({ address: STX, symbol: 'STX', name: 'Stelix', decimals: 18, logoUrl: 'https://stelix-admin.pages.dev/api/logo/abc', verified: true, sortOrder: 0 })],
      'arc-mainnet',
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].symbol).toBe('STX');
    expect(merged[0].name).toBe('Stelix');
    expect(merged[0].decimals).toBe(18);
    expect(merged[0].logoUrl).toBe('https://stelix-admin.pages.dev/api/logo/abc');
    expect(merged[0].verified).toBe(true);
  });

  it('ignores registry and imported tokens from other chains', () => {
    const merged = mergeRegistryTokens(
      [imported({ chainId: 'arc', address: BSCT, symbol: 'BSCT' })],
      [registry({ chainId: 'arc', address: STX, symbol: 'STX', sortOrder: 0 })],
      'arc-mainnet',
    );
    expect(merged).toEqual([]);
  });

  it('keeps unverified registry tokens, flagged without the badge', () => {
    const merged = mergeRegistryTokens(
      [],
      [registry({ address: STX, symbol: 'STX', verified: false, sortOrder: 0 })],
      'arc-mainnet',
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].verified).toBe(false);
  });

  it('returns only imported tokens when the registry is empty', () => {
    const merged = mergeRegistryTokens(
      [imported({ address: BSCT, symbol: 'BSCT' })],
      [],
      'arc-mainnet',
    );
    expect(merged.map((t) => t.symbol)).toEqual(['BSCT']);
  });
});
