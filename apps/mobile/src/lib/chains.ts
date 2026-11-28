/**
 * Multichain registry — live data, no placeholder values.
 *
 * MAINNET-FIRST (2026-11-28): the built-in registry lists mainnet
 * chains ONLY. There are no hardcoded testnet entries in this file:
 * a testnet appears in the app only when the admin serves it through
 * GET /api/sync (see lib/adminChains.ts / lib/adminSync.ts) and the
 * admin's network mode allows it. Chains therefore come from the
 * admin sync; the built-ins below are the offline fallback for
 * mainnet chains.
 *
 * Arc is the DEFAULT chain: Arc Mainnet (chain id 5042, live
 * 2026-09-16), verified against Arc docs (docs.arc.io, 2026-11-27):
 * RPC https://rpc.mainnet.arc.io, explorer https://explorer.arc.io.
 * Native gas asset: USDC, 6 decimals as a *token* — but the EVM
 * native unit (eth_getBalance, tx value, gas) is always wei (18).
 * Do not format a native balance with 6; see
 * EVM_NATIVE_RPC_DECIMALS below.
 *
 * ADDED (2026-11-28): Plasma (EVM, Uniswap V3) and Pi Network
 * (Stellar-based, NOT EVM). Plasma mainnet is live with verified
 * addresses (see the `plasma` entry); Pi is `comingSoon` — shown in
 * the picker, disabled, never selectable — until its execution path
 * exists. A coming-soon chain must never become the active chain:
 * see isChainUsable / USABLE_CHAINS below and the setChain guard in
 * store/AppContext.tsx. Pi is modelled like Solana (kind 'pi'): no
 * EVM RPC, balance, swap or lock call may ever target it — every
 * EVM guard in the codebase keys off `kind !== 'evm'`.
 *
 * The exit stablecoin is registry-driven per chain: USDT where listed,
 * otherwise the named stablecoin (Arc: USDC) — never vague.
 * StelixVault addresses are null until deployed per chain;
 * see VAULT_ADDRESSES / getVaultAddress().
 */

export type ChainKind = 'evm' | 'solana' | 'pi';

/**
 * The unit every EVM native RPC value is in: eth_getBalance, the
 * transaction `value` field, gasPrice × gasLimit. It is ALWAYS 18
 * (wei), on every EVM chain — including Arc, where the USDC *token*
 * has 6 decimals. Formatting a native balance or fee with
 * chain.nativeDecimals (6 on Arc) inflates it by 10^12 and makes
 * native sends send 10^12 times too little. Found 2026-11-27 when a
 * real 30 USDC Arc balance showed as 30,000,000,000,000 USDC.
 */
export const EVM_NATIVE_RPC_DECIMALS = 18;

export interface ChainStablecoins {
  /** USDT contract address on this chain (null = no verified USDT here). */
  USDT: string | null;
  /** USDC contract address on this chain (null = no verified USDC here). */
  USDC: string | null;
}

export interface ChainConfig {
  id: string;
  name: string;
  chainId: number | null; // null for Solana (no EVM chain id)
  kind: ChainKind;
  nativeSymbol: string;
  nativeName: string;
  /** Decimals of the native gas asset as a token (Arc USDC = 6, most
   *  EVM = 18). This is the ERC-20 view of the asset — it is NOT the
   *  unit eth_getBalance / tx value / gas use. Those are always wei
   *  (see EVM_NATIVE_RPC_DECIMALS below). Never format a native RPC
   *  balance or fee with nativeDecimals. */
  nativeDecimals: number;
  /** Stablecoin the user receives on an auto-sell on this chain. */
  exitStablecoin: 'USDT' | 'USDC' | 'BUSD';
  exitStablecoinLabel: string; // exact in-app label, e.g. "auto-sell to USDT"
  /** Exit stablecoin contract address on this chain (null = confirm before use). */
  exitStablecoinAddress: string | null;
  /** Default stablecoins shown in My Assets (USDT + USDC) on this chain.
   *  Every address here was verified on the official explorer (symbol +
   *  decimals read on-chain or from the explorer token page) — null =
   *  no verified contract on this chain, never a guessed address.
   *  Absent = not applicable (non-EVM chains: Solana auto-discovers SPL
   *  tokens from the wallet's token accounts; Pi has no stablecoins). */
  stablecoins?: ChainStablecoins;
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
  /** Token factory contract on this chain, registered in the admin Chain
   *  Manager after a wallet-signed deploy from the Launchpad page.
   *  Creates ERC-20s for free (gas only). null = not deployed yet.
   *  The wallet reads a token's logoURI from it on-chain
   *  (getTokenByAddress), so a factory token's logo shows wherever the
   *  address is imported. */
  tokenFactoryAddress?: string | null;
  /** Launchpad sale contract on this chain, registered in the admin
   *  Chain Manager after a wallet-signed deploy. null = not deployed
   *  yet — launches cannot go live on the chain without it. */
  launchpadAddress?: string | null;
  /** Slug of the paired chain (e.g. a testnet served by the admin ↔
   *  its mainnet), from the admin registry. Used when the admin flips
   *  the global network mode: the wallet moves to the pair when it
   *  exists. A pair is data from the admin sync, never hardcoded. */
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
  /**
   * Coming soon — the chain is SHOWN in the picker with a "Coming
   * soon" badge but is visibly disabled and can never be selected
   * (see lib/networkPicker.ts and the setChain guard in
   * store/AppContext.tsx). Set from the admin Chain Manager
   * (D1 `chains.coming_soon`, carried through /api/sync as the raw
   * `coming_soon` integer); absent means false. A coming-soon chain
   * is never a usable chain for balances, swaps or locks — see
   * isChainUsable.
   */
  comingSoon?: boolean;
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
    id: 'arc-mainnet',
    name: 'Arc Mainnet',
    chainId: 5042,
    kind: 'evm',
    nativeSymbol: 'USDC',
    nativeName: 'USD Coin (Arc gas asset)',
    nativeDecimals: 6,
    exitStablecoin: 'USDC',
    exitStablecoinLabel: 'auto-sell to USDC',
    // Arc mainnet USDC — the well-known native-USDC precompile
    // address (0x3600...0000).
    exitStablecoinAddress: '0x3600000000000000000000000000000000000000',
    // No verified USDT on Arc mainnet; USDC is the native gas asset.
    stablecoins: { USDT: null, USDC: '0x3600000000000000000000000000000000000000' },
    rpcUrl: rpcFromEnv('arc-mainnet', 'https://rpc.mainnet.arc.io', 'arc_mainnet'),
    rpcUrls: ['https://rpc.mainnet.arc.io'],
    explorerUrl: 'https://explorer.arc.io',
    explorerApiUrl: 'https://explorer.arc.io/api',
    dexScreenerChainId: 'arc',
    geckoTerminalNetwork: 'arc',
    dex: 'Uniswap V3 (SwapRouter02) / V2 (Router02)',
    // Uniswap routers published for Arc MAINNET (5042) — verified
    // via Uniswap contracts PR 144 / docs.arc.io.
    uniswapV3Router: '0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77',
    uniswapV2Router: '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA',
    vaultContract: null,
    status: 'live',
    isDefault: true,
    active: true,
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
    // BNB USDT (18 dec) + USDC (18 dec) — re-verified on-chain 2026-11-28
    // (symbol()/decimals() via eth_call on bsc-dataseed).
    stablecoins: { USDT: '0x55d398326f99059fF775485246999027B3197955', USDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' },
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
    id: 'base',
    name: 'Base',
    chainId: 8453,
    kind: 'evm',
    nativeSymbol: 'ETH',
    nativeName: 'Ether',
    nativeDecimals: 18,
    exitStablecoin: 'USDC',
    exitStablecoinLabel: 'auto-sell to USDC',
    // Base native USDC — verified 2026-11-27 on Basescan (FiatTokenProxy)
    // and Circle docs: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913.
    // The old value …bd029029 differs in the last 7 chars and is not a
    // real contract — never use it.
    exitStablecoinAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    // Base native USDC — verified on Basescan (USDC, 6 dec). No verified
    // native USDT address on Base — null, never a guessed bridged address.
    stablecoins: { USDT: null, USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
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
    // ETH USDT (6 dec, TetherToken on Etherscan) + USDC (6 dec).
    stablecoins: { USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7', USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' },
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
    // Polygon USDT + USDC — verified 2026-11-27 on Polygonscan (both 6 dec).
    stablecoins: { USDT: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', USDC: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
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
  {
    id: 'plasma',
    name: 'Plasma',
    chainId: 9745,
    kind: 'evm',
    nativeSymbol: 'XPL',
    nativeName: 'Plasma (XPL gas asset)',
    nativeDecimals: 18,
    exitStablecoin: 'USDT',
    exitStablecoinLabel: 'auto-sell to USDT',
    // USDT0 — verified on Plasma mainnet 2026-11-28 by eth_call on
    // https://rpc.plasma.to (symbol USDT0, 6 decimals). USDC is the
    // second verified stablecoin (token0 of the USDC/USDT0 pool).
    exitStablecoinAddress: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',
    // Plasma USDT0 (symbol USDT0, 6 dec) + USDC (6 dec) — re-verified
    // on-chain 2026-11-28 (symbol()/decimals() via eth_call on rpc.plasma.to).
    // The USDT slot holds USDT0: Tether's Plasma stablecoin, not plain USDT.
    stablecoins: { USDT: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', USDC: '0x2d661c89d812261039af9764eceaaee884f5f67f' },
    rpcUrl: rpcFromEnv('plasma', 'https://rpc.plasma.to'),
    rpcUrls: ['https://rpc.plasma.to'],
    explorerUrl: 'https://plasmascan.to',
    explorerApiUrl: null, // plasmascan.to is Routescan-based; the
    // Routescan Etherscan-compatible API returns "chain not supported"
    // for 9745 (checked 2026-11-28) — history falls back to RPC.
    dexScreenerChainId: 'plasma',
    geckoTerminalNetwork: 'plasma',
    dex: 'Uniswap V3 (SwapRouter02)',
    // Uniswap V3 SwapRouter02 — canonical deployment per Uniswap
    // governance; code verified live on rpc.plasma.to 2026-11-28
    // (24,497 bytes at the address). USDC/USDT0 0.01% pool
    // 0x56cf5fc8a6d04f52df99752eed255ee8a64504de exists.
    uniswapV3Router: '0x807F4E281B7A3B324825C64ca53c69F0b418dE40',
    vaultContract: null, // not deployed yet
    status: 'live',
    active: true,
    comingSoon: false,
  },
  {
    id: 'pi',
    name: 'Pi Network',
    chainId: null, // NOT EVM — Stellar-based (Stellar Core, SCP). No EVM chain id.
    kind: 'pi',
    nativeSymbol: 'PI',
    nativeName: 'Pi',
    nativeDecimals: 7, // Stellar convention (1 PI = 10^7 micro-PI).
    exitStablecoin: 'USDT',
    exitStablecoinLabel: 'auto-sell to USDT',
    // No stablecoin, no DEX router, no vault on Pi: smart contracts
    // are internal-only for third parties (Pi Core Team, Oct 2026;
    // Protocol v28 live). A Pi vault would need a separate Soroban
    // (Rust) build, like Solana's Anchor program.
    exitStablecoinAddress: null,
    // Horizon API (Stellar), NOT an EVM JSON-RPC endpoint — never
    // pass this to ethers or any EVM call (every EVM guard keys off
    // kind !== 'evm'). Verified live 2026-11-28 (Horizon root doc).
    rpcUrl: 'https://api.mainnet.minepi.com',
    rpcUrls: ['https://api.mainnet.minepi.com'],
    explorerUrl: 'https://blockexplorer.minepi.com',
    explorerApiUrl: null,
    dexScreenerChainId: 'pi',
    geckoTerminalNetwork: 'pi',
    dex: 'No DEX on Pi yet — contracts internal-only',
    vaultContract: null,
    status: 'coming-soon',
    active: true,
    comingSoon: true,
  },
];

export const DEFAULT_CHAIN = CHAINS.find((c) => c.isDefault) ?? CHAINS[0];

/**
 * The chains the wallet may use: every chain with active: true.
 *  Every picker, token list, fetcher and Discover filter must read
 *  this list (or isChainActive), never CHAINS directly — CHAINS
 *  includes disabled entries kept only so they can be re-enabled
 *  later. Coming-soon chains ARE in this list (they are shown in the
 *  picker, disabled) — use USABLE_CHAINS for anything that actually
 *  does work on a chain.
 */
export const ACTIVE_CHAINS: ChainConfig[] = CHAINS.filter((c) => c.active);

/** A chain the wallet may actually USE for balances, swaps and locks:
 *  active AND not coming-soon. A coming-soon chain is shown in the
 *  picker (disabled) but can never become the active chain, so it
 *  must never appear here. */
export function isChainUsable(c: ChainConfig): boolean {
  return c.active && !c.comingSoon;
}

/** Chains the wallet may do work on (balances, swaps, locks, Discover).
 *  Plasma mainnet is usable; Pi is coming-soon and excluded until
 *  the admin marks it live. Testnets are never in this list: they
 *  arrive only from the admin sync. */
export const USABLE_CHAINS: ChainConfig[] = CHAINS.filter(isChainUsable);

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
// StelixVault contract registry — all null until deployed.
// Fill an address ONLY after a verified mainnet deploy, and record
// chain + address + tx hash + compiler version in contracts/README.md.
// ---------------------------------------------------------------------------

export const VAULT_NOT_DEPLOYED_MESSAGE =
  'Not deployed on this chain yet — deploy required';

export const VAULT_ADDRESSES: Record<string, string | null> = {
  'arc-mainnet': null,
  bnb: null,
  base: null,
  ethereum: null,
  polygon: null,
  solana: null, // Anchor program ID, not an EVM address
  plasma: null,
  pi: null, // Soroban program, not an EVM address — separate build
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
// (contracts/src/launchpad/). Both null until deployed on Arc and
// registered here AND in the admin D1 `deployments` table. Fill an address
// ONLY after a verified deploy.
// The launchpad is FREE: no Stelix launch fee, gas only (Arc USDC gas).
// ---------------------------------------------------------------------------

export const LAUNCHPAD_NOT_DEPLOYED_MESSAGE =
  'Launchpad contracts are not deployed on Arc yet';

export const TOKEN_FACTORY_ADDRESSES: Record<string, string | null> = {
  'arc-mainnet': null,
  bnb: null,
  base: null,
  ethereum: null,
  polygon: null,
  solana: null,
  plasma: null,
  pi: null, // no EVM factory on Pi
};

export const LAUNCHPAD_ADDRESSES: Record<string, string | null> = {
  'arc-mainnet': null,
  bnb: null,
  base: null,
  ethereum: null,
  polygon: null,
  solana: null,
  plasma: null,
  pi: null, // no EVM launchpad on Pi
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
        'Launches go live once the launchpad contracts are deployed on Arc.',
    );
  }
  return status.launchpad;
}

export function requireTokenFactoryAddress(chainId: string): string {
  const status = getLaunchpadDeploymentStatus(chainId);
  if (!status.deployed) {
    throw new Error(
      `${LAUNCHPAD_NOT_DEPLOYED_MESSAGE} (${getChain(chainId).name}). ` +
        'Token creation goes live once the launchpad contracts are deployed on Arc.',
    );
  }
  return status.factory;
}
