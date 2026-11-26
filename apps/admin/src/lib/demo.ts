// DEMO data only — clearly labelled in the UI. Production replaces these
// with Workers API calls (see src/lib/api.ts) backed by D1.
import type { AuditEntry, Chain, KeeperRun, LockRow, TokenEntry } from './types'
export const DEMO = true
export const demoChains: Chain[] = [
  { id: 'arc', name: 'Arc', chainId: 5042002, rpcUrls: ['https://rpc.arc.network'], explorerUrl: 'https://explorer.arc.network', nativeToken: 'USDC', stablecoin: 'USDC', stablecoinAddress: '0x0000000000000000000000000000000000000000', dexRouter: 'Arc DEX / aggregator (set in registry)', vaultAddress: null, status: 'testnet', isDefault: true },
  { id: 'bnb', name: 'BNB Chain', chainId: 56, rpcUrls: ['https://bsc-dataseed.binance.org'], explorerUrl: 'https://bscscan.com', nativeToken: 'BNB', stablecoin: 'USDT', stablecoinAddress: '0x55d398326f99059fF775485246999027B3197955', dexRouter: 'PancakeSwap v3', vaultAddress: null, status: 'testnet' },
  { id: 'base', name: 'Base', chainId: 8453, rpcUrls: ['https://mainnet.base.org'], explorerUrl: 'https://basescan.org', nativeToken: 'ETH', stablecoin: 'USDC', stablecoinAddress: '0x833589fCD6eDb6E08f4c7D8b7fF4B7a4aA8aA8a8', dexRouter: 'Base DEX aggregator', vaultAddress: null, status: 'hidden' },
  { id: 'ethereum', name: 'Ethereum', chainId: 1, rpcUrls: ['https://eth.llamarpc.com'], explorerUrl: 'https://etherscan.io', nativeToken: 'ETH', stablecoin: 'USDT', stablecoinAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', dexRouter: 'Mainnet aggregator', vaultAddress: null, status: 'hidden' },
  { id: 'polygon', name: 'Polygon', chainId: 137, rpcUrls: ['https://polygon-rpc.com'], explorerUrl: 'https://polygonscan.com', nativeToken: 'MATIC', stablecoin: 'USDT', stablecoinAddress: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', dexRouter: 'Polygon aggregator', vaultAddress: null, status: 'hidden' },
  { id: 'solana', name: 'Solana', chainId: 101, rpcUrls: ['https://api.mainnet-beta.solana.com'], explorerUrl: 'https://solscan.io', nativeToken: 'SOL', stablecoin: 'USDT', stablecoinAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', dexRouter: 'Jupiter', vaultAddress: null, status: 'hidden' },
]
export const demoTokens: TokenEntry[] = [
  { symbol: 'WBNB', chain: 'BNB Chain', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18, verified: true, featured: true },
  { symbol: 'USDT', chain: 'BNB Chain', address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18, verified: true, featured: true },
  { symbol: 'USDC', chain: 'Arc', address: '0x0000000000000000000000000000000000000000', decimals: 6, verified: true, featured: true },
]
export const demoLocks: LockRow[] = [
  { id: 'LK-DEMO-001', owner: '0xDemo…a1b2', chain: 'Arc', token: 'USDC', amount: '1,000', target: '3x', status: 'Active', unlockDate: '2027-11-26' },
  { id: 'LK-DEMO-002', owner: '0xDemo…c3d4', chain: 'BNB Chain', token: 'WBNB', amount: '2.5', target: '2x', status: 'PartiallySold', unlockDate: '2027-05-26' },
]
export const demoKeeperRuns: KeeperRun[] = [
  { id: 'KR-DEMO-101', startedAt: '2026-11-26 12:00 WAT', chain: 'Arc', locksChecked: 12, triggers: 1, executed: 1, retried: 0, failed: 0, status: 'ok' },
  { id: 'KR-DEMO-100', startedAt: '2026-11-26 11:55 WAT', chain: 'BNB Chain', locksChecked: 8, triggers: 0, executed: 0, retried: 1, failed: 0, status: 'partial' },
]
export const demoAudit: AuditEntry[] = [
  { id: 'AU-1', at: '2026-11-26 12:05', actor: 'owner (demo)', action: 'config.view', detail: 'Dashboard viewed' },
  { id: 'AU-2', at: '2026-11-26 11:40', actor: 'owner (demo)', action: 'chain.update', detail: 'Arc status set to testnet' },
]
export const demoStats = { tvlByChain: [{ chain: 'Arc', tvl: '$0.00' }, { chain: 'BNB Chain', tvl: '$0.00' }, { chain: 'Base', tvl: '$0.00' }], activeLocks: 0, autoSells: 0, autoSellVolume: '$0.00', keeperHealth: 'Healthy (demo)', configVersion: 'v1 (demo)' }
