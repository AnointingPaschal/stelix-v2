// API client — every call hits a live Workers + D1 endpoint. There is no
// sample data and no fallback: a failed request throws with the server's
// message, and pages render a real empty state or an honest error instead of
// invented figures.
import type {
  AuditEntry, AuditRun, Chain, ExternalAudit, FeeConfig, KeeperRun, LaunchContributionRow, LaunchRow, LockRow,
} from './types'

async function live<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: 'same-origin', ...init })
  if (r.status === 401) {
    if (window.location.pathname !== '/') window.location.href = '/'
    throw new Error('Session expired — sign in again.')
  }
  let body: { error?: string; message?: string } & Record<string, unknown> = {}
  try { body = (await r.json()) as typeof body } catch { /* non-JSON error */ }
  if (!r.ok) throw new Error(body.error ?? body.message ?? `Request failed: ${r.status}`)
  return body as unknown as T
}

const post = <T,>(path: string, data?: unknown): Promise<T> =>
  live<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  })

type ChainRow = { id: string; name: string; chain_id: number; rpc_urls: string; explorer_url: string; native_token: string; stablecoin: string; stablecoin_address: string; dex_router: string; vault_address: string | null; status: Chain['status']; is_default: number }
type KeeperRow = { id: number; started_at: string; chain_id: string; locks_checked: number; triggers: number; executed: number; retried: number; failed: number; status: KeeperRun['status'] }
type AuditRow = { id: number; created_at: string; actor: string; action: string; detail: string | null }
type TokenRow = { id: number; symbol: string; chain_id: string; address: string; decimals: number; verified: number; featured: number }
type LockDbRow = { id: string; chain_id: string; owner: string; token_address: string; token_symbol: string; amount_raw: string; status: string; unlock_time: string | null }

const mapChain = (c: ChainRow): Chain => ({
  id: c.id, name: c.name, chainId: c.chain_id, rpcUrls: c.rpc_urls ? c.rpc_urls.split(',').map((s) => s.trim()).filter(Boolean) : [],
  explorerUrl: c.explorer_url, nativeToken: c.native_token, stablecoin: c.stablecoin,
  stablecoinAddress: c.stablecoin_address ?? '', dexRouter: c.dex_router ?? '',
  vaultAddress: c.vault_address, status: c.status, isDefault: c.is_default === 1,
})
const mapKeeper = (r: KeeperRow): KeeperRun => ({
  id: String(r.id), startedAt: r.started_at, chain: r.chain_id, locksChecked: r.locks_checked,
  triggers: r.triggers, executed: r.executed, retried: r.retried, failed: r.failed, status: r.status,
})
const mapAudit = (a: AuditRow): AuditEntry => ({ id: String(a.id), at: a.created_at, actor: a.actor, action: a.action, detail: a.detail ?? '' })
type LaunchDbRow = {
  id: number; sale_id: number | null; chain_id: string; seller: string; token_address: string;
  token_symbol: string; token_name: string; token_decimals: number; logo_url: string | null;
  price_per_token: string; soft_cap: string; hard_cap: string; raised: string; tokens_sold: string;
  contributors: number; start_time: number; end_time: number; liquidity_lock_bps: number;
  tokens_for_sale: string; status: string; finalized: number; approval_status: string;
  liquidity_manager: string | null; liquidity_released: number; tx_hash: string | null; created_at: string
}
type LaunchContributionDbRow = { id: number; launch_id: number; contributor: string; amount: string; tx_hash: string | null; created_at: string }

const mapLaunch = (l: LaunchDbRow): LaunchRow => ({
  id: l.id, saleId: l.sale_id, chain: l.chain_id, seller: l.seller, tokenAddress: l.token_address,
  tokenSymbol: l.token_symbol, tokenName: l.token_name, tokenDecimals: l.token_decimals, logoUrl: l.logo_url,
  pricePerToken: l.price_per_token, softCap: l.soft_cap, hardCap: l.hard_cap, raised: l.raised,
  tokensSold: l.tokens_sold, contributors: l.contributors, startTime: l.start_time, endTime: l.end_time,
  liquidityLockBps: l.liquidity_lock_bps, tokensForSale: l.tokens_for_sale,
  status: (l.status as LaunchRow['status']) ?? 'Active', finalized: l.finalized === 1,
  approvalStatus: (l.approval_status as LaunchRow['approvalStatus']) ?? 'pending',
  liquidityManager: l.liquidity_manager, liquidityReleased: l.liquidity_released === 1,
  txHash: l.tx_hash, createdAt: l.created_at,
})
const mapLaunchContribution = (c: LaunchContributionDbRow): LaunchContributionRow => ({
  id: c.id, launchId: c.launch_id, contributor: c.contributor, amount: c.amount, txHash: c.tx_hash, createdAt: c.created_at,
})

export interface LaunchesFeed {
  launches: LaunchRow[]
  launchpadAddress: string | null
  factoryAddress: string | null
  liquidityManager: string | null
  note: string
}

const mapLock = (l: LockDbRow): LockRow => ({
  id: l.id, owner: l.owner, chain: l.chain_id, token: l.token_symbol || l.token_address,
  amount: l.amount_raw, target: '', status: (l.status as LockRow['status']) ?? 'Active', unlockDate: l.unlock_time ?? '',
})

export interface DashboardData {
  tvlByChain: { chain: string; chainId: string; vault: string | null; tvlUsd: number | null; note: string }[]
  totalTvlUsd: number
  activeLocks: number
  autoSells: number
  autoSellVolumeUsd: number
  keeperHealth: string
  keeperLastRunAt: string | null
  keeperMinutesSinceLastRun: number | null
  keeperFailedRuns24h: number
  configVersion: string
}

export interface KeeperStatus {
  paused: boolean
  keeperAddress: string | null
  updatedAt: string | null
  keeperLive: boolean
  keeperWorkerUrl: string | null
  lastRun: KeeperRow | null
  failedRuns24h: number
  balances: { chain: string; balanceRaw: string; balance: string }[]
}

export interface CompileResult {
  ok: boolean
  sourceHash: string
  compiler: string
  bytecodeHash: string | null
  deployedBytes: number | null
  withinSizeLimit: number
  warnings: string[]
  status: string
  matchesArtifact: boolean
}

export interface DeployPrepare {
  ok: boolean
  chain: string
  env: string
  params: Record<string, unknown>
  deployCommand: string
  note: string
  rpcUrl: string
}

export interface DeployVerify {
  ok: boolean
  chain: string
  address: string
  codePresent: boolean
  codeLength: number
  sourceVerified: boolean
  explorerChecked: boolean
  note: string
  explorerUrl: string
}

export interface AuditGate {
  automated: { latestRun: AuditRun | null; pass: boolean; openCriticalHigh: number }
  external: { audits: ExternalAudit[]; pass: boolean }
  gatePass: boolean
  note: string
}

export const api = {
  async getDashboard(): Promise<DashboardData> {
    return live<DashboardData>('/api/admin/dashboard')
  },
  async getChains(): Promise<Chain[]> {
    const d = await live<{ chains: ChainRow[] }>('/api/chains')
    return d.chains.map(mapChain)
  },
  async createChain(data: {
    id: string; name: string; chainId: number; rpcUrls: string; explorerUrl: string;
    nativeToken: string; stablecoin: string; stablecoinAddress: string; dexRouter: string;
    status: Chain['status']; isDefault?: boolean
  }): Promise<{ ok: boolean; id: string }> {
    return post<{ ok: boolean; id: string }>('/api/admin/chains', data)
  },
  async updateChain(id: string, data: Record<string, unknown>): Promise<{ ok: boolean }> {
    return post<{ ok: boolean }>(`/api/admin/chains/${encodeURIComponent(id)}`, data)
  },
  async getTokens(): Promise<{ id: number; symbol: string; chain: string; address: string; decimals: number; verified: boolean; featured: boolean }[]> {
    const d = await live<{ tokens: TokenRow[] }>('/api/admin/tokens')
    return d.tokens.map((t) => ({ id: t.id, symbol: t.symbol, chain: t.chain_id, address: t.address, decimals: t.decimals, verified: t.verified === 1, featured: t.featured === 1 }))
  },
  async searchTokens(q: string, chain?: string): Promise<{ tokens: { symbol: string; name: string; chain: string; address: string; priceUsd: number | null; dex: string; pairUrl: string | null; source: string }[]; source: string }> {
    const params = new URLSearchParams({ q })
    if (chain) params.set('chain', chain)
    return live(`/api/admin/tokens/search?${params.toString()}`)
  },
  async addToken(data: { symbol: string; chainId: string; address: string; decimals: number; verified?: boolean; featured?: boolean }): Promise<{ ok: boolean; id: number | null }> {
    return post('/api/admin/tokens', data)
  },
  async removeToken(id: number): Promise<{ ok: boolean }> {
    const r = await fetch(`/api/admin/tokens?id=${id}`, { method: 'DELETE', credentials: 'same-origin' })
    if (!r.ok) throw new Error(`Remove failed: ${r.status}`)
    return r.json() as Promise<{ ok: boolean }>
  },
  async getKeeperRuns(): Promise<KeeperRun[]> {
    const d = await live<{ runs: KeeperRow[] }>('/api/keeper/runs')
    return d.runs.map(mapKeeper)
  },
  async getKeeperStatus(): Promise<KeeperStatus> {
    return live<KeeperStatus>('/api/admin/keeper/status')
  },
  async keeperRunNow(): Promise<{ ok: boolean; live: boolean; message?: string; keeper?: unknown }> {
    return post('/api/admin/keeper/run-now', {})
  },
  async keeperPause(paused: boolean, keeperAddress?: string | null): Promise<{ ok: boolean; paused: boolean }> {
    return post('/api/admin/keeper/pause', { paused, keeperAddress: keeperAddress ?? undefined })
  },
  async getLocks(): Promise<LockRow[]> {
    const d = await live<{ locks: LockDbRow[] }>('/api/admin/locks')
    return d.locks.map(mapLock)
  },
  async getLaunches(): Promise<LaunchesFeed> {
    const d = await live<{ launches: LaunchDbRow[]; launchpadAddress: string | null; factoryAddress: string | null; liquidityManager: string | null; note: string }>('/api/admin/launches')
    return { launches: d.launches.map(mapLaunch), launchpadAddress: d.launchpadAddress, factoryAddress: d.factoryAddress, liquidityManager: d.liquidityManager, note: d.note }
  },
  async registerLaunch(data: {
    chainId?: string; saleId?: number | null; seller: string; tokenAddress: string; tokenSymbol: string;
    tokenName?: string; tokenDecimals?: number; logoUrl?: string | null; pricePerToken: string;
    softCap: string; hardCap: string; tokensForSale: string; startTime: number; endTime: number;
    liquidityLockBps?: number; txHash?: string | null
  }): Promise<{ ok: boolean; id: number | null }> {
    return post('/api/admin/launches', data)
  },
  async setLaunchApproval(id: number, approvalStatus: LaunchRow['approvalStatus']): Promise<{ ok: boolean }> {
    const r = await fetch(`/api/admin/launches/${id}`, {
      method: 'PATCH', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approvalStatus }),
    })
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `Update failed: ${r.status}`)
    }
    return r.json() as Promise<{ ok: boolean }>
  },
  async updateLaunch(id: number, data: Record<string, unknown>): Promise<{ ok: boolean }> {
    const r = await fetch(`/api/admin/launches/${id}`, {
      method: 'PATCH', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `Update failed: ${r.status}`)
    }
    return r.json() as Promise<{ ok: boolean }>
  },
  async getLaunchContributions(launchId: number): Promise<LaunchContributionRow[]> {
    const d = await live<{ contributions: LaunchContributionDbRow[] }>(`/api/admin/launches/${launchId}/contributions`)
    return d.contributions.map(mapLaunchContribution)
  },
  async recordLaunchContribution(launchId: number, data: { contributor: string; amount: string; txHash?: string | null }): Promise<{ ok: boolean; id: number | null }> {
    return post(`/api/admin/launches/${launchId}/contributions`, data)
  },
  async getAudit(): Promise<AuditEntry[]> {
    const d = await live<{ audit: AuditRow[] }>('/api/admin/audit')
    return d.audit.map(mapAudit)
  },
  async getFees(): Promise<{ fees: FeeConfig | null; version?: number; publishedBy?: string; publishedAt?: string; note?: string }> {
    return live('/api/admin/fees')
  },
  async saveFees(fees: FeeConfig): Promise<{ ok: boolean; version: number; fees: FeeConfig }> {
    return post('/api/admin/fees', fees)
  },
  async getFeeHistory(): Promise<{ history: { id: number; version: number; payload_json: string; published_by: string; created_at: string }[] }> {
    return live('/api/admin/fees/history')
  },
  async getAnnouncements(): Promise<{ announcements: { id: number; title: string; message: string; audience: string; expires_at: string | null; created_at: string }[] }> {
    return live('/api/admin/announcements')
  },
  async publishAnnouncement(data: { title: string; message: string; audience: string; expiresAt?: string | null }): Promise<{ ok: boolean; id: number | null }> {
    return post('/api/admin/announcements', data)
  },
  async deleteAnnouncement(id: number): Promise<{ ok: boolean }> {
    const r = await fetch(`/api/admin/announcements?id=${id}`, { method: 'DELETE', credentials: 'same-origin' })
    if (!r.ok) throw new Error(`Delete failed: ${r.status}`)
    return r.json() as Promise<{ ok: boolean }>
  },
  async getConfig(): Promise<{ config: { version: string; payload: Record<string, unknown> | null; signature: string | null; publishedBy: string; publishedAt: string } | null; note?: string }> {
    return live('/api/admin/config')
  },
  async publishConfig(data: { minAppVersion: string; forceUpgrade: boolean; flags: Record<string, boolean> }): Promise<{ ok: boolean; version: string; payload: unknown; signature: string }> {
    return post('/api/admin/config', data)
  },
  async getPublicConfig(): Promise<{ config: { version: string; payload: unknown; signature: string | null; signatureValid: boolean; publishedAt: string } | null; note?: string }> {
    return live('/api/config')
  },
  async supportLookup(q: string): Promise<Record<string, unknown>> {
    return live(`/api/support?q=${encodeURIComponent(q)}`)
  },
  async compile(source: string): Promise<CompileResult> {
    return post('/api/admin/compile', { source })
  },
  async getLatestCompile(): Promise<{ job: Record<string, unknown> | null; artifactSourceHash: string; artifactBytecodeHash: string }> {
    return live('/api/admin/compile/latest')
  },
  async deployPrepare(params: Record<string, unknown>): Promise<DeployPrepare> {
    return post('/api/admin/deploy/prepare', params)
  },
  async deployVerify(chainId: string, address: string): Promise<DeployVerify> {
    return post('/api/admin/deploy/verify', { chainId, address })
  },
  async deployRegister(params: Record<string, unknown>): Promise<{ ok: boolean; chain: string; address: string; verificationStatus: string; note: string; explorerUrl: string }> {
    return post('/api/admin/deploy/register', params)
  },
  async getDeployments(): Promise<{ deployments: { id: number; chain_id: string; address: string; tx_hash: string | null; compiler_version: string; verification_status: string; env: string; created_at: string }[] }> {
    return live('/api/admin/deployments')
  },
  async attestSmoke(chainId: string, note: string): Promise<{ ok: boolean }> {
    return post('/api/admin/deploy/gate/attest', { chainId, kind: 'smoke', note })
  },
  async runContractAudit(source: string): Promise<{ ok: boolean; runId: number | null; sourceHash: string; compiler: string; verdict: string; counts: Record<string, number>; openCriticalHigh: number; findings: AuditRun['findings'] }> {
    return post('/api/admin/audit/run', { source })
  },
  async getAuditRuns(): Promise<{ runs: AuditRun[] }> {
    return live('/api/admin/audit/runs')
  },
  async getAuditRun(id: number): Promise<{ run: AuditRun }> {
    return live(`/api/admin/audit/runs/${id}`)
  },
  async setFindingStatus(runId: number, findingId: string, status: string): Promise<{ ok: boolean; verdict: string; openCriticalHigh: number; findings: AuditRun['findings'] }> {
    const r = await fetch(`/api/admin/audit/runs/${runId}`, {
      method: 'PATCH', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ findingId, status }),
    })
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `Update failed: ${r.status}`)
    }
    return r.json() as Promise<{ ok: boolean; verdict: string; openCriticalHigh: number; findings: AuditRun['findings'] }>
  },
  async getExternalAudits(): Promise<{ audits: ExternalAudit[] }> {
    return live('/api/admin/audit/external')
  },
  async recordExternalAudit(data: { auditor: string; auditDate: string; scope: string; verdict: string; reportUrl?: string | null; reportRef?: string | null }): Promise<{ ok: boolean; id: number | null }> {
    return post('/api/admin/audit/external', data)
  },
  async deleteExternalAudit(id: number): Promise<{ ok: boolean }> {
    const r = await fetch(`/api/admin/audit/external?id=${id}`, { method: 'DELETE', credentials: 'same-origin' })
    if (!r.ok) throw new Error(`Delete failed: ${r.status}`)
    return r.json() as Promise<{ ok: boolean }>
  },
  async getAuditGate(): Promise<AuditGate> {
    return live('/api/admin/audit/gate')
  },
  async getBackup(): Promise<Record<string, unknown>> {
    return live('/api/admin/backup')
  },
  async getSession(): Promise<{ authenticated: boolean; email?: string }> {
    const r = await fetch('/api/admin/session', { credentials: 'same-origin' })
    if (!r.ok) return { authenticated: false }
    return r.json()
  },
  async logout() {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' })
  },
}
