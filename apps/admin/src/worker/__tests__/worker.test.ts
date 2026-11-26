import { pbkdf2Sync, randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type Env } from '../index'
import source from '../../contracts/StelixVault.sol?raw'

// ---------------------------------------------------------------------------
// Minimal in-memory D1 stub: implements the subset of SQL the Worker uses
// (equality WHERE, ORDER BY id/version/created_at/started_at DESC, LIMIT,
// INSERT / UPDATE / DELETE, COUNT(*) and MAX(version) aggregates, and the
// two upserts the Worker performs). It is a test double, not production code.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>

class FakeD1 {
  tables: Record<string, Row[]> = {}
  private ids: Record<string, number> = {}

  prepare(sql: string) {
    const self = this
    return {
      bind(...params: unknown[]) {
        return {
          async all<T>(): Promise<{ results: T[] }> {
            return { results: self.select(sql, params) as T[] }
          },
          async first<T>(): Promise<T | null> {
            const rows = self.select(sql, params)
            return (rows[0] as T) ?? null
          },
          async run(): Promise<{ meta: { last_row_id?: number } }> {
            return { meta: { last_row_id: self.mutate(sql, params) } }
          },
        }
      },
      async all<T>(): Promise<{ results: T[] }> {
        return { results: self.select(sql, []) as T[] }
      },
      async first<T>(): Promise<T | null> {
        const rows = self.select(sql, [])
        return (rows[0] as T) ?? null
      },
      async run(): Promise<{ meta: { last_row_id?: number } }> {
        return { meta: { last_row_id: self.mutate(sql, []) } }
      },
    }
  }

  private rows(table: string): Row[] {
    if (!this.tables[table]) this.tables[table] = []
    return this.tables[table]
  }

  private nextId(table: string): number {
    this.ids[table] = (this.ids[table] ?? 0) + 1
    return this.ids[table]
  }

  select(sql: string, params: unknown[]): Row[] {
    const m = /FROM\s+(\w+)/i.exec(sql)
    if (!m) return []
    let rows = [...this.rows(m[1])]
    // Equality filters: `col = ?` in WHERE, params in order.
    const whereCols = [...sql.matchAll(/(\w+)\s*=\s*\?/g)].map((x) => x[1])
    whereCols.forEach((col, i) => {
      rows = rows.filter((r) => String(r[col]) === String(params[i]))
    })
    // Literal equality: `col = 'value'`
    for (const lit of sql.matchAll(/(\w+)\s*=\s*'([^']+)'/g)) {
      rows = rows.filter((r) => String(r[lit[1]]) === lit[2])
    }
    // Aggregates
    if (/COUNT\(\*\)\s+AS\s+n/i.test(sql) && /SUM\(amount_usd\)/i.test(sql)) {
      const volume = rows.reduce((s, r) => s + Number(r.amount_usd ?? 0), 0)
      return [{ n: rows.length, volume }]
    }
    if (/COUNT\(\*\)\s+AS\s+n/i.test(sql)) return [{ n: rows.length }]
    if (/COALESCE\(MAX\(version\),\s*0\)\s+AS\s+v/i.test(sql)) {
      return [{ v: rows.reduce((mx, r) => Math.max(mx, Number(r.version ?? 0)), 0) }]
    }
    // Ordering
    const order = /ORDER BY\s+([\w, ]+?)(?:\s+DESC|\s+LIMIT|$)/i.exec(sql)
    const desc = /\bDESC\b/i.test(sql)
    if (order) {
      const key = order[1].split(',')[0].trim()
      rows.sort((a, b) => {
        const av = a[key] ?? a.id ?? 0
        const bv = b[key] ?? b.id ?? 0
        if (av === bv) return 0
        return (av < bv ? -1 : 1) * (desc ? -1 : 1)
      })
    } else if (desc) {
      rows.sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0))
    }
    const limit = /LIMIT\s+(\d+)/i.exec(sql)
    if (limit) rows = rows.slice(0, Number(limit[1]))
    return rows
  }

  mutate(sql: string, params: unknown[]): number | undefined {
    // Upserts used by the Worker.
    if (/INTO\s+login_attempts/i.test(sql)) {
      const ip = String(params[0])
      const rows = this.rows('login_attempts')
      const existing = rows.find((r) => r.ip === ip)
      if (existing) {
        existing.attempts = params[1]
        existing.locked_until = params[2]
      } else {
        rows.push({ ip, attempts: params[1], last_attempt_at: new Date().toISOString(), locked_until: params[2] })
      }
      return undefined
    }
    if (/INTO\s+keeper_state/i.test(sql)) {
      const rows = this.rows('keeper_state')
      const existing = rows.find((r) => r.id === 1)
      if (existing) {
        existing.paused = params[0]
        if (params[1] !== null && params[1] !== undefined) existing.keeper_address = params[1]
        existing.updated_by = params[2]
      } else {
        rows.push({ id: 1, paused: params[0], keeper_address: params[1], updated_by: params[2], updated_at: new Date().toISOString() })
      }
      return undefined
    }
    const insert = /INSERT INTO\s+(\w+)\s*\(([^)]+)\)/i.exec(sql)
    if (insert) {
      const table = insert[1]
      const cols = insert[2].split(',').map((c) => c.trim())
      const row: Row = { id: this.nextId(table), created_at: new Date().toISOString() }
      cols.forEach((c, i) => { row[c] = params[i] })
      this.rows(table).push(row)
      return row.id as number
    }
    const update = /UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+id\s*=\s*\?/is.exec(sql)
    if (update) {
      const table = update[1]
      const setCols = [...update[2].matchAll(/(\w+)\s*=\s*\?/g)].map((x) => x[1])
      const id = params[params.length - 1]
      const row = this.rows(table).find((r) => r.id === id)
      if (row) setCols.forEach((c, i) => { row[c] = params[i] })
      return undefined
    }
    const del = /DELETE FROM\s+(\w+)\s+WHERE\s+(?:id|ip)\s*=\s*\?/i.exec(sql)
    if (del) {
      const table = del[1]
      const key = /WHERE\s+id/i.test(sql) ? 'id' : 'ip'
      this.tables[table] = this.rows(table).filter((r) => r[key] !== params[0])
      return undefined
    }
    return undefined
  }
}

function makeEnv(db: FakeD1, extra: Partial<Env> = {}): Env {
  return {
    DB: db as unknown as D1Database,
    ASSETS: { fetch: async () => new Response('spa', { status: 200 }) } as unknown as Fetcher,
    ENVIRONMENT: 'test',
    ADMIN_EMAIL: 'ozoemenapaschal09@gmail.com',
    ADMIN_PASSWORD_HASH: '',
    ADMIN_SESSION_SECRET: 'test-session-secret',
    ...extra,
  }
}

function passwordHash(password: string): string {
  const salt = randomBytes(16)
  const key = pbkdf2Sync(password, salt, 600000, 32, 'sha256')
  return `pbkdf2-sha256$600000$${salt.toString('base64url')}$${key.toString('base64url')}`
}

async function login(env: Env): Promise<string> {
  const r = await worker.fetch(
    new Request('https://admin.test/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ozoemenapaschal09@gmail.com', password: 'correct-horse' }),
    }),
    env,
  )
  expect(r.status).toBe(200)
  const setCookie = r.headers.get('set-cookie') ?? ''
  const token = /stelix_admin=([^;]+)/.exec(setCookie)?.[1] ?? ''
  expect(token.length).toBeGreaterThan(10)
  return token
}

const authed = (token: string) => ({ Cookie: `stelix_admin=${token}` })

async function call(
  env: Env,
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await worker.fetch(
    new Request(`https://admin.test${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? authed(opts.token) : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    env,
  )
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>
  return { status: r.status, body }
}

const DEPLOY_PARAMS = {
  chainId: 'arc', env: 'testnet',
  owner: '0x1111111111111111111111111111111111111111',
  keeper: '0x2222222222222222222222222222222222222222',
  router: '0x3333333333333333333333333333333333333333',
  priceFeed: '0x4444444444444444444444444444444444444444',
  penaltyRecipient: '0x5555555555555555555555555555555555555555',
  feeRecipient: '0x6666666666666666666666666666666666666666',
  autoSellFeeBps: 100,
}

describe('Worker API (live endpoints, no sample data)', () => {
  let db: FakeD1
  let env: Env
  let token: string
  const realFetch = globalThis.fetch

  beforeEach(async () => {
    db = new FakeD1()
    // Seed the chain rows the other endpoints depend on (as migration 0002 does).
    db.tables.chains = [
      { id: 'arc', name: 'Arc', chain_id: 5042002, rpc_urls: 'https://rpc.testnet.arc.network', explorer_url: 'https://testnet.arcscan.app', native_token: 'USDC', stablecoin: 'USDC', stablecoin_address: '0x3600000000000000000000000000000000000000', dex_router: '', vault_address: null, status: 'testnet', is_default: 1 },
      { id: 'bnb', name: 'BNB Smart Chain', chain_id: 56, rpc_urls: 'https://bsc-dataseed.bnbchain.org', explorer_url: 'https://bscscan.com', native_token: 'BNB', stablecoin: 'USDT', stablecoin_address: '0x55d398326f99059fF775485246999027B3197955', dex_router: '', vault_address: null, status: 'hidden', is_default: 0 },
    ]
    db.tables.keeper_state = [{ id: 1, paused: 0, keeper_address: null, updated_by: '', updated_at: new Date().toISOString() }]
    env = makeEnv(db, { ADMIN_PASSWORD_HASH: passwordHash('correct-horse'), CONFIG_SIGNING_SECRET: 'test-config-secret' })
    token = await login(env)
    // Stub outbound network: RPC returns zero balances / no tx, DexScreener empty.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('dexscreener')) return new Response(JSON.stringify({ pairs: [] }), { status: 200 })
      if (url.includes('arcscan.app/api')) return new Response(JSON.stringify({ status: '1', result: [{ SourceCode: '' }] }), { status: 200 })
      let method = ''
      try { method = (JSON.parse(String(init?.body ?? '{}')) as { method?: string }).method ?? '' } catch { method = '' }
      if (method === 'eth_getTransactionByHash' || method === 'eth_getTransactionReceipt') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }), { status: 200 })
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' + '0'.repeat(64) }), { status: 200 })
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('serves health publicly and rejects unauthenticated admin calls', async () => {
    const health = await call(env, '/api/health')
    expect(health.status).toBe(200)
    expect(health.body.ok).toBe(true)
    const noAuth = await call(env, '/api/admin/dashboard')
    expect(noAuth.status).toBe(401)
  })

  it('dashboard starts at real zeros with no runs, no locks, no vault', async () => {
    const { status, body } = await call(env, '/api/admin/dashboard', { token })
    expect(status).toBe(200)
    expect(body.activeLocks).toBe(0)
    expect(body.autoSells).toBe(0)
    expect(body.autoSellVolumeUsd).toBe(0)
    expect(body.totalTvlUsd).toBe(0)
    expect(body.keeperHealth).toBe('No runs yet')
    expect(body.configVersion).toBe('not published')
    expect(Array.isArray(body.tvlByChain)).toBe(true)
  })

  it('fees: rejects an invalid config, versions a valid one, and keeps history', async () => {
    const bad = await call(env, '/api/admin/fees', { method: 'POST', token, body: { autoSellFeePct: 25, minLockUsd: 10, maxLockUsd: 100000, defaultPenaltyPct: 5, twapMinutes: 30, trailingStopOptions: 'Off', defaultSlippagePct: 1.5, penaltyDestination: 'treasury' } })
    expect(bad.status).toBe(400)
    const good = await call(env, '/api/admin/fees', { method: 'POST', token, body: { autoSellFeePct: 1, minLockUsd: 10, maxLockUsd: 100000, defaultPenaltyPct: 5, twapMinutes: 30, trailingStopOptions: 'Off, 10%', defaultSlippagePct: 1.5, penaltyDestination: 'treasury' } })
    expect(good.status).toBe(201)
    expect(good.body.version).toBe(1)
    const current = await call(env, '/api/admin/fees', { token })
    expect((current.body.fees as { autoSellFeePct: number }).autoSellFeePct).toBe(1)
    const history = await call(env, '/api/admin/fees/history', { token })
    expect((history.body.history as unknown[]).length).toBe(1)
  })

  it('tokens: add, duplicate rejected, list, remove', async () => {
    const add = await call(env, '/api/admin/tokens', { method: 'POST', token, body: { symbol: 'USDC', chainId: 'arc', address: '0x3600000000000000000000000000000000000000', decimals: 6, verified: true } })
    expect(add.status).toBe(201)
    const dup = await call(env, '/api/admin/tokens', { method: 'POST', token, body: { symbol: 'USDC', chainId: 'arc', address: '0x3600000000000000000000000000000000000000', decimals: 6 } })
    expect(dup.status).toBe(409)
    const list = await call(env, '/api/admin/tokens', { token })
    expect((list.body.tokens as unknown[]).length).toBe(1)
    const del = await call(env, `/api/admin/tokens?id=${add.body.id as number}`, { method: 'DELETE', token })
    expect(del.status).toBe(200)
    const empty = await call(env, '/api/admin/tokens', { token })
    expect((empty.body.tokens as unknown[]).length).toBe(0)
  })

  it('chains: create a chain and read it back', async () => {
    const res = await call(env, '/api/admin/chains', { method: 'POST', token, body: { id: 'base', name: 'Base', chainId: 8453, rpcUrls: 'https://mainnet.base.org', explorerUrl: 'https://basescan.org', nativeToken: 'ETH', stablecoin: 'USDC', stablecoinAddress: '', dexRouter: '', status: 'hidden' } })
    expect(res.status).toBe(201)
    const list = await call(env, '/api/chains', { token })
    expect((list.body.chains as { id: string }[]).some((c) => c.id === 'base')).toBe(true)
  })

  it('announcements: publish to D1 and serve publicly to the app banner feed', async () => {
    const pub = await call(env, '/api/admin/announcements', { method: 'POST', token, body: { title: 'Arc is live', message: 'Arc testnet is now live on Stelix.', audience: 'all' } })
    expect(pub.status).toBe(201)
    const feed = await call(env, '/api/announcements')
    expect(feed.status).toBe(200)
    expect((feed.body.announcements as { title: string }[])[0].title).toBe('Arc is live')
  })

  it('config: publishes a signed config and the public feed verifies the signature', async () => {
    const pub = await call(env, '/api/admin/config', { method: 'POST', token, body: { minAppVersion: '2.0.0', forceUpgrade: false, flags: { bullLockAutoSell: true, trailingStop: true } } })
    expect(pub.status).toBe(201)
    expect(pub.body.version).toBe('v1')
    expect(typeof pub.body.signature).toBe('string')
    const feed = await call(env, '/api/config')
    expect(feed.status).toBe(200)
    expect((feed.body.config as { signatureValid: boolean }).signatureValid).toBe(true)
  })

  it('config: refuses to publish unsigned when the signing secret is missing', async () => {
    const envNoSecret = makeEnv(db, { ADMIN_PASSWORD_HASH: passwordHash('correct-horse') })
    const t2 = await login(envNoSecret)
    const res = await call(envNoSecret, '/api/admin/config', { method: 'POST', token: t2, body: { minAppVersion: '2.0.0', forceUpgrade: false, flags: {} } })
    expect(res.status).toBe(503)
  })

  it('support: rejects seed phrases and finds nothing for an unknown tx hash', async () => {
    const seed = await call(env, '/api/support?q=' + encodeURIComponent('apple banana cherry dog elephant frog grape hotel india juliet kilo lima'), { token })
    expect(seed.status).toBe(400)
    const tx = await call(env, '/api/support?q=0x' + 'a'.repeat(64), { token })
    expect(tx.status).toBe(200)
    expect(tx.body.found).toBe(false)
  })

  it('keeper: run-now is honest when the keeper worker is not live', async () => {
    const res = await call(env, '/api/admin/keeper/run-now', { method: 'POST', token, body: {} })
    expect(res.status).toBe(503)
    expect(res.body.live).toBe(false)
    expect(String(res.body.message)).toMatch(/not live yet/)
    const status = await call(env, '/api/admin/keeper/status', { token })
    expect((status.body as { keeperLive: boolean }).keeperLive).toBe(false)
  })

  it('keeper: pause and resume write state to D1', async () => {
    const paused = await call(env, '/api/admin/keeper/pause', { method: 'POST', token, body: { paused: true } })
    expect(paused.status).toBe(200)
    expect(paused.body.paused).toBe(true)
    const runNow = await call(env, '/api/admin/keeper/run-now', { method: 'POST', token, body: {} })
    expect(runNow.status).toBe(409)
    const resumed = await call(env, '/api/admin/keeper/pause', { method: 'POST', token, body: { paused: false } })
    expect(resumed.body.paused).toBe(false)
  })

  it('compile: the exact repo source matches the solc 0.8.24 artifact', async () => {
    const res = await call(env, '/api/admin/compile', { method: 'POST', token, body: { source } })
    expect(res.status).toBe(200)
    expect(res.body.matchesArtifact).toBe(true)
    expect(res.body.compiler).toBe('solc 0.8.24')
    expect(typeof res.body.bytecodeHash).toBe('string')
  })

  it('contract audit: runs the checker, stores the run, and the gate passes on zero open critical/high', async () => {
    const run = await call(env, '/api/admin/audit/run', { method: 'POST', token, body: { source } })
    expect(run.status).toBe(201)
    expect(run.body.verdict).toBe('pass')
    expect(run.body.openCriticalHigh).toBe(0)
    const findings = run.body.findings as { rule: string; severity: string }[]
    expect(findings.some((f) => f.rule === 'PRICE_FEED_TRUST' && f.severity === 'medium')).toBe(true)
    const gate = await call(env, '/api/admin/audit/gate', { token })
    expect((gate.body as { gatePass: boolean }).gatePass).toBe(true)
    const runs = await call(env, '/api/admin/audit/runs', { token })
    expect((runs.body.runs as unknown[]).length).toBe(1)
  })

  it('external audit: requires evidence, then records it', async () => {
    const noEvidence = await call(env, '/api/admin/audit/external', { method: 'POST', token, body: { auditor: 'Firm', auditDate: '2026-11-26', scope: 'StelixVault', verdict: 'pass' } })
    expect(noEvidence.status).toBe(400)
    const ok = await call(env, '/api/admin/audit/external', { method: 'POST', token, body: { auditor: 'Firm', auditDate: '2026-11-26', scope: 'StelixVault', verdict: 'pass', reportUrl: 'https://example.com/audit.pdf' } })
    expect(ok.status).toBe(201)
    const list = await call(env, '/api/admin/audit/external', { token })
    expect((list.body.audits as unknown[]).length).toBe(1)
  })

  it('deploy prepare: validates constructor params and returns a Foundry command (no broadcast)', async () => {
    const res = await call(env, '/api/admin/deploy/prepare', { method: 'POST', token, body: { ...DEPLOY_PARAMS, sourceHash: '0b5e90fcf6bc5d0592ccecd1aa41e83fbc880ef844c3ad4eaee9adcecc6f0646' } })
    expect(res.status).toBe(200)
    expect(String(res.body.deployCommand)).toMatch(/forge script/)
    expect(String(res.body.deployCommand)).toMatch(/PRICE_FEED/)
  })

  it('deploy prepare: rejects a missing price feed', async () => {
    const res = await call(env, '/api/admin/deploy/prepare', { method: 'POST', token, body: { ...DEPLOY_PARAMS, priceFeed: '' } })
    expect(res.status).toBe(400)
  })

  it('deploy register: refuses an address with no contract code (RPC stub returns empty code)', async () => {
    // The stubbed RPC returns 0x + 64 zero bytes for eth_call, which is empty
    // returndata, not contract code — but eth_getCode is what matters: our
    // stub returns the same zero payload, so code is absent and registration
    // must fail rather than record a fake deployment.
    const res = await call(env, '/api/admin/deploy/register', {
      method: 'POST', token,
      body: { ...DEPLOY_PARAMS, address: '0x7777777777777777777777777777777777777777', sourceHash: '0b5e90fcf6bc5d0592ccecd1aa41e83fbc880ef844c3ad4eaee9adcecc6f0646' },
    })
    expect([400, 502]).toContain(res.status)
    const deployments = await call(env, '/api/admin/deployments', { token })
    expect((deployments.body.deployments as unknown[]).length).toBe(0)
  })

  it('deploy register: mainnet is gated without audit/testnet/smoke evidence', async () => {
    const res = await call(env, '/api/admin/deploy/register', {
      method: 'POST', token,
      body: { ...DEPLOY_PARAMS, env: 'mainnet', address: '0x7777777777777777777777777777777777777777', sourceHash: '0b5e90fcf6bc5d0592ccecd1aa41e83fbc880ef844c3ad4eaee9adcecc6f0646', confirmation: 'Deploy StelixVault to Arc mainnet' },
    })
    expect(res.status).toBe(403)
  })

  it('audit log records admin actions', async () => {
    await call(env, '/api/admin/fees', { method: 'POST', token, body: { autoSellFeePct: 1, minLockUsd: 10, maxLockUsd: 100000, defaultPenaltyPct: 5, twapMinutes: 30, trailingStopOptions: 'Off', defaultSlippagePct: 1.5, penaltyDestination: 'treasury' } })
    const log = await call(env, '/api/admin/audit', { token })
    const actions = (log.body.audit as { action: string }[]).map((a) => a.action)
    expect(actions).toContain('fees.publish')
    expect(actions).toContain('admin.login')
  })

  it('launches: public feed starts empty with no deployed contracts', async () => {
    const feed = await call(env, '/api/launches')
    expect(feed.status).toBe(200)
    expect(feed.body.launches).toEqual([])
    expect(feed.body.launchpadAddress).toBeNull()
    expect(feed.body.factoryAddress).toBeNull()
    expect(feed.body.liquidityManager).toBeNull()
    expect(feed.body.note as string).toMatch(/No launches yet — launches go live once the launchpad contracts are deployed on Arc testnet/)
    const admin = await call(env, '/api/admin/launches', { token })
    expect(admin.status).toBe(200)
    expect(admin.body.launches).toEqual([])
    const noAuth = await call(env, '/api/admin/launches')
    expect(noAuth.status).toBe(401)
  })

  it('launches: admin registers, approves, and the public feed lists it; bad data rejected', async () => {
    const now = Math.floor(Date.now() / 1000)
    const bad = await call(env, '/api/admin/launches', {
      method: 'POST', token,
      body: { seller: 'not-an-address', tokenAddress: '0x2222222222222222222222222222222222222222', tokenSymbol: 'TEST', pricePerToken: '100000', softCap: '1000000000', hardCap: '10000000000', tokensForSale: '100000000000000000000000', startTime: now + 60, endTime: now + 86400, liquidityLockBps: 2000 },
    })
    expect(bad.status).toBe(400)
    const tooMuchLock = await call(env, '/api/admin/launches', {
      method: 'POST', token,
      body: { seller: '0x1111111111111111111111111111111111111111', tokenAddress: '0x2222222222222222222222222222222222222222', tokenSymbol: 'TEST', pricePerToken: '100000', softCap: '1000000000', hardCap: '10000000000', tokensForSale: '100000000000000000000000', startTime: now + 60, endTime: now + 86400, liquidityLockBps: 5001 },
    })
    expect(tooMuchLock.status).toBe(400)
    const created = await call(env, '/api/admin/launches', {
      method: 'POST', token,
      body: { saleId: 0, seller: '0x1111111111111111111111111111111111111111', tokenAddress: '0x2222222222222222222222222222222222222222', tokenSymbol: 'TEST', tokenName: 'Test Token', tokenDecimals: 18, pricePerToken: '100000', softCap: '1000000000', hardCap: '10000000000', tokensForSale: '100000000000000000000000', startTime: now + 60, endTime: now + 86400, liquidityLockBps: 2000 },
    })
    expect(created.status).toBe(201)
    const id = created.body.id as number
    expect(id).toBeGreaterThan(0)
    // Pending approval: not on the public feed yet.
    const hidden = await call(env, '/api/launches')
    expect(hidden.body.launches).toEqual([])
    const badApproval = await call(env, `/api/admin/launches/${id}`, { method: 'PATCH', token, body: { approvalStatus: 'yes' } })
    expect(badApproval.status).toBe(400)
    const approved = await call(env, `/api/admin/launches/${id}`, { method: 'PATCH', token, body: { approvalStatus: 'approved' } })
    expect(approved.status).toBe(200)
    const feed = await call(env, '/api/launches')
    expect((feed.body.launches as unknown[]).length).toBe(1)
    const row = (feed.body.launches as Record<string, unknown>[])[0]
    expect(row.token_symbol).toBe('TEST')
    expect(row.approval_status).toBe('approved')
    expect(row.liquidity_manager).toBeNull()
    // Marking the sale successful updates the admin record.
    const settled = await call(env, `/api/admin/launches/${id}`, { method: 'PATCH', token, body: { status: 'Success', finalized: true } })
    expect(settled.status).toBe(200)
    const admin = await call(env, '/api/admin/launches', { token })
    const listed = (admin.body.launches as Record<string, unknown>[])[0]
    expect(listed.status).toBe('Success')
    expect(listed.finalized).toBe(1)
  })

  it('launches: contributions are recorded per launch and listed', async () => {
    const now = Math.floor(Date.now() / 1000)
    const created = await call(env, '/api/admin/launches', {
      method: 'POST', token,
      body: { seller: '0x1111111111111111111111111111111111111111', tokenAddress: '0x2222222222222222222222222222222222222222', tokenSymbol: 'TEST', pricePerToken: '100000', softCap: '1000000000', hardCap: '10000000000', tokensForSale: '100000000000000000000000', startTime: now + 60, endTime: now + 86400, liquidityLockBps: 0 },
    })
    const id = created.body.id as number
    const bad = await call(env, `/api/admin/launches/${id}/contributions`, { method: 'POST', token, body: { contributor: 'nope', amount: '25000000' } })
    expect(bad.status).toBe(400)
    const ok = await call(env, `/api/admin/launches/${id}/contributions`, { method: 'POST', token, body: { contributor: '0x3333333333333333333333333333333333333333', amount: '25000000' } })
    expect(ok.status).toBe(201)
    const list = await call(env, `/api/admin/launches/${id}/contributions`, { token })
    expect(list.status).toBe(200)
    expect((list.body.contributions as unknown[]).length).toBe(1)
    expect((list.body.contributions as Record<string, unknown>[])[0].amount).toBe('25000000')
    const missing = await call(env, '/api/admin/launches/9999/contributions', { token })
    expect(missing.body.contributions).toEqual([])
  })
})
