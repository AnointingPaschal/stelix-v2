/** Chain registry tests — Arc default, verified ids, vault not deployed. */
import {
  CHAINS,
  DEFAULT_CHAIN,
  VAULT_ADDRESSES,
  VAULT_NOT_DEPLOYED_MESSAGE,
  getChain,
  getChainByEvmId,
  getVaultAddress,
  getVaultDeploymentStatus,
  requireVaultAddress,
} from '../chains';

describe('chain registry', () => {
  it('Arc is the default chain, testnet, chain id 5042002, USDC gas (6 decimals)', () => {
    expect(DEFAULT_CHAIN.id).toBe('arc');
    expect(DEFAULT_CHAIN.chainId).toBe(5042002);
    expect(DEFAULT_CHAIN.testnet).toBe(true);
    expect(DEFAULT_CHAIN.nativeSymbol).toBe('USDC');
    expect(DEFAULT_CHAIN.nativeDecimals).toBe(6);
    expect(DEFAULT_CHAIN.rpcUrl).toBe('https://rpc.testnet.arc.network');
    expect(DEFAULT_CHAIN.explorerUrl).toBe('https://testnet.arcscan.app');
    expect(DEFAULT_CHAIN.exitStablecoin).toBe('USDC');
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
    expect(sol.rpcUrl).toBe('https://api.mainnet-beta.solana.com');
  });

  it('every chain names its exit stablecoin explicitly (USDT or USDC, never vague)', () => {
    for (const c of CHAINS) {
      expect(['USDT', 'USDC']).toContain(c.exitStablecoin);
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
