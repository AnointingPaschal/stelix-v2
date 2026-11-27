/**
 * adminSync tests — live-polling sync payload, effective fees, maintenance,
 * token registry, and the admin-controlled testnet/mainnet mode switch.
 *
 * The wallet polls GET /api/sync (live polling, not push) and re-applies
 * state only when the server version changes. These tests cover the pure
 * parsing/decision layer; the AppContext polling loop itself is exercised
 * by the retest steps in the report (admin edit -> app).
 */
import { CHAINS } from '../chains';
import { mergeAdminChains, type AdminChainRow } from '../adminChains';
import {
  clearAdminSyncCache,
  collapseArcPair,
  resolveModeChange,
  fetchAdminSync,
  filterChainsByMode,
  findRegistryToken,
  isVersionBelow,
  maintenanceBlocksApp,
  maintenanceBlocksSigning,
  parseAdminSync,
  pickChainForMode,
  resolveEffectiveFees,
  visibleAnnouncements,
  MAINTENANCE_OFF,
  type AdminSyncData,
} from '../adminSync';

function chainRow(over: Partial<AdminChainRow> = {}): AdminChainRow {
  return {
    id: 'arc',
    name: 'Arc Testnet',
    chain_id: 5042002,
    rpc_urls: 'https://rpc.testnet.arc.io',
    explorer_url: 'https://explorer.testnet.arc.io',
    native_token: 'USDC',
    native_decimals: 6,
    stablecoin: 'USDC',
    stablecoin_address: '0x3600000000000000000000000000000000000000',
    stablecoin_decimals: 6,
    gas_token: 'USDC',
    dex_router: '0xfA845604F52843a7b5cfA4030120c6238741F420',
    vault_address: null,
    status: 'live',
    is_default: 1,
    is_testnet: 1,
    active: 1,
    paired_chain_id: 'arc-mainnet',
    ...over,
  };
}

function arcMainnetRow(): AdminChainRow {
  return chainRow({
    id: 'arc-mainnet',
    name: 'Arc Mainnet',
    chain_id: 5042,
    rpc_urls: 'https://rpc.mainnet.arc.io',
    explorer_url: 'https://explorer.arc.io',
    status: 'live',
    is_default: 0,
    is_testnet: 0,
    active: 1,
    paired_chain_id: 'arc',
    dex_router: '0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77',
  });
}

function syncBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 7,
    chains: [chainRow(), arcMainnetRow()],
    deletedIds: [],
    fees: {
      autoSellFeePct: 2, minLockUsd: 25, maxLockUsd: 50000, defaultPenaltyPct: 7,
      twapMinutes: 30, trailingStopOptions: 'Off, 10%, 20%', defaultSlippagePct: 1,
      penaltyDestination: 'treasury',
    },
    feeVersion: 3,
    announcements: [
      { id: 1, title: 'Hello', message: 'All users', audience: 'all', expires_at: null, created_at: '2026-11-27' },
      { id: 2, title: 'Arc only', message: 'Arc users', audience: 'arc', expires_at: null, created_at: '2026-11-27' },
    ],
    config: {
      version: 'v2',
      payload: {
        minAppVersion: '2.0.0', forceUpgrade: false,
        flags: { bullLockAutoSell: true, trailingStop: false, yieldWhileLocked: false, groupLocks: false },
      },
      signature: 'sig', signatureValid: true, publishedAt: '2026-11-27',
    },
    tokens: [
      { id: 1, symbol: 'USDC', chain_id: 'arc', address: '0x3600000000000000000000000000000000000000', decimals: 6, verified: 1, featured: 0 },
    ],
    maintenance: { enabled: false, message: '', scope: 'wallet', updatedAt: null },
    networkMode: null,
    ...over,
  };
}

describe('parseAdminSync', () => {
  it('parses a full /api/sync payload', () => {
    const data = parseAdminSync(syncBody());
    expect(data?.version).toBe(7);
    expect(data?.chains).toHaveLength(2);
    expect(data?.deletedIds).toEqual([]);
    expect(data?.fees?.autoSellFeePct).toBe(2);
    expect(data?.feeVersion).toBe(3);
    expect(data?.announcements).toHaveLength(2);
    expect(data?.config?.version).toBe('v2');
    expect(data?.config?.flags.trailingStop).toBe(false);
    expect(data?.config?.signatureValid).toBe(true);
    expect(data?.tokens).toHaveLength(1);
    expect(data?.maintenance).toEqual(MAINTENANCE_OFF);
    expect(data?.networkMode).toBeNull();
  });

  it('parses networkMode testnet/mainnet, and null when never set', () => {
    expect(parseAdminSync(syncBody({ networkMode: 'mainnet' }))?.networkMode).toBe('mainnet');
    expect(parseAdminSync(syncBody({ networkMode: 'testnet' }))?.networkMode).toBe('testnet');
    expect(parseAdminSync(syncBody({ networkMode: 'bogus' }))?.networkMode).toBeNull();
  });

  it('returns null on a wrong shape, so the wallet keeps last-known state', () => {
    expect(parseAdminSync(null)).toBeNull();
    expect(parseAdminSync({})).toBeNull();
    expect(parseAdminSync({ version: 1, chains: 'nope' })).toBeNull();
    expect(parseAdminSync({ version: 'x', chains: [] })).toBeNull();
  });

  it('tolerates missing sections (fees/config/tokens/announcements)', () => {
    const data = parseAdminSync({ version: 1, chains: [] });
    expect(data?.fees).toBeNull();
    expect(data?.config).toBeNull();
    expect(data?.tokens).toEqual([]);
    expect(data?.announcements).toEqual([]);
    expect(data?.maintenance).toEqual(MAINTENANCE_OFF);
    expect(data?.networkMode).toBeNull();
  });
});

describe('fetchAdminSync', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    clearAdminSyncCache();
  });

  it('fetches /api/sync and returns null (never throws) when the API is down', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    });
    await expect(fetchAdminSync()).resolves.toBeNull();
    global.fetch = jest.fn(async () => new Response(JSON.stringify(syncBody()), { status: 200 }));
    const data: AdminSyncData | null = await fetchAdminSync();
    expect(data?.version).toBe(7);
    expect(data?.fees?.autoSellFeePct).toBe(2);
  });
});

describe('effective fees', () => {
  it('an edited admin fee appears after sync (source admin)', () => {
    const data = parseAdminSync(syncBody());
    const eff = resolveEffectiveFees(data?.fees ?? null, data?.feeVersion ?? null);
    expect(eff.source).toBe('admin');
    expect(eff.fees.autoSellFeePct).toBe(2);
    expect(eff.fees.minLockUsd).toBe(25);
    expect(eff.fees.defaultPenaltyPct).toBe(7);
    expect(eff.version).toBe(3);
  });

  it('no published fee config is an honest empty state (source default, never a silent override)', () => {
    const data = parseAdminSync(syncBody({ fees: null, feeVersion: null }));
    const eff = resolveEffectiveFees(data?.fees ?? null, data?.feeVersion ?? null);
    expect(eff.source).toBe('default');
    expect(eff.fees.autoSellFeePct).toBe(0);
    expect(eff.version).toBeNull();
  });
});

describe('announcements and token registry', () => {
  it('filters announcements by audience', () => {
    const data = parseAdminSync(syncBody());
    expect(visibleAnnouncements(data?.announcements ?? [], 'arc').map((a) => a.id)).toEqual([1, 2]);
    expect(visibleAnnouncements(data?.announcements ?? [], 'bnb').map((a) => a.id)).toEqual([1]);
  });

  it('finds a registered token case-insensitively; a removed token is not verified', () => {
    const data = parseAdminSync(syncBody());
    const found = findRegistryToken(data?.tokens ?? [], 'arc', '0X3600000000000000000000000000000000000000');
    expect(found?.symbol).toBe('USDC');
    expect(findRegistryToken(data?.tokens ?? [], 'arc', '0x0000000000000000000000000000000000000001')).toBeNull();
    const afterDelete = parseAdminSync(syncBody({ tokens: [] }));
    expect(findRegistryToken(afterDelete?.tokens ?? [], 'arc', '0x3600000000000000000000000000000000000000')).toBeNull();
  });
});

describe('maintenance mode', () => {
  it('blocks signing in either scope, and blocks the whole app only in scope all', () => {
    expect(maintenanceBlocksSigning(MAINTENANCE_OFF)).toBe(false);
    expect(maintenanceBlocksApp(MAINTENANCE_OFF)).toBe(false);
    const wallet = { enabled: true, message: 'Down', scope: 'wallet' as const, updatedAt: null };
    expect(maintenanceBlocksSigning(wallet)).toBe(true);
    expect(maintenanceBlocksApp(wallet)).toBe(false);
    const all = { enabled: true, message: 'Down', scope: 'all' as const, updatedAt: null };
    expect(maintenanceBlocksSigning(all)).toBe(true);
    expect(maintenanceBlocksApp(all)).toBe(true);
  });

  it('compares app versions for the force-upgrade flag', () => {
    expect(isVersionBelow('2.0.0', '2.0.0')).toBe(false);
    expect(isVersionBelow('1.9.9', '2.0.0')).toBe(true);
    expect(isVersionBelow('2.0.1', '2.0.0')).toBe(false);
  });
});

describe('network mode (admin testnet/mainnet switch)', () => {
  // Merged chains as the wallet sees them with the live admin rows:
  // arc (testnet, paired) + arc-mainnet (mainnet, active, paired).
  // The picker NEVER shows arc-mainnet as a separate entry: Arc is
  // collapsed to one 'arc' entry whose variant comes from the admin
  // mode (collapseArcPair, 2026-11-27). The tests below pin that.
  const merged = mergeAdminChains(CHAINS, [chainRow(), arcMainnetRow()]);
  const arc = merged.find((c) => c.id === 'arc')!;
  const arcMainnet = merged.find((c) => c.id === 'arc-mainnet')!;

  it('Arc collapses to one entry: testnet variant by default, mainnet variant only in mainnet mode', () => {
    for (const mode of [null, 'testnet'] as const) {
      const collapsed = collapseArcPair(merged, mode);
      expect(collapsed.map((c) => c.id)).not.toContain('arc-mainnet');
      const a = collapsed.find((c) => c.id === 'arc')!;
      expect(a.chainId).toBe(5042002);
      expect(a.testnet).toBe(true);
    }
    const main = collapseArcPair(merged, 'mainnet');
    expect(main.map((c) => c.id)).not.toContain('arc-mainnet');
    const a = main.find((c) => c.id === 'arc')!;
    expect(a.chainId).toBe(5042);
    expect(a.testnet).toBe(false);
    expect(a.vaultContract).toBeNull(); // mode switch never deploys a vault
  });

  it('testnet mode shows testnet chains only; mainnet mode shows mainnet chains only (Arc once, as mainnet); null shows all with Arc testnet only', () => {
    expect(filterChainsByMode(merged, 'testnet').map((c) => c.id)).toEqual([
      'arc', 'bnb-testnet', 'base-sepolia', 'ethereum-sepolia', 'polygon-amoy',
    ]);
    expect(filterChainsByMode(merged, 'mainnet').map((c) => c.id)).toEqual([
      'arc', 'bnb', 'base', 'ethereum', 'polygon', 'solana',
    ]);
    expect(filterChainsByMode(merged, 'mainnet').find((c) => c.id === 'arc')?.chainId).toBe(5042);
    expect(filterChainsByMode(merged, null).map((c) => c.id)).toEqual(
      merged.map((c) => c.id).filter((id) => id !== 'arc-mainnet'),
    );
  });

  it('admin flips to Mainnet: the wallet switches Arc testnet to the Arc Mainnet variant (same id, chain 5042)', () => {
    const next = pickChainForMode(merged, arc, 'mainnet');
    expect(next?.id).toBe('arc');
    expect(next?.chainId).toBe(5042);
    const d = resolveModeChange({
      currentMode: 'testnet', nextMode: 'mainnet', transactionActive: false,
      chains: merged, currentChain: arc,
    });
    expect(d.deferred).toBe(false);
    expect(d.chain?.id).toBe('arc');
    expect(d.chain?.chainId).toBe(5042);
    expect(d.notice).toBe('Switched to Mainnet by admin');
  });

  it('admin flips back to Testnet: the wallet switches Arc Mainnet back to Arc testnet', () => {
    const d = resolveModeChange({
      currentMode: 'mainnet', nextMode: 'testnet', transactionActive: false,
      chains: merged, currentChain: arcMainnet,
    });
    expect(d.deferred).toBe(false);
    expect(d.chain?.id).toBe('arc');
    expect(d.chain?.chainId).toBe(5042002);
    expect(d.notice).toBe('Switched to Testnet by admin');
  });

  it('no switch is needed when the current chain already fits the new mode', () => {
    const d = resolveModeChange({
      currentMode: null, nextMode: 'mainnet', transactionActive: false,
      chains: merged, currentChain: merged.find((c) => c.id === 'bnb')!,
    });
    expect(d.deferred).toBe(false);
    expect(d.chain).toBeNull();
    expect(d.notice).toBe('Switched to Mainnet by admin');
  });

  it('a mode flip mid-transaction is deferred, not applied', () => {
    const d = resolveModeChange({
      currentMode: 'testnet', nextMode: 'mainnet', transactionActive: true,
      chains: merged, currentChain: arc,
    });
    expect(d.deferred).toBe(true);
    expect(d.chain).toBeNull();
    expect(d.notice).toBeNull();
  });

  it('clearing the mode back to null moves Arc Mainnet back to Arc testnet with a notice', () => {
    const d = resolveModeChange({
      currentMode: 'mainnet', nextMode: null, transactionActive: false,
      chains: merged, currentChain: arcMainnet,
    });
    expect(d.deferred).toBe(false);
    // 'arc-mainnet' is not a picker entry any more: clearing the mode
    // returns the user to the single Arc entry, testnet variant.
    expect(d.chain?.id).toBe('arc');
    expect(d.chain?.chainId).toBe(5042002);
    expect(d.notice).toMatch(/all networks/);
  });

  it('same mode twice is a no-op', () => {
    const d = resolveModeChange({
      currentMode: 'testnet', nextMode: 'testnet', transactionActive: false,
      chains: merged, currentChain: arc,
    });
    expect(d).toEqual({ deferred: false, chain: null, notice: null });
  });
});
