/**
 * Regression tests for the fetchBalances Solana address bug (2026-11-27).
 *
 * What broke: fetchBalances() validated `ethers.isAddress(address)` BEFORE
 * the Solana branch. A valid base58 Solana address fails ethers.isAddress,
 * so every Solana balance read returned 'Invalid wallet address.' with an
 * empty portfolio — even though the Solana branch itself (SOL + SPL via
 * fetchSolanaBalances) was correctly placed inside fetchBalances. The EVM
 * check now runs only after the Solana branch has returned.
 *
 * No network: fetchSolanaBalances and the price fetchers are mocked.
 * Run: npm test -- solana-balances
 */
import { deriveSolanaAddress } from '../solana';

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
  fetchMajorPrices: jest.fn(async () => ({})),
  fetchDexScreenerToken: jest.fn(async () => null),
}));

import { fetchBalances } from '../balances';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('fetchBalances on Solana (base58 address)', () => {
  it('accepts a valid derived Solana address — no "Invalid wallet address."', async () => {
    const solAddress = deriveSolanaAddress(MNEMONIC);
    expect(solAddress.startsWith('0x')).toBe(false);
    const res = await fetchBalances('solana', solAddress);
    expect(res.error).toBeNull();
    expect(res.tokens).toHaveLength(1);
    expect(res.tokens[0].symbol).toBe('SOL');
    expect(res.tokens[0].balance).toBe(2);
    expect(res.tokens[0].balanceRaw).toBe('2000000000');
  });

  it('a wallet with no Solana address gets the honest no-address error, not "Invalid wallet address."', async () => {
    const res = await fetchBalances('solana', '');
    expect(res.error).toMatch(/No Solana address for this wallet/);
    expect(res.tokens).toEqual([]);
  });

  it('an EVM address on Solana is still refused with the no-address error', async () => {
    const res = await fetchBalances('solana', '0x0000000000000000000000000000000000000001');
    expect(res.error).toMatch(/No Solana address for this wallet/);
  });

  it('an invalid address on an EVM chain is still rejected', async () => {
    const res = await fetchBalances('bnb', 'not-an-address');
    expect(res.error).toBe('Invalid wallet address.');
    expect(res.tokens).toEqual([]);
  });
});
