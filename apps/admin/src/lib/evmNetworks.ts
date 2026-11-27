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

export const EVM_TESTNETS: DeployNetwork[] = [
  {
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
