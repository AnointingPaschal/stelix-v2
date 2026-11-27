/**
 * Multichain registry — live data, no placeholder values.
 *
 * RESTORED (2026-11-27): all six chains are active again at the user's
 * instruction ("work with all chains from beginning"). The scope-down
 * of 2026-11-27 (Arc + BNB only) is reversed. ACTIVE_CHAINS is the
 * only list the UI and fetchers may use; CHAINS is the full registry.
 * The `active` flag stays so a chain can be disabled again later
 * (e.g. from the admin Chain Manager — see apps/mobile/SCOPE.md).
 *
 * Arc is the DEFAULT chain and is TESTNET-FIRST (chain id 5042002).
 * Verified against Arc docs (docs.arc.io, 2026-11-27):
 *   - Arc Testnet chain id: 5042002 (0x4cef52)
 *   - Arc Testnet RPC (primary): https://rpc.testnet.arc.io
 *     (the old hostname https://rpc.testnet.arc.network no longer
 *     resolves — UnknownHostException on device — and is absent from
 *     current Arc docs; do not restore it)
 *   - Arc Testnet fallbacks (docs.arc.io):
 *     https://rpc.blockdaemon.testnet.arc.io,
 *     https://rpc.drpc.testnet.arc.io,
 *     https://rpc.quicknode.testnet.arc.io
 *   - Arc Testnet explorer: https://explorer.testnet.arc.io
 *   - Native gas asset: USDC, 6 decimals (NOT 18)
 * Arc MAINNET (chain id 5042, live 2026-09-16) is registered below as
 * `arc-mainnet` — registry source data ONLY, never a picker entry.
 * The picker shows ONE 'Arc' entry whose variant is chosen by the
 * admin network_mode (see collapseArcPair in lib/adminSync.ts):
 * testnet variant until the admin sets mainnet mode.
 * against docs.arc.io ("Connect to Arc" and "RPC endpoints", checked
 * 2026-11-27: mainnet 5042 / testnet 5042002, RPC
 * https://rpc.mainnet.arc.io, explorer https://explorer.arc.io) and
 * matches the admin registry (apps/admin/src/lib/arcNetworks.ts) —
 * 5042001 is not an Arc chain id. The wallet stays
 * testnet-first for Arc and the picker shows only active chains, so
 * mainnet is not selectable until that decision. Its RPC, explorer,
 * USDC and Uniswap router addresses are recorded here so Contract
 * Studio / admin can read them from the registry without re-verifying.
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
  exitStablecoin: 'USDT' | 'USDC' | 'BUSD';
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
  /** Uniswap V3 SwapRouter02 address on this chain (undefined = none confirmed). */
  uniswapV3Router?: string | null;
  /** Uniswap V2 Router02 address on this chain (undefined = none confirmed). */
  uniswapV2Router?: string | null;
  /** DEX router address registered in the admin Chain Manager (verified on
   *  the explorer only, never guessed). null = not confirmed yet. Swap
   *  execution does NOT use this yet — it uses the verified per-chain
   *  routers in lib/swap.ts — but the merged chain carries it so the UI
   *  can say honestly whether a router is registered for the chain. */
  dexRouter?: string | null;
  /** Slug of the paired chain (testnet ↔ mainnet pair, e.g. arc ↔
   *  arc-mainnet), from the admin registry. Used when the admin flips the
   *  global network mode: the wallet moves to the pair when it exists. */
  pairedChainId?: string | null;
  vaultContract: string | null; // null = not deployed yet
  status: 'live' | 'testnet' | 'paused' | 'coming-soon';
  isDefault?: boolean;
  testnet?: boolean;
  /**
   * Scope flag — false = disabled (chain stays in the registry so it
   * can be re-enabled by flipping this to true, e.g. from the admin
   * Chain Manager — see apps/mobile/SCOPE.md); while false the chain
   * must not appear in any picker, list or fetch. All six chains are
   * active as restored 2026-11-27 at the user's instruction.
   */
  active: boolean;
}

/** Env override for a chain's RPC, e.g. EXPO_PUBLIC_ARC_RPC_URL. Never a key.
 *  `envId` overrides the env-var stem (needed when the chain id contains
 *  a hyphen, e.g. 'arc-mainnet' -> EXPO_PUBLIC_ARC_MAINNET_RPC_URL). */
function rpcFromEnv(chainId: string, fallback: string, envId?: string): string {
  const v =
    typeof process !== 'undefined'
      ? (process.env as Record<string, string | undefined>)[
          `EXPO_PUBLIC_${(envId ?? chainId).toUpperCase()}_RPC_URL`
        ]
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
    // TO-CONFIRM on explorer.testnet.arc.io before any mainnet use.
    exitStablecoinAddress: '0x3600000000000000000000000000000000000000',
    rpcUrl: rpcFromEnv('arc', 'https://rpc.testnet.arc.io'),
    rpcUrls: [
      'https://rpc.testnet.arc.io',
      'https://rpc.blockdaemon.testnet.arc.io',
      'https://rpc.drpc.testnet.arc.io',
      'https://rpc.quicknode.testnet.arc.io',
    ],
    explorerUrl: 'https://explorer.testnet.arc.io',
    explorerApiUrl: 'https://explorer.testnet.arc.io/api',
    dexScreenerChainId: 'arc',
    geckoTerminalNetwork: 'arc',
    dex: 'Arc DEX / aggregator (admin registry)',
    vaultContract: null,
    status: 'testnet',
    isDefault: true,
    testnet: true,
    active: true,
    // Testnet ↔ mainnet pair (Arc testnet 5042002 ↔ Arc mainnet 5042).
    // The admin row wins when it sets paired_chain_id; this is the
    // fallback so a mode flip works even before the admin fills it in.
    pairedChainId: 'arc-mainnet',
  },
  {
    id: 'arc-mainnet',
    name: 'Arc Mainnet',
    chainId: 5042,
    kind: 'evm',
    nativeSymbol: 'USDC',
    nativeName: 'USD Coin (Arc gas asset)',
    nativeDecimals: 6,
    exitStablecoin: 'USDC',
    exitStablecoinLabel: 'auto-sell to USDC',
    // Arc mainnet USDC — same well-known native-USDC precompile address
    // as testnet (0x3600...0000).
    exitStablecoinAddress: '0x3600000000000000000000000000000000000000',
    rpcUrl: rpcFromEnv('arc-mainnet', 'https://rpc.mainnet.arc.io', 'arc_mainnet'),
    rpcUrls: ['https://rpc.mainnet.arc.io'],
    explorerUrl: 'https://explorer.arc.io',
    explorerApiUrl: 'https://explorer.arc.io/api',
    dexScreenerChainId: 'arc',
    geckoTerminalNetwork: 'arc',
    dex: 'Uniswap V3 (SwapRouter02) / V2 (Router02)',
    // Uniswap routers published for Arc MAINNET (5042) only — verified
    // via Uniswap contracts PR 144 / docs.arc.io. NEVER use these on
    // Arc testnet (5042002); testnet has no verified router yet.
    uniswapV3Router: '0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77',
    uniswapV2Router: '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA',
    vaultContract: null,
    status: 'live',
    // DISABLED in the wallet: Arc stays TESTNET-FIRST until a mainnet
    // deployment is explicitly approved. The entry exists so Contract
    // Studio / admin can read mainnet RPC, explorer, USDC and routers
    // from the registry; the picker only shows active chains, so this
    // is not selectable. Re-enable by flipping active: true (see
    // apps/mobile/SCOPE.md) — only after that mainnet decision.
    active: false,
    pairedChainId: 'arc',
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
    active: true,
  },
  {
    id: 'bnb-testnet',
    name: 'BNB Testnet',
    chainId: 97,
    kind: 'evm',
    nativeSymbol: 'tBNB',
    nativeName: 'BNB (testnet)',
    nativeDecimals: 18,
    exitStablecoin: 'BUSD',
    exitStablecoinLabel: 'auto-sell to BUSD (testnet)',
    // BUSD test token on BNB Testnet — verified on testnet BscScan
    // 2026-11-27, 18 decimals. A test token, not issuer-backed BUSD.
    exitStablecoinAddress: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7',
    rpcUrl: 'https://bsc-testnet-dataseed.bnbchain.org',
    rpcUrls: ['https://bsc-testnet-dataseed.bnbchain.org', 'https://bsc-testnet.bnbchain.org'],
    explorerUrl: 'https://testnet.bscscan.com',
    explorerApiUrl: 'https://api-testnet.bscscan.com/api',
    dexScreenerChainId: 'bsc',
    geckoTerminalNetwork: 'bsc',
    dex: 'PancakeSwap V2 (testnet)',
    // PancakeRouter on BNB Testnet — verified on testnet BscScan
    // 2026-11-27, 153,719 txs, swaps hours ago.
    uniswapV2Router: '0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3',
    vaultContract: null,
    status: 'testnet',
    testnet: true,
    active: true,
    pairedChainId: 'bnb',
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
    active: true,
  },
  {
    id: 'base-sepolia',
    name: 'Base Sepolia',
    chainId: 84532,
    kind: 'evm',
    nativeSymbol: 'ETH',
    nativeName: 'Ether (testnet)',
    nativeDecimals: 18,
    exitStablecoin: 'USDC',
    exitStablecoinLabel: 'auto-sell to USDC',
    exitStablecoinAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    rpcUrl: 'https://sepolia.base.org',
    rpcUrls: ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com'],
    explorerUrl: 'https://sepolia.basescan.org',
    explorerApiUrl: 'https://api-sepolia.basescan.org/api',
    dexScreenerChainId: 'base',
    geckoTerminalNetwork: 'base',
    dex: 'Uniswap V3 (Sepolia)',
    uniswapV3Router: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
    vaultContract: null,
    status: 'testnet',
    testnet: true,
    active: true,
    pairedChainId: 'base',
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
    active: true,
  },
  {
    id: 'ethereum-sepolia',
    name: 'Ethereum Sepolia',
    chainId: 11155111,
    kind: 'evm',
    nativeSymbol: 'ETH',
    nativeName: 'Ether (testnet)',
    nativeDecimals: 18,
    exitStablecoin: 'USDC',
    exitStablecoinLabel: 'auto-sell to USDC',
    exitStablecoinAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    rpcUrl: 'https://rpc.sepolia.org',
    rpcUrls: ['https://rpc.sepolia.org', 'https://ethereum-sepolia-rpc.publicnode.com'],
    explorerUrl: 'https://sepolia.etherscan.io',
    explorerApiUrl: 'https://api-sepolia.etherscan.io/api',
    dexScreenerChainId: 'ethereum',
    geckoTerminalNetwork: 'eth',
    dex: 'Uniswap V2 (Sepolia)',
    // Corrected Sepolia V2 Router02 (Uniswap official deployments).
    // 0x7a250d… is mainnet/Goerli only — never use it on Sepolia.
    uniswapV2Router: '0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3',
    uniswapV3Router: '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E',
    vaultContract: null,
    status: 'testnet',
    testnet: true,
    active: true,
    pairedChainId: 'ethereum',
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
    active: true,
  },
  {
    id: 'polygon-amoy',
    name: 'Polygon Amoy',
    chainId: 80002,
    kind: 'evm',
    nativeSymbol: 'POL',
    nativeName: 'Polygon (testnet)',
    nativeDecimals: 18,
    exitStablecoin: 'USDC',
    exitStablecoinLabel: 'auto-sell to USDC',
    exitStablecoinAddress: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    rpcUrl: 'https://rpc-amoy.polygon.technology',
    rpcUrls: ['https://rpc-amoy.polygon.technology', 'https://polygon-amoy.drpc.org'],
    explorerUrl: 'https://amoy.polygonscan.com',
    explorerApiUrl: 'https://api-amoy.polygonscan.com/api',
    dexScreenerChainId: 'polygon',
    geckoTerminalNetwork: 'polygon_pos',
    dex: 'No verified router on Amoy yet — vault deploys refused',
    vaultContract: null,
    status: 'testnet',
    testnet: true,
    active: true,
    pairedChainId: 'polygon',
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
    active: true,
  },
];

export const DEFAULT_CHAIN = CHAINS.find((c) => c.isDefault) ?? CHAINS[0];

/**
 * The chains the wallet may use: every chain with active: true
 * (all six, as restored 2026-11-27). Every picker, token list,
 * fetcher and Discover filter must read this list (or isChainActive),
 * never CHAINS directly — CHAINS includes disabled entries kept only
 * so they can be re-enabled later.
 */
export const ACTIVE_CHAINS: ChainConfig[] = CHAINS.filter((c) => c.active);

/** True when the chain id is active. */
export function isChainActive(id: string): boolean {
  return CHAINS.some((c) => c.id === id && c.active);
}

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
  'arc-mainnet': null,
  bnb: null,
  'bnb-testnet': null,
  base: null,
  'base-sepolia': null,
  ethereum: null,
  'ethereum-sepolia': null,
  polygon: null,
  'polygon-amoy': null,
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

// ---------------------------------------------------------------------------
// Launchpad contract registry — StelixTokenFactory + StelixLaunchpad
// (contracts/src/launchpad/). Both null until deployed on Arc testnet and
// registered here AND in the admin D1 `deployments` table. Fill an address
// ONLY after a verified testnet deploy; see contracts/DEPLOY_ARC_TESTNET.md.
// The launchpad is FREE: no Stelix launch fee, gas only (Arc USDC gas).
// ---------------------------------------------------------------------------

export const LAUNCHPAD_NOT_DEPLOYED_MESSAGE =
  'Launchpad contracts are not deployed on Arc testnet yet';

export const TOKEN_FACTORY_ADDRESSES: Record<string, string | null> = {
  arc: null,
  'arc-mainnet': null,
  bnb: null,
  base: null,
  ethereum: null,
  polygon: null,
  solana: null,
};

export const LAUNCHPAD_ADDRESSES: Record<string, string | null> = {
  arc: null,
  'arc-mainnet': null,
  bnb: null,
  base: null,
  ethereum: null,
  polygon: null,
  solana: null,
};

export type LaunchpadDeploymentStatus =
  | { deployed: true; factory: string; launchpad: string }
  | { deployed: false; factory: string | null; launchpad: string | null; message: string };

export function getLaunchpadDeploymentStatus(chainId: string): LaunchpadDeploymentStatus {
  const factory = TOKEN_FACTORY_ADDRESSES[chainId] ?? null;
  const launchpad = LAUNCHPAD_ADDRESSES[chainId] ?? null;
  if (factory && launchpad) return { deployed: true, factory, launchpad };
  return { deployed: false, factory, launchpad, message: LAUNCHPAD_NOT_DEPLOYED_MESSAGE };
}

/** Throws when the launchpad is not deployed on this chain. Use before any
 *  on-chain launchpad call so the UI can show the not-deployed state. */
export function requireLaunchpadAddress(chainId: string): string {
  const status = getLaunchpadDeploymentStatus(chainId);
  if (!status.deployed) {
    throw new Error(
      `${LAUNCHPAD_NOT_DEPLOYED_MESSAGE} (${getChain(chainId).name}). ` +
        'Launches go live once the launchpad contracts are deployed on Arc testnet.',
    );
  }
  return status.launchpad;
}

export function requireTokenFactoryAddress(chainId: string): string {
  const status = getLaunchpadDeploymentStatus(chainId);
  if (!status.deployed) {
    throw new Error(
      `${LAUNCHPAD_NOT_DEPLOYED_MESSAGE} (${getChain(chainId).name}). ` +
        'Token creation goes live once the launchpad contracts are deployed on Arc testnet.',
    );
  }
  return status.factory;
}
