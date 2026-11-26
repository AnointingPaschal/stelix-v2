/** Multichain registry — data, not code (spec Part C).
 *  Arc is the DEFAULT chain. Solana is a separate Anchor program with the
 *  same UX and rules. The exit stablecoin is registry-driven per chain:
 *  USDT where listed, otherwise the named stablecoin (Arc: USDC) — never a
 *  vague promise. Contract addresses are placeholders until the admin
 *  Contract Studio deploys StelixVault per chain (testnet-first). */

export type ChainKind = 'evm' | 'solana';

export interface ChainConfig {
  id: string;
  name: string;
  chainId: number | null; // null for Solana (no EVM chain id)
  kind: ChainKind;
  nativeSymbol: string;
  nativeName: string;
  /** Stablecoin the user receives on an auto-sell on this chain. */
  exitStablecoin: 'USDT' | 'USDC';
  exitStablecoinLabel: string; // exact in-app label, e.g. "auto-sell to USDT"
  rpcUrl: string;
  explorerUrl: string;
  dex: string;
  vaultContract: string | null; // null = not deployed yet
  status: 'live' | 'testnet' | 'paused' | 'coming-soon';
  isDefault?: boolean;
  testnet?: boolean;
}

export const CHAINS: ChainConfig[] = [
  {
    id: 'arc',
    name: 'Arc',
    chainId: 5042002,
    kind: 'evm',
    nativeSymbol: 'USDC',
    nativeName: 'USD Coin (Arc gas asset)',
    exitStablecoin: 'USDC',
    exitStablecoinLabel: 'auto-sell to USDC',
    rpcUrl: 'https://rpc.arc.network',
    explorerUrl: 'https://explorer.arc.network',
    dex: 'Arc DEX / aggregator (admin registry)',
    vaultContract: null,
    status: 'testnet',
    isDefault: true,
    testnet: true,
  },
  {
    id: 'bnb',
    name: 'BNB Chain',
    chainId: 56,
    kind: 'evm',
    nativeSymbol: 'BNB',
    nativeName: 'BNB',
    exitStablecoin: 'USDT',
    exitStablecoinLabel: 'auto-sell to USDT',
    rpcUrl: 'https://bsc-dataseed.bnbchain.org',
    explorerUrl: 'https://bscscan.com',
    dex: 'PancakeSwap + aggregator',
    vaultContract: null,
    status: 'live',
  },
  {
    id: 'base',
    name: 'Base',
    chainId: 8453,
    kind: 'evm',
    nativeSymbol: 'ETH',
    nativeName: 'Ether',
    exitStablecoin: 'USDC',
    exitStablecoinLabel: 'auto-sell to USDC',
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    dex: 'Base DEX aggregator',
    vaultContract: null,
    status: 'live',
  },
  {
    id: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    kind: 'evm',
    nativeSymbol: 'ETH',
    nativeName: 'Ether',
    exitStablecoin: 'USDT',
    exitStablecoinLabel: 'auto-sell to USDT',
    rpcUrl: 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
    dex: 'Mainnet aggregator',
    vaultContract: null,
    status: 'live',
  },
  {
    id: 'polygon',
    name: 'Polygon',
    chainId: 137,
    kind: 'evm',
    nativeSymbol: 'POL',
    nativeName: 'Polygon',
    exitStablecoin: 'USDT',
    exitStablecoinLabel: 'auto-sell to USDT',
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    dex: 'Polygon aggregator',
    vaultContract: null,
    status: 'live',
  },
  {
    id: 'solana',
    name: 'Solana',
    chainId: null,
    kind: 'solana',
    nativeSymbol: 'SOL',
    nativeName: 'Solana',
    exitStablecoin: 'USDT',
    exitStablecoinLabel: 'auto-sell to USDT',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    explorerUrl: 'https://explorer.solana.com',
    dex: 'Jupiter aggregator',
    vaultContract: null, // Anchor program ID registered in admin Chain Manager
    status: 'live',
  },
];

export const DEFAULT_CHAIN = CHAINS.find((c) => c.isDefault) ?? CHAINS[0];

export function getChain(id: string): ChainConfig {
  return CHAINS.find((c) => c.id === id) ?? DEFAULT_CHAIN;
}

/** Stelix fee / guard defaults from the spec (admin-configurable in production). */
export const VAULT_DEFAULTS = {
  slippageBps: 150, // 1.5% default slippage
  maxPriceImpactBps: 500, // 5% — above this, extra confirmation / split
  twapWindowMinutes: 30,
  autoSellFeeBps: 0, // set in admin before mainnet; shown in review screen
  breakCoolingOffHours: 24,
  guardianBreakDelayHours: 48,
} as const;
