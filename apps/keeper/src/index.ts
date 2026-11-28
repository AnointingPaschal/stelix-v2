// Stelix 2.0 Keeper — Cloudflare Worker on cron, every 5 minutes (spec Part G).
// Steps: 1) fetch active locks with price targets from D1 `locks` (written by
// the indexer) and enrich each from the vault on-chain; 2) 30-min TWAP from
// the vault's price feed (the feed itself is a 30-min TWAP — the keeper uses
// that on-chain value as its price point, it never invents a price);
// 3) at/above target or trailing-stop breached -> simulate the stage swap
// via the router adapter's quoter, impact/min-receive guards (pause +
// notify + retry, never force a bad sell); 4) call pokePrice +
// executeTrigger with the keeper key; 5) record result in D1 keeper_runs
// and notify the user.
// The keeper key can ONLY call executeTrigger()/pokePrice(); it cannot move
// funds anywhere except the swap-to-stablecoin / unlock-to-owner paths in
// the contract. No private keys in code — KEEPER_PRIVATE_KEY is a Cloudflare
// secret, never logged. Live runs need RPC_URL_ARC, VAULT_ADDRESS_ARC and
// KEEPER_PRIVATE_KEY set; without them a run reports "not configured" and
// does nothing (it never fakes a run).
import { decideLock } from './keeper'
import { notify } from './notify'
import { parseLockId, lockInputFromGetLock } from './mapping'
import {
  publicClientFor, readRawLock, readTwapUsd, readTokenDecimals, readVaultAddresses,
  simulateStageSwap, sendTrigger, walletClientFor,
} from './chain'
import type { Hex, PublicClient } from 'viem'
import type { KeeperRunResult, LockInput, PricePoint, SwapSimulation } from './types'

export interface Env {
  DB: D1Database
  TWAP_WINDOW_MINUTES?: string
  MAX_PRICE_IMPACT_BPS?: string
  MAX_RETRIES?: string
  NOTIFY_WEBHOOK_URL?: string
  RPC_URL_ARC?: string
  VAULT_ADDRESS_ARC?: string
  RPC_URL_BNB?: string
  VAULT_ADDRESS_BNB?: string
  KEEPER_PRIVATE_KEY?: string // Cloudflare secret; never logged
  /** Shared secret the admin sends as `x-stelix-keeper-key` on /run.
   *  Without it, manual runs are refused — /run must never be open. */
  KEEPER_RUN_KEY?: string
}

interface ChainCtx {
  chain: string
  rpcUrl: string
  vault: Hex
  client: PublicClient
  priceFeed: Hex
  router: Hex
}

interface ActiveLock {
  input: LockInput
  raw: { amountTotal: bigint; nextSellBps: number; stablecoin: Hex; stablecoinDecimals: number; tokenDecimals: number }
}

function chainEnv(env: Env, chain: string): { rpcUrl?: string; vault?: string } {
  if (chain === 'arc') return { rpcUrl: env.RPC_URL_ARC, vault: env.VAULT_ADDRESS_ARC }
  if (chain === 'bnb') return { rpcUrl: env.RPC_URL_BNB, vault: env.VAULT_ADDRESS_BNB }
  return {}
}

async function getChainCtx(env: Env, chain: string): Promise<ChainCtx | null> {
  const { rpcUrl, vault } = chainEnv(env, chain)
  if (!rpcUrl || !vault) return null
  const client = publicClientFor(rpcUrl)
  const { priceFeed, router } = await readVaultAddresses(client, vault as Hex)
  return { chain, rpcUrl, vault: vault as Hex, client, priceFeed, router }
}

async function fetchActiveLocks(ctx: ChainCtx, env: Env): Promise<ActiveLock[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, owner, token_address FROM locks WHERE chain_id = ? AND status IN ('Active', 'PartiallySold') ORDER BY created_at ASC LIMIT 100",
  ).bind(ctx.chain).all<{ id: string; owner: string; token_address: string }>()
  const out: ActiveLock[] = []
  for (const row of results ?? []) {
    const lockId = parseLockId(row.id)
    if (lockId === null) continue
    try {
      const rawLock = await readRawLock(ctx.client, ctx.vault, lockId)
      const input = lockInputFromGetLock(rawLock, lockId.toString(), ctx.chain)
      if (!input) continue
      // Raw lock data for the swap simulation (next unsold stage).
      const nextStage = rawLock.ladderStages.find((s) => !s.sold)
      const tokenDecimals = await readTokenDecimals(ctx.client, rawLock.token as Hex)
      out.push({
        input,
        raw: {
          amountTotal: rawLock.amountTotal,
          nextSellBps: nextStage ? nextStage.sellBps : 0,
          stablecoin: rawLock.stablecoin as Hex,
          stablecoinDecimals: rawLock.stablecoinDecimals,
          tokenDecimals,
        },
      })
    } catch (err) {
      console.error('[keeper: lock read failed]', row.id, err)
    }
  }
  return out
}

async function fetchPricePoints(ctx: ChainCtx, lock: LockInput): Promise<PricePoint[]> {
  // The vault's feed already returns a 30-min TWAP on-chain; the keeper
  // uses that value as its single price point (computeTWAP of one point
  // returns that point). The keeper never supplies its own price.
  const twap = await readTwapUsd(ctx.client, ctx.priceFeed, lock.token as Hex, 1800)
  return [{ price: twap, timestampMs: Date.now() }]
}

async function simulateSwap(ctx: ChainCtx, active: ActiveLock, twapUsd: number): Promise<SwapSimulation | null> {
  return simulateStageSwap(ctx.client, ctx.router, active.input, active.raw, twapUsd)
}

async function executeTriggerOnChain(env: Env, ctx: ChainCtx, lock: LockInput): Promise<{ txHash: string }> {
  if (!env.KEEPER_PRIVATE_KEY) {
    throw new Error('executeTrigger not wired: KEEPER_PRIVATE_KEY secret is not set (see README)')
  }
  const wallet = walletClientFor(ctx.rpcUrl, env.KEEPER_PRIVATE_KEY as Hex)
  return sendTrigger(ctx.client, wallet, ctx.vault, BigInt(lock.lockId))
}

async function isKeeperPaused(env: Env): Promise<boolean> {
  try {
    const row = await env.DB.prepare('SELECT paused FROM keeper_state WHERE id = 1').first<{ paused: number }>()
    return (row?.paused ?? 0) === 1
  } catch {
    return false
  }
}

export async function runKeeper(env: Env, chain: string): Promise<KeeperRunResult> {
  const maxImpactBps = Number(env.MAX_PRICE_IMPACT_BPS ?? 500)
  const result: KeeperRunResult = { chain, locksChecked: 0, triggers: 0, executed: 0, retried: 0, failed: 0, status: 'ok' }
  const ctx = await getChainCtx(env, chain).catch((err) => {
    console.error(`[keeper ${chain}: chain context failed]`, err)
    return null
  })
  if (!ctx) {
    // Not configured (no RPC/vault yet) — report, do not fake a run.
    console.log(`[keeper ${chain}] not configured: RPC_URL_${chain.toUpperCase()} / VAULT_ADDRESS_${chain.toUpperCase()} missing; skipping`)
    return result
  }
  const locks = await fetchActiveLocks(ctx, env)
  result.locksChecked = locks.length
  for (const active of locks) {
    const lock = active.input
    try {
      const points = await fetchPricePoints(ctx, lock)
      const twapUsd = points[0]?.price ?? NaN
      const sim = await simulateSwap(ctx, active, twapUsd)
      const decision = decideLock(lock, points, sim, maxImpactBps)
      if (decision.action === 'trigger') {
        result.triggers++
        const { txHash } = await executeTriggerOnChain(env, ctx, lock)
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
    // Pause hook: the admin sets keeper_state.paused = 1; cron runs then
    // skip without touching any lock.
    if (await isKeeperPaused(env)) {
      console.log('[keeper] paused via keeper_state; skipping cron run')
      return
    }
    // Arc first (default chain), then BNB — other chains added via registry.
    ctx.waitUntil(runKeeper(env, 'arc').then((r) => console.log('[keeper arc]', JSON.stringify(r))))
    ctx.waitUntil(runKeeper(env, 'bnb').then((r) => console.log('[keeper bnb]', JSON.stringify(r))))
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'stelix-keeper' })
    // Run Now (manual trigger from Keeper Monitor) — requires the shared
    // run key the admin sends as `x-stelix-keeper-key`. The key is a
    // Cloudflare secret on BOTH workers (same value). Without it, /run
    // is refused: anyone who finds the keeper URL must not be able to
    // make it spend gas on trigger transactions.
    if (url.pathname === '/run' && req.method === 'POST') {
      if (!env.KEEPER_RUN_KEY || req.headers.get('x-stelix-keeper-key') !== env.KEEPER_RUN_KEY) {
        return Response.json({ ok: false, error: 'keeper run key missing or wrong' }, { status: 401 })
      }
      if (await isKeeperPaused(env)) return Response.json({ ok: false, error: 'keeper is paused' }, { status: 409 })
      const result = await runKeeper(env, 'arc')
      return Response.json(result)
    }
    // Pause hook: POST /pause stops cron + Run Now until /resume.
    if (url.pathname === '/pause' && req.method === 'POST') {
      await env.DB.prepare("UPDATE keeper_state SET paused = 1, updated_by = 'keeper-api', updated_at = datetime('now') WHERE id = 1").run()
      return Response.json({ ok: true, paused: true })
    }
    if (url.pathname === '/resume' && req.method === 'POST') {
      await env.DB.prepare("UPDATE keeper_state SET paused = 0, updated_by = 'keeper-api', updated_at = datetime('now') WHERE id = 1").run()
      return Response.json({ ok: true, paused: false })
    }
    if (url.pathname === '/status' && req.method === 'GET') {
      const state = await env.DB.prepare('SELECT paused, keeper_address, updated_at FROM keeper_state WHERE id = 1').first()
      const { results } = await env.DB.prepare('SELECT * FROM keeper_runs ORDER BY started_at DESC LIMIT 5').all()
      return Response.json({ ok: true, state, recentRuns: results ?? [] })
    }
    return new Response('stelix-keeper: cron worker', { status: 200 })
  },
}
