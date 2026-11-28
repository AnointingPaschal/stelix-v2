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
    if (/INTO\s+admin_auth/i.test(sql)) {
      const rows = this.rows('admin_auth')
      const existing = rows.find((r) => r.id === 1)
      if (existing) {
        existing.password_hash = params[0]
        existing.session_version = params[1]
      } else {
        rows.push({ id: 1, password_hash: params[0], session_version: params[1], updated_at: new Date().toISOString() })
      }
      return undefined
    }
    if (/INTO\s+admin_settings/i.test(sql)) {
      const rows = this.rows('admin_settings')
      const existing = rows.find((r) => r.key === params[0])
      if (existing) {
        existing.value = params[1]
        existing.updated_at = new Date().toISOString()
      } else {
        rows.push({ key: params[0], value: params[1], updated_at: new Date().toISOString() })
      }
      return undefined
    }
    const insert = /INSERT INTO\s+(\w+)\s*\(([^)]+)\)/i.exec(sql)
    if (insert) {
      const table = insert[1]
      const cols = insert[2].split(',').map((c) => c.trim())
      const row: Row = { id: this.nextId(table), created_at: new Date().toISOString() }
      // VALUES may mix `?` placeholders with literals (e.g. `..., 1, 0, ?`
      // in the token-registry upsert) — bind placeholders in order and
      // take literals as written, so the double matches real D1.
      const valuesPart = /VALUES\s*\(([^)]+)\)/i.exec(sql)?.[1]?.split(',').map((v) => v.trim()) ?? []
      let paramIdx = 0
      cols.forEach((c, i) => {
        const v = valuesPart[i]
        if (v === '?') {
          row[c] = params[paramIdx]
          paramIdx += 1
        } else if (v !== undefined && v !== '') {
          const num = Number(v)
          row[c] = v.startsWith("'") && v.endsWith("'") ? v.slice(1, -1) : Number.isNaN(num) ? v : num
        } else {
          row[c] = params[paramIdx]
          paramIdx += 1
        }
      })
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
  const key = pbkdf2Sync(password, salt, 100000, 32, 'sha256')
  return `pbkdf2-sha256$100000$${salt.toString('base64url')}$${key.toString('base64url')}`
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
    // Seed the chain rows the other endpoints depend on (as migrations 0002 + 0006 do).
    db.tables.chains = [
      { id: 'arc', name: 'Arc Testnet', chain_id: 5042002, rpc_urls: 'https://rpc.testnet.arc.io', explorer_url: 'https://explorer.testnet.arc.io', native_token: 'USDC', stablecoin: 'USDC', stablecoin_address: '0x3600000000000000000000000000000000000000', dex_router: '0xfA845604F52843a7b5cfA4030120c6238741F420', vault_address: null, status: 'testnet', is_default: 1 },
      { id: 'arc-mainnet', name: 'Arc Mainnet', chain_id: 5042, rpc_urls: 'https://rpc.mainnet.arc.io', explorer_url: 'https://explorer.arc.io', native_token: 'USDC', stablecoin: 'USDC', stablecoin_address: '0x3600000000000000000000000000000000000000', dex_router: '0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77', vault_address: null, status: 'live', is_default: 0 },
      { id: 'bnb', name: 'BNB Smart Chain', chain_id: 56, rpc_urls: 'https://bsc-dataseed.bnbchain.org', explorer_url: 'https://bscscan.com', native_token: 'BNB', stablecoin: 'USDT', stablecoin_address: '0x55d398326f99059fF775485246999027B3197955', dex_router: '', vault_address: null, status: 'hidden', is_default: 0 },
    ]
    db.tables.keeper_state = [{ id: 1, paused: 0, keeper_address: null, updated_by: '', updated_at: new Date().toISOString() }]
    env = makeEnv(db, { ADMIN_PASSWORD_HASH: passwordHash('correct-horse'), CONFIG_SIGNING_SECRET: 'test-config-secret' })
    token = await login(env)
    // Stub outbound network: RPC returns zero balances / no tx, DexScreener empty.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('dexscreener')) return new Response(JSON.stringify({ pairs: [] }), { status: 200 })
      if (url.includes('explorer.testnet.arc.io/api') || url.includes('explorer.arc.io/api')) return new Response(JSON.stringify({ status: '1', result: [{ SourceCode: '' }] }), { status: 200 })
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

  it('chains: GET /api/chains is public (no admin session) and returns the new fields', async () => {
    const pub = await call(env, '/api/chains')
    expect(pub.status).toBe(200)
    const chains = pub.body.chains as Record<string, unknown>[]
    expect(chains.some((c) => c.id === 'arc')).toBe(true)
    const arc = chains.find((c) => c.id === 'arc') as Record<string, unknown>
    expect(arc.chain_id).toBe(5042002)
    expect(arc.rpc_urls).toMatch(/https:\/\//)
    expect(arc.explorer_url).toMatch(/https:\/\//)
    expect(arc.stablecoin).toBe('USDC')
  })

  it('chains: create rejects a bad chain id, http RPC, bad address, duplicate slug and duplicate chain id', async () => {
    const base = { id: 'arbitrum', name: 'Arbitrum One', chainId: 42161, rpcUrls: 'https://arb1.arbitrum.io/rpc', explorerUrl: 'https://arbiscan.io', nativeToken: 'ETH', stablecoin: 'USDC', stablecoinAddress: '', dexRouter: '', status: 'testnet' }
    const badId = await call(env, '/api/admin/chains', { method: 'POST', token, body: { ...base, chainId: 'not-a-number' } })
    expect(badId.status).toBe(400)
    expect(String(badId.body.error)).toMatch(/chain id/)
    const badRpc = await call(env, '/api/admin/chains', { method: 'POST', token, body: { ...base, rpcUrls: 'http://arb1.arbitrum.io/rpc' } })
    expect(badRpc.status).toBe(400)
    expect(String(badRpc.body.error)).toMatch(/https/)
    const badAddr = await call(env, '/api/admin/chains', { method: 'POST', token, body: { ...base, stablecoinAddress: '0x1234' } })
    expect(badAddr.status).toBe(400)
    expect(String(badAddr.body.error)).toMatch(/0x address/)
    const badRouter = await call(env, '/api/admin/chains', { method: 'POST', token, body: { ...base, dexRouter: 'guess-me' } })
    expect(badRouter.status).toBe(400)
    const ok = await call(env, '/api/admin/chains', { method: 'POST', token, body: { ...base, nativeDecimals: 18, stablecoinDecimals: 6, gasToken: 'ETH', isTestnet: true, active: true } })
    expect(ok.status).toBe(201)
    const dupSlug = await call(env, '/api/admin/chains', { method: 'POST', token, body: { ...base, chainId: 42162 } })
    expect(dupSlug.status).toBe(409)
    expect(String(dupSlug.body.error)).toMatch(/slug/)
    const dupChainId = await call(env, '/api/admin/chains', { method: 'POST', token, body: { ...base, id: 'arbitrum-2', chainId: 42161 } })
    expect(dupChainId.status).toBe(409)
    expect(String(dupChainId.body.error)).toMatch(/42161/)
    // The valid row is readable publicly with its new fields intact.
    const pub = await call(env, '/api/chains')
    const row = (pub.body.chains as Record<string, unknown>[]).find((c) => c.id === 'arbitrum') as Record<string, unknown>
    expect(row.native_decimals).toBe(18)
    expect(row.stablecoin_decimals).toBe(6)
    expect(row.gas_token).toBe('ETH')
    expect(row.is_testnet).toBe(1)
    expect(row.active).toBe(1)
  })

  it('chains: PUT edits a chain and PATCH /active disables / re-enables it; writes need a session', async () => {
    const noAuth = await call(env, '/api/admin/chains', { method: 'POST', body: { id: 'x', name: 'X', chainId: 999, rpcUrls: 'https://example.com', explorerUrl: 'https://example.com', nativeToken: 'ETH', stablecoin: 'USDC', status: 'hidden' } })
    expect(noAuth.status).toBe(401)
    const created = await call(env, '/api/admin/chains', { method: 'POST', token, body: { id: 'optimism', name: 'Optimism', chainId: 10, rpcUrls: 'https://mainnet.optimism.io', explorerUrl: 'https://optimistic.etherscan.io', nativeToken: 'ETH', stablecoin: 'USDC', stablecoinAddress: '', dexRouter: '', status: 'hidden' } })
    expect(created.status).toBe(201)
    const edited = await call(env, '/api/admin/chains/optimism', { method: 'PUT', token, body: { name: 'OP Mainnet', nativeDecimals: 18, stablecoinAddress: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', status: 'testnet' } })
    expect(edited.status).toBe(200)
    const badEdit = await call(env, '/api/admin/chains/optimism', { method: 'PUT', token, body: { stablecoinAddress: '0x1234' } })
    expect(badEdit.status).toBe(400)
    const missing = await call(env, '/api/admin/chains/nope', { method: 'PUT', token, body: { name: 'Nope' } })
    expect(missing.status).toBe(404)
    const disabled = await call(env, '/api/admin/chains/optimism/active', { method: 'PATCH', token, body: { active: false } })
    expect(disabled.status).toBe(200)
    expect(disabled.body.active).toBe(false)
    const pub = await call(env, '/api/chains')
    const row = (pub.body.chains as Record<string, unknown>[]).find((c) => c.id === 'optimism') as Record<string, unknown>
    expect(row.name).toBe('OP Mainnet')
    expect(row.stablecoin_address).toBe('0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85')
    expect(row.active).toBe(0)
    expect(row.is_testnet).toBe(1)
    const badToggle = await call(env, '/api/admin/chains/optimism/active', { method: 'PATCH', token, body: { active: 'yes' } })
    expect(badToggle.status).toBe(400)
    const enabled = await call(env, '/api/admin/chains/optimism/active', { method: 'PATCH', token, body: { active: true } })
    expect(enabled.status).toBe(200)
    const pub2 = await call(env, '/api/chains')
    expect((pub2.body.chains as Record<string, unknown>[]).find((c) => c.id === 'optimism')?.active).toBe(1)
  })

  it('chains: coming-soon flag — create with it, PATCH /coming-soon flips it, /api/sync carries it', async () => {
    const created = await call(env, '/api/admin/chains', { method: 'POST', token, body: { id: 'plasma', name: 'Plasma', chainId: 9745, rpcUrls: 'https://rpc.plasma.to', explorerUrl: 'https://plasmascan.to', nativeToken: 'XPL', stablecoin: 'USDT0', stablecoinAddress: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb', dexRouter: '0x807F4E281B7A3B324825C64ca53c69F0b418dE40', status: 'live', comingSoon: true } })
    expect(created.status).toBe(201)
    const pub = await call(env, '/api/chains')
    const row = (pub.body.chains as Record<string, unknown>[]).find((c) => c.id === 'plasma') as Record<string, unknown>
    expect(row.coming_soon).toBe(1)
    // /api/sync serves the raw chain rows (snake_case), same as /api/chains.
    const sync = await call(env, '/api/sync')
    const syncChain = (sync.body.chains as Record<string, unknown>[]).find((c) => c.id === 'plasma') as Record<string, unknown>
    expect(syncChain.coming_soon).toBe(1)
    // Flip it off from the Chain Manager toggle.
    const off = await call(env, '/api/admin/chains/plasma/coming-soon', { method: 'PATCH', token, body: { comingSoon: false } })
    expect(off.status).toBe(200)
    expect(off.body.comingSoon).toBe(false)
    const pub2 = await call(env, '/api/chains')
    expect((pub2.body.chains as Record<string, unknown>[]).find((c) => c.id === 'plasma')?.coming_soon).toBe(0)
    const bad = await call(env, '/api/admin/chains/plasma/coming-soon', { method: 'PATCH', token, body: { comingSoon: 'yes' } })
    expect(bad.status).toBe(400)
    const missing = await call(env, '/api/admin/chains/nope/coming-soon', { method: 'PATCH', token, body: { comingSoon: true } })
    expect(missing.status).toBe(404)
    const noAuth = await call(env, '/api/admin/chains/plasma/coming-soon', { method: 'PATCH', body: { comingSoon: true } })
    expect(noAuth.status).toBe(401)
  })

  it('announcements: publish to D1 and serve publicly to the app banner feed', async () => {
    const pub = await call(env, '/api/admin/announcements', { method: 'POST', token, body: { title: 'Arc is live', message: 'Arc testnet is now live on Stelix.', audience: 'all' } })
    expect(pub.status).toBe(201)
    const feed = await call(env, '/api/announcements')
    expect(feed.status).toBe(200)
    expect((feed.body.announcements as { title: string }[])[0].title).toBe('Arc is live')
  })

  it('releases: publish validates version + URL, lists newest first, and /api/sync carries the latest as appUpdate', async () => {
    const badVersion = await call(env, '/api/admin/releases', { method: 'POST', token, body: { version: '2.1', url: 'https://example.com/stelix-2.1.0.apk', force: false } })
    expect(badVersion.status).toBe(400)
    const badUrl = await call(env, '/api/admin/releases', { method: 'POST', token, body: { version: '2.1.0', url: 'ftp://example.com/stelix-2.1.0.apk', force: false } })
    expect(badUrl.status).toBe(400)
    const noAuth = await call(env, '/api/admin/releases', { method: 'POST', body: { version: '2.1.0', url: 'https://example.com/stelix-2.1.0.apk', force: false } })
    expect(noAuth.status).toBe(401)
    const before = await call(env, '/api/sync')
    expect(before.body.appUpdate).toBeNull()
    const pub = await call(env, '/api/admin/releases', { method: 'POST', token, body: { version: '2.1.0', notes: 'Faster locks.', url: 'https://example.com/stelix-2.1.0.apk', force: true } })
    expect(pub.status).toBe(201)
    const list = await call(env, '/api/admin/releases', { token })
    expect(list.status).toBe(200)
    expect((list.body.releases as { version: string }[])[0].version).toBe('2.1.0')
    const sync = await call(env, '/api/sync')
    expect(sync.body.appUpdate).toEqual({ version: '2.1.0', notes: 'Faster locks.', url: 'https://example.com/stelix-2.1.0.apk', force: true })
    expect(sync.body.version).toBe(1)
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

  it('deploy register: retries a transient RPC failure and then registers', async () => {
    // The mainnet vault registration at ~20:10 WAT failed on a one-off
    // RPC hiccup even though the RPC answers in ~34 ms from the Workers
    // runtime — rpcCall retries once so a single blip cannot fail a save.
    let codeCalls = 0
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('explorer')) return new Response(JSON.stringify({ status: '1', result: [{ SourceCode: '' }] }), { status: 200 })
      let method = ''
      try { method = (JSON.parse(String(init?.body ?? '{}')) as { method?: string }).method ?? '' } catch { method = '' }
      if (method === 'eth_getCode') {
        codeCalls++
        if (codeCalls === 1) throw new Error('fetch failed')
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x6080604052' }), { status: 200 })
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' + '0'.repeat(64) }), { status: 200 })
    }) as unknown as typeof fetch
    const res = await call(env, '/api/admin/deploy/register', {
      method: 'POST', token,
      body: { ...DEPLOY_PARAMS, address: '0x8888888888888888888888888888888888888888', sourceHash: '0b5e90fcf6bc5d0592ccecd1aa41e83fbc880ef844c3ad4eaee9adcecc6f0646' },
    })
    expect(res.status).toBe(201)
    expect(codeCalls).toBe(2)
    const deployments = await call(env, '/api/admin/deployments', { token })
    expect((deployments.body.deployments as unknown[]).length).toBe(1)
  })

  it('deploy register: re-registering the same vault with the same values succeeds without the RPC', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('explorer')) return new Response(JSON.stringify({ status: '1', result: [{ SourceCode: '' }] }), { status: 200 })
      let method = ''
      try { method = (JSON.parse(String(init?.body ?? '{}')) as { method?: string }).method ?? '' } catch { method = '' }
      if (method === 'eth_getCode') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x6080604052' }), { status: 200 })
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' + '0'.repeat(64) }), { status: 200 })
    }) as unknown as typeof fetch
    const body = { ...DEPLOY_PARAMS, address: '0x8888888888888888888888888888888888888888', sourceHash: '0b5e90fcf6bc5d0592ccecd1aa41e83fbc880ef844c3ad4eaee9adcecc6f0646' }
    const first = await call(env, '/api/admin/deploy/register', { method: 'POST', token, body })
    expect(first.status).toBe(201)
    // The RPC now fails on every call — a re-register must not need it.
    globalThis.fetch = vi.fn(async () => { throw new Error('fetch failed') }) as unknown as typeof fetch
    const again = await call(env, '/api/admin/deploy/register', { method: 'POST', token, body })
    expect(again.status).toBe(200)
    expect(again.body.verificationStatus).toBe('already-registered')
    const deployments = await call(env, '/api/admin/deployments', { token })
    expect((deployments.body.deployments as unknown[]).length).toBe(1)
    // Same address, different constructor values: refuse, do not overwrite.
    const different = await call(env, '/api/admin/deploy/register', { method: 'POST', token, body: { ...body, keeper: '0x9999999999999999999999999999999999999999' } })
    expect(different.status).toBe(400)
  })

  it('deploy register: mainnet is gated without audit/testnet/smoke evidence', async () => {
    const res = await call(env, '/api/admin/deploy/register', {
      method: 'POST', token,
      body: { ...DEPLOY_PARAMS, env: 'mainnet', address: '0x7777777777777777777777777777777777777777', sourceHash: '0b5e90fcf6bc5d0592ccecd1aa41e83fbc880ef844c3ad4eaee9adcecc6f0646', confirmation: 'Deploy StelixVault to Arc Testnet mainnet' },
    })
    expect(res.status).toBe(403)
  })

  it('deploy prepare: mainnet gate for arc-mainnet counts a verified Arc testnet deployment', async () => {
    const mainnet = { ...DEPLOY_PARAMS, chainId: 'arc-mainnet', env: 'mainnet', sourceHash: '0b5e90fcf6bc5d0592ccecd1aa41e83fbc880ef844c3ad4eaee9adcecc6f0646', confirmation: 'Deploy StelixVault to Arc Mainnet' }
    // No audit / testnet deployment / smoke attestation yet: gated.
    const gated = await call(env, '/api/admin/deploy/prepare', { method: 'POST', token, body: mainnet })
    expect(gated.status).toBe(403)
    // Passing automated audit + verified testnet deployment on "arc" +
    // smoke attestation for "arc-mainnet": the gate passes and prepare
    // returns the mainnet RPC and a CHAIN=arc-mainnet command.
    db.tables.audit_runs = [{ id: 1, verdict: 'pass', findings_json: '[]' }]
    db.tables.deployments = [{ id: 1, chain_id: 'arc', env: 'testnet', verification_status: 'verified' }]
    db.tables.gate_attestations = [{ id: 1, chain_id: 'arc-mainnet', kind: 'smoke' }]
    const listed = await call(env, '/api/admin/deployments', { token })
    expect((listed.body.deployments as unknown[]).length).toBe(1)
    const ok = await call(env, '/api/admin/deploy/prepare', { method: 'POST', token, body: mainnet })
    expect(ok.status).toBe(200)
    expect(ok.body.rpcUrl).toBe('https://rpc.mainnet.arc.io')
    expect(String(ok.body.deployCommand)).toMatch(/CHAIN=arc-mainnet/)
    expect(String(ok.body.note)).toMatch(/mainnet deployer key/)
  })

  it('gate bypass: off by default, lets a mainnet prepare pass without gate evidence, and re-enforces when turned off', async () => {
    const before = await call(env, '/api/admin/gate-bypass', { token })
    expect(before.body.bypassed).toBe(false)
    // No confirmation phrase in the body either: the bypass skips it too.
    const mainnet = { ...DEPLOY_PARAMS, chainId: 'arc-mainnet', env: 'mainnet', sourceHash: '0b5e90fcf6bc5d0592ccecd1aa41e83fbc880ef844c3ad4eaee9adcecc6f0646' }
    const gated = await call(env, '/api/admin/deploy/prepare', { method: 'POST', token, body: mainnet })
    expect(gated.status).toBe(403)
    const flipped = await call(env, '/api/admin/gate-bypass', { method: 'POST', token, body: { bypassed: true } })
    expect(flipped.status).toBe(200)
    expect(flipped.body.bypassed).toBe(true)
    const after = await call(env, '/api/admin/gate-bypass', { token })
    expect(after.body.bypassed).toBe(true)
    const allowed = await call(env, '/api/admin/deploy/prepare', { method: 'POST', token, body: mainnet })
    expect(allowed.status).toBe(200)
    expect(String(allowed.body.deployCommand)).toMatch(/CHAIN=arc-mainnet/)
    // Turning it back off re-enforces the gate.
    await call(env, '/api/admin/gate-bypass', { method: 'POST', token, body: { bypassed: false } })
    const gatedAgain = await call(env, '/api/admin/deploy/prepare', { method: 'POST', token, body: mainnet })
    expect(gatedAgain.status).toBe(403)
  })

  it('deploy register: gate bypass does not skip the on-chain code check', async () => {
    await call(env, '/api/admin/gate-bypass', { method: 'POST', token, body: { bypassed: true } })
    const res = await call(env, '/api/admin/deploy/register', {
      method: 'POST', token,
      body: { ...DEPLOY_PARAMS, chainId: 'arc-mainnet', env: 'mainnet', address: '0x7777777777777777777777777777777777777777', sourceHash: '0b5e90fcf6bc5d0592ccecd1aa41e83fbc880ef844c3ad4eaee9adcecc6f0646' },
    })
    expect([400, 502]).toContain(res.status)
    const deployments = await call(env, '/api/admin/deployments', { token })
    expect((deployments.body.deployments as unknown[]).length).toBe(0)
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

  it('launches: terms edit works before money is in; "1e+23" rejected; tokens must cover hard cap', async () => {
    const now = Math.floor(Date.now() / 1000)
    const created = await call(env, '/api/admin/launches', {
      method: 'POST', token,
      body: { saleId: 0, seller: '0x1111111111111111111111111111111111111111', tokenAddress: '0x2222222222222222222222222222222222222222', tokenSymbol: 'TEST', tokenName: 'Test Token', tokenDecimals: 18, pricePerToken: '100000', softCap: '1000000000', hardCap: '10000000000', tokensForSale: '100000000000000000000000', startTime: now + 60, endTime: now + 86400, liquidityLockBps: 2000 },
    })
    expect(created.status).toBe(201)
    const id = created.body.id as number
    // Regression: 100,000 whole tokens at 18 decimals is exact digits —
    // the old float math produced "1e+23", which must be rejected, not stored.
    const sci = await call(env, `/api/admin/launches/${id}`, { method: 'PATCH', token, body: { tokensForSale: '1e+23' } })
    expect(sci.status).toBe(400)
    expect(sci.body.error as string).toMatch(/scientific notation/)
    const sciPrice = await call(env, `/api/admin/launches/${id}`, { method: 'PATCH', token, body: { pricePerToken: '1e+5' } })
    expect(sciPrice.status).toBe(400)
    // Tokens for sale must cover hardCap / price: $10,000 at $0.10 needs
    // 100,000 tokens, so 10,000 tokens is rejected.
    const tooFew = await call(env, `/api/admin/launches/${id}`, { method: 'PATCH', token, body: { tokensForSale: '10000000000000000000000' } })
    expect(tooFew.status).toBe(400)
    expect(tooFew.body.error as string).toMatch(/cover the hard cap/)
    // A valid terms edit applies (price $0.20, hard cap $20,000 still needs
    // exactly the 100,000 tokens on sale).
    const ok = await call(env, `/api/admin/launches/${id}`, { method: 'PATCH', token, body: { pricePerToken: '200000', hardCap: '20000000000', tokensForSale: '100000000000000000000000', startTime: now + 120, endTime: now + 90000, liquidityLockBps: 2500 } })
    expect(ok.status).toBe(200)
    const admin = await call(env, '/api/admin/launches', { token })
    const row = (admin.body.launches as Record<string, unknown>[])[0]
    expect(row.price_per_token).toBe('200000')
    expect(row.hard_cap).toBe('20000000000')
    expect(row.tokens_for_sale).toBe('100000000000000000000000')
    expect(row.liquidity_lock_bps).toBe(2500)
    // Bad terms are rejected: hard cap below soft cap, end before start,
    // liquidity lock above the 50% max.
    const badCap = await call(env, `/api/admin/launches/${id}`, { method: 'PATCH', token, body: { hardCap: '100' } })
    expect(badCap.status).toBe(400)
    const badDates = await call(env, `/api/admin/launches/${id}`, { method: 'PATCH', token, body: { startTime: now + 90000, endTime: now + 120 } })
    expect(badDates.status).toBe(400)
    const badLock = await call(env, `/api/admin/launches/${id}`, { method: 'PATCH', token, body: { liquidityLockBps: 5001 } })
    expect(badLock.status).toBe(400)
  })

  it('launches: once money is in, price/caps/tokens are blocked; dates need explicit confirmation', async () => {
    const now = Math.floor(Date.now() / 1000)
    const created = await call(env, '/api/admin/launches', {
      method: 'POST', token,
      body: { saleId: 0, seller: '0x1111111111111111111111111111111111111111', tokenAddress: '0x2222222222222222222222222222222222222222', tokenSymbol: 'TEST', tokenName: 'Test Token', tokenDecimals: 18, pricePerToken: '100000', softCap: '1000000000', hardCap: '10000000000', tokensForSale: '100000000000000000000000', startTime: now + 60, endTime: now + 86400, liquidityLockBps: 2000 },
    })
    const id = created.body.id as number
    // Record a contribution: money is in. (The launch row counters are
    // only synced by admin updates, so the guardrail must count the
    // contributions table too — not just the row.)
    const contrib = await call(env, `/api/admin/launches/${id}/contributions`, { method: 'POST', token, body: { contributor: '0x3333333333333333333333333333333333333333', amount: '25000000' } })
    expect(contrib.status).toBe(201)
    const blockedPrice = await call(env, `/api/admin/launches/${id}`, { method: 'PATCH', token, body: { pricePerToken: '200000' } })
    expect(blockedPrice.status).toBe(400)
    expect(blockedPrice.body.error as string).toMatch(/already has contributions/)
    const blockedCap = await call(env, `/api/admin/launches/${id}`, { method: 'PATCH', token, body: { hardCap: '20000000000' } })
    expect(blockedCap.status).toBe(400)
    const blockedTokens = await call(env, `/api/admin/launches/${id}`, { method: 'PATCH', token, body: { tokensForSale: '200000000000000000000000' } })
    expect(blockedTokens.status).toBe(400)
    // Dates / liquidity lock need the explicit confirmation flag.
    const noConfirm = await call(env, `/api/admin/launches/${id}`, { method: 'PATCH', token, body: { endTime: now + 200000 } })
    expect(noConfirm.status).toBe(400)
    expect(noConfirm.body.error as string).toMatch(/confirm/)
    const confirmed = await call(env, `/api/admin/launches/${id}`, { method: 'PATCH', token, body: { endTime: now + 200000, confirmTermsChange: true } })
    expect(confirmed.status).toBe(200)
    const admin = await call(env, '/api/admin/launches', { token })
    const row = (admin.body.launches as Record<string, unknown>[])[0]
    expect(row.end_time).toBe(now + 200000)
    // ... while the blocked price never changed.
    expect(row.price_per_token).toBe('100000')
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

  it('launch logos: upload a file (never a link), serve it publicly, reject SVG/oversize/unauthenticated', async () => {
    // A 1x1 transparent PNG.
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])
    const upload = async (file: File, useToken: boolean) => {
      const form = new FormData()
      form.append('file', file)
      const r = await worker.fetch(
        new Request('https://admin.test/api/admin/launches/logo', {
          method: 'POST',
          headers: useToken ? authed(token) : {},
          body: form,
        }),
        env,
      )
      return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }
    }
    const noAuth = await upload(new File([png], 'logo.png', { type: 'image/png' }), false)
    expect(noAuth.status).toBe(401)
    const svg = await upload(new File(['<svg></svg>'], 'logo.svg', { type: 'image/svg+xml' }), true)
    expect(svg.status).toBe(400)
    const big = await upload(new File([new Uint8Array(256 * 1024 + 1)], 'big.png', { type: 'image/png' }), true)
    expect(big.status).toBe(400)
    const ok = await upload(new File([png], 'logo.png', { type: 'image/png' }), true)
    expect(ok.status).toBe(201)
    const url = ok.body.url as string
    expect(url).toMatch(/^https:\/\/admin\.test\/api\/logo\/l[0-9a-f]{24}$/)
    // The public serve route returns the bytes with the right type, no session needed.
    const served = await worker.fetch(new Request(url), env)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png)
    const missing = await worker.fetch(new Request('https://admin.test/api/logo/l000000000000000000000000'), env)
    expect(missing.status).toBe(404)
  })

  it('launch register upserts the token registry with the logo and returns per-chain contracts', async () => {
    const now = Math.floor(Date.now() / 1000)
    const logoUrl = 'https://stelix-admin.pages.dev/api/logo/l0123456789abcdef01234567'
    const created = await call(env, '/api/admin/launches', {
      method: 'POST', token,
      body: { seller: '0x1111111111111111111111111111111111111111', tokenAddress: '0x2222222222222222222222222222222222222222', tokenSymbol: 'TEST', tokenName: 'Test Token', tokenDecimals: 18, logoUrl, pricePerToken: '100000', softCap: '1000000000', hardCap: '10000000000', tokensForSale: '100000000000000000000000', startTime: now + 60, endTime: now + 86400, liquidityLockBps: 0 },
    })
    expect(created.status).toBe(201)
    // The token is in the public registry (verified) with its logo, so
    // the wallet shows the logo wherever the address is imported.
    const tokens = await call(env, '/api/tokens')
    const row = (tokens.body.tokens as Record<string, unknown>[]).find((t) => t.address === '0x2222222222222222222222222222222222222222')
    expect(row).toBeDefined()
    expect(row?.symbol).toBe('TEST')
    expect(row?.verified).toBe(1)
    expect(row?.logo_url).toBe(logoUrl)
    // The admin launches feed carries per-chain contract addresses.
    const admin = await call(env, '/api/admin/launches', { token })
    expect(Array.isArray(admin.body.chains)).toBe(true)
    expect((admin.body.chains as Record<string, unknown>[]).find((c) => c.id === 'arc')).toBeDefined()
  })

  it('chains: PUT accepts launchpad + factory addresses (verified 0x only) and GET /api/chains returns them', async () => {
    const bad = await call(env, '/api/admin/chains/arc', {
      method: 'PUT', token,
      body: { launchpadAddress: 'guess-me' },
    })
    expect(bad.status).toBe(400)
    const ok = await call(env, '/api/admin/chains/arc', {
      method: 'PUT', token,
      body: { launchpadAddress: '0x1111111111111111111111111111111111111111', tokenFactoryAddress: '0x2222222222222222222222222222222222222222' },
    })
    expect(ok.status).toBe(200)
    const chains = await call(env, '/api/chains')
    const arc = (chains.body.chains as Record<string, unknown>[]).find((c) => c.id === 'arc')
    expect(arc?.launchpad_address).toBe('0x1111111111111111111111111111111111111111')
    expect(arc?.token_factory_address).toBe('0x2222222222222222222222222222222222222222')
  })

  it('multisigs: prepare validates owners/threshold; no chain needed, Solana refused, legacy chain normalised to evm', async () => {
    const owners = [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      '0x3333333333333333333333333333333333333333',
    ]
    const noAuth = await call(env, '/api/admin/multisigs', {
      method: 'POST', body: { owners, threshold: 2 },
    })
    expect(noAuth.status).toBe(401)
    const badOwner = await call(env, '/api/admin/multisigs', {
      method: 'POST', token, body: { owners: [owners[0], 'not-an-address', owners[2]], threshold: 2 },
    })
    expect(badOwner.status).toBe(400)
    const tooHigh = await call(env, '/api/admin/multisigs', {
      method: 'POST', token, body: { owners, threshold: 4 },
    })
    expect(tooHigh.status).toBe(400)
    const zero = await call(env, '/api/admin/multisigs', {
      method: 'POST', token, body: { owners, threshold: 0 },
    })
    expect(zero.status).toBe(400)
    const dup = await call(env, '/api/admin/multisigs', {
      method: 'POST', token, body: { owners: [owners[0], owners[1], owners[0].toUpperCase()], threshold: 2 },
    })
    expect(dup.status).toBe(400)
    const one = await call(env, '/api/admin/multisigs', {
      method: 'POST', token, body: { owners: [owners[0]], threshold: 1 },
    })
    expect(one.status).toBe(400)
    const solana = await call(env, '/api/admin/multisigs', {
      method: 'POST', token, body: { chainId: 'solana', owners, threshold: 2 },
    })
    expect(solana.status).toBe(400)
    expect(JSON.stringify(solana.body.details)).toMatch(/Safe is not available on Solana/)
    // No chainId at all: one multisig for all EVM chains, stored as 'evm'.
    const ok = await call(env, '/api/admin/multisigs', {
      method: 'POST', token, body: { label: 'Treasury', owners, threshold: 2, saltNonce: '0' },
    })
    expect(ok.status).toBe(201)
    expect(ok.body.id).toBeGreaterThan(0)
    // A legacy per-chain chainId is normalised, not stored per-chain.
    const legacy = await call(env, '/api/admin/multisigs', {
      method: 'POST', token, body: { chainId: 'bnb', owners, threshold: 2 },
    })
    expect(legacy.status).toBe(201)
    const list = await call(env, '/api/admin/multisigs', { token })
    expect(list.status).toBe(200)
    const rows = list.body.multisigs as Record<string, unknown>[]
    expect(rows.length).toBe(2)
    expect(rows.every((r) => r.chain_id === 'evm')).toBe(true)
    expect(rows[0].status).toBe('prepared')
    expect(rows[0].safe_address).toBeNull()
    expect(rows[0].factory_address).toBe('0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67')
    expect(rows[0].singleton_address).toBe('0x41675C099F32341bf84BFc5382aF534df5C7461a')
  })

  it('multisigs: predicted + confirm verifies on-chain owners/threshold before recording', async () => {
    const owners = [
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      '0x3333333333333333333333333333333333333333',
    ]
    const SAFE = '0x9B3E9B6B8f3D2C1A4E5F60718293A4B5C6D7E8F9'
    const created = await call(env, '/api/admin/multisigs', {
      method: 'POST', token, body: { owners, threshold: 2 },
    })
    expect(created.status).toBe(201)
    const id = created.body.id as number
    // RPC stub: the Safe exists at SAFE with the prepared owners; threshold
    // is mutable so the mismatch case can be exercised.
    let onChainThreshold = 2
    let codePresent = true
    const uint256 = (n: number) => '0x' + BigInt(n).toString(16).padStart(64, '0')
    const encodeOwners = (list: string[]) => {
      let hex = '0x' + '20'.padStart(64, '0') + list.length.toString(16).padStart(64, '0')
      for (const o of list) hex += '0'.repeat(24) + o.slice(2).toLowerCase()
      return hex
    }
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      let method = ''
      let params: unknown[] = []
      try {
        const b = JSON.parse(String(init?.body ?? '{}')) as { method?: string; params?: unknown[] }
        method = b.method ?? ''
        params = b.params ?? []
      } catch { method = '' }
      if (method === 'eth_getCode') {
        const addr = String((params as string[])[0] ?? '').toLowerCase()
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: addr === SAFE.toLowerCase() && codePresent ? '0x608060405234801561001057600080fd5b50' : '0x' }), { status: 200 })
      }
      if (method === 'eth_call') {
        const data = String(((params as { data?: string }[])[0] ?? {}).data ?? '')
        if (data.startsWith('0x0d582f13')) return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: uint256(onChainThreshold) }), { status: 200 })
        if (data.startsWith('0xa0e67e2b')) return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: encodeOwners(owners) }), { status: 200 })
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x' + '0'.repeat(64) }), { status: 200 })
    }) as unknown as typeof fetch
    // No code at a random address: cannot confirm a Safe that is not deployed.
    const noCode = await call(env, `/api/admin/multisigs/${id}/confirm`, {
      method: 'POST', token, body: { safeAddress: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    })
    expect(noCode.status).toBe(400)
    expect(String(noCode.body.error)).toMatch(/No contract code/)
    // Predicted address: recorded, but still not usable as Owner.
    const predicted = await call(env, `/api/admin/multisigs/${id}/predicted`, {
      method: 'POST', token, body: { predictedAddress: SAFE },
    })
    expect(predicted.status).toBe(200)
    expect(predicted.body.predictedAddress).toBe(SAFE.toLowerCase())
    // On-chain threshold differs from the prepared one: refuse.
    onChainThreshold = 1
    const mismatch = await call(env, `/api/admin/multisigs/${id}/confirm`, {
      method: 'POST', token, body: { safeAddress: SAFE },
    })
    expect(mismatch.status).toBe(400)
    expect(String(mismatch.body.error)).toMatch(/On-chain threshold is 1/)
    // Matching owners + threshold: recorded as deployed, verified on the
    // first EVM chain whose RPC reports the Safe (arc, the default chain
    // in this test env) — and stored as the universal 'evm' multisig.
    onChainThreshold = 2
    const confirmed = await call(env, `/api/admin/multisigs/${id}/confirm`, {
      method: 'POST', token, body: { safeAddress: SAFE, txHash: '0x' + 'b'.repeat(64) },
    })
    expect(confirmed.status).toBe(201)
    expect(confirmed.body.safeAddress).toBe(SAFE.toLowerCase())
    expect(confirmed.body.threshold).toBe(2)
    expect(confirmed.body.chain).toBe('arc')
    expect(confirmed.body.verifiedChainId).toBe('arc')
    const list = await call(env, '/api/admin/multisigs', { token })
    const row = (list.body.multisigs as Record<string, unknown>[])[0]
    expect(row.status).toBe('deployed')
    expect(row.chain_id).toBe('evm')
    expect(row.verified_chain_id).toBe('arc')
    expect(row.safe_address).toBe(SAFE.toLowerCase())
    // Confirm twice and delete-when-deployed are both refused.
    const again = await call(env, `/api/admin/multisigs/${id}/confirm`, {
      method: 'POST', token, body: { safeAddress: SAFE },
    })
    expect(again.status).toBe(409)
    const delDeployed = await call(env, `/api/admin/multisigs/${id}`, { method: 'DELETE', token })
    expect(delDeployed.status).toBe(409)
    // A prepared multisig can still be discarded.
    const second = await call(env, '/api/admin/multisigs', {
      method: 'POST', token, body: { owners, threshold: 2 },
    })
    const delPrepared = await call(env, `/api/admin/multisigs/${second.body.id as number}`, { method: 'DELETE', token })
    expect(delPrepared.status).toBe(200)
    codePresent = true
  })

  // ---- Realtime sync (live polling, not push) + maintenance + network mode ----
  it('sync: /api/sync returns every section plus a version that bumps on each admin write', async () => {
    const first = await call(env, '/api/sync')
    expect(first.status).toBe(200)
    expect(first.body.version).toBe(0)
    expect(Array.isArray(first.body.chains)).toBe(true)
    expect(first.body.deletedIds).toEqual([])
    expect(first.body.fees).toBeNull()
    expect(first.body.maintenance).toEqual({ enabled: false, message: '', scope: 'wallet', updatedAt: null })
    expect(first.body.networkMode).toBeNull()
    const fee = await call(env, '/api/admin/fees', { method: 'POST', token, body: { autoSellFeePct: 2, minLockUsd: 25, maxLockUsd: 50000, defaultPenaltyPct: 7, twapMinutes: 30, trailingStopOptions: 'Off, 10%', defaultSlippagePct: 1, penaltyDestination: 'treasury' } })
    expect(fee.status).toBe(201)
    const second = await call(env, '/api/sync')
    expect(second.body.version).toBe(1)
    expect((second.body.fees as { autoSellFeePct: number }).autoSellFeePct).toBe(2)
    // The public fee feed mirrors the same value.
    const pubFees = await call(env, '/api/fees')
    expect((pubFees.body.fees as { autoSellFeePct: number }).autoSellFeePct).toBe(2)
  })

  it('chains: DELETE refuses the default chain and a chain with a vault, and tombstones a clean chain', async () => {
    const delDefault = await call(env, '/api/admin/chains/arc', { method: 'DELETE', token })
    expect(delDefault.status).toBe(409)
    expect(String(delDefault.body.error)).toMatch(/default/)
    // Give bnb a vault: deletion must be refused.
    const bnb = db.tables.chains.find((c) => c.id === 'bnb')
    if (bnb) bnb.vault_address = '0x1111111111111111111111111111111111111111'
    const delVault = await call(env, '/api/admin/chains/bnb', { method: 'DELETE', token })
    expect(delVault.status).toBe(409)
    expect(String(delVault.body.error)).toMatch(/vault/)
    // A clean chain deletes, disappears from /api/chains, and is tombstoned.
    const created = await call(env, '/api/admin/chains', { method: 'POST', token, body: { id: 'optimism', name: 'Optimism', chainId: 10, rpcUrls: 'https://mainnet.optimism.io', explorerUrl: 'https://optimistic.etherscan.io', nativeToken: 'ETH', stablecoin: 'USDC', stablecoinAddress: '', dexRouter: '', status: 'hidden' } })
    expect(created.status).toBe(201)
    const noAuth = await call(env, '/api/admin/chains/optimism', { method: 'DELETE' })
    expect(noAuth.status).toBe(401)
    const del = await call(env, '/api/admin/chains/optimism', { method: 'DELETE', token })
    expect(del.status).toBe(200)
    expect(del.body.deleted).toBe(true)
    const pub = await call(env, '/api/chains')
    expect((pub.body.chains as { id: string }[]).some((c) => c.id === 'optimism')).toBe(false)
    expect((pub.body.deletedIds as string[])).toContain('optimism')
    expect(pub.body.version).toBeGreaterThan(0)
    // Re-adding the same slug clears the tombstone.
    const readded = await call(env, '/api/admin/chains', { method: 'POST', token, body: { id: 'optimism', name: 'Optimism', chainId: 10, rpcUrls: 'https://mainnet.optimism.io', explorerUrl: 'https://optimistic.etherscan.io', nativeToken: 'ETH', stablecoin: 'USDC', stablecoinAddress: '', dexRouter: '', status: 'hidden' } })
    expect(readded.status).toBe(201)
    const pub2 = await call(env, '/api/chains')
    expect((pub2.body.deletedIds as string[])).not.toContain('optimism')
  })

  it('tokens: the public registry feed lists added tokens and drops removed ones', async () => {
    const empty = await call(env, '/api/tokens')
    expect((empty.body.tokens as unknown[])).toEqual([])
    const add = await call(env, '/api/admin/tokens', { method: 'POST', token, body: { symbol: 'USDC', chainId: 'arc', address: '0x3600000000000000000000000000000000000000', decimals: 6, verified: true } })
    expect(add.status).toBe(201)
    const listed = await call(env, '/api/tokens')
    expect((listed.body.tokens as { symbol: string }[]).map((t) => t.symbol)).toContain('USDC')
    const del = await call(env, `/api/admin/tokens?id=${add.body.id as number}`, { method: 'DELETE', token })
    expect(del.status).toBe(200)
    const gone = await call(env, '/api/tokens')
    expect((gone.body.tokens as unknown[])).toEqual([])
  })

  it('maintenance: set on/off from admin, served publicly and in /api/sync, validated', async () => {
    const noAuth = await call(env, '/api/admin/maintenance', { method: 'POST', body: { enabled: true, message: 'Down', scope: 'wallet' } })
    expect(noAuth.status).toBe(401)
    const badScope = await call(env, '/api/admin/maintenance', { method: 'POST', token, body: { enabled: true, message: 'Down', scope: 'everywhere' } })
    expect(badScope.status).toBe(400)
    const noMessage = await call(env, '/api/admin/maintenance', { method: 'POST', token, body: { enabled: true, message: '', scope: 'wallet' } })
    expect(noMessage.status).toBe(400)
    const on = await call(env, '/api/admin/maintenance', { method: 'POST', token, body: { enabled: true, message: 'Scheduled maintenance — back soon.', scope: 'all' } })
    expect(on.status).toBe(200)
    expect((on.body.maintenance as { enabled: boolean }).enabled).toBe(true)
    const pub = await call(env, '/api/maintenance')
    expect((pub.body.maintenance as { message: string }).message).toBe('Scheduled maintenance — back soon.')
    expect((pub.body.maintenance as { scope: string }).scope).toBe('all')
    const sync = await call(env, '/api/sync')
    expect((sync.body.maintenance as { enabled: boolean }).enabled).toBe(true)
    const off = await call(env, '/api/admin/maintenance', { method: 'POST', token, body: { enabled: false, message: '', scope: 'wallet' } })
    expect(off.status).toBe(200)
    expect((off.body.maintenance as { enabled: boolean }).enabled).toBe(false)
  })

  it('network mode: admin sets testnet/mainnet, wallet reads it from /api/sync, invalid rejected', async () => {
    const initial = await call(env, '/api/admin/network-mode', { token })
    expect(initial.body.networkMode).toBeNull()
    const bad = await call(env, '/api/admin/network-mode', { method: 'POST', token, body: { mode: 'sideways' } })
    expect(bad.status).toBe(400)
    const set = await call(env, '/api/admin/network-mode', { method: 'POST', token, body: { mode: 'mainnet' } })
    expect(set.status).toBe(200)
    expect(set.body.networkMode).toBe('mainnet')
    const sync = await call(env, '/api/sync')
    expect(sync.body.networkMode).toBe('mainnet')
    expect(sync.body.version).toBeGreaterThan(0)
    const clear = await call(env, '/api/admin/network-mode', { method: 'POST', token, body: { mode: null } })
    expect(clear.status).toBe(200)
    expect(clear.body.networkMode).toBeNull()
  })

  // ---- Circle User-Controlled Wallets (Arc only, EOA first) ----
  it('circle: unauthenticated calls are rejected', async () => {
    const noAuth = await call(env, '/api/circle/config')
    expect(noAuth.status).toBe(401)
  })

  it('circle: challenge validation rejects a non-Arc blockchain before any Circle call', async () => {
    const res = await call(env, '/api/circle/challenges', { method: 'POST', token, body: { type: 'createWallet', userId: 'stelix-user-1', blockchain: 'ETH' } })
    expect(res.status).toBe(400)
    expect(String(res.body.error)).toMatch(/ARC-TESTNET or ARC/)
  })

  it('circle: executeContract to an unregistered contract is refused — no vault deployed yet', async () => {
    const res = await call(env, '/api/circle/challenges', {
      method: 'POST', token,
      body: {
        type: 'executeContract', userId: 'stelix-user-1', blockchain: 'ARC-TESTNET', walletId: 'wallet-1',
        contractAddress: '0x7777777777777777777777777777777777777777',
        abiFunctionSignature: 'lock(uint256,uint256)', abiParameters: ['1000000'],
      },
    })
    expect(res.status).toBe(400)
    expect(String(res.body.error)).toMatch(/not a registered StelixVault/)
    expect(res.body.code).toBe('vault_not_registered')
  })

  it('circle: missing CIRCLE_API_KEY is an honest 503, and config reports unconfigured', async () => {
    // No CIRCLE_API_KEY in this env (beforeEach): user creation refuses honestly.
    const user = await call(env, '/api/circle/users', { method: 'POST', token, body: { userId: 'stelix-user-1', email: 'user@example.com' } })
    expect(user.status).toBe(503)
    expect(String(user.body.error)).toMatch(/CIRCLE_API_KEY is not set/)
    // A registered user + challenge also stops at the missing key, not at Circle.
    db.tables.circle_users = [{ id: 1, user_id: 'stelix-user-1', circle_user_id: 'circle-user-uuid', email: null, created_by: 'admin' }]
    const chal = await call(env, '/api/circle/challenges', { method: 'POST', token, body: { type: 'createWallet', userId: 'stelix-user-1', blockchain: 'ARC-TESTNET' } })
    expect(chal.status).toBe(503)
    expect(String(chal.body.error)).toMatch(/CIRCLE_API_KEY is not set/)
    const cfg = await call(env, '/api/circle/config', { token })
    expect(cfg.status).toBe(200)
    expect(cfg.body.configured).toBe(false)
    expect(cfg.body.apiKeyConfigured).toBe(false)
    expect(cfg.body.arcTestnet).toBe(true)
    expect(cfg.body.appIdMasked).toBeNull()
    expect(cfg.body.vaultDeployed).toBe(false)
  })

  it('circle: config never leaks the key once it is set, and the App ID round-trips masked only', async () => {
    const key = 'TESTKEY:circle-test-key-value-never-shown'
    env.CIRCLE_API_KEY = key
    const bad = await call(env, '/api/admin/circle-config', { method: 'POST', token, body: { appId: 'not-a-uuid' } })
    expect(bad.status).toBe(400)
    const appId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const saved = await call(env, '/api/admin/circle-config', { method: 'POST', token, body: { appId } })
    expect(saved.status).toBe(200)
    expect(saved.body.appIdMasked).toBe('aaaaaaaa…')
    expect(JSON.stringify(saved.body)).not.toContain(appId)
    const cfg = await call(env, '/api/circle/config', { token })
    expect(cfg.status).toBe(200)
    expect(cfg.body.apiKeyConfigured).toBe(true)
    expect(cfg.body.appIdConfigured).toBe(true)
    expect(cfg.body.appIdMasked).toBe('aaaaaaaa…')
    expect(JSON.stringify(cfg.body)).not.toContain(key)
    expect(JSON.stringify(cfg.body)).not.toContain(appId)
    const log = await call(env, '/api/admin/audit', { token })
    expect((log.body.audit as { action: string }[]).map((a) => a.action)).toContain('circle.config_set')
  })

  it('circle: users + challenges proxy Circle and return the challengeId only', async () => {
    env.CIRCLE_API_KEY = 'TESTKEY:circle-test-key'
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://api.circle.com/v1/w3s/users') {
        return new Response(JSON.stringify({ data: { id: '11111111-2222-3333-4444-555555555555' } }), { status: 201 })
      }
      if (url === 'https://api.circle.com/v1/w3s/users/token') {
        return new Response(JSON.stringify({ data: { userToken: 'user-token-must-never-leak', encryptionKey: 'encryption-key-must-never-leak' } }), { status: 200 })
      }
      if (url === 'https://api.circle.com/v1/w3s/user/wallets') {
        return new Response(JSON.stringify({ data: { challengeId: '22222222-3333-4444-5555-666666666666' } }), { status: 201 })
      }
      if (url.startsWith('https://api.circle.com/v1/w3s/wallets')) {
        return new Response(JSON.stringify({ data: { wallets: [{ id: 'wallet-1', blockchain: 'ARC-TESTNET', address: '0x1111111111111111111111111111111111111111' }] } }), { status: 200 })
      }
      if (url.startsWith('https://api.circle.com/v1/w3s/transactions/')) {
        return new Response(JSON.stringify({ data: { id: 'tx-1', state: 'CONFIRMED', txHash: '0x' + 'c'.repeat(64) } }), { status: 200 })
      }
      return new Response(JSON.stringify({ code: 404, message: 'not found' }), { status: 404 })
    }) as unknown as typeof fetch
    const created = await call(env, '/api/circle/users', { method: 'POST', token, body: { userId: 'stelix-user-1', email: 'user@example.com' } })
    expect(created.status).toBe(201)
    expect(created.body.circleUserId).toBe('11111111-2222-3333-4444-555555555555')
    // Creating the same Stelix user again returns the stored mapping, no second Circle call.
    const again = await call(env, '/api/circle/users', { method: 'POST', token, body: { userId: 'stelix-user-1' } })
    expect(again.status).toBe(200)
    expect(again.body.existing).toBe(true)
    const chal = await call(env, '/api/circle/challenges', { method: 'POST', token, body: { type: 'createWallet', userId: 'stelix-user-1', blockchain: 'ARC-TESTNET' } })
    expect(chal.status).toBe(201)
    expect(chal.body.challengeId).toBe('22222222-3333-4444-5555-666666666666')
    // The user token minted for the challenge is never returned.
    expect(JSON.stringify(chal.body)).not.toContain('user-token-must-never-leak')
    expect(JSON.stringify(chal.body)).not.toContain('encryption-key-must-never-leak')
    const wallets = await call(env, '/api/circle/wallets?userId=stelix-user-1', { token })
    expect(wallets.status).toBe(200)
    expect((wallets.body.wallets as unknown[]).length).toBe(1)
    const tx = await call(env, '/api/circle/transactions/tx-1', { token })
    expect(tx.status).toBe(200)
    expect((tx.body.transaction as { state: string }).state).toBe('CONFIRMED')
    // Unknown user: 404 before any Circle call.
    const missing = await call(env, '/api/circle/wallets?userId=nope-user', { token })
    expect(missing.status).toBe(404)
  })

  it('circle: a Circle 4xx is surfaced honestly with its code and message', async () => {
    env.CIRCLE_API_KEY = 'TESTKEY:circle-test-key'
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ code: 155106, message: 'User already exists.' }), { status: 400 })) as unknown as typeof fetch
    const res = await call(env, '/api/circle/users', { method: 'POST', token, body: { userId: 'stelix-user-1' } })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe(155106)
    // The Worker follows the repo's `error`-field convention for failures.
    expect(String(res.body.error)).toMatch(/User already exists/)
  })

  it('change-password: wrong current is 401, short new is 400, a good change works and kills the old session', async () => {
    const wrong = await call(env, '/api/admin/change-password', { method: 'POST', token, body: { currentPassword: 'not-the-password', newPassword: 'a-brand-new-password-123' } })
    expect(wrong.status).toBe(401)
    const short = await call(env, '/api/admin/change-password', { method: 'POST', token, body: { currentPassword: 'correct-horse', newPassword: 'short' } })
    expect(short.status).toBe(400)
    const ok = await call(env, '/api/admin/change-password', { method: 'POST', token, body: { currentPassword: 'correct-horse', newPassword: 'a-brand-new-password-123' } })
    expect(ok.status).toBe(200)
    expect(ok.body.ok).toBe(true)
    // The old session is dead: the version bump invalidated it.
    const dead = await call(env, '/api/admin/dashboard', { token })
    expect(dead.status).toBe(401)
    // And the new password logs in.
    const r = await worker.fetch(
      new Request('https://admin.test/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'ozoemenapaschal09@gmail.com', password: 'a-brand-new-password-123' }),
      }),
      env,
    )
    expect(r.status).toBe(200)
  })

  describe('Cyber Defense (migration 0018)', () => {
    const fromIp = async (ip: string, path: string, opts: { method?: string; token?: string; body?: unknown } = {}) => {
      const r = await worker.fetch(
        new Request(`https://admin.test${path}`, {
          method: opts.method ?? 'GET',
          headers: {
            'content-type': 'application/json',
            'cf-connecting-ip': ip,
            ...(opts.token ? authed(opts.token) : {}),
          },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        }),
        env,
      )
      const body = (await r.json().catch(() => ({}))) as Record<string, unknown>
      return { status: r.status, body }
    }

    it('records failed sign-ins and auto-blocks the IP after 5 failures', async () => {
      const ip = '203.0.113.42'
      for (let i = 0; i < 5; i++) {
        const r = await fromIp(ip, '/api/admin/login', { method: 'POST', body: { email: 'ozoemenapaschal09@gmail.com', password: 'wrong-password' } })
        expect([401, 429]).toContain(r.status)
      }
      // The IP is now on the blocklist: even the public sync refuses it.
      const blocked = await fromIp(ip, '/api/sync')
      expect(blocked.status).toBe(403)
      // And the feed recorded the failures plus the auto-block.
      const feed = await call(env, '/api/admin/security-events', { token })
      expect(feed.status).toBe(200)
      const events = feed.body.events as { category: string; ip: string }[]
      expect(events.filter((e) => e.category === 'login-failed' && e.ip === ip)).toHaveLength(5)
      expect(events.some((e) => e.category === 'brute-force' && e.ip === ip)).toBe(true)
      const blocks = await call(env, '/api/admin/security-blocks', { token })
      expect((blocks.body.blocks as { ip: string }[]).some((b) => b.ip === ip)).toBe(true)
    })

    it('manual block refuses the IP on every route; unblock lets it back in', async () => {
      const ip = '198.51.100.7'
      const ok = await call(env, '/api/sync')
      expect(ok.status).toBe(200)
      const block = await call(env, '/api/admin/security-blocks', { method: 'POST', token, body: { ip, reason: 'test block', minutes: 60 } })
      expect(block.status).toBe(200)
      const refused = await fromIp(ip, '/api/sync')
      expect(refused.status).toBe(403)
      const refusedAdmin = await fromIp(ip, '/api/admin/dashboard', { token })
      expect(refusedAdmin.status).toBe(403)
      const list = await call(env, '/api/admin/security-blocks', { token })
      const rows = list.body.blocks as { id: number; ip: string }[]
      const row = rows.find((b) => b.ip === ip)
      expect(row).toBeDefined()
      const unblock = await call(env, `/api/admin/security-blocks?id=${row!.id}`, { method: 'DELETE', token })
      expect(unblock.status).toBe(200)
      const back = await fromIp(ip, '/api/sync')
      expect(back.status).toBe(200)
    })

    it('records an unauthenticated admin probe in the feed', async () => {
      const probe = await call(env, '/api/admin/dashboard')
      expect(probe.status).toBe(401)
      const feed = await call(env, '/api/admin/security-events', { token })
      const events = feed.body.events as { category: string }[]
      expect(events.some((e) => e.category === 'unauthorized-admin')).toBe(true)
    })

    it('security audit scores the live configuration', async () => {
      const res = await call(env, '/api/admin/security-audit', { token })
      expect(res.status).toBe(200)
      const checks = res.body.checks as { id: string; status: string }[]
      const byId = new Map(checks.map((c) => [c.id, c.status]))
      expect(byId.get('admin-password')).toBe('pass')
      expect(byId.get('session-secret')).toBe('pass')
      expect(byId.get('config-signing')).toBe('pass')
      expect(byId.get('blocklist')).toBe('pass')
      expect(byId.get('keeper')).toBe('warn')
    })

    it('contract watch returns an array (empty with no deployments)', async () => {
      const res = await call(env, '/api/admin/contract-watch', { token })
      expect(res.status).toBe(200)
      expect(Array.isArray(res.body.contracts)).toBe(true)
    })

    it('token order: a reorder POST rewrites sort_order for the chain', async () => {
      const a = await call(env, '/api/admin/tokens', { method: 'POST', token, body: { symbol: 'AAA', chainId: 'arc', address: '0x1111111111111111111111111111111111111111', decimals: 18, verified: true } })
      const b = await call(env, '/api/admin/tokens', { method: 'POST', token, body: { symbol: 'BBB', chainId: 'arc', address: '0x2222222222222222222222222222222222222222', decimals: 18, verified: false } })
      expect(a.status).toBe(201)
      expect(b.status).toBe(201)
      const idA = a.body.id as number
      const idB = b.body.id as number
      const reorder = await call(env, '/api/admin/tokens/order', { method: 'POST', token, body: { chainId: 'arc', ids: [idB, idA] } })
      expect(reorder.status).toBe(200)
      const rows = db.tables.tokens as { id: number; sort_order: number }[]
      expect(rows.find((r) => r.id === idB)?.sort_order).toBe(0)
      expect(rows.find((r) => r.id === idA)?.sort_order).toBe(1)
    })

    it('login brake: cool with no failures, slowing at 10', async () => {
      const cool = await call(env, '/api/admin/login-brake', { token })
      expect(cool.status).toBe(200)
      expect(cool.body.state).toBe('cool')
      expect(cool.body.failuresLast10Min).toBe(0)
      expect(cool.body.slowingAt).toBe(10)
      expect(cool.body.pauseAt).toBe(25)
      for (let i = 0; i < 10; i++) {
        db.tables.security_events.push({ id: 200 + i, category: 'login-failed', status: 'failed', ip: `203.0.113.${i + 1}`, country: '', user_agent: '', method: 'POST', path: '/api/admin/login', detail: 'failed admin sign-in', created_at: new Date().toISOString() })
      }
      const slowing = await call(env, '/api/admin/login-brake', { token })
      expect(slowing.body.state).toBe('slowing')
      expect(slowing.body.failuresLast10Min).toBe(10)
    })

    it('login brake: 25 failures from rotating IPs pause sign-in for everyone', async () => {
      // Seed 24 failures as if from 24 rotating IPs — the feed already
      // holds them, exactly as the live pen-test showed.
      for (let i = 0; i < 24; i++) {
        db.tables.security_events.push({ id: 100 + i, category: 'login-failed', status: 'failed', ip: `203.0.113.${i + 1}`, country: '', user_agent: '', method: 'POST', path: '/api/admin/login', detail: 'failed admin sign-in', created_at: new Date().toISOString() })
      }
      // The 25th failure is a real login attempt; the brake is now hot.
      const last = await fromIp('203.0.113.25', '/api/admin/login', { method: 'POST', body: { email: 'ozoemenapaschal09@gmail.com', password: 'wrong-password' } })
      expect(last.status).toBe(401)
      // The 26th attempt — from yet another fresh IP — is paused, not a 401.
      const paused = await fromIp('198.51.100.99', '/api/admin/login', { method: 'POST', body: { email: 'ozoemenapaschal09@gmail.com', password: 'wrong-password' } })
      expect(paused.status).toBe(429)
      expect(paused.body.brake).toBe(true)
      // Even the correct password is paused: the brake cannot tell who
      // is knocking, which is why the pause is short and self-healing.
      const correct = await fromIp('198.51.100.100', '/api/admin/login', { method: 'POST', body: { email: 'ozoemenapaschal09@gmail.com', password: 'correct-horse' } })
      expect(correct.status).toBe(429)
      // The brake endpoint and the audit report the paused state, and
      // the feed holds exactly one brake event (not one per blocked try).
      const brake = await call(env, '/api/admin/login-brake', { token })
      expect(brake.body.state).toBe('paused')
      expect(brake.body.failuresLast10Min).toBe(25)
      const auditRes = await call(env, '/api/admin/security-audit', { token })
      const checks = auditRes.body.checks as { id: string; status: string }[]
      expect(checks.find((c) => c.id === 'login-brake')?.status).toBe('warn')
      const feed = await call(env, '/api/admin/security-events', { token })
      const events = feed.body.events as { category: string }[]
      expect(events.filter((e) => e.category === 'login-brake')).toHaveLength(1)
    })
  })
})
