// API stubs. In production these call the Workers API (src/worker/index.ts)
// backed by D1. Until the Cloudflare deploy happens they resolve DEMO data
// from src/lib/demo.ts — the UI labels every such value DEMO.
import { demoAudit, demoChains, demoKeeperRuns, demoLocks, demoStats, demoTokens } from './demo'
const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms))
export const api = {
  async getDashboard() { await delay(); return demoStats },
  async getChains() { await delay(); return demoChains },
  async getTokens() { await delay(); return demoTokens },
  async getKeeperRuns() { await delay(); return demoKeeperRuns },
  async getLocks() { await delay(); return demoLocks },
  async getAudit() { await delay(); return demoAudit },
  // Real production endpoints (Workers, src/worker/index.ts):
  //   GET  /api/config        signed app config
  //   GET  /api/chains        GET /api/keeper/runs
  //   POST /api/admin/chains  POST /api/admin/keeper/run-now
  //   GET  /api/support?wallet=…|lock=…|tx=…
  //   POST /api/admin/compile (Contract Studio — compile job, pinned solc)
}
export const DEMO_NOTICE = 'DEMO data — this portal is not yet connected to live D1/Workers. Values shown are placeholders until the Cloudflare deploy.'
