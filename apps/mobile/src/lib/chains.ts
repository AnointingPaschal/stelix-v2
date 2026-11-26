/**
 * Multichain registry — live data, no placeholder values.
 *
 * Arc is the DEFAULT chain and is TESTNET-FIRST (chain id 5042002).
 * Verified against Arc docs / Circle docs (2026-11-26):
 *   - Arc Testnet chain id: 5042002 (0x4cef52)
 *   - Arc Testnet RPC (primary, resolves): https://rpc.testnet.arc.network
 *   - Arc Testnet explorer: https://testnet.arcscan.app (Blockscout)
 *   - Native gas asset: USDC, 6 decimals (NOT 18)
 *   - Arc Mainnet chain id 5042 / https://rpc.mainnet.arc.io is reported by
 *     third-party RPC lists, but Stelix stays on Arc TESTNET until a
 *     mainnet deployment is explicitly approved — do not flip this file
 *     to mainnet without that decision.
 * The old values `https://rpc.arc.network` / `https://explorer.arc.network`
 * were unverified and did not resolve; they have been removed.
 *
 * The exit stablecoin is registry-driven per chain: USDT where listed,
 * otherwise the named stablecoin (Arc: USDC) — never vague.
 * StelixVault addresses are null until deployed per chain (testnet-first);
 * see VAULT_ADDRESSES / getVaultAddress().
 */

export type ChainKind = 'evm' | 'solana';

export interface ChainConfig {
  id: string;
  name: string;
  chainId: number | null; // null for Solana (no EVM chain id)
  kind: ChainKind;
  nativeSymbol: string;
  nativeName: string;
  /** Decimals of the native gas asset (Arc USDC = 6, most EVM = 18). */
  nativeDecimals: number;
  /** Stablecoin the user receives on an auto-sell on this chain. */
  exitStablecoin: 'USDT' | 'USDC';
  exitStablecoinLabel: string; // exact in-app label, e.g. "auto-sell to USDT"
  /** Exit stablecoin contract address on this chain (null = confirm before use). */
  exitStablecoinAddress: string | null;
  rpcUrl: string;
  rpcUrls: string[];
  explorerUrl: string;
  /** Etherscan-family explorer API base (null = no public explorer API wired). */
  explorerApiUrl: string | null;
  /** DexScreener chain slug used in api.dexscreener.com URLs. */
  dexScreenerChainId: string;
  /** GeckoTerminal network slug used in api.geckoterminal.com URLs. */
  geckoTerminalNetwork: string;
  dex: string;
  vaultContract: string | null; // null = not deployed yet
  status: 'live' | 'testnet' | 'paused' | 'coming-soon';
  isDefault?: boolean;
  testnet?: boolean;
}

/** Env override for a chain's RPC, e.g. EXPO_PUBLIC_ARC_RPC_URL. Never a key. */
function rpcFromEnv(chainId: string, fallback: string): string {
  const v =
    typeof process !== 'undefined'
      ? (process.env as Record<string, string | undefined>)[`EXPO_PUBLIC_${chainId.toUpperCase()}_RPC_URL`]
      : undefined;
  return v && v.startsWith('http') ? v : fallback;
}

export const CHAINS: ChainConfig[] = [
  {
    id: 'arc',
    name: 'Arc',
    chainId: 5042002,
    kind: 'evm',
    nativeSymbol: 'USDC',
    nativeName: 'USD Coin (Arc gas asset)',
    nativeDecimals: 6,
    exitStablecoin: 'USDC',
    exitStablecoinLabel: 'auto-sell to USDC',
    // Arc testnet USDC as native gas asset. Address is the well-known
    // native-USDC precompile address reported in Arc testnet guides;
    // TO-CONFIRM on testnet.arcscan.app before any mainnet use.
    exitStablecoinAddress: '0x3600000000000000000000000000000000000000',
    rpcUrl: rpcFromEnv('arc', 'https://rpc.testnet.arc.network'),
    rpcUrls: [
      'https://rpc.testnet.arc.network',
      'https://rpc.blockdaemon.testnet.arc.network',
      'https://rpc.drpc.testnet.arc.network',
    ],
    explorerUrl: 'https://testnet.arcscan.app',
    explorerApiUrl: 'https://testnet.arcscan.app/api',
    dexScreenerChainId: 'arc',
    geckoTerminalNetwork: 'arc',
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
    nativeDecimals: 18,
    exitStablecoin: 'USDT',
    exitStablecoinLabel: 'auto-sell to USDT',
    exitStablecoinAddress: '0x55d398326f99059fF775485246999027B3197955',
    rpcUrl: rpcFromEnv('bnb', 'https://bsc-dataseed.bnbchain.org'),
    rpcUrls: [
      'https://bsc-dataseed.bnbchain.org',
      'https://bsc-dataseed1.defibit.io',
      'https://bsc-dataseed1.ninicoin.io',
    ],
    explorerUrl: 'https://bscscan.com',
    explorerApiUrl: 'https://api.bscscan.com/api',
    dexScreenerChainId: 'bsc',
    geckoTerminalNetwork: 'bsc',
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
    nativeDecimals: 18,
    exitStablecoin: 'USDC',
    exitStablecoinLabel: 'auto-sell to USDC',
    exitStablecoinAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bd029029',
    rpcUrl: rpcFromEnv('base', 'https://mainnet.base.org'),
    rpcUrls: ['https://mainnet.base.org', 'https://base.llamarpc.com'],
    explorerUrl: 'https://basescan.org',
    explorerApiUrl: 'https://api.basescan.org/api',
    dexScreenerChainId: 'base',
    geckoTerminalNetwork: 'base',
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
    nativeDecimals: 18,
    exitStablecoin: 'USDT',
    exitStablecoinLabel: 'auto-sell to USDT',
    exitStablecoinAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    rpcUrl: rpcFromEnv('ethereum', 'https://eth.llamarpc.com'),
    rpcUrls: ['https://eth.llamarpc.com', 'https://ethereum.publicnode.com'],
    explorerUrl: 'https://etherscan.io',
    explorerApiUrl: 'https://api.etherscan.io/api',
    dexScreenerChainId: 'ethereum',
    geckoTerminalNetwork: 'eth',
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
    nativeDecimals: 18,
    exitStablecoin: 'USDT',
    exitStablecoinLabel: 'auto-sell to USDT',
    exitStablecoinAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
    rpcUrl: rpcFromEnv('polygon', 'https://polygon-rpc.com'),
    rpcUrls: ['https://polygon-rpc.com', 'https://polygon.llamarpc.com'],
    explorerUrl: 'https://polygonscan.com',
    explorerApiUrl: 'https://api.polygonscan.com/api',
    dexScreenerChainId: 'polygon',
    geckoTerminalNetwork: 'polygon_pos',
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
    nativeDecimals: 9,
    exitStablecoin: 'USDT',
    exitStablecoinLabel: 'auto-sell to USDT',
    exitStablecoinAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    rpcUrl: rpcFromEnv('solana', 'https://api.mainnet-beta.solana.com'),
    rpcUrls: ['https://api.mainnet-beta.solana.com'],
    explorerUrl: 'https://explorer.solana.com',
    explorerApiUrl: null, // Solana history uses the RPC getSignaturesForAddress, not an explorer API
    dexScreenerChainId: 'solana',
    geckoTerminalNetwork: 'solana',
    dex: 'Jupiter aggregator',
    vaultContract: null, // Anchor program ID registered in admin Chain Manager
    status: 'live',
  },
];

export const DEFAULT_CHAIN = CHAINS.find((c) => c.isDefault) ?? CHAINS[0];

export function getChain(id: string): ChainConfig {
  return CHAINS.find((c) => c.id === id) ?? DEFAULT_CHAIN;
}

export function getChainByEvmId(chainId: number): ChainConfig | null {
  return CHAINS.find((c) => c.chainId === chainId) ?? null;
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

// ---------------------------------------------------------------------------
// StelixVault contract registry — all null until deployed (testnet-first).
// Fill an address ONLY after a verified testnet/mainnet deploy, and record
// chain + address + tx hash + compiler version in contracts/README.md.
// ---------------------------------------------------------------------------

export const VAULT_NOT_DEPLOYED_MESSAGE =
  'Not deployed on this chain yet — testnet deploy required';

export const VAULT_ADDRESSES: Record<string, string | null> = {
  arc: null,
  bnb: null,
  base: null,
  ethereum: null,
  polygon: null,
  solana: null, // Anchor program ID, not an EVM address
};

export function getVaultAddress(chainId: string): string | null {
  const fromRegistry = VAULT_ADDRESSES[chainId] ?? null;
  if (fromRegistry) return fromRegistry;
  return getChain(chainId).vaultContract;
}

export type VaultDeploymentStatus =
  | { deployed: true; address: string }
  | { deployed: false; address: null; message: string };

export function getVaultDeploymentStatus(chainId: string): VaultDeploymentStatus {
  const address = getVaultAddress(chainId);
  if (address) return { deployed: true, address };
  return { deployed: false, address: null, message: VAULT_NOT_DEPLOYED_MESSAGE };
}

/** Throws when the vault is not deployed on this chain. Use before any
 *  on-chain vault call so the UI can show the not-deployed state. */
export function requireVaultAddress(chainId: string): string {
  const status = getVaultDeploymentStatus(chainId);
  if (!status.deployed) {
    throw new Error(
      `${VAULT_NOT_DEPLOYED_MESSAGE} (${getChain(chainId).name}). ` +
        'Locks on this chain are unavailable until StelixVault is deployed and registered here.',
    );
  }
  return status.address;
}
