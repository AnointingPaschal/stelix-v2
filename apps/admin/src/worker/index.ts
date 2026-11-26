// Stelix 2.0 Admin — Workers API (Cloudflare). Serves the admin portal and
// the mobile app's signed config. D1 binding: DB (see wrangler.toml).
// No secrets in code: signing keys and deployer keys are Cloudflare secrets.
export interface Env { DB: D1Database; ENVIRONMENT: string; ADMIN_SESSION_SECRET: string }

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/api/health') return json({ ok: true, env: env.ENVIRONMENT })
    if (url.pathname === '/api/chains' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM chains ORDER BY is_default DESC, name').all()
      return json({ chains: results })
    }
    if (url.pathname === '/api/keeper/runs' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM keeper_runs ORDER BY started_at DESC LIMIT 50').all()
      return json({ runs: results })
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
      // Production: require Cloudflare Access identity + admin session here.
      return json({ error: 'admin endpoints require an authenticated admin session (Cloudflare Access)' }, 401)
    }
    return json({ error: 'not found' }, 404)
  },
}
