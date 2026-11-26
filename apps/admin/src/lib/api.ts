// API client. Live endpoints (Workers + D1) are used where they exist:
//   GET  /api/chains        GET /api/keeper/runs   GET /api/admin/audit
//   GET  /api/config        (signed app config — public)
// Pages without a live endpoint yet still resolve DEMO data from
// src/lib/demo.ts — the UI labels every such value DEMO.
import { demoAudit, demoChains, demoKeeperRuns, demoLocks, demoStats, demoTokens } from './demo'
import type { AuditEntry, Chain, KeeperRun } from './types'

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms))

async function live<T>(path: string): Promise<T> {
  const r = await fetch(path, { credentials: 'same-origin' })
  if (r.status === 401) {
    // Session expired or missing — back to the login page.
    if (window.location.pathname !== '/') window.location.href = '/'
    throw new Error('session required')
  }
  if (!r.ok) throw new Error(`request failed: ${r.status}`)
  return r.json() as Promise<T>
}

type ChainRow = { id: string; name: string; chain_id: number; rpc_urls: string; explorer_url: string; native_token: string; stablecoin: string; stablecoin_address: string; dex_router: string; vault_address: string | null; status: Chain['status']; is_default: number }
type KeeperRow = { id: number; started_at: string; chain_id: string; locks_checked: number; triggers: number; executed: number; retried: number; failed: number; status: KeeperRun['status'] }
type AuditRow = { id: number; created_at: string; actor: string; action: string; detail: string | null }

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

export const api = {
  async getDashboard() { await delay(); return demoStats },
  async getChains(): Promise<Chain[]> {
    try { const d = await live<{ chains: ChainRow[] }>('/api/chains'); return d.chains.map(mapChain) }
    catch { await delay(); return demoChains }
  },
  async getTokens() { await delay(); return demoTokens },
  async getKeeperRuns(): Promise<KeeperRun[]> {
    try { const d = await live<{ runs: KeeperRow[] }>('/api/keeper/runs'); return d.runs.map(mapKeeper) }
    catch { await delay(); return demoKeeperRuns }
  },
  async getLocks() { await delay(); return demoLocks },
  async getAudit(): Promise<AuditEntry[]> {
    try { const d = await live<{ audit: AuditRow[] }>('/api/admin/audit'); return d.audit.map(mapAudit) }
    catch { await delay(); return demoAudit }
  },
  async getSession(): Promise<{ authenticated: boolean; email?: string }> {
    const r = await fetch('/api/admin/session', { credentials: 'same-origin' })
    if (!r.ok) return { authenticated: false }
    return r.json()
  },
  async logout() {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' })
  },
  // Real production endpoints (Workers, src/worker/index.ts):
  //   GET  /api/config        signed app config
  //   GET  /api/chains        GET /api/keeper/runs
  //   POST /api/admin/chains  POST /api/admin/keeper/run-now
  //   GET  /api/support?q=…   (admin session required)
  //   POST /api/admin/compile (Contract Studio — compile job, pinned solc)
}
export const DEMO_NOTICE = 'LIVE: Chain Manager, Keeper Monitor and Audit Log read from D1. Dashboard, tokens, fees, announcements and config still show DEMO placeholders until wired.'
