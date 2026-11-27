// Stelix Admin — verified Arc network parameters.
//
// Sources (checked 2026-11-27, do not invent others):
// - docs.arc.io "Connect to Arc" + "RPC endpoints": mainnet chain 5042,
//   https://rpc.mainnet.arc.io, https://explorer.arc.io; testnet chain
//   5042002, https://rpc.testnet.arc.io, https://explorer.testnet.arc.io.
//   The old endpoints rpc.testnet.arc.network / testnet.arcscan.app are
//   decommissioned.
// - docs.arc.io "Contract addresses" + Uniswap deployments feed: USDC
//   0x3600000000000000000000000000000000000000 is the same predeploy on
//   both networks (6 decimals; it is also the gas token).
// - Arc mainnet Uniswap V3: SwapRouter02
//   0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77, Factory
//   0xf0db7b58379503491d857dB50AC9ece64c653918, V2 Router02
//   0x1f7d7550B1b028f7571E69A784071F0205FD2EfA (mainnet live 2026-09-16).
// - Arc testnet V3 router 0xfA845604F52843a7b5cfA4030120c6238741F420 is the
//   full address already in this repo
//   (contracts/script/DeployAdapters.s.sol, StelixV3RouterAdapter.sol).
//   Never use a truncated address.
//
// WETH9 trap (Arc mainnet AND testnet): the router's WETH9() is a stub
// that always reverts, so native-value swaps revert. Swaps must use the
// ERC-20 USDC above, never native value.

export const ARC_USDC = '0x3600000000000000000000000000000000000000'

export interface ArcNetwork {
  /** D1 chain slug. */
  id: string
  name: string
  env: 'testnet' | 'mainnet'
  chainId: number
  rpcUrl: string
  explorerUrl: string
  stablecoin: string
  stablecoinAddress: string
  stablecoinDecimals: number
  /** DEX router the vault (via its V3 adapter) points at. */
  dexRouter: string
  dexRouterKind: string
  /** Uniswap V3 factory (mainnet only; testnet has no verified V3 factory in the repo). */
  factory?: string
  /** Uniswap V2 Router02 (mainnet only). */
  v2Router?: string
}

export const ARC_TESTNET: ArcNetwork = {
  id: 'arc',
  name: 'Arc Testnet',
  env: 'testnet',
  chainId: 5042002,
  rpcUrl: 'https://rpc.testnet.arc.io',
  explorerUrl: 'https://explorer.testnet.arc.io',
  stablecoin: 'USDC',
  stablecoinAddress: ARC_USDC,
  stablecoinDecimals: 6,
  dexRouter: '0xfA845604F52843a7b5cfA4030120c6238741F420',
  dexRouterKind: 'Uniswap V3 SwapRouter (testnet)',
}

export const ARC_MAINNET: ArcNetwork = {
  id: 'arc-mainnet',
  name: 'Arc Mainnet',
  env: 'mainnet',
  chainId: 5042,
  rpcUrl: 'https://rpc.mainnet.arc.io',
  explorerUrl: 'https://explorer.arc.io',
  stablecoin: 'USDC',
  stablecoinAddress: ARC_USDC,
  stablecoinDecimals: 6,
  dexRouter: '0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77',
  dexRouterKind: 'Uniswap V3 SwapRouter02 (mainnet)',
  factory: '0xf0db7b58379503491d857dB50AC9ece64c653918',
  v2Router: '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA',
}

export const ARC_NETWORKS: ArcNetwork[] = [ARC_TESTNET, ARC_MAINNET]

export const arcNetworkFor = (env: 'testnet' | 'mainnet'): ArcNetwork =>
  env === 'mainnet' ? ARC_MAINNET : ARC_TESTNET
