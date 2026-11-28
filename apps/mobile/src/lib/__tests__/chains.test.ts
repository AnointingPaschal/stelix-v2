/** Chain registry tests — Arc default, verified ids, vault not deployed.
 * Restored 2026-11-27: all six chains active again at the user's
 * instruction (the 2026-11-27 Arc + BNB scope-down is reversed).
 * Arc MAINNET (arc-mainnet) stays disabled until a mainnet deployment
 * is explicitly approved — it is not one of the six. */
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
  it('Arc is the default chain, testnet, chain id 5042002, USDC gas (6 decimals)', () => {
    expect(DEFAULT_CHAIN.id).toBe('arc');
    expect(DEFAULT_CHAIN.chainId).toBe(5042002);
    expect(DEFAULT_CHAIN.testnet).toBe(true);
    expect(DEFAULT_CHAIN.nativeSymbol).toBe('USDC');
    expect(DEFAULT_CHAIN.nativeDecimals).toBe(6);
    expect(DEFAULT_CHAIN.rpcUrl).toBe('https://rpc.testnet.arc.io');
    expect(DEFAULT_CHAIN.explorerUrl).toBe('https://explorer.testnet.arc.io');
    expect(DEFAULT_CHAIN.exitStablecoin).toBe('USDC');
  });

  it('the active chain list is the six mainnets plus the four EVM testnets, plus Plasma and Pi', () => {
    expect(ACTIVE_CHAINS.map((c) => c.id)).toEqual([
      'arc', 'bnb', 'bnb-testnet', 'base', 'base-sepolia', 'ethereum', 'ethereum-sepolia', 'polygon', 'polygon-amoy', 'solana',
      'plasma', 'plasma-testnet', 'pi', 'pi-testnet',
    ]);
    for (const id of ['arc', 'bnb', 'bnb-testnet', 'base', 'base-sepolia', 'ethereum', 'ethereum-sepolia', 'polygon', 'polygon-amoy', 'solana', 'plasma', 'plasma-testnet', 'pi', 'pi-testnet']) {
      expect(isChainActive(id)).toBe(true);
      expect(getChain(id).active).toBe(true);
    }
    // Arc MAINNET is a separate registry entry and stays disabled until
    // a mainnet deployment is explicitly approved.
    expect(isChainActive('arc-mainnet')).toBe(false);
  });

  it('the four EVM testnets have their verified chain ids and stablecoins', () => {
    expect(getChain('bnb-testnet').chainId).toBe(97);
    expect(getChain('bnb-testnet').exitStablecoin).toBe('BUSD');
    expect(getChain('base-sepolia').chainId).toBe(84532);
    expect(getChain('base-sepolia').exitStablecoinAddress).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
    expect(getChain('ethereum-sepolia').chainId).toBe(11155111);
    // Corrected Sepolia V2 router — 0x7a250d… is mainnet/Goerli only.
    expect(getChain('ethereum-sepolia').uniswapV2Router).toBe('0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3');
    expect(getChain('polygon-amoy').chainId).toBe(80002);
    expect(getChain('polygon-amoy').nativeSymbol).toBe('POL');
    for (const id of ['bnb-testnet', 'base-sepolia', 'ethereum-sepolia', 'polygon-amoy']) {
      expect(getChain(id).testnet).toBe(true);
      expect(getChain(id).vaultContract).toBeNull();
    }
  });

  it('BNB / Base / Ethereum / Polygon chain ids are the well-known mainnet ids', () => {
    expect(getChain('bnb').chainId).toBe(56);
    expect(getChain('base').chainId).toBe(8453);
    expect(getChain('ethereum').chainId).toBe(1);
    expect(getChain('polygon').chainId).toBe(137);
    expect(getChainByEvmId(56)?.id).toBe('bnb');
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
    expect(getChainByEvmId(9746)?.id).toBe('plasma-testnet');
  });

  it('Plasma testnet is coming-soon with no verified router or stablecoin', () => {
    const p = getChain('plasma-testnet');
    expect(p.kind).toBe('evm');
    expect(p.chainId).toBe(9746);
    expect(p.rpcUrl).toBe('https://testnet-rpc.plasma.to');
    expect(p.explorerUrl).toBe('https://testnet.plasmascan.to');
    expect(p.exitStablecoinAddress).toBeNull();
    expect(p.uniswapV3Router).toBeUndefined();
    expect(p.vaultContract).toBeNull();
    expect(p.comingSoon).toBe(true);
    expect(p.testnet).toBe(true);
    expect(isChainUsable(p)).toBe(false);
  });

  it('Pi is non-EVM (kind pi), no chain id, Horizon API — never an EVM RPC', () => {
    for (const id of ['pi', 'pi-testnet']) {
      const piChain = getChain(id);
      expect(piChain.kind).toBe('pi');
      expect(piChain.chainId).toBeNull();
      expect(piChain.nativeSymbol).toBe('PI');
      expect(piChain.nativeDecimals).toBe(7);
      expect(piChain.exitStablecoinAddress).toBeNull();
      expect(piChain.vaultContract).toBeNull();
      expect(piChain.comingSoon).toBe(true);
      expect(isChainUsable(piChain)).toBe(false);
    }
    expect(getChain('pi').rpcUrl).toBe('https://api.mainnet.minepi.com');
    expect(getChain('pi-testnet').rpcUrl).toBe('https://api.testnet.minepi.com');
    expect(getChain('pi-testnet').testnet).toBe(true);
    // No EVM id resolves to Pi.
    expect(getChainByEvmId(9745)?.id).toBe('plasma');
  });

  it('usable chains exclude every coming-soon chain', () => {
    expect(USABLE_CHAINS.map((c) => c.id)).toEqual([
      'arc', 'bnb', 'bnb-testnet', 'base', 'base-sepolia', 'ethereum', 'ethereum-sepolia', 'polygon', 'polygon-amoy', 'solana', 'plasma',
    ]);
    for (const id of ['plasma-testnet', 'pi', 'pi-testnet']) {
      expect(USABLE_CHAINS.some((c) => c.id === id)).toBe(false);
    }
  });

  it('unknown chain ids fall back to the default', () => {
    expect(getChain('nope').id).toBe('arc');
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
    const s = getVaultDeploymentStatus('arc');
    expect(s.deployed).toBe(false);
    if (!s.deployed) expect(s.message).toBe(VAULT_NOT_DEPLOYED_MESSAGE);
    expect(() => requireVaultAddress('arc')).toThrow(/Not deployed on this chain yet/);
  });
});
