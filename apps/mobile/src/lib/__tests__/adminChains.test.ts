/**
 * adminChains tests — merge behaviour and silent fallback to the built-in
 * registry when the admin API fails. The wallet must never break because
 * the registry endpoint is unreachable.
 */
import { CHAINS } from '../chains';
import {
  clearAdminChainsCache,
  fetchAdminChains,
  mergeAdminChains,
  type AdminChainRow,
} from '../adminChains';

function row(over: Partial<AdminChainRow> = {}): AdminChainRow {
  return {
    id: 'arbitrum',
    name: 'Arbitrum One',
    chain_id: 42161,
    rpc_urls: 'https://arb1.arbitrum.io/rpc',
    explorer_url: 'https://arbiscan.io',
    native_token: 'ETH',
    native_decimals: 18,
    stablecoin: 'USDC',
    stablecoin_address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    stablecoin_decimals: 6,
    gas_token: 'ETH',
    dex_router: '',
    vault_address: null,
    status: 'testnet',
    is_default: 0,
    is_testnet: 1,
    active: 1,
    paired_chain_id: null,
    ...over,
  };
}

describe('mergeAdminChains', () => {
  it('returns the built-ins unchanged when the fetch failed (remote null)', () => {
    const merged = mergeAdminChains(CHAINS, null);
    expect(merged.map((c) => c.id)).toEqual(CHAINS.map((c) => c.id));
    expect(merged.find((c) => c.id === 'arc')?.active).toBe(true);
    expect(merged.find((c) => c.id === 'arc')?.fromAdmin).toBeUndefined();
  });

  it('overlays remote display fields on a matching slug; remote wins where it provides a value', () => {
    const merged = mergeAdminChains(CHAINS, [
      row({ id: 'bnb', name: 'BNB Smart Chain', chain_id: 56, rpc_urls: 'https://bsc-dataseed2.bnbchain.org', explorer_url: 'https://bscscan.com', native_token: 'BNB', stablecoin: 'USDT', stablecoin_address: '', status: 'live', is_testnet: 0, active: 1 }),
    ]);
    const bnb = merged.find((c) => c.id === 'bnb');
    expect(bnb?.rpcUrl).toBe('https://bsc-dataseed2.bnbchain.org');
    expect(bnb?.name).toBe('BNB Smart Chain');
    expect(bnb?.status).toBe('live');
    expect(bnb?.testnet).toBe(false);
    // Empty remote stablecoin address never blanks the verified built-in one.
    expect(bnb?.exitStablecoinAddress).toBe('0x55d398326f99059fF775485246999027B3197955');
  });

  it('appends a remote-only chain as a new entry marked fromAdmin', () => {
    const merged = mergeAdminChains(CHAINS, [row()]);
    expect(merged.map((c) => c.id)).toEqual([...CHAINS.map((c) => c.id), 'arbitrum']);
    const arb = merged.find((c) => c.id === 'arbitrum');
    expect(arb?.fromAdmin).toBe(true);
    expect(arb?.chainId).toBe(42161);
    expect(arb?.kind).toBe('evm');
    expect(arb?.rpcUrl).toBe('https://arb1.arbitrum.io/rpc');
    expect(arb?.explorerUrl).toBe('https://arbiscan.io');
    expect(arb?.nativeSymbol).toBe('ETH');
    expect(arb?.exitStablecoin).toBe('USDC');
    expect(arb?.exitStablecoinAddress).toBe('0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
    expect(arb?.testnet).toBe(true);
    expect(arb?.active).toBe(true);
    // No verified vault yet: locks/swaps must stay unavailable on it.
    expect(arb?.vaultContract).toBeNull();
  });

  it('a remote-only chain with no verified stablecoin/vault keeps nulls (never a guessed address)', () => {
    const merged = mergeAdminChains(CHAINS, [row({ stablecoin_address: '', vault_address: '' })]);
    const arb = merged.find((c) => c.id === 'arbitrum');
    expect(arb?.exitStablecoinAddress).toBeNull();
    expect(arb?.vaultContract).toBeNull();
  });

  it('honours the remote active flag: admin disable hides the chain, admin enable shows it', () => {
    const disabled = mergeAdminChains(CHAINS, [row({ id: 'bnb', chain_id: 56, active: 0 })]);
    expect(disabled.find((c) => c.id === 'bnb')?.active).toBe(false);
    const enabled = mergeAdminChains(CHAINS, [row({ id: 'base', chain_id: 8453, active: 1 })]);
    expect(enabled.find((c) => c.id === 'base')?.active).toBe(true);
  });

  it('skips invalid remote rows instead of breaking the merge', () => {
    const merged = mergeAdminChains(CHAINS, [
      row({ id: '', name: '' }),
      row({ id: 'no-rpc', chain_id: 12345, rpc_urls: '', explorer_url: 'https://example.com' }),
      row({ id: 'no-chain-id', chain_id: null }),
      row(),
    ]);
    expect(merged.map((c) => c.id)).toEqual([...CHAINS.map((c) => c.id), 'arbitrum']);
  });

  it('keeps Solana non-EVM: remote numeric id never overwrites chainId null, and the base58 mint is kept', () => {
    const merged = mergeAdminChains(CHAINS, [
      row({ id: 'solana', name: 'Solana', chain_id: 101, rpc_urls: 'https://api.mainnet-beta.solana.com', explorer_url: 'https://solscan.io', native_token: 'SOL', native_decimals: 9, stablecoin: 'USDC', stablecoin_address: '', status: 'live', is_testnet: 0, active: 1 }),
    ]);
    const sol = merged.find((c) => c.id === 'solana');
    expect(sol?.chainId).toBeNull();
    expect(sol?.kind).toBe('solana');
    expect(sol?.exitStablecoinAddress).toBe('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
    expect(sol?.explorerUrl).toBe('https://solscan.io');
  });
});

describe('fetchAdminChains', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    clearAdminChainsCache();
  });

  afterEach(() => {
    global.fetch = realFetch;
    clearAdminChainsCache();
  });

  function mockFetch(body: unknown, status = 200): void {
    global.fetch = jest.fn(async () => new Response(JSON.stringify(body), { status }));
  }

  it('returns rows on a good response and caches them', async () => {
    let calledUrl = '';
    const fetchMock = jest.fn(async (url: string) => {
      calledUrl = url;
      return new Response(JSON.stringify({ chains: [row()] }), { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const first = await fetchAdminChains();
    expect(first?.[0].id).toBe('arbitrum');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const second = await fetchAdminChains();
    expect(second?.[0].id).toBe('arbitrum');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calledUrl).toMatch(/\/api\/chains$/);
  });

  it('returns null on a network failure, so the wallet falls back to built-ins', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    });
    expect(await fetchAdminChains()).toBeNull();
    expect(mergeAdminChains(CHAINS, null).map((c) => c.id)).toEqual(CHAINS.map((c) => c.id));
  });

  it('returns null on a 404 and on bad JSON', async () => {
    mockFetch({ error: 'not found' }, 404);
    expect(await fetchAdminChains()).toBeNull();
    clearAdminChainsCache();
    global.fetch = jest.fn(async () => new Response('not json{{', { status: 200 }));
    expect(await fetchAdminChains()).toBeNull();
  });

  it('returns null when the shape is wrong (no chains array)', async () => {
    mockFetch({ chains: 'nope' });
    expect(await fetchAdminChains()).toBeNull();
    clearAdminChainsCache();
    mockFetch({ nope: [] });
    expect(await fetchAdminChains()).toBeNull();
  });
});
