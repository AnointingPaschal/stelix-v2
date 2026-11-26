// Stelix 2.0 Admin — Workers API (Cloudflare Pages, advanced mode _worker.js).
// Serves the admin portal SPA and the mobile app's signed config.
// D1 binding: DB (see wrangler.toml). ASSETS binding is provided
// automatically by Pages advanced mode.
//
// AUTH (production, no demo login): the admin portal is owner-only.
// - POST /api/admin/login checks email + PBKDF2-SHA256 password hash
//   (ADMIN_EMAIL var, ADMIN_PASSWORD_HASH secret) server-side, with
//   per-IP rate limiting (5 failures -> 15 min lock) and an audit_log entry.
// - On success it sets an HttpOnly signed session cookie (HMAC-SHA256 with
//   ADMIN_SESSION_SECRET, 8h). All /api/admin/* endpoints (except login),
//   plus /api/chains, /api/keeper/runs and /api/support, require it.
// - /api/health and /api/config stay public: config is served to the app.
// No secrets in code: password hash and session secret are Pages secrets.
export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  ENVIRONMENT: string
  ADMIN_EMAIL: string
  ADMIN_PASSWORD_HASH: string
  ADMIN_SESSION_SECRET: string
}

const json = (data: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } })

const b64url = (bytes: Uint8Array) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const unb64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
const timingSafeEqual = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

async function hmac(key: string, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)))
}

async function makeSession(email: string, secret: string): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ email, exp: Date.now() + 8 * 3600 * 1000 })))
  const sig = b64url(await hmac(secret, payload))
  return `${payload}.${sig}`
}

async function readSession(req: Request, env: Env): Promise<string | null> {
  const cookie = req.headers.get('cookie') ?? ''
  const m = /(?:^|;\s*)stelix_admin=([^;]+)/.exec(cookie)
  if (!m) return null
  const [payload, sig] = m[1].split('.')
  if (!payload || !sig) return null
  const expected = b64url(await hmac(env.ADMIN_SESSION_SECRET, payload))
  if (!timingSafeEqual(new TextEncoder().encode(sig), new TextEncoder().encode(expected))) return null
  try {
    const { email, exp } = JSON.parse(new TextDecoder().decode(unb64url(payload)))
    if (typeof email !== 'string' || typeof exp !== 'number' || exp < Date.now()) return null
    return email
  } catch {
    return null
  }
}

const sessionCookie = (token: string | null) =>
  token
    ? `stelix_admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`
    : 'stelix_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  // Format: pbkdf2-sha256$<iterations>$<b64url salt>$<b64url key>
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false
  const iterations = parseInt(parts[1], 10)
  if (!Number.isFinite(iterations) || iterations < 10000) return false
  const salt = unb64url(parts[2])
  const expected = unb64url(parts[3])
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, expected.length * 8))
  return timingSafeEqual(derived, expected)
}

const clientIp = (req: Request) => req.headers.get('cf-connecting-ip') ?? 'unknown'

async function audit(env: Env, actor: string, action: string, detail: string) {
  try {
    await env.DB.prepare('INSERT INTO audit_log (actor, action, detail) VALUES (?, ?, ?)').bind(actor, action, detail).run()
  } catch {
    // Audit failure must not break login; the attempt itself is still gated.
  }
}

async function handleLogin(req: Request, env: Env): Promise<Response> {
  const ip = clientIp(req)
  let body: { email?: string; password?: string } = {}
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid request' }, 400)
  }
  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''

  // Rate limit: 5 failed attempts -> locked 15 minutes (per IP, D1).
  const row = await env.DB.prepare('SELECT attempts, locked_until FROM login_attempts WHERE ip = ?').bind(ip).first<{ attempts: number; locked_until: string | null }>()
  if (row?.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return json({ error: 'Too many failed attempts. Try again in 15 minutes.' }, 429)
  }

  const emailOk = email.length > 0 && email === (env.ADMIN_EMAIL ?? '').toLowerCase()
  const passOk = emailOk && password.length > 0 && (await verifyPassword(password, env.ADMIN_PASSWORD_HASH ?? ''))
  if (!emailOk || !passOk) {
    const attempts = (row?.attempts ?? 0) + 1
    const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null
    await env.DB.prepare(
      'INSERT INTO login_attempts (ip, attempts, last_attempt_at, locked_until) VALUES (?, ?, datetime(\'now\'), ?) ON CONFLICT(ip) DO UPDATE SET attempts = excluded.attempts, last_attempt_at = excluded.last_attempt_at, locked_until = excluded.locked_until',
    )
      .bind(ip, attempts, lockedUntil)
      .run()
    await audit(env, email || ip, 'admin.login_failed', `failed sign-in from ${ip} (${attempts} attempts)`)
    return json({ error: attempts >= 5 ? 'Too many failed attempts. Try again in 15 minutes.' : 'Invalid email or password.' }, 401)
  }

  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run()
  await audit(env, email, 'admin.login', `admin sign-in from ${ip}`)
  const token = await makeSession(email, env.ADMIN_SESSION_SECRET)
  return json({ ok: true, email }, 200, { 'set-cookie': sessionCookie(token) })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)

    if (url.pathname === '/api/health') return json({ ok: true, env: env.ENVIRONMENT })

    if (url.pathname === '/api/admin/login' && req.method === 'POST') return handleLogin(req, env)
    if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie(null) })
    }
    if (url.pathname === '/api/admin/session' && req.method === 'GET') {
      const email = await readSession(req, env)
      if (!email) return json({ authenticated: false }, 401)
      return json({ authenticated: true, email })
    }

    // Everything below requires a valid admin session.
    const authed = url.pathname === '/api/config' ? true : await readSession(req, env)
    if (!authed && (url.pathname.startsWith('/api/admin/') || url.pathname === '/api/chains' || url.pathname === '/api/keeper/runs' || url.pathname === '/api/support')) {
      return json({ error: 'admin session required — sign in first' }, 401)
    }

    if (url.pathname === '/api/chains' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM chains ORDER BY is_default DESC, name').all()
      return json({ chains: results })
    }
    if (url.pathname === '/api/keeper/runs' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM keeper_runs ORDER BY started_at DESC LIMIT 50').all()
      return json({ runs: results })
    }
    if (url.pathname === '/api/admin/audit' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 100').all()
      return json({ audit: results })
    }
    if (url.pathname === '/api/config' && req.method === 'GET') {
      // Signed config: payload + signature (HMAC/Ed25519 key in secrets).
      // The app verifies the signature before trusting chain/contract data.
      const { results } = await env.DB.prepare('SELECT * FROM config_versions ORDER BY id DESC LIMIT 1').all()
      return json({ config: results[0] ?? null, note: 'DEMO: sign payload in production before serving.' })
    }
    if (url.pathname === '/api/support' && req.method === 'GET') {
      // Public on-chain state only. Never accepts or returns seed/private keys.
      const q = url.searchParams.get('q') ?? ''
      if (!q) return json({ error: 'q (wallet, lock ID or tx hash) required' }, 400)
      return json({ query: q, result: null, note: 'Production: resolve via chain RPC/indexer; never ask for keys.' })
    }
    if (url.pathname.startsWith('/api/admin/')) {
      return json({ error: 'admin endpoint not implemented yet' }, 404)
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404)

    // SPA: serve static assets, falling back to index.html for app routes.
    const asset = await env.ASSETS.fetch(req)
    if (asset.status !== 404) return asset
    if (!url.pathname.includes('.')) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', req.url), req))
    }
    return asset
  },
}
