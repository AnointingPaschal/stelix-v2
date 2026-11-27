// Stelix Admin — verified EVM network parameters for every chain, not
// just Arc. Sources are checked 2026-11-27; do not invent others.
// D1 (chains table) is the live registry — RPC, explorer, stablecoin,
// router, vault — but it cannot say *what kind* of router or feed a
// chain needs. That lives here, keyed by D1 chain slug:
//   routerKind 'v2'  — the vault speaks V2 natively, no router adapter.
//                      The price feed is the V2 TWAP feed
//                      (PancakeV2TwapFeed, works for any V2 pair).
//   routerKind 'v3'  — the vault needs StelixV3RouterAdapter in front
//                      of the V3 SwapRouter, and UniswapV3TwapFeed as
//                      the price feed. Same as Arc.
//   routerKind 'none'— no verified router on this chain yet. The admin
//                      must refuse to deploy there until one is verified
//                      on the chain's explorer. Never guess one.
//
// Testnet rows (migration 0013): bnb-testnet, base-sepolia,
// ethereum-sepolia, polygon-amoy. Mainnet rows already exist in D1.
export type RouterKind = 'v2' | 'v3' | 'none'
export type FeedKind = 'v2-twap' | 'v3-twap' | 'none'

export interface EvmNetwork {
  /** D1 chain slug. */
  id: string
  name: string
  env: 'testnet' | 'mainnet'
  chainId: number
  rpcUrl: string
  explorerUrl: string
  nativeSymbol: string
  nativeDecimals: number
  stablecoin: string
  stablecoinAddress: string
  stablecoinDecimals: number
  routerKind: RouterKind
  /** DEX router the vault (or its V3 adapter) points at. '' = unverified. */
  dexRouter: string
  dexRouterKind: string
  feedKind: FeedKind
  /** Faucet for test gas / test stablecoin. */
  faucetUrl?: string
  /** Why this chain cannot deploy yet, when routerKind/feedKind is 'none'. */
  blocker?: string
}

export const EVM_TESTNETS: DeployNetwork[] = [  {
    id: 'bnb-testnet', name: 'BNB Testnet', env: 'testnet', chainId: 97,
    rpcUrl: 'https://bsc-testnet-dataseed.bnbchain.org',
    explorerUrl: 'https://testnet.bscscan.com',
    nativeSymbol: 'tBNB', nativeDecimals: 18,
    stablecoin: 'BUSD', stablecoinAddress: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7', stablecoinDecimals: 18,
    routerKind: 'v2', dexRouter: '0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3',
    dexRouterKind: 'PancakeSwap V2 Router (testnet)',
    feedKind: 'v2-twap',
    faucetUrl: 'https://testnet.bnbchain.org/faucet-smart',
  },
  {
    id: 'base-sepolia', name: 'Base Sepolia', env: 'testnet', chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    nativeSymbol: 'ETH', nativeDecimals: 18,
    stablecoin: 'USDC', stablecoinAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', stablecoinDecimals: 6,
    routerKind: 'v3', dexRouter: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
    dexRouterKind: 'Uniswap V3 SwapRouter02 (Base Sepolia)',
    feedKind: 'v3-twap',
    faucetUrl: 'https://coinbase.com/faucets/base-sepolia-faucet',
  },
  {
    id: 'ethereum-sepolia', name: 'Ethereum Sepolia', env: 'testnet', chainId: 11155111,
    rpcUrl: 'https://rpc.sepolia.org',
    explorerUrl: 'https://sepolia.etherscan.io',
    nativeSymbol: 'ETH', nativeDecimals: 18,
    stablecoin: 'USDC', stablecoinAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', stablecoinDecimals: 6,
    routerKind: 'v2', dexRouter: '0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3',
    dexRouterKind: 'Uniswap V2 Router02 (Sepolia)',
    feedKind: 'v2-twap',
    faucetUrl: 'https://cloud.google.com/application/web3/faucet/ethereum/sepolia',
  },
  {
    id: 'polygon-amoy', name: 'Polygon Amoy', env: 'testnet', chainId: 80002,
    rpcUrl: 'https://rpc-amoy.polygon.technology',
    explorerUrl: 'https://amoy.polygonscan.com',
    nativeSymbol: 'POL', nativeDecimals: 18,
    stablecoin: 'USDC', stablecoinAddress: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582', stablecoinDecimals: 6,
    routerKind: 'none', dexRouter: '',
    dexRouterKind: 'No verified router on Amoy yet',
    feedKind: 'none',
    faucetUrl: 'https://faucet.polygon.technology',
    blocker: 'No verified V3 router and no Chainlink feed on Polygon Amoy yet. The V3 router addresses found are unverified secondary claims only. Do not deploy on Amoy until a router is verified on amoy.polygonscan.com.',
  },
]

// Mainnet rows. Every address below was verified 2026-11-27 against an
// official source — do not invent others, and never paste a router from
// memory: two candidates supplied for this build were WRONG and were
// caught only by checking them (Base V3 SwapRouter02
// 0x2626664c2603336E57B271c5C0b26F21AB9933d8 and Base USDC
// 0x833589fCD6eDb6E08f4c7C32D4f71b54bd029029 both share their first
// 32 hex chars with the real address and differ only at the end).
//   Arc Mainnet: Uniswap/contracts deployments/json/5042.json +
//     arc.etherscan.io — V3 SwapRouter02
//     0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77 (also in arcNetworks.ts).
//     Arc also has a real V2 Router02
//     0x1f7d7550B1b028f7571E69A784071F0205FD2EfA; the vault keeps the
//     V3-adapter path, same as testnet, so nothing changes there.
//   BNB Mainnet: bscscan.com "PancakeSwap: Router v2"
//     0x10ED43C718714eb63d5aA57B78B54704E256024E. USDT is Binance-Peg
//     USDT, 18 decimals — the V2 feed constructor must get 18.
//   Ethereum Mainnet: official Uniswap V2 deployments page — V2
//     Router02 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
//     (mainnet only; Sepolia's is 0xeE567Fe…).
//   Base Mainnet: official Uniswap V3 Base deployments page — V3
//     SwapRouter02 0x2626664c2603336E57B271c5C0b26F421741e481.
//     Native USDC 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 dec,
//     Basescan FiatTokenProxy + Circle docs).
//   Polygon Mainnet: official Uniswap V3 Polygon deployments page —
//     V3 SwapRouter02 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45.
//     0xE592427A… is the v1 SwapRouter, NOT SwapRouter02: its
//     exactInputSingle takes a deadline parameter, so the adapter
//     (built for SwapRouter02's deadline-free exactInputSingle)
//     would break against it. Gas token is POL, not MATIC.
// D1 (chains table) is the live registry — migration 0014 sets the
// mainnet dex_router values there to match these, and fixes the
// wrong Base USDC that migration 0013 wrote.
export const EVM_MAINNETS: DeployNetwork[] = [
  {
    id: 'arc-mainnet', name: 'Arc Mainnet', env: 'mainnet', chainId: 5042,
    rpcUrl: 'https://rpc.mainnet.arc.io',
    explorerUrl: 'https://explorer.arc.io',
    nativeSymbol: 'USDC', nativeDecimals: 6,
    stablecoin: 'USDC', stablecoinAddress: '0x3600000000000000000000000000000000000000', stablecoinDecimals: 6,
    routerKind: 'v3', dexRouter: '0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77',
    dexRouterKind: 'Uniswap V3 SwapRouter02 (mainnet)',
    feedKind: 'v3-twap',
  },
  {
    id: 'bnb', name: 'BNB Chain', env: 'mainnet', chainId: 56,
    rpcUrl: 'https://bsc-dataseed.bnbchain.org',
    explorerUrl: 'https://bscscan.com',
    nativeSymbol: 'BNB', nativeDecimals: 18,
    stablecoin: 'USDT', stablecoinAddress: '0x55d398326f99059fF775485246999027B3197955', stablecoinDecimals: 18,
    routerKind: 'v2', dexRouter: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    dexRouterKind: 'PancakeSwap V2 Router (mainnet)',
    feedKind: 'v2-twap',
  },
  {
    id: 'base', name: 'Base', env: 'mainnet', chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    nativeSymbol: 'ETH', nativeDecimals: 18,
    stablecoin: 'USDC', stablecoinAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', stablecoinDecimals: 6,
    routerKind: 'v3', dexRouter: '0x2626664c2603336E57B271c5C0b26F421741e481',
    dexRouterKind: 'Uniswap V3 SwapRouter02 (mainnet)',
    feedKind: 'v3-twap',
  },
  {
    id: 'ethereum', name: 'Ethereum', env: 'mainnet', chainId: 1,
    rpcUrl: 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
    nativeSymbol: 'ETH', nativeDecimals: 18,
    stablecoin: 'USDT', stablecoinAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', stablecoinDecimals: 6,
    routerKind: 'v2', dexRouter: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    dexRouterKind: 'Uniswap V2 Router02 (mainnet)',
    feedKind: 'v2-twap',
  },
  {
    id: 'polygon', name: 'Polygon', env: 'mainnet', chainId: 137,
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    nativeSymbol: 'POL', nativeDecimals: 18,
    stablecoin: 'USDT', stablecoinAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', stablecoinDecimals: 6,
    routerKind: 'v3', dexRouter: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    dexRouterKind: 'Uniswap V3 SwapRouter02 (mainnet)',
    feedKind: 'v3-twap',
  },
]

/** D1 slug of the mainnet row for a chain family, or null (Solana). */
export const mainnetIdForFamily = (family: string): string | null => {
  switch (family) {
    case 'arc': return 'arc-mainnet'
    case 'bnb': return 'bnb'
    case 'base': return 'base'
    case 'ethereum': return 'ethereum'
    case 'polygon': return 'polygon'
    default: return null
  }
}

/** The network object the browser-deploy cards (Deploy Adapters /
 *  Deploy Vault) need. Arc's ArcNetwork already has every field except
 *  routerKind/feedKind, which Contract Studio adds for the selected
 *  network; the EVM testnet entries in EVM_TESTNETS are DeployNetworks
 *  already. */
export interface DeployNetwork {
  id: string
  name: string
  env: 'testnet' | 'mainnet'
  chainId: number
  rpcUrl: string
  explorerUrl: string
  nativeSymbol: string
  nativeDecimals: number
  stablecoin: string
  stablecoinAddress: string
  stablecoinDecimals: number
  routerKind: RouterKind
  dexRouter: string
  dexRouterKind: string
  feedKind: FeedKind
  faucetUrl?: string
  blocker?: string
}

/** D1 slug of the testnet row for a chain family, or null (Solana). */
export const testnetIdForFamily = (family: string): string | null => {
  switch (family) {
    case 'arc': return 'arc'
    case 'bnb': return 'bnb-testnet'
    case 'base': return 'base-sepolia'
    case 'ethereum': return 'ethereum-sepolia'
    case 'polygon': return 'polygon-amoy'
    default: return null
  }
}

export const evmTestnetFor = (id: string): DeployNetwork | undefined =>
  EVM_TESTNETS.find((n) => n.id === id)

export const evmMainnetFor = (id: string): DeployNetwork | undefined =>
  EVM_MAINNETS.find((n) => n.id === id)
