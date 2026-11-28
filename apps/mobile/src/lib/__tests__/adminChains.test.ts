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
    expect(merged.find((c) => c.id === 'arc-mainnet')?.active).toBe(true);
    expect(merged.find((c) => c.id === 'arc-mainnet')?.fromAdmin).toBeUndefined();
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

  it('a deleted chain never comes back: tombstones drop built-ins and remote-only rows', () => {
    const tombstoned = mergeAdminChains(CHAINS, [row()], { deletedIds: ['bnb', 'arbitrum'] });
    expect(tombstoned.some((c) => c.id === 'bnb')).toBe(false);
    expect(tombstoned.some((c) => c.id === 'arbitrum')).toBe(false);
    expect(tombstoned.some((c) => c.id === 'arc-mainnet')).toBe(true);
  });

  it('a deleted chain stays deleted when the API is down (persisted tombstones)', () => {
    const merged = mergeAdminChains(CHAINS, null, { deletedIds: ['bnb'] });
    expect(merged.some((c) => c.id === 'bnb')).toBe(false);
    expect(merged.some((c) => c.id === 'arc-mainnet')).toBe(true);
  });

  it('a disabled chain stays disabled when the API is down (persisted disabled ids)', () => {
    const merged = mergeAdminChains(CHAINS, null, { disabledIds: ['bnb'] });
    expect(merged.find((c) => c.id === 'bnb')?.active).toBe(false);
    expect(merged.find((c) => c.id === 'arc-mainnet')?.active).toBe(true);
  });

  it('carries the admin DEX router and paired chain when verified', () => {
    const merged = mergeAdminChains(CHAINS, [
      row({
        id: 'bnb', chain_id: 56,
        dex_router: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
        paired_chain_id: 'bnb-testnet',
      }),
    ]);
    const bnb = merged.find((c) => c.id === 'bnb');
    expect(bnb?.dexRouter).toBe('0x10ED43C718714eb63d5aA57B78B54704E256024E');
    expect(bnb?.pairedChainId).toBe('bnb-testnet');
  });

  it('carries the launchpad factory + launchpad addresses when verified, null when blank', () => {
    const merged = mergeAdminChains(CHAINS, [
      row({
        id: 'arc', chain_id: 5042002,
        token_factory_address: '0x1111111111111111111111111111111111111111',
        launchpad_address: '0x2222222222222222222222222222222222222222',
      }),
    ]);
    const arc = merged.find((c) => c.id === 'arc');
    expect(arc?.tokenFactoryAddress).toBe('0x1111111111111111111111111111111111111111');
    expect(arc?.launchpadAddress).toBe('0x2222222222222222222222222222222222222222');
    const blank = mergeAdminChains(CHAINS, [
      row({ id: 'arc', chain_id: 5042002, token_factory_address: '', launchpad_address: null }),
    ]);
    expect(blank.find((c) => c.id === 'arc')?.tokenFactoryAddress).toBeNull();
    expect(blank.find((c) => c.id === 'arc')?.launchpadAddress).toBeNull();
    // A remote-only chain carries them too.
    const remoteOnly = mergeAdminChains(CHAINS, [
      row({
        token_factory_address: '0x3333333333333333333333333333333333333333',
        launchpad_address: '0x4444444444444444444444444444444444444444',
      }),
    ]);
    const arb = remoteOnly.find((c) => c.id === 'arbitrum');
    expect(arb?.tokenFactoryAddress).toBe('0x3333333333333333333333333333333333333333');
    expect(arb?.launchpadAddress).toBe('0x4444444444444444444444444444444444444444');
  });

  it('an unverified router address is never carried (blank or malformed)', () => {
    const merged = mergeAdminChains(CHAINS, [row({ id: 'bnb', chain_id: 56, dex_router: 'guess-me' })]);
    expect(merged.find((c) => c.id === 'bnb')?.dexRouter).toBeNull();
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

  it('carries the admin coming-soon flag (either spelling); admin wins, absent keeps the built-in', () => {
    // Snake_case (D1 column) marks Plasma testnet coming-soon.
    const snake = mergeAdminChains(CHAINS, [
      row({ id: 'plasma-testnet', name: 'Plasma Testnet', chain_id: 9746, rpc_urls: 'https://testnet-rpc.plasma.to', explorer_url: 'https://testnet.plasmascan.to', native_token: 'XPL', native_decimals: 18, stablecoin: 'USDT', stablecoin_address: '', status: 'testnet', is_testnet: 1, active: 1, coming_soon: 1 }),
    ]);
    expect(snake.find((c) => c.id === 'plasma-testnet')?.comingSoon).toBe(true);
    // CamelCase is only a defensive fallback (the sync serves raw
    // snake_case rows) — it clears Plasma mainnet here.
    const camel = mergeAdminChains(CHAINS, [
      row({ id: 'plasma', name: 'Plasma', chain_id: 9745, rpc_urls: 'https://rpc.plasma.to', explorer_url: 'https://plasmascan.to', native_token: 'XPL', native_decimals: 18, stablecoin: 'USDT', stablecoin_address: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', status: 'live', is_testnet: 0, active: 1, comingSoon: false }),
    ]);
    expect(camel.find((c) => c.id === 'plasma')?.comingSoon).toBe(false);
    const silent = mergeAdminChains(CHAINS, [
      row({ id: 'plasma-testnet', name: 'Plasma Testnet', chain_id: 9746, rpc_urls: 'https://testnet-rpc.plasma.to', explorer_url: 'https://testnet.plasmascan.to', native_token: 'XPL', native_decimals: 18, stablecoin: 'USDT', stablecoin_address: '', status: 'testnet', is_testnet: 1, active: 1 }),
    ]);
    // A remote-only chain whose row says nothing about coming-soon is
    // not coming-soon: the admin serves coming_soon: 1 for Plasma
    // testnet in production, and the flag is what marks it.
    expect(silent.find((c) => c.id === 'plasma-testnet')?.comingSoon).toBe(false);
    // A coming-soon chain is NOT dropped by the merge — it stays in
    // the list so the picker can show it disabled.
    expect(snake.some((c) => c.id === 'plasma-testnet')).toBe(true);
  });

  it('keeps Pi non-EVM and always coming-soon, even if the admin row says otherwise', () => {
    const merged = mergeAdminChains(CHAINS, [
      row({ id: 'pi', name: 'Pi Network', chain_id: 1234, rpc_urls: 'https://api.mainnet.minepi.com', explorer_url: 'https://blockexplorer.minepi.com', native_token: 'PI', native_decimals: 7, stablecoin: 'USDT', stablecoin_address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', status: 'live', is_testnet: 0, active: 1, comingSoon: false }),
    ]);
    const piChain = merged.find((c) => c.id === 'pi');
    expect(piChain?.kind).toBe('pi');
    expect(piChain?.chainId).toBeNull();
    expect(piChain?.comingSoon).toBe(true);
    // A 0x stablecoin address never lands on a non-EVM chain.
    expect(piChain?.exitStablecoinAddress).toBeNull();
  });

  it('a remote-only Pi row is appended as kind pi, coming-soon, with no EVM id', () => {
    const merged = mergeAdminChains([], [
      row({ id: 'pi', name: 'Pi Network', chain_id: null, rpc_urls: 'https://api.mainnet.minepi.com', explorer_url: 'https://blockexplorer.minepi.com', native_token: 'PI', native_decimals: 7, stablecoin: 'USDT', stablecoin_address: '', status: 'coming-soon', is_testnet: 0, active: 1 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe('pi');
    expect(merged[0].chainId).toBeNull();
    expect(merged[0].comingSoon).toBe(true);
    expect(merged[0].fromAdmin).toBe(true);
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

  it('returns rows on a good response and refetches on every call (live polling — no time cache)', async () => {
    let calledUrl = '';
    const fetchMock = jest.fn(async (url: string) => {
      calledUrl = url;
      return new Response(JSON.stringify({ chains: [row()] }), { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const first = await fetchAdminChains();
    expect(first?.[0].id).toBe('arbitrum');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A second call hits the server again: an admin edit must never wait
    // out a cache. Only concurrent calls share one request.
    const second = await fetchAdminChains();
    expect(second?.[0].id).toBe('arbitrum');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calledUrl).toMatch(/\/api\/sync$/);
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
