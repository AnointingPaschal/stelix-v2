/** Chain registry tests — Arc default, verified ids, vault not deployed.
 * Restored 2026-11-27: all six chains active again at the user's
 * instruction (the 2026-11-27 Arc + BNB scope-down is reversed).
 * Arc MAINNET (arc-mainnet) stays disabled until a mainnet deployment
 * is explicitly approved — it is not one of the six. */
import {
  ACTIVE_CHAINS,
  CHAINS,
  DEFAULT_CHAIN,
  VAULT_ADDRESSES,
  VAULT_NOT_DEPLOYED_MESSAGE,
  getChain,
  getChainByEvmId,
  getVaultAddress,
  getVaultDeploymentStatus,
  isChainActive,
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

  it('the active chain list is the six mainnets plus the four EVM testnets', () => {
    expect(ACTIVE_CHAINS.map((c) => c.id)).toEqual([
      'arc', 'bnb', 'bnb-testnet', 'base', 'base-sepolia', 'ethereum', 'ethereum-sepolia', 'polygon', 'polygon-amoy', 'solana',
    ]);
    for (const id of ['arc', 'bnb', 'bnb-testnet', 'base', 'base-sepolia', 'ethereum', 'ethereum-sepolia', 'polygon', 'polygon-amoy', 'solana']) {
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
      expect(c.exitStablecoinAddress).toBeTruthy();
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
