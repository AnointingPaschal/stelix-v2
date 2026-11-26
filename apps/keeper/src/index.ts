// Stelix 2.0 Keeper — Cloudflare Worker on cron, every 5 minutes (spec Part G).
// Steps: 1) fetch active locks with price targets (D1 / indexer — stubbed here
// until the indexer + D1 are wired); 2) 30-min TWAP from DEX pair (Chainlink
// where the registry provides a feed); 3) at/above target or trailing-stop
// breached -> simulate stage swap, impact/min-receive guards (pause + notify
// + retry, never force a bad sell); 4) call executeTrigger; 5) record result
// in D1 keeper_runs and notify the user.
// The keeper key can ONLY call executeTrigger(); it cannot move funds
// anywhere except the swap-to-stablecoin / unlock-to-owner paths in the
// contract. No private keys in code — KEEPER_PRIVATE_KEY is a Cloudflare secret.
import { decideLock } from './keeper'
import { notify } from './notify'
import type { KeeperRunResult, LockInput, PricePoint, SwapSimulation } from './types'

export interface Env {
  DB: D1Database
  TWAP_WINDOW_MINUTES?: string
  MAX_PRICE_IMPACT_BPS?: string
  MAX_RETRIES?: string
  NOTIFY_WEBHOOK_URL?: string
  KEEPER_PRIVATE_KEY: string // Cloudflare secret; never logged
}

// --- Production integration points (stubs until D1/indexer/RPC are wired) ---
async function fetchActiveLocks(_env: Env, _chain: string): Promise<LockInput[]> {
  // Production: SELECT active locks with price targets from D1 / indexer.
  return []
}
async function fetchPricePoints(_env: Env, _lock: LockInput): Promise<PricePoint[]> {
  // Production: DEX pair TWAP observations; Chainlink feed where registry provides one.
  return []
}
async function simulateSwap(_env: Env, _lock: LockInput): Promise<SwapSimulation | null> {
  // Production: quote the stage swap via the chain DEX router/aggregator.
  return null
}
async function executeTriggerOnChain(_env: Env, _lock: LockInput): Promise<{ txHash: string }> {
  // Production: sign + send StelixVault.executeTrigger(lockId) with the keeper key.
  throw new Error('executeTrigger not wired: keeper key + RPC + vault address required (see README)')
}

export async function runKeeper(env: Env, chain: string): Promise<KeeperRunResult> {
  const maxImpactBps = Number(env.MAX_PRICE_IMPACT_BPS ?? 500)
  const result: KeeperRunResult = { chain, locksChecked: 0, triggers: 0, executed: 0, retried: 0, failed: 0, status: 'ok' }
  const locks = await fetchActiveLocks(env, chain)
  result.locksChecked = locks.length
  for (const lock of locks) {
    try {
      const points = await fetchPricePoints(env, lock)
      const sim = await simulateSwap(env, lock)
      const decision = decideLock(lock, points, sim, maxImpactBps)
      if (decision.action === 'trigger') {
        result.triggers++
        const { txHash } = await executeTriggerOnChain(env, lock)
        result.executed++
        await notify(env, 'auto-sell.executed', { lockId: lock.lockId, chain, txHash, owner: lock.owner })
      } else if (decision.action === 'retry') {
        result.retried++
        await notify(env, 'auto-sell.retry', { lockId: lock.lockId, chain, reason: decision.reason })
      } else if (decision.action === 'pause-and-notify') {
        result.failed++
        await notify(env, 'auto-sell.paused', { lockId: lock.lockId, chain, reason: decision.reason })
      }
      // 'skip': nothing to do — lock stays locked.
    } catch (err) {
      result.failed++
      await notify(env, 'auto-sell.failed', { lockId: lock.lockId, chain, error: String(err) })
    }
  }
  if (result.failed > 0 && result.executed === 0) result.status = 'failed'
  else if (result.failed > 0 || result.retried > 0) result.status = 'partial'
  // Record the run in D1 (best effort — a logging failure must not fail the run).
  try {
    await env.DB.prepare(
      'INSERT INTO keeper_runs (started_at, chain_id, locks_checked, triggers, executed, retried, failed, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(new Date().toISOString(), chain, result.locksChecked, result.triggers, result.executed, result.retried, result.failed, result.status).run()
  } catch (err) { console.error('[keeper_runs insert failed]', err) }
  return result
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Arc first (default chain), then BNB — other chains added via registry.
    ctx.waitUntil(runKeeper(env, 'arc').then((r) => console.log('[keeper arc]', JSON.stringify(r))))
    ctx.waitUntil(runKeeper(env, 'bnb').then((r) => console.log('[keeper bnb]', JSON.stringify(r))))
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    if (new URL(req.url).pathname === '/health') return Response.json({ ok: true, service: 'stelix-keeper' })
    if (new URL(req.url).pathname === '/run' && req.method === 'POST') {
      // Manual run-now from Keeper Monitor — production: require admin auth.
      const result = await runKeeper(env, 'arc')
      return Response.json(result)
    }
    return new Response('stelix-keeper: cron worker', { status: 200 })
  },
}
