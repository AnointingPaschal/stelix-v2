/** Chain registry tests — Arc Mainnet is the default; the built-in
 *  registry is MAINNET-ONLY (2026-11-28). There are no hardcoded
 *  testnet entries: a testnet appears only when the admin serves it
 *  through /api/sync (see adminSync.test.ts / adminChains.test.ts).
 *  Vault addresses are still all null until deployed. */
import {
  ACTIVE_CHAINS,
  CHAINS,
  DEFAULT_CHAIN,
  USABLE_CHAINS,
  VAULT_ADDRESSES,
  VAULT_NOT_DEPLOYED_MESSAGE,
  getChain,
  getChainByEvmId,
  getVaultAddress,
  getVaultDeploymentStatus,
  isChainActive,
  isChainUsable,
  requireVaultAddress,
} from '../chains';

describe('chain registry', () => {
  it('Arc Mainnet is the default chain, chain id 5042, USDC gas (6 decimals)', () => {
    expect(DEFAULT_CHAIN.id).toBe('arc-mainnet');
    expect(DEFAULT_CHAIN.chainId).toBe(5042);
    expect(DEFAULT_CHAIN.testnet).toBeUndefined();
    expect(DEFAULT_CHAIN.status).toBe('live');
    expect(DEFAULT_CHAIN.nativeSymbol).toBe('USDC');
    expect(DEFAULT_CHAIN.nativeDecimals).toBe(6);
    expect(DEFAULT_CHAIN.rpcUrl).toBe('https://rpc.mainnet.arc.io');
    expect(DEFAULT_CHAIN.explorerUrl).toBe('https://explorer.arc.io');
    expect(DEFAULT_CHAIN.exitStablecoin).toBe('USDC');
    expect(DEFAULT_CHAIN.active).toBe(true);
    expect(DEFAULT_CHAIN.isDefault).toBe(true);
  });

  it('the active chain list is the mainnets only, Arc Mainnet first', () => {
    expect(ACTIVE_CHAINS.map((c) => c.id)).toEqual([
      'arc-mainnet', 'bnb', 'base', 'ethereum', 'polygon', 'solana', 'plasma', 'pi',
    ]);
    for (const id of ['arc-mainnet', 'bnb', 'base', 'ethereum', 'polygon', 'solana', 'plasma', 'pi']) {
      expect(isChainActive(id)).toBe(true);
      expect(getChain(id).active).toBe(true);
    }
  });

  it('no hardcoded testnet exists in the built-in registry', () => {
    // No testnet chain id, name, RPC or explorer anywhere in CHAINS.
    const testnetIds = [5042002, 97, 84532, 11155111, 80002, 9746];
    for (const c of CHAINS) {
      expect(c.testnet).not.toBe(true);
      expect(c.status).not.toBe('testnet');
      if (typeof c.chainId === 'number') expect(testnetIds).not.toContain(c.chainId);
      expect(c.rpcUrl).not.toMatch(/testnet/i);
      expect(c.explorerUrl).not.toMatch(/testnet/i);
      expect(c.name).not.toMatch(/testnet/i);
    }
    // Unknown testnet ids resolve to nothing, never to a built-in.
    expect(getChainByEvmId(5042002)).toBeNull();
    expect(getChainByEvmId(97)).toBeNull();
    expect(getChainByEvmId(84532)).toBeNull();
    expect(getChainByEvmId(11155111)).toBeNull();
    expect(getChainByEvmId(80002)).toBeNull();
    expect(getChainByEvmId(9746)).toBeNull();
    // An unknown slug falls back to the default (Arc Mainnet).
    expect(getChain('arc').id).toBe('arc-mainnet');
  });

  it('BNB / Base / Ethereum / Polygon chain ids are the well-known mainnet ids', () => {
    expect(getChain('bnb').chainId).toBe(56);
    expect(getChain('base').chainId).toBe(8453);
    expect(getChain('ethereum').chainId).toBe(1);
    expect(getChain('polygon').chainId).toBe(137);
    expect(getChainByEvmId(56)?.id).toBe('bnb');
    expect(getChainByEvmId(5042)?.id).toBe('arc-mainnet');
    expect(getChainByEvmId(999999)).toBeNull();
  });

  it('Solana has no EVM chain id and uses the mainnet-beta RPC', () => {
    const sol = getChain('solana');
    expect(sol.chainId).toBeNull();
    expect(sol.kind).toBe('solana');
    expect(sol.active).toBe(true);
    expect(sol.rpcUrl).toBe('https://api.mainnet-beta.solana.com');
  });

  it('every chain names its exit stablecoin explicitly (USDT, USDC or BUSD, never vague)', () => {
    for (const c of CHAINS) {
      expect(['USDT', 'USDC', 'BUSD']).toContain(c.exitStablecoin);
      expect(c.exitStablecoinLabel).toContain(c.exitStablecoin);
      // A usable chain must have a verified exit stablecoin address;
      // a coming-soon chain honestly has none yet (null = not
      // confirmed, never a guessed address). Inactive chains keep
      // whatever address they already have.
      if (isChainUsable(c)) {
        expect(c.exitStablecoinAddress).toBeTruthy();
      } else if (c.comingSoon) {
        expect(c.exitStablecoinAddress).toBeNull();
      }
    }
  });

  it('Plasma mainnet has the verified router and stablecoins (checked 2026-11-28)', () => {
    const p = getChain('plasma');
    expect(p.kind).toBe('evm');
    expect(p.chainId).toBe(9745);
    expect(p.nativeSymbol).toBe('XPL');
    expect(p.nativeDecimals).toBe(18);
    expect(p.rpcUrl).toBe('https://rpc.plasma.to');
    expect(p.explorerUrl).toBe('https://plasmascan.to');
    expect(p.exitStablecoin).toBe('USDT');
    expect(p.exitStablecoinAddress).toBe('0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb');
    expect(p.uniswapV3Router).toBe('0x807F4E281B7A3B324825C64ca53c69F0b418dE40');
    expect(p.vaultContract).toBeNull();
    expect(p.comingSoon).toBe(false);
    expect(isChainUsable(p)).toBe(true);
    expect(getChainByEvmId(9745)?.id).toBe('plasma');
  });

  it('Pi is non-EVM (kind pi), no chain id, Horizon API — never an EVM RPC', () => {
    const piChain = getChain('pi');
    expect(piChain.kind).toBe('pi');
    expect(piChain.chainId).toBeNull();
    expect(piChain.nativeSymbol).toBe('PI');
    expect(piChain.nativeDecimals).toBe(7);
    expect(piChain.exitStablecoinAddress).toBeNull();
    expect(piChain.vaultContract).toBeNull();
    expect(piChain.comingSoon).toBe(true);
    expect(isChainUsable(piChain)).toBe(false);
    expect(piChain.rpcUrl).toBe('https://api.mainnet.minepi.com');
    // No EVM id resolves to Pi.
    expect(getChainByEvmId(9745)?.id).toBe('plasma');
  });

  it('usable chains exclude every coming-soon chain', () => {
    expect(USABLE_CHAINS.map((c) => c.id)).toEqual([
      'arc-mainnet', 'bnb', 'base', 'ethereum', 'polygon', 'solana', 'plasma',
    ]);
    expect(USABLE_CHAINS.some((c) => c.id === 'pi')).toBe(false);
  });

  it('unknown chain ids fall back to the default', () => {
    expect(getChain('nope').id).toBe('arc-mainnet');
  });
});

describe('vault contract registry', () => {
  it('no StelixVault address is registered on any chain yet', () => {
    for (const c of CHAINS) {
      expect(getVaultAddress(c.id)).toBeNull();
      expect(VAULT_ADDRESSES[c.id]).toBeNull();
    }
  });

  it('deployment status reports not-deployed with the exact message', () => {
    const s = getVaultDeploymentStatus('arc-mainnet');
    expect(s.deployed).toBe(false);
    if (!s.deployed) expect(s.message).toBe(VAULT_NOT_DEPLOYED_MESSAGE);
    expect(() => requireVaultAddress('arc-mainnet')).toThrow(/Not deployed on this chain yet/);
  });
});
