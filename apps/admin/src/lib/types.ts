// Shared types — mirror the D1 schema in migrations/0001_schema.sql and the
// StelixVault contract in src/contracts/StelixVault.sol (spec Part F).
export type ChainStatus = 'testnet' | 'live' | 'paused' | 'hidden'
export interface Chain { id: string; name: string; chainId: number; rpcUrls: string[]; explorerUrl: string; nativeToken: string; stablecoin: string; stablecoinAddress: string; dexRouter: string; vaultAddress: string | null; status: ChainStatus; isDefault?: boolean }
export interface TokenEntry { symbol: string; chain: string; address: string; decimals: number; verified: boolean; featured: boolean }
export interface LockRow { id: string; owner: string; chain: string; token: string; amount: string; target: string; status: 'Active' | 'PartiallySold' | 'Matured' | 'Completed' | 'Broken'; unlockDate: string }
export interface KeeperRun { id: string; startedAt: string; chain: string; locksChecked: number; triggers: number; executed: number; retried: number; failed: number; status: 'ok' | 'partial' | 'failed' }
export interface AuditEntry { id: string; at: string; actor: string; action: string; detail: string }
export const SOLC_PINNED = '0.8.24'
