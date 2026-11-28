/**
 * Network picker tests — coming-soon chains appear in the list with a
 * "Coming soon" badge but are visibly disabled and can never be
 * selected; a coming-soon active chain is never the selected row.
 */
import { CHAINS, getChain } from '../chains';
import { buildNetworkOptions, selectableChain } from '../networkPicker';

describe('buildNetworkOptions', () => {
  it('lists every active chain, Arc first (default), with testnet/mainnet + native in the sub', () => {
    const opts = buildNetworkOptions(CHAINS, 'arc');
    expect(opts.map((o) => o.key)).toEqual([
      'arc', 'bnb', 'bnb-testnet', 'base', 'base-sepolia', 'ethereum', 'ethereum-sepolia', 'polygon', 'polygon-amoy', 'solana',
      'plasma', 'plasma-testnet', 'pi', 'pi-testnet',
    ]);
    const arc = opts.find((o) => o.key === 'arc')!;
    expect(arc.selected).toBe(true);
    expect(arc.disabled).toBe(false);
    expect(arc.badge).toBeUndefined();
    expect(arc.sub).toContain('Testnet');
    expect(arc.sub).toContain('Native: USDC');
    expect(arc.sub).toContain('Default');
  });

  it('coming-soon chains are shown, disabled, badged — never selected, even when active', () => {
    const opts = buildNetworkOptions(CHAINS, 'plasma-testnet');
    for (const id of ['plasma-testnet', 'pi', 'pi-testnet']) {
      const o = opts.find((x) => x.key === id)!;
      expect(o.disabled).toBe(true);
      expect(o.badge).toBe('Coming soon');
      expect(o.selected).toBe(false);
    }
    // No row is selected when the current chain itself is coming-soon:
    // the caller must fall back to Arc instead of showing a disabled
    // chain as the active network.
    expect(opts.some((o) => o.selected)).toBe(false);
    // Plasma mainnet is usable: shown, enabled, no badge.
    const plasma = opts.find((o) => o.key === 'plasma')!;
    expect(plasma.disabled).toBe(false);
    expect(plasma.badge).toBeUndefined();
    expect(plasma.sub).toContain('Mainnet');
    expect(plasma.sub).toContain('Native: XPL');
  });

  it('inactive chains never appear (Arc Mainnet stays hidden)', () => {
    const opts = buildNetworkOptions(CHAINS, 'arc');
    expect(opts.some((o) => o.key === 'arc-mainnet')).toBe(false);
  });
});

describe('selectableChain', () => {
  it('returns the chain for usable ids and null for coming-soon, disabled or unknown ids', () => {
    expect(selectableChain(CHAINS, 'arc')?.id).toBe('arc');
    expect(selectableChain(CHAINS, 'plasma')?.id).toBe('plasma');
    expect(selectableChain(CHAINS, 'plasma-testnet')).toBeNull();
    expect(selectableChain(CHAINS, 'pi')).toBeNull();
    expect(selectableChain(CHAINS, 'pi-testnet')).toBeNull();
    expect(selectableChain(CHAINS, 'arc-mainnet')).toBeNull();
    expect(selectableChain(CHAINS, 'nope')).toBeNull();
  });

  it('an admin-marked coming-soon chain is not selectable even when the built-in says otherwise', () => {
    const merged = CHAINS.map((c) => (c.id === 'plasma' ? { ...c, comingSoon: true } : c));
    expect(selectableChain(merged, 'plasma')).toBeNull();
    expect(buildNetworkOptions(merged, 'arc').find((o) => o.key === 'plasma')?.disabled).toBe(true);
    expect(getChain('plasma').comingSoon).toBe(false);
  });
});
