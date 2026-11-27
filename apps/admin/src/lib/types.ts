// Shared types — mirror the D1 schema in migrations/0001_schema.sql and
// 0003_live.sql and the StelixVault contract in src/contracts/StelixVault.sol.
import type { AuditFinding } from './auditCheck'
import type { FeeConfig } from './fees'

export type { FeeConfig }
export type { AuditFinding }
export type ChainStatus = 'testnet' | 'live' | 'paused' | 'hidden'
export interface Chain {
  id: string; name: string; chainId: number; rpcUrls: string[]; explorerUrl: string
  nativeToken: string; nativeDecimals: number
  stablecoin: string; stablecoinAddress: string; stablecoinDecimals: number
  gasToken: string; dexRouter: string; vaultAddress: string | null
  status: ChainStatus; isDefault?: boolean
  /** True when this is a testnet (derived from status when the flag is absent). */
  isTestnet: boolean
  /** The admin enable/disable toggle: false hides the chain from the wallet. */
  active: boolean
  /** Slug of the paired chain in a testnet/mainnet pair, or null. */
  pairedChainId: string | null
}
export interface TokenEntry { symbol: string; chain: string; address: string; decimals: number; verified: boolean; featured: boolean }
export interface LockRow { id: string; owner: string; chain: string; token: string; amount: string; target: string; status: 'Active' | 'PartiallySold' | 'Matured' | 'Completed' | 'Broken'; unlockDate: string }
export interface KeeperRun { id: string; startedAt: string; chain: string; locksChecked: number; triggers: number; executed: number; retried: number; failed: number; status: 'ok' | 'partial' | 'failed' }
export interface AuditEntry { id: string; at: string; actor: string; action: string; detail: string }
export interface AuditRun {
  id: number
  source_hash: string
  compiler: string
  verdict: string
  counts_json: string
  findings_json: string
  created_by: string
  created_at: string
  findings?: AuditFinding[]
  counts?: Record<string, number>
}
export interface ExternalAudit {
  id: number
  auditor: string
  audit_date: string
  scope: string
  verdict: string
  report_url: string | null
  report_ref: string | null
  created_by: string
  created_at: string
}
export interface LaunchRow {
  id: number
  saleId: number | null
  chain: string
  seller: string
  tokenAddress: string
  tokenSymbol: string
  tokenName: string
  tokenDecimals: number
  logoUrl: string | null
  /** Micro-USDC (6 dec) per ONE WHOLE token, as a decimal string. */
  pricePerToken: string
  softCap: string
  hardCap: string
  raised: string
  tokensSold: string
  contributors: number
  /** Epoch seconds. */
  startTime: number
  endTime: number
  liquidityLockBps: number
  tokensForSale: string
  status: 'Active' | 'Success' | 'Failed'
  finalized: boolean
  approvalStatus: 'pending' | 'approved' | 'rejected'
  liquidityManager: string | null
  liquidityReleased: boolean
  txHash: string | null
  createdAt: string
}
export interface LaunchContributionRow { id: number; launchId: number; contributor: string; amount: string; txHash: string | null; createdAt: string }
export const SOLC_PINNED = '0.8.24'
