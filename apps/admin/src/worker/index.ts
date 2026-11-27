// Stelix 2.0 Admin — Workers API (Cloudflare Pages, advanced mode _worker.js).
// Serves the admin portal SPA and the mobile app's signed config + announcements.
// D1 binding: DB (see wrangler.toml). ASSETS binding is provided automatically
// by Pages advanced mode. All data is live: D1 rows and on-chain RPC reads.
// There is no sample data anywhere in this API — empty tables return empty
// lists / zero counts with an explicit note, never invented figures.
//
// AUTH (owner-only): POST /api/admin/login checks email + PBKDF2-SHA256
// password hash (ADMIN_EMAIL var, ADMIN_PASSWORD_HASH secret) server-side,
// with per-IP rate limiting (5 failures -> 15 min lock) and an audit_log entry.
// On success it sets an HttpOnly signed session cookie (HMAC-SHA256 with
// ADMIN_SESSION_SECRET, 8h). All /api/admin/*, /api/keeper/runs
// and /api/support require it. /api/health, /api/config, /api/announcements,
// /api/launches, /api/chains, /api/fees, /api/tokens, /api/maintenance and
// /api/sync stay public: config is signed and served to
// the app; announcements are the public in-app banner feed; launches is the
// public approved-launch feed for the mobile Launchpad tab; chains is the
// public chain registry the wallet reads (GET only — every chain write
// stays behind the admin session); fees/tokens/maintenance are the public
// read feeds the wallet polls; /api/sync is the single polling endpoint
// that returns all of them plus a monotonic sync version (see bumpSync).
// No secrets in code: password hash, session secret, config signing secret,
// keeper run key, explorer key and the Circle API key are Pages/Worker
// secrets (see wrangler.toml). The Circle App ID is public and is stored
// in D1 circle_config (POST /api/admin/circle-config), never as a secret.
//
// CIRCLE (User-Controlled Wallets, Arc only, EOA first): the Worker is a
// proxy for api.circle.com under /v1/w3s/. POST /api/circle/users creates
// the Circle user, POST /api/circle/challenges creates a challenge the
// mobile SDK executes (sdk.execute(challengeId), user approves with PIN),
// GET /api/circle/wallets lists a user's wallets, GET
// /api/circle/transactions/:id reads transaction status, GET
// /api/circle/config reports setup status (masked App ID only, never the
// key), POST /api/admin/circle-config saves the public App ID. All of
// them need an admin session. The backend never holds a user key share
// and never signs: challenge calls mint a short-lived user token with
// POST /v1/w3s/users/token, use it once in memory, and return only the
// challengeId. executeContract challenges are refused unless the target
// contract is a StelixVault registered in Chain Manager — no vault is
// deployed anywhere yet, so locks refuse honestly until one is.
//
// REALTIME (live polling, NOT push): there is no websocket/push channel.
// The wallet polls GET /api/sync every ~45s, on foreground, on network-
// picker open and on pull-to-refresh, and re-applies state only when the
// `version` changes. Every admin write below calls bumpSync() so an edit
// is visible within one poll interval. Deleted chains are tombstoned in
// `deleted_chains` and returned as `deletedIds`, so the wallet never
// resurrects a deleted chain from its built-in fallback — even when the
// API is down, the wallet keeps the tombstones it last saw in local
// storage (see apps/mobile/src/lib/adminSync.ts).
//
// CONTRACT STUDIO: the Worker never holds a deployer key and never broadcasts
// a deploy. POST /api/admin/deploy/prepare validates constructor args and
// returns the exact Foundry command to run locally; POST
// /api/admin/deploy/register verifies on-chain code (eth_getCode) and explorer
// source status, checks the source hash against the compiled artifact
// (solc 0.8.24, scripts/compile.mjs), then writes the deployment + vault
// address to D1. Mainnet registration is gated in the Worker: passing
// automated audit (zero open critical/high) OR a recorded passing independent
// audit, a verified testnet deployment on the same chain, a recorded
// small-value smoke-test attestation, and the typed confirmation phrase.
import { runStaticAudit, sha256Hex, type AuditFinding } from '../lib/auditCheck'
import { validateFeePayload, type FeeConfig } from '../lib/fees'
import { buildCircleChallengeRequest, CIRCLE_API_BASE, isValidCircleAppId, maskAppId, parseCircleError, validateCircleChallengeInput } from '../lib/circle'
import { isAddress, isTxHash, mainnetConfirmPhrase, testnetChainIdFor, validateDeployParams } from '../lib/deployParams'
import { validateMultisigInput } from '../lib/multisig'
import { validateChainInput, type ChainInput } from '../lib/chainValidation'
import artifact from '../contracts/StelixVault.artifact.json'

export interface Env {
  DB: D1Database
  ASSETS: Fetcher
  ENVIRONMENT: string
  ADMIN_EMAIL: string
  ADMIN_PASSWORD_HASH: string
  ADMIN_SESSION_SECRET: string
  CONFIG_SIGNING_SECRET?: string
  KEEPER_WORKER_URL?: string
  KEEPER_RUN_KEY?: string
  EXPLORER_API_KEY?: string
  /** Circle W3S API key (Wrangler secret, never in code/git/D1). The
   *  Circle App ID is public and lives in D1 circle_config instead. */
  CIRCLE_API_KEY?: string
}

const SOLC_PINNED = '0.8.24'
const ARTIFACT_SOURCE_HASH = (artifact as { sourceHashes: Record<string, string> }).sourceHashes['StelixVault.sol'] as string
const ARTIFACT_BYTECODE_HASH = (artifact as { bytecodeHash: string }).bytecodeHash as string

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

async function audit(env: Env, actor: string | null, action: string, detail: string) {
  try {
    await env.DB.prepare('INSERT INTO audit_log (actor, action, detail) VALUES (?, ?, ?)').bind(actor ?? 'unknown', action, detail).run()
  } catch {
    // Audit failure must not break the request; the attempt itself is still gated.
  }
}

// ---- Realtime sync version (migration 0007) ----
// Monotonic counter the wallet polls via GET /api/sync. Bumped on every
// admin write so an edit is visible within one poll interval. Best-effort:
// if the sync_state table does not exist yet (migration not applied), the
// write still succeeds and the version simply reads as 0.
async function getSyncVersion(env: Env): Promise<number> {
  try {
    const row = await env.DB.prepare('SELECT version FROM sync_state WHERE id = 1').first<{ version: number }>()
    return row?.version ?? 0
  } catch {
    return 0
  }
}

async function bumpSync(env: Env): Promise<number> {
  try {
    const row = await env.DB.prepare('SELECT version FROM sync_state WHERE id = 1').first<{ version: number }>()
    const next = (row?.version ?? 0) + 1
    if (row) {
      await env.DB.prepare('UPDATE sync_state SET version = ? WHERE id = ?').bind(next, 1).run()
    } else {
      await env.DB.prepare('INSERT INTO sync_state (id, version) VALUES (?, ?)').bind(1, next).run()
    }
    return next
  } catch {
    return 0
  }
}

async function getDeletedChainIds(env: Env): Promise<string[]> {
  try {
    const { results } = await env.DB.prepare('SELECT id FROM deleted_chains').all<{ id: string }>()
    return (results ?? []).map((r) => r.id)
  } catch {
    return []
  }
}

export interface MaintenanceState {
  enabled: boolean
  message: string
  scope: 'all' | 'wallet'
  updatedAt: string | null
}

/** Global testnet/mainnet mode (migration 0008). null = the admin has
 *  never chosen: the wallet shows all networks, exactly as before. */
export type NetworkMode = 'testnet' | 'mainnet' | null

async function getNetworkMode(env: Env): Promise<NetworkMode> {
  try {
    const row = await env.DB.prepare('SELECT mode FROM network_mode WHERE id = 1').first<{ mode: string | null }>()
    return row?.mode === 'mainnet' ? 'mainnet' : row?.mode === 'testnet' ? 'testnet' : null
  } catch {
    return null
  }
}

async function getMaintenanceState(env: Env): Promise<MaintenanceState> {
  try {
    const row = await env.DB.prepare('SELECT * FROM maintenance WHERE id = 1').first<{
      enabled: number
      message: string
      scope: string
      updated_at: string | null
    }>()
    if (!row) return { enabled: false, message: '', scope: 'wallet', updatedAt: null }
    return {
      enabled: row.enabled === 1,
      message: row.message ?? '',
      scope: row.scope === 'all' ? 'all' : 'wallet',
      updatedAt: row.updated_at ?? null,
    }
  } catch {
    return { enabled: false, message: '', scope: 'wallet', updatedAt: null }
  }
}

async function getLatestFees(env: Env): Promise<{ fees: FeeConfig | null; version: number | null; publishedBy: string | null; publishedAt: string | null }> {
  const row = await env.DB.prepare('SELECT * FROM fee_versions ORDER BY version DESC LIMIT 1').first<{
    version: number
    payload_json: string
    published_by: string
    created_at: string
  }>()
  if (!row) return { fees: null, version: null, publishedBy: null, publishedAt: null }
  let payload: FeeConfig | null = null
  try { payload = JSON.parse(row.payload_json) as FeeConfig } catch { payload = null }
  return { fees: payload, version: row.version, publishedBy: row.published_by, publishedAt: row.created_at }
}

async function getPublicAnnouncements(env: Env): Promise<unknown[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM announcements WHERE expires_at IS NULL OR expires_at = '' OR datetime(expires_at) > datetime('now') ORDER BY created_at DESC, id DESC LIMIT 20",
  ).all()
  return results ?? []
}

async function getSignedConfig(env: Env): Promise<{
  version: string
  payload: unknown
  signature: string | null
  signatureValid: boolean
  publishedAt: string
} | null> {
  const row = await env.DB.prepare('SELECT * FROM config_versions ORDER BY id DESC LIMIT 1').first<{
    version: string
    payload_json: string
    signature: string | null
    created_at: string
  }>()
  if (!row) return null
  let signatureValid = false
  if (row.signature && env.CONFIG_SIGNING_SECRET) {
    const expected = b64url(await hmac(env.CONFIG_SIGNING_SECRET, row.payload_json))
    signatureValid = timingSafeEqual(new TextEncoder().encode(row.signature), new TextEncoder().encode(expected))
  }
  let payload: unknown = null
  try { payload = JSON.parse(row.payload_json) } catch { payload = null }
  return { version: row.version, payload, signature: row.signature, signatureValid, publishedAt: row.created_at }
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// On-chain helpers (public JSON-RPC; no keys, no secrets)
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url: string, init: RequestInit, ms = 8000): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

// ---------------------------------------------------------------------------
// Circle User-Controlled Wallets proxy (Arc only, EOA first).
// One call, 8s timeout, no retries on 4xx (and no retries at all — a
// challenge must never be created twice by a retry). Circle's error
// code/message are surfaced honestly; the API key is never logged and
// never appears in any response.
// ---------------------------------------------------------------------------
type CircleResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; code: number | string; message: string }

/** Map a Circle HTTP status to the status this Worker returns: Circle
 *  4xx pass through (the caller's input or Circle account is wrong),
 *  Circle 5xx / unreachable become 502 (an upstream failure, not a
 *  client error). */
const circleStatusToHttp = (status: number): number => (status >= 400 && status < 500 ? status : 502)

async function circleCall(
  env: Env,
  path: string,
  init: { method: string; userToken?: string; body?: Record<string, unknown> },
): Promise<CircleResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${env.CIRCLE_API_KEY ?? ''}`,
  }
  if (init.userToken) headers['x-user-token'] = init.userToken
  let r: Response
  try {
    r = await fetchWithTimeout(
      `${CIRCLE_API_BASE}${path}`,
      { method: init.method, headers, body: init.body ? JSON.stringify(init.body) : undefined },
      8000,
    )
  } catch {
    return { ok: false, status: 502, code: 'circle_unreachable', message: 'Circle API did not respond within 8 seconds. No challenge or user was created — try again.' }
  }
  let parsed: unknown = null
  try {
    parsed = await r.json()
  } catch {
    parsed = null
  }
  if (!r.ok) {
    const e = parseCircleError(parsed, r.status)
    return { ok: false, status: r.status, code: e.code, message: e.message }
  }
  return { ok: true, status: r.status, data: parsed }
}

/** Mint a short-lived (60-minute) user session token for one challenge
 *  call. The token is used once, in memory, and never stored or returned:
 *  the mobile SDK needs the challengeId only, plus its own session. */
async function circleUserToken(env: Env, externalUserId: string): Promise<{ ok: true; userToken: string } | { ok: false; status: number; code: number | string; message: string }> {
  const res = await circleCall(env, '/v1/w3s/users/token', { method: 'POST', body: { userId: externalUserId } })
  if (!res.ok) return res
  const token = (res.data as { data?: { userToken?: unknown } } | null)?.data?.userToken
  if (typeof token !== 'string' || token === '') {
    return { ok: false, status: 502, code: 'circle_bad_response', message: 'Circle returned no user token — the challenge was not created.' }
  }
  return { ok: true, userToken: token }
}

/** The public Circle App ID saved in D1 (circle_config, id = 1), or null
 *  when the admin has never saved one. Missing table (migration 0010
 *  not applied yet) reads as null, not a crash. */
async function getCircleAppId(env: Env): Promise<string | null> {
  try {
    const row = await env.DB.prepare('SELECT app_id FROM circle_config WHERE id = 1').first<{ app_id: string | null }>()
    const appId = row?.app_id ?? null
    return typeof appId === 'string' && appId !== '' ? appId : null
  } catch {
    return null
  }
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const r = await fetchWithTimeout(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!r.ok) throw new Error(`RPC ${method} failed: HTTP ${r.status}`)
  const body = (await r.json()) as { result?: unknown; error?: { message?: string } }
  if (body.error) throw new Error(`RPC ${method} error: ${body.error.message ?? 'unknown'}`)
  return body.result
}

const pad32 = (addr: string) => '0'.repeat(24) + addr.slice(2).toLowerCase()
const hexToBigInt = (hex: string): bigint => {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  return h === '' ? 0n : BigInt('0x' + h)
}
const slot = (hex: string, index: number): bigint => hexToBigInt(hex.slice(2 + index * 64, 2 + (index + 1) * 64))
const slotAddress = (hex: string, index: number): string =>
  '0x' + hex.slice(2 + index * 64 + 24, 2 + (index + 1) * 64)

async function ethCall(rpcUrl: string, to: string, data: string): Promise<string> {
  const result = await rpcCall(rpcUrl, 'eth_call', [{ to, data }, 'latest'])
  if (typeof result !== 'string') throw new Error('eth_call returned no data')
  return result
}

function decodeUintArray(hex: string): bigint[] {
  // ABI: [offset][length][items...]
  if (hex.length < 2 + 128) return []
  const len = Number(slot(hex, 1))
  const out: bigint[] = []
  for (let i = 0; i < len; i++) out.push(slot(hex, 2 + i))
  return out
}

function decodeAddressArray(hex: string): string[] {
  // ABI-encoded address[]: [offset=0x20][length][addr word ...], each
  // address in the low 20 bytes of its 32-byte word. Used to read a
  // Safe's getOwners() result.
  if (!hex || hex.length < 2 + 128) return []
  const len = Number(slot(hex, 1))
  const out: string[] = []
  for (let i = 0; i < len; i++) {
    out.push('0x' + hex.slice(2 + (2 + i) * 64 + 24, 2 + (3 + i) * 64))
  }
  return out
}

const LOCK_STATUSES = ['Active', 'PartiallySold', 'Completed', 'Matured', 'Broken'] as const

function decodeGetLock(hex: string): {
  owner: string
  token: string
  amountRemaining: string
  amountTotal: string
  entryPrice: string
  unlockTime: number
  stablecoin: string
  status: string
} | null {
  // StelixVault.Lock layout: owner, token, amountRemaining, amountTotal,
  // entryPrice, unlockTime, ladderStages offset, trailingStopBps, peakPrice,
  // breakMode, penaltyBps, autoSell, stablecoin, router, slippageBps,
  // minReceivePerStage, status, feeBps, penaltyRecipient, breakRequestedAt.
  if (!hex || hex.length < 2 + 19 * 64) return null
  const statusIdx = Number(slot(hex, 16))
  return {
    owner: slotAddress(hex, 0),
    token: slotAddress(hex, 1),
    amountRemaining: slot(hex, 2).toString(),
    amountTotal: slot(hex, 3).toString(),
    entryPrice: slot(hex, 4).toString(),
    unlockTime: Number(slot(hex, 5)),
    stablecoin: slotAddress(hex, 12),
    status: LOCK_STATUSES[statusIdx] ?? 'Unknown',
  }
}

async function dexScreenerPrice(tokenAddress: string): Promise<number | null> {
  try {
    const r = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {}, 8000)
    if (!r.ok) return null
    const body = (await r.json()) as { pairs?: { priceUsd?: string }[] }
    const price = Number(body.pairs?.[0]?.priceUsd)
    return Number.isFinite(price) && price > 0 ? price : null
  } catch {
    return null
  }
}

type ChainRow = {
  id: string
  name: string
  chain_id: number
  rpc_urls: string
  explorer_url: string
  native_token: string
  native_decimals?: number | null
  stablecoin: string
  stablecoin_address: string
  stablecoin_decimals?: number | null
  gas_token?: string | null
  dex_router: string
  vault_address: string | null
  status: string
  is_default: number
  is_testnet?: number | null
  active?: number | null
  paired_chain_id?: string | null
  launchpad_address?: string | null
  token_factory_address?: string | null
}

async function getChains(env: Env): Promise<ChainRow[]> {
  const { results } = await env.DB.prepare('SELECT * FROM chains ORDER BY is_default DESC, name').all<ChainRow>()
  return results ?? []
}

async function explorerSourceVerified(env: Env, chain: ChainRow, address: string): Promise<{ checked: boolean; sourceVerified: boolean; note: string }> {
  // Etherscan-compatible API (ArcScan, BscScan, Etherscan, Basescan, Polygonscan).
  try {
    const base = chain.explorer_url.replace(/\/$/, '')
    const key = env.EXPLORER_API_KEY ? `&apikey=${encodeURIComponent(env.EXPLORER_API_KEY)}` : ''
    const r = await fetchWithTimeout(
      `${base}/api?module=contract&action=getsourcecode&address=${address}${key}`,
      {},
      8000,
    )
    if (!r.ok) return { checked: false, sourceVerified: false, note: `Explorer API returned HTTP ${r.status}; source verification not confirmed.` }
    const body = (await r.json()) as { status?: string; result?: { SourceCode?: string }[] }
    const src = body.result?.[0]?.SourceCode ?? ''
    return {
      checked: true,
      sourceVerified: src.length > 0,
      note: src.length > 0
        ? 'Source code is verified on the explorer.'
        : 'Contract code exists on-chain, but source is not verified on the explorer yet.',
    }
  } catch {
    return { checked: false, sourceVerified: false, note: 'Explorer API unreachable; source verification not confirmed.' }
  }
}

async function mainnetGate(env: Env, chainId: string): Promise<{ pass: boolean; reasons: string[] }> {
  const reasons: string[] = []
  const latestRun = await env.DB.prepare(
    'SELECT * FROM audit_runs ORDER BY id DESC LIMIT 1',
  ).first<{ verdict: string; findings_json: string }>()
  let automatedPass = false
  if (latestRun) {
    try {
      const findings = JSON.parse(latestRun.findings_json) as AuditFinding[]
      const openCriticalHigh = findings.filter(
        (f) => (f.severity === 'critical' || f.severity === 'high') && f.status === 'open',
      ).length
      automatedPass = latestRun.verdict === 'pass' && openCriticalHigh === 0
    } catch {
      automatedPass = false
    }
  }
  const external = await env.DB.prepare(
    "SELECT * FROM external_audits WHERE verdict = 'pass' ORDER BY id DESC LIMIT 1",
  ).first<{ auditor: string }>()
  if (!automatedPass && !external) {
    reasons.push('No passing audit: run the automated audit with zero open critical/high findings, or record a passing independent audit.')
  }
  // The verified testnet deployment that gates a mainnet deploy lives
  // under the testnet counterpart row: a mainnet deploy of "arc-mainnet"
  // is gated by the verified testnet deployment on "arc", not by a
  // testnet deployment on "arc-mainnet" (which can never exist).
  const testnet = await env.DB.prepare(
    "SELECT * FROM deployments WHERE chain_id = ? AND env = 'testnet' AND verification_status = 'verified' ORDER BY id DESC LIMIT 1",
  ).bind(testnetChainIdFor(chainId)).first<{ id: number }>()
  if (!testnet) reasons.push('No verified testnet deployment on this chain yet.')
  const smoke = await env.DB.prepare(
    "SELECT * FROM gate_attestations WHERE chain_id = ? AND kind = 'smoke' ORDER BY id DESC LIMIT 1",
  ).bind(chainId).first<{ id: number }>()
  if (!smoke) reasons.push('No small-value mainnet smoke-test attestation recorded for this chain.')
  return { pass: reasons.length === 0, reasons }
}

async function handleLogin(req: Request, env: Env): Promise<Response> {
  const ip = clientIp(req)
  const body = await readJson(req)
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')

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
    ).bind(ip, attempts, lockedUntil).run()
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
    const path = url.pathname

    if (path === '/api/health') return json({ ok: true, env: env.ENVIRONMENT })

    if (path === '/api/admin/login' && req.method === 'POST') return handleLogin(req, env)
    if (path === '/api/admin/logout' && req.method === 'POST') {
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie(null) })
    }
    if (path === '/api/admin/session' && req.method === 'GET') {
      const email = await readSession(req, env)
      if (!email) return json({ authenticated: false }, 401)
      return json({ authenticated: true, email })
    }

    // Public feeds for the mobile app (no admin session).
    if (path === '/api/config' && req.method === 'GET') {
      const config = await getSignedConfig(env)
      if (!config) return json({ config: null, note: 'No signed config published yet.' })
      return json({ config })
    }
    if (path === '/api/announcements' && req.method === 'GET') {
      return json({ announcements: await getPublicAnnouncements(env) })
    }

    // Public fee feed for the mobile app (no admin session). The wallet
    // shows the admin's fee when one is published and an honest "no admin
    // fee published yet" state otherwise — never a hardcoded fee that
    // silently overrides an admin edit.
    if (path === '/api/fees' && req.method === 'GET') {
      const latest = await getLatestFees(env)
      if (!latest.fees) return json({ fees: null, note: 'No fee config published yet. Defaults apply in the app until you save one.' })
      return json({ fees: latest.fees, version: latest.version, publishedBy: latest.publishedBy, publishedAt: latest.publishedAt })
    }

    // Public token registry for the mobile app (no admin session). The
    // wallet uses it to badge imported tokens as "verified in the Stelix
    // registry"; a token removed here loses the badge on the next sync.
    // Importing an unregistered token by address is still allowed — the
    // wallet says so instead of blocking it.
    if (path === '/api/tokens' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM tokens ORDER BY chain_id, symbol').all()
      return json({ tokens: results ?? [] })
    }

    // Public maintenance state for the mobile app (no admin session).
    if (path === '/api/maintenance' && req.method === 'GET') {
      return json({ maintenance: await getMaintenanceState(env) })
    }

    // Single polling endpoint for the mobile app (no admin session):
    // chains + tombstones + fees + announcements + signed config +
    // token registry + maintenance, plus the monotonic sync version.
    // The wallet polls this every ~45s and re-applies state only when
    // `version` changes. This is live polling, not push.
    // `networkMode` is the admin's global testnet/mainnet switch (null =
    // never set: the wallet shows all networks, as before).
    if (path === '/api/sync' && req.method === 'GET') {
      const version = await getSyncVersion(env)
      const chains = await getChains(env)
      const deletedIds = await getDeletedChainIds(env)
      const latestFees = await getLatestFees(env)
      const announcements = await getPublicAnnouncements(env)
      const config = await getSignedConfig(env)
      const { results: tokens } = await env.DB.prepare('SELECT * FROM tokens ORDER BY chain_id, symbol').all()
      const maintenance = await getMaintenanceState(env)
      const networkMode = await getNetworkMode(env)
      return json({
        version,
        chains,
        deletedIds,
        fees: latestFees.fees,
        feeVersion: latestFees.version,
        feePublishedAt: latestFees.publishedAt,
        announcements,
        config,
        tokens: tokens ?? [],
        maintenance,
        networkMode,
      })
    }

    // Public launchpad feed for the mobile app (no admin session).
    // Only APPROVED launches are listed. Empty until a launch is recorded
    // in D1 — never invented launches. Contract addresses come from the Arc
    // chain row (migration 0004) and are null until a verified deploy.
    if (path === '/api/launches' && req.method === 'GET') {
      const { results } = await env.DB.prepare(
        "SELECT * FROM launches WHERE approval_status = 'approved' ORDER BY created_at DESC, id DESC LIMIT 100",
      ).all()
      const arc = await env.DB.prepare('SELECT * FROM chains WHERE id = ?').bind('arc').first<ChainRow & { launchpad_address?: string | null; token_factory_address?: string | null }>()
      const managerRow = await env.DB.prepare(
        'SELECT liquidity_manager FROM launches WHERE liquidity_manager IS NOT NULL ORDER BY id DESC LIMIT 1',
      ).first<{ liquidity_manager: string | null }>()
      return json({
        launches: results ?? [],
        launchpadAddress: arc?.launchpad_address ?? null,
        factoryAddress: arc?.token_factory_address ?? null,
        liquidityManager: managerRow?.liquidity_manager ?? null,
        note: (arc?.launchpad_address ?? null)
          ? 'Live launches on Arc testnet. Liquidity lock is pending Arc DEX confirmation until a liquidity manager is set.'
          : 'No launches yet — launches go live once the launchpad contracts are deployed on Arc testnet',
      })
    }

    // Public chain registry for the mobile app (no admin session).
    // The wallet reads this to list chains (apps/mobile/src/lib/adminChains.ts)
    // so a chain added here appears in the picker/Discover/Swap with no app
    // rebuild. Every chain WRITE stays behind the admin session below.
    // A chain listed here is NOT usable for locks/swaps until its vault and
    // DEX router are verified on the explorer and registered — the wallet
    // must say that honestly.
    if (path === '/api/chains' && req.method === 'GET') {
      const chains = await getChains(env)
      // deletedIds are the tombstones: a slug here must never reappear in
      // the wallet, even from its built-in fallback registry.
      return json({ chains, deletedIds: await getDeletedChainIds(env), version: await getSyncVersion(env) })
    }

    // Everything below requires a valid admin session.
    const authed = await readSession(req, env)
    if (!authed && path.startsWith('/api/')) {
      return json({ error: 'admin session required — sign in first' }, 401)
    }
    if (!authed) {
      // Non-API paths fall through to the SPA below only when authed; otherwise
      // the SPA itself redirects to login via its session check.
    }

    // ---- Circle User-Controlled Wallets (Arc only, EOA first) ----
    // Proxy for api.circle.com /v1/w3s/. Every route here needs the admin
    // session (the gate above). The backend creates challenges; the mobile
    // SDK executes them and the user approves with their PIN. The backend
    // never holds a user key share and never signs for a user.
    if (path === '/api/circle/users' && req.method === 'POST') {
      const body = await readJson(req)
      const userId = String(body.userId ?? '').trim()
      const email = body.email ? String(body.email).trim() : null
      if (userId.length < 5 || userId.length > 50) {
        return json({ error: 'userId is required (5–50 characters) — pass the Stelix user id; Circle stores it as the external user id.' }, 400)
      }
      if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: 'email must be a valid email address' }, 400)
      }
      const existing = await env.DB.prepare('SELECT * FROM circle_users WHERE user_id = ?').bind(userId).first<{ circle_user_id: string; email: string | null }>()
      if (existing) {
        return json({ ok: true, userId, circleUserId: existing.circle_user_id, email: existing.email, existing: true })
      }
      if (!env.CIRCLE_API_KEY) {
        return json({ error: 'CIRCLE_API_KEY is not set. Set it with: wrangler pages secret put CIRCLE_API_KEY --project-name stelix-admin. No Circle user was created.', code: 'circle_api_key_missing' }, 503)
      }
      const res = await circleCall(env, '/v1/w3s/users', { method: 'POST', body: { userId } })
      if (!res.ok) return json({ error: res.message, code: res.code, circleStatus: res.status }, circleStatusToHttp(res.status))
      const circleUserId = (res.data as { data?: { id?: unknown } } | null)?.data?.id
      if (typeof circleUserId !== 'string' || circleUserId === '') {
        return json({ error: 'Circle returned no user id — the user was not recorded.', code: 'circle_bad_response' }, 502)
      }
      await env.DB.prepare('INSERT INTO circle_users (user_id, circle_user_id, email, created_by) VALUES (?, ?, ?, ?)').bind(userId, circleUserId, email, authed).run()
      await audit(env, authed, 'circle.user_create', `Circle user created for ${userId} (Circle id ${circleUserId})`)
      return json({ ok: true, userId, circleUserId, email }, 201)
    }
    if (path === '/api/circle/challenges' && req.method === 'POST') {
      const body = await readJson(req)
      const { value, errors } = validateCircleChallengeInput(body)
      if (!value) {
        return json({ error: errors[0] ?? 'invalid challenge', details: errors }, 400)
      }
      // executeContract may only target a StelixVault that is deployed
      // and registered in Chain Manager. No vault is deployed anywhere
      // yet, so until one is, every lock attempt is refused here with a
      // clear message instead of reaching Circle.
      if (value.type === 'executeContract') {
        const chains = await getChains(env)
        const vault = chains.find((c) => c.vault_address && c.vault_address.toLowerCase() === (value.contractAddress ?? '').toLowerCase())
        if (!vault) {
          return json({ error: `Contract ${value.contractAddress} is not a registered StelixVault — no vault is deployed on any chain yet. Deploy a vault in Contract Studio and register it in Chain Manager first; lock attempts are refused until then.`, code: 'vault_not_registered' }, 400)
        }
      }
      const mapping = await env.DB.prepare('SELECT * FROM circle_users WHERE user_id = ?').bind(value.userId).first<{ circle_user_id: string }>()
      if (!mapping) {
        return json({ error: `No Circle user is registered for userId "${value.userId}" — create one first with POST /api/circle/users.`, code: 'circle_user_not_found' }, 404)
      }
      if (!env.CIRCLE_API_KEY) {
        return json({ error: 'CIRCLE_API_KEY is not set. Set it with: wrangler pages secret put CIRCLE_API_KEY --project-name stelix-admin. No challenge was created.', code: 'circle_api_key_missing' }, 503)
      }
      const tokenRes = await circleUserToken(env, value.userId)
      if (!tokenRes.ok) return json({ error: tokenRes.message, code: tokenRes.code, circleStatus: tokenRes.status }, circleStatusToHttp(tokenRes.status))
      const { path: circlePath, body: circleBody } = buildCircleChallengeRequest(value, crypto.randomUUID())
      const res = await circleCall(env, circlePath, { method: 'POST', userToken: tokenRes.userToken, body: circleBody })
      if (!res.ok) return json({ error: res.message, code: res.code, circleStatus: res.status }, circleStatusToHttp(res.status))
      const challengeId = (res.data as { data?: { challengeId?: unknown } } | null)?.data?.challengeId
      if (typeof challengeId !== 'string' || challengeId === '') {
        return json({ error: 'Circle returned no challengeId — the challenge was not created.', code: 'circle_bad_response' }, 502)
      }
      // Audit trail only: the user token is never stored, and only the
      // challengeId is returned to the caller.
      try {
        await env.DB.prepare('INSERT INTO circle_challenges (challenge_id, circle_user_id, type, blockchain, wallet_id, contract_address) VALUES (?, ?, ?, ?, ?, ?)').bind(challengeId, mapping.circle_user_id, value.type, value.blockchain, value.walletId ?? null, value.contractAddress ?? null).run()
      } catch {
        // The challenge already exists at Circle; a D1 audit write must
        // not fail the response.
      }
      await audit(env, authed, 'circle.challenge_create', `${value.type} challenge ${challengeId} created for ${value.userId} on ${value.blockchain}`)
      return json({ challengeId, type: value.type, blockchain: value.blockchain }, 201)
    }
    if (path === '/api/circle/wallets' && req.method === 'GET') {
      const userId = (url.searchParams.get('userId') ?? '').trim()
      if (!userId) return json({ error: 'userId query parameter is required' }, 400)
      const mapping = await env.DB.prepare('SELECT * FROM circle_users WHERE user_id = ?').bind(userId).first<{ circle_user_id: string }>()
      if (!mapping) {
        return json({ error: `No Circle user is registered for userId "${userId}" — create one first with POST /api/circle/users.`, code: 'circle_user_not_found' }, 404)
      }
      if (!env.CIRCLE_API_KEY) {
        return json({ error: 'CIRCLE_API_KEY is not set. Set it with: wrangler pages secret put CIRCLE_API_KEY --project-name stelix-admin.', code: 'circle_api_key_missing' }, 503)
      }
      const res = await circleCall(env, `/v1/w3s/wallets?userId=${encodeURIComponent(mapping.circle_user_id)}`, { method: 'GET' })
      if (!res.ok) return json({ error: res.message, code: res.code, circleStatus: res.status }, circleStatusToHttp(res.status))
      const wallets = (res.data as { data?: { wallets?: unknown } } | null)?.data?.wallets
      return json({ wallets: Array.isArray(wallets) ? wallets : [], userId })
    }
    const circleTxMatch = /^\/api\/circle\/transactions\/([A-Za-z0-9-]+)$/.exec(path)
    if (circleTxMatch && req.method === 'GET') {
      if (!env.CIRCLE_API_KEY) {
        return json({ error: 'CIRCLE_API_KEY is not set. Set it with: wrangler pages secret put CIRCLE_API_KEY --project-name stelix-admin.', code: 'circle_api_key_missing' }, 503)
      }
      const res = await circleCall(env, `/v1/w3s/transactions/${encodeURIComponent(circleTxMatch[1])}`, { method: 'GET' })
      if (!res.ok) return json({ error: res.message, code: res.code, circleStatus: res.status }, circleStatusToHttp(res.status))
      const transaction = (res.data as { data?: unknown } | null)?.data ?? null
      return json({ transaction })
    }
    if (path === '/api/circle/config' && req.method === 'GET') {
      const apiKeyConfigured = Boolean(env.CIRCLE_API_KEY)
      const appId = await getCircleAppId(env)
      const appIdConfigured = appId !== null
      let circleReachable: boolean | null = null
      let circleAppIdMatches: boolean | null = null
      let circleError: string | null = null
      if (apiKeyConfigured) {
        // Harmless read: GET /v1/w3s/config/entity returns the App ID
        // Circle associates with this API key. It tests the key without
        // creating anything, and lets the admin see whether the saved App
        // ID matches the one Circle reports.
        const res = await circleCall(env, '/v1/w3s/config/entity', { method: 'GET' })
        if (res.ok) {
          circleReachable = true
          const liveAppId = (res.data as { data?: { appId?: unknown } } | null)?.data?.appId
          if (typeof liveAppId === 'string' && liveAppId !== '') {
            circleAppIdMatches = appIdConfigured ? liveAppId === appId : null
          }
        } else {
          circleReachable = false
          circleError = res.message
        }
      }
      const chains = await getChains(env)
      const vaultDeployed = chains.some((c) => Boolean(c.vault_address))
      const note = !apiKeyConfigured
        ? 'CIRCLE_API_KEY is not set. Set it with: wrangler pages secret put CIRCLE_API_KEY --project-name stelix-admin.'
        : !appIdConfigured
          ? 'API key is set. Save your Circle App ID below (Circle Console → Web3 Services) so the mobile SDK can initialise.'
          : !vaultDeployed
            ? 'Circle is configured, but no StelixVault is deployed yet — lock (executeContract) challenges are refused until a vault is deployed and registered in Chain Manager.'
            : 'Circle is configured and a vault is registered.'
      // Never the key, never the full App ID — only a masked prefix.
      return json({
        configured: apiKeyConfigured && appIdConfigured,
        appIdConfigured,
        apiKeyConfigured,
        arcTestnet: true,
        appIdMasked: maskAppId(appId),
        circleReachable,
        circleAppIdMatches,
        circleError,
        vaultDeployed,
        note,
      })
    }
    if (path === '/api/admin/circle-config' && req.method === 'POST') {
      const body = await readJson(req)
      const appId = String(body.appId ?? '').trim()
      if (!isValidCircleAppId(appId)) {
        return json({ error: 'appId must be the Circle App ID — a UUID from your Circle Console (Web3 Services). It was not saved.' }, 400)
      }
      const existing = await env.DB.prepare('SELECT id FROM circle_config WHERE id = 1').first<{ id: number }>()
      if (existing) {
        await env.DB.prepare("UPDATE circle_config SET app_id = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").bind(appId, authed, 1).run()
      } else {
        await env.DB.prepare('INSERT INTO circle_config (id, app_id, updated_by) VALUES (?, ?, ?)').bind(1, appId, authed).run()
      }
      await audit(env, authed, 'circle.config_set', `Circle App ID saved (${maskAppId(appId)}) — the App ID is public, not a secret; the API key stays a Wrangler secret`)
      return json({ ok: true, appIdMasked: maskAppId(appId) })
    }

    // ---- Dashboard (live: D1 + on-chain vault balances) ----
    if (path === '/api/admin/dashboard' && req.method === 'GET') {
      const chains = await getChains(env)
      const locksCount = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM locks WHERE status IN ('Active', 'PartiallySold')",
      ).first<{ n: number }>()
      const autoSells = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount_usd), 0) AS volume FROM auto_sells').first<{ n: number; volume: number }>()
      const lastRun = await env.DB.prepare('SELECT * FROM keeper_runs ORDER BY started_at DESC LIMIT 1').first<{
        started_at: string
        status: string
        failed: number
      }>()
      const failedRuns = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM keeper_runs WHERE status = 'failed' AND datetime(started_at) > datetime('now', '-24 hours')",
      ).first<{ n: number }>()
      const configRow = await env.DB.prepare('SELECT version FROM config_versions ORDER BY id DESC LIMIT 1').first<{ version: string }>()

      const tvlByChain: { chain: string; chainId: string; vault: string | null; tvlUsd: number | null; note: string }[] = []
      let totalTvl = 0
      for (const chain of chains) {
        if (!chain.vault_address) {
          tvlByChain.push({ chain: chain.name, chainId: chain.id, vault: null, tvlUsd: 0, note: 'No vault deployed on this chain yet.' })
          continue
        }
        const rpcUrl = (chain.rpc_urls.split(',')[0] ?? '').trim()
        const { results: tokenRows } = await env.DB.prepare('SELECT * FROM tokens WHERE chain_id = ?').bind(chain.id).all<{
          symbol: string
          address: string
          decimals: number
        }>()
        const tokens = [...(tokenRows ?? [])]
        if (chain.stablecoin_address && !tokens.some((t) => t.address.toLowerCase() === chain.stablecoin_address.toLowerCase())) {
          tokens.push({ symbol: chain.stablecoin, address: chain.stablecoin_address, decimals: 6 })
        }
        let tvl = 0
        let failed = false
        for (const token of tokens) {
          try {
            const raw = await ethCall(rpcUrl, token.address, '0x70a08231' + pad32(chain.vault_address))
            const balance = Number(hexToBigInt(raw)) / 10 ** token.decimals
            if (balance <= 0) continue
            const price = token.symbol === chain.stablecoin ? 1 : await dexScreenerPrice(token.address)
            if (price === null) { failed = true; continue }
            tvl += balance * price
          } catch {
            failed = true
          }
        }
        if (failed && tvl === 0) {
          tvlByChain.push({ chain: chain.name, chainId: chain.id, vault: chain.vault_address, tvlUsd: null, note: 'Vault balance or price unavailable — RPC or price feed unreachable. TVL is not shown rather than guessed.' })
        } else {
          tvlByChain.push({ chain: chain.name, chainId: chain.id, vault: chain.vault_address, tvlUsd: Math.round(tvl * 100) / 100, note: failed ? 'Partial: some token prices were unavailable and are excluded.' : 'Live on-chain vault balances.' })
          totalTvl += tvl
        }
      }
      const lastRunAt = lastRun?.started_at ?? null
      const minutesSinceLastRun = lastRunAt ? Math.max(0, Math.round((Date.now() - new Date(lastRunAt).getTime()) / 60000)) : null
      const keeperHealth =
        minutesSinceLastRun === null
          ? 'No runs yet'
          : minutesSinceLastRun <= 10
            ? 'Healthy'
            : minutesSinceLastRun <= 60
              ? 'Stale'
              : 'Down'
      return json({
        tvlByChain,
        totalTvlUsd: Math.round(totalTvl * 100) / 100,
        activeLocks: locksCount?.n ?? 0,
        autoSells: autoSells?.n ?? 0,
        autoSellVolumeUsd: Math.round((autoSells?.volume ?? 0) * 100) / 100,
        keeperHealth,
        keeperLastRunAt: lastRunAt,
        keeperMinutesSinceLastRun: minutesSinceLastRun,
        keeperFailedRuns24h: failedRuns?.n ?? 0,
        configVersion: configRow?.version ?? 'not published',
      })
    }

    // ---- Chains ----
    // GET /api/chains is public (above, before the auth gate) — the wallet
    // reads the registry from it. Everything here writes and needs a session.
    if (path === '/api/admin/chains' && req.method === 'POST') {
      const body = await readJson(req)
      const { value, errors } = validateChainInput(body)
      if (!value || !value.id || !value.name || value.chainId === undefined) {
        const first = Object.values(errors)[0] ?? 'invalid chain'
        return json({ error: first, details: errors }, 400)
      }
      const chain = value as ChainInput
      const bySlug = await env.DB.prepare('SELECT id FROM chains WHERE id = ?').bind(chain.id).first()
      if (bySlug) return json({ error: 'A chain with that slug already exists', details: { id: 'A chain with that slug already exists' } }, 409)
      const byChainId = await env.DB.prepare('SELECT id FROM chains WHERE chain_id = ?').bind(chain.chainId).first<{ id: string }>()
      if (byChainId) return json({ error: `Chain id ${chain.chainId} is already used by "${byChainId.id}"`, details: { chainId: `Chain id ${chain.chainId} is already used by "${byChainId.id}"` } }, 409)
      const isDefault = chain.isDefault ? 1 : 0
      if (isDefault) await env.DB.prepare('UPDATE chains SET is_default = 0').run()
      await env.DB.prepare(
        'INSERT INTO chains (id, name, chain_id, rpc_urls, explorer_url, native_token, native_decimals, stablecoin, stablecoin_address, stablecoin_decimals, gas_token, dex_router, vault_address, status, is_testnet, active, paired_chain_id, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        chain.id, chain.name, chain.chainId, chain.rpcUrls.join(','), chain.explorerUrl,
        chain.nativeToken, chain.nativeDecimals, chain.stablecoin, chain.stablecoinAddress,
        chain.stablecoinDecimals, chain.gasToken, chain.dexRouter, chain.vaultAddress,
        chain.status, chain.isTestnet ? 1 : 0, chain.active ? 1 : 0, chain.pairedChainId, isDefault,
      ).run()
      // Re-adding a slug that was previously deleted clears its tombstone.
      await env.DB.prepare('DELETE FROM deleted_chains WHERE id = ?').bind(chain.id).run()
      await bumpSync(env)
      await audit(env, authed, 'chain.create', `chain ${chain.id} (${chain.name}, chainId ${chain.chainId}) created`)
      return json({ ok: true, id: chain.id }, 201)
    }
    const chainToggle = /^\/api\/admin\/chains\/([a-z0-9-]+)\/active$/.exec(path)
    if (chainToggle && req.method === 'PATCH') {
      const id = chainToggle[1]
      const body = await readJson(req)
      if (typeof body.active !== 'boolean') return json({ error: 'active must be true or false' }, 400)
      const chain = await env.DB.prepare('SELECT * FROM chains WHERE id = ?').bind(id).first<ChainRow>()
      if (!chain) return json({ error: 'chain not found' }, 404)
      await env.DB.prepare("UPDATE chains SET active = ?, updated_at = datetime('now') WHERE id = ?").bind(body.active ? 1 : 0, id).run()
      await bumpSync(env)
      await audit(env, authed, body.active ? 'chain.enable' : 'chain.disable', `chain ${id} ${body.active ? 'enabled' : 'disabled'} (active=${body.active})`)
      return json({ ok: true, id, active: body.active })
    }
    const chainUpdate = /^\/api\/admin\/chains\/([a-z0-9-]+)$/.exec(path)
    if (chainUpdate && (req.method === 'POST' || req.method === 'PUT')) {
      const id = chainUpdate[1]
      const body = await readJson(req)
      const { value, errors } = validateChainInput(body, { partial: true })
      if (!value) {
        const first = Object.values(errors)[0] ?? 'invalid chain update'
        return json({ error: first, details: errors }, 400)
      }
      if (value.pairedChainId !== undefined && value.pairedChainId !== null && value.pairedChainId === id) {
        return json({ error: 'a chain cannot be paired with itself', details: { pairedChainId: 'a chain cannot be paired with itself' } }, 400)
      }
      const chain = await env.DB.prepare('SELECT * FROM chains WHERE id = ?').bind(id).first<ChainRow>()
      if (!chain) return json({ error: 'chain not found' }, 404)
      if (value.chainId !== undefined && value.chainId !== chain.chain_id) {
        const clash = await env.DB.prepare('SELECT id FROM chains WHERE chain_id = ?').bind(value.chainId).first<{ id: string }>()
        if (clash) return json({ error: `Chain id ${value.chainId} is already used by "${clash.id}"`, details: { chainId: `Chain id ${value.chainId} is already used by "${clash.id}"` } }, 409)
      }
      const updates: string[] = []
      const values: unknown[] = []
      const set = (col: string, val: unknown) => { updates.push(`${col} = ?`); values.push(val) }
      if (value.name !== undefined) set('name', value.name)
      if (value.chainId !== undefined) set('chain_id', value.chainId)
      if (value.rpcUrls !== undefined) set('rpc_urls', value.rpcUrls.join(','))
      if (value.explorerUrl !== undefined) set('explorer_url', value.explorerUrl)
      if (value.nativeToken !== undefined) set('native_token', value.nativeToken)
      if (value.nativeDecimals !== undefined) set('native_decimals', value.nativeDecimals)
      if (value.stablecoin !== undefined) set('stablecoin', value.stablecoin)
      if (value.stablecoinAddress !== undefined) set('stablecoin_address', value.stablecoinAddress)
      if (value.stablecoinDecimals !== undefined) set('stablecoin_decimals', value.stablecoinDecimals)
      if (value.gasToken !== undefined) set('gas_token', value.gasToken === '' ? chain.native_token : value.gasToken)
      if (value.dexRouter !== undefined) set('dex_router', value.dexRouter)
      if (value.vaultAddress !== undefined) set('vault_address', value.vaultAddress)
      if (value.status !== undefined) {
        set('status', value.status)
        // A status change implies the testnet flag unless it was set explicitly.
        if (value.isTestnet === undefined) set('is_testnet', value.status === 'testnet' ? 1 : 0)
      }
      if (value.isTestnet !== undefined) set('is_testnet', value.isTestnet ? 1 : 0)
      if (value.active !== undefined) set('active', value.active ? 1 : 0)
      if (value.pairedChainId !== undefined) set('paired_chain_id', value.pairedChainId)
      if (value.isDefault === true) {
        await env.DB.prepare('UPDATE chains SET is_default = 0').run()
        set('is_default', 1)
      }
      if (updates.length === 0) return json({ error: 'nothing to update' }, 400)
      set('updated_at', new Date().toISOString())
      await env.DB.prepare(`UPDATE chains SET ${updates.join(', ')} WHERE id = ?`).bind(...values, id).run()
      await bumpSync(env)
      await audit(env, authed, 'chain.update', `chain ${id} updated: ${updates.join(', ')}`)
      return json({ ok: true })
    }

    // ---- Delete a chain ----
    // Refuses (409) when the chain is the wallet default, has a vault
    // deployed, has a recorded deployment, or still has registered
    // tokens — deleting any of those would orphan live state. A clean
    // chain is deleted and tombstoned in `deleted_chains`, so the wallet
    // removes it on its next sync and can never resurrect it from its
    // built-in fallback. Re-adding the same slug later clears the
    // tombstone (see the create handler above).
    const chainDelete = /^\/api\/admin\/chains\/([a-z0-9-]+)$/.exec(path)
    if (chainDelete && req.method === 'DELETE') {
      const id = chainDelete[1]
      const chain = await env.DB.prepare('SELECT * FROM chains WHERE id = ?').bind(id).first<ChainRow>()
      if (!chain) return json({ error: 'chain not found' }, 404)
      if (chain.is_default === 1) {
        return json({ error: `Cannot delete "${chain.name}": it is the default chain. Make another chain the default first.`, code: 'chain_is_default' }, 409)
      }
      if (chain.vault_address) {
        return json({ error: `Cannot delete "${chain.name}": a vault is deployed at ${chain.vault_address}. A chain with a deployed vault can never be deleted from the registry.`, code: 'chain_has_vault' }, 409)
      }
      const deployment = await env.DB.prepare('SELECT id FROM deployments WHERE chain_id = ? LIMIT 1').bind(id).first<{ id: number }>()
      if (deployment) {
        return json({ error: `Cannot delete "${chain.name}": a deployment is recorded for it. Deployments are permanent audit history.`, code: 'chain_has_deployment' }, 409)
      }
      const tokenCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM tokens WHERE chain_id = ?').bind(id).first<{ n: number }>()
      if ((tokenCount?.n ?? 0) > 0) {
        return json({ error: `Cannot delete "${chain.name}": ${tokenCount?.n} token(s) are still registered on it. Remove them from the Token Registry first.`, code: 'chain_has_tokens' }, 409)
      }
      await env.DB.prepare('DELETE FROM chains WHERE id = ?').bind(id).run()
      await env.DB.prepare('INSERT INTO deleted_chains (id) VALUES (?)').bind(id).run()
      await bumpSync(env)
      await audit(env, authed, 'chain.delete', `chain ${id} (${chain.name}) deleted and tombstoned`)
      return json({ ok: true, id, deleted: true })
    }

    // ---- Tokens / DEX registry ----
    if (path === '/api/admin/tokens' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM tokens ORDER BY chain_id, symbol').all()
      return json({ tokens: results ?? [] })
    }
    if (path === '/api/admin/tokens' && req.method === 'POST') {
      const body = await readJson(req)
      const symbol = String(body.symbol ?? '').trim().toUpperCase()
      const chainId = String(body.chainId ?? body.chain_id ?? '').trim()
      const address = String(body.address ?? '').trim()
      const decimals = Number(body.decimals ?? 18)
      if (!symbol || !chainId || !address) return json({ error: 'symbol, chainId and address are required' }, 400)
      if (!isAddress(address)) return json({ error: 'address must be a valid 0x address (Solana tokens are registered by the Solana program, not here)' }, 400)
      if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return json({ error: 'decimals must be 0-36' }, 400)
      const chain = await env.DB.prepare('SELECT id FROM chains WHERE id = ?').bind(chainId).first()
      if (!chain) return json({ error: 'chain not found in Chain Manager' }, 400)
      const existing = await env.DB.prepare('SELECT id FROM tokens WHERE chain_id = ? AND address = ?').bind(chainId, address).first()
      if (existing) return json({ error: 'Token already registered for this chain' }, 409)
      const run = await env.DB.prepare(
        'INSERT INTO tokens (symbol, chain_id, address, decimals, verified, featured) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(symbol, chainId, address, decimals, body.verified ? 1 : 0, body.featured ? 1 : 0).run()
      await bumpSync(env)
      await audit(env, authed, 'token.add', `${symbol} on ${chainId} (${address})`)
      const id = (run as unknown as { meta?: { last_row_id?: number } }).meta?.last_row_id ?? null
      return json({ ok: true, id }, 201)
    }
    if (path === '/api/admin/tokens' && req.method === 'DELETE') {
      const id = url.searchParams.get('id')
      if (!id) return json({ error: 'id required' }, 400)
      await env.DB.prepare('DELETE FROM tokens WHERE id = ?').bind(Number(id)).run()
      await bumpSync(env)
      await audit(env, authed, 'token.remove', `token id ${id} removed`)
      return json({ ok: true })
    }
    if (path === '/api/admin/tokens/search' && req.method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim()
      const chainFilter = (url.searchParams.get('chain') ?? '').trim()
      if (q.length < 2) return json({ error: 'q must be at least 2 characters' }, 400)
      try {
        const r = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, {}, 8000)
        if (!r.ok) return json({ error: `DexScreener search failed: HTTP ${r.status}` }, 502)
        const body = (await r.json()) as { pairs?: { chainId: string; dexId: string; baseToken: { address: string; symbol: string; name: string }; priceUsd?: string; url?: string }[] }
        const seen = new Set<string>()
        const tokens = (body.pairs ?? [])
          .filter((p) => !chainFilter || p.chainId === chainFilter)
          .filter((p) => {
            const key = `${p.chainId}:${p.baseToken.address.toLowerCase()}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
          })
          .slice(0, 20)
          .map((p) => ({
            symbol: p.baseToken.symbol,
            name: p.baseToken.name,
            chain: p.chainId,
            address: p.baseToken.address,
            priceUsd: p.priceUsd ? Number(p.priceUsd) : null,
            dex: p.dexId,
            pairUrl: p.url ?? null,
            source: 'DexScreener',
          }))
        return json({ tokens, source: 'DexScreener (live)' })
      } catch {
        return json({ error: 'DexScreener search unreachable' }, 502)
      }
    }

    // ---- Fees and Limits (versioned) ----
    if (path === '/api/admin/fees' && req.method === 'GET') {
      const latest = await getLatestFees(env)
      if (!latest.fees) return json({ fees: null, note: 'No fee config published yet. Defaults apply in the app until you save one.' })
      return json({ fees: latest.fees, version: latest.version, publishedBy: latest.publishedBy, publishedAt: latest.publishedAt })
    }
    if (path === '/api/admin/fees' && req.method === 'POST') {
      const body = await readJson(req)
      const { config, errors } = validateFeePayload(body)
      if (!config) return json({ error: 'invalid fee config', details: errors }, 400)
      const maxRow = await env.DB.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM fee_versions').first<{ v: number }>()
      const version = (maxRow?.v ?? 0) + 1
      await env.DB.prepare('INSERT INTO fee_versions (version, payload_json, published_by) VALUES (?, ?, ?)').bind(version, JSON.stringify(config), authed).run()
      await bumpSync(env)
      await audit(env, authed, 'fees.publish', `fee config v${version} published (auto-sell fee ${config.autoSellFeePct}%)`)
      return json({ ok: true, version, fees: config }, 201)
    }
    if (path === '/api/admin/fees/history' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT id, version, payload_json, published_by, created_at FROM fee_versions ORDER BY version DESC LIMIT 20').all()
      return json({ history: results ?? [] })
    }

    // ---- Announcements ----
    if (path === '/api/admin/announcements' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM announcements ORDER BY created_at DESC, id DESC LIMIT 50').all()
      return json({ announcements: results ?? [] })
    }
    if (path === '/api/admin/announcements' && req.method === 'POST') {
      const body = await readJson(req)
      const title = String(body.title ?? '').trim()
      const message = String(body.message ?? '').trim()
      const audience = String(body.audience ?? 'all')
      const expiresAt = body.expiresAt ? String(body.expiresAt) : null
      if (!title || !message) return json({ error: 'title and message are required' }, 400)
      if (!['all', 'arc', 'bnb', 'base', 'ethereum', 'polygon', 'solana'].includes(audience)) return json({ error: 'invalid audience' }, 400)
      const run = await env.DB.prepare(
        'INSERT INTO announcements (title, message, audience, expires_at) VALUES (?, ?, ?, ?)',
      ).bind(title, message, audience, expiresAt).run()
      await bumpSync(env)
      await audit(env, authed, 'announcement.publish', `"${title}" to ${audience}`)
      const id = (run as unknown as { meta?: { last_row_id?: number } }).meta?.last_row_id ?? null
      return json({ ok: true, id }, 201)
    }
    if (path === '/api/admin/announcements' && req.method === 'DELETE') {
      const id = url.searchParams.get('id')
      if (!id) return json({ error: 'id required' }, 400)
      await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(Number(id)).run()
      await bumpSync(env)
      await audit(env, authed, 'announcement.delete', `announcement id ${id} deleted`)
      return json({ ok: true })
    }

    // ---- Maintenance Mode ----
    // GET returns the current state; POST sets it. Scope 'all' shows a
    // full maintenance screen in the wallet, scope 'wallet' shows a banner
    // and blocks on-chain actions while still allowing browsing. Either
    // scope blocks signing. The admin portal itself is never blocked by
    // this flag, so maintenance can always be switched off from here.
    if (path === '/api/admin/maintenance' && req.method === 'GET') {
      return json({ maintenance: await getMaintenanceState(env) })
    }
    if (path === '/api/admin/maintenance' && req.method === 'POST') {
      const body = await readJson(req)
      const enabled = body.enabled === true
      const message = String(body.message ?? '').trim()
      const scope = String(body.scope ?? 'wallet')
      if (!['all', 'wallet'].includes(scope)) return json({ error: "scope must be 'all' or 'wallet'" }, 400)
      if (message.length > 500) return json({ error: 'message must be 500 characters or fewer' }, 400)
      if (enabled && message === '') return json({ error: 'message is required while maintenance is on — the wallet shows it to users' }, 400)
      const existing = await env.DB.prepare('SELECT id FROM maintenance WHERE id = 1').first<{ id: number }>()
      if (existing) {
        await env.DB.prepare("UPDATE maintenance SET enabled = ?, message = ?, scope = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").bind(enabled ? 1 : 0, message, scope, authed, 1).run()
      } else {
        await env.DB.prepare('INSERT INTO maintenance (id, enabled, message, scope, updated_by) VALUES (?, ?, ?, ?, ?)').bind(1, enabled ? 1 : 0, message, scope, authed).run()
      }
      await bumpSync(env)
      await audit(env, authed, enabled ? 'maintenance.on' : 'maintenance.off', enabled ? `Maintenance ON (${scope}): "${message}"` : 'Maintenance OFF')
      return json({ ok: true, maintenance: await getMaintenanceState(env) })
    }

    // ---- Network mode (Testnet / Mainnet switch) ----
    // Global mode the wallet follows in real time via /api/sync. null =
    // never set: the wallet shows all networks, as before. Flipping the
    // mode does NOT deploy a vault, does NOT bypass the mainnet gate, and
    // does NOT make locks/swaps go live on mainnet — a mainnet chain with
    // no vault still refuses honestly in the wallet.
    if (path === '/api/admin/network-mode' && req.method === 'GET') {
      return json({ networkMode: await getNetworkMode(env) })
    }
    if (path === '/api/admin/network-mode' && req.method === 'POST') {
      const body = await readJson(req)
      const mode = body.mode === null || body.mode === undefined ? null : String(body.mode)
      if (mode !== null && mode !== 'testnet' && mode !== 'mainnet') {
        return json({ error: "mode must be 'testnet', 'mainnet' or null (all networks)" }, 400)
      }
      const existing = await env.DB.prepare('SELECT id FROM network_mode WHERE id = 1').first<{ id: number }>()
      if (existing) {
        await env.DB.prepare("UPDATE network_mode SET mode = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?").bind(mode, authed, 1).run()
      } else {
        await env.DB.prepare('INSERT INTO network_mode (id, mode, updated_by) VALUES (?, ?, ?)').bind(1, mode, authed).run()
      }
      await bumpSync(env)
      await audit(env, authed, 'network_mode.set', mode === null ? 'Network mode cleared — wallet shows all networks' : `Network mode set to ${mode} — wallet follows on next sync`)
      return json({ ok: true, networkMode: await getNetworkMode(env) })
    }

    // ---- App Config and Releases (HMAC-signed) ----
    if (path === '/api/admin/config' && req.method === 'GET') {
      const row = await env.DB.prepare('SELECT * FROM config_versions ORDER BY id DESC LIMIT 1').first<{
        version: string
        payload_json: string
        signature: string | null
        published_by: string
        created_at: string
      }>()
      if (!row) return json({ config: null, note: 'No signed config published yet.' })
      let payload: unknown = null
      try { payload = JSON.parse(row.payload_json) } catch { payload = null }
      return json({ config: { version: row.version, payload, signature: row.signature, publishedBy: row.published_by, publishedAt: row.created_at } })
    }
    if (path === '/api/admin/config' && req.method === 'POST') {
      if (!env.CONFIG_SIGNING_SECRET) {
        return json({ error: 'CONFIG_SIGNING_SECRET is not set. Set it with: wrangler pages secret put CONFIG_SIGNING_SECRET --project-name stelix-admin. Config is never published unsigned.' }, 503)
      }
      const body = await readJson(req)
      const minAppVersion = String(body.minAppVersion ?? '').trim()
      const forceUpgrade = body.forceUpgrade === true
      const flags = (body.flags ?? {}) as Record<string, unknown>
      if (!/^\d+\.\d+\.\d+$/.test(minAppVersion)) return json({ error: 'minAppVersion must look like 2.0.0' }, 400)
      const feeRow = await env.DB.prepare('SELECT version FROM fee_versions ORDER BY version DESC LIMIT 1').first<{ version: number }>()
      const chains = await getChains(env)
      const payload = {
        minAppVersion,
        forceUpgrade,
        flags: {
          bullLockAutoSell: flags.bullLockAutoSell !== false,
          trailingStop: flags.trailingStop !== false,
          yieldWhileLocked: flags.yieldWhileLocked === true,
          groupLocks: flags.groupLocks === true,
        },
        feeVersion: feeRow?.version ?? null,
        chains: chains.map((c) => ({
          id: c.id, name: c.name, chainId: c.chain_id, status: c.status, isDefault: c.is_default === 1,
          vaultAddress: c.vault_address, stablecoin: c.stablecoin, stablecoinAddress: c.stablecoin_address,
          dexRouter: c.dex_router, explorerUrl: c.explorer_url,
          active: (c.active ?? 1) === 1, isTestnet: (c.is_testnet ?? (c.status === 'testnet' ? 1 : 0)) === 1,
          nativeToken: c.native_token, nativeDecimals: c.native_decimals ?? 18,
          stablecoinDecimals: c.stablecoin_decimals ?? 6, gasToken: c.gas_token ?? c.native_token,
          rpcUrls: c.rpc_urls ? c.rpc_urls.split(',').map((s) => s.trim()).filter(Boolean) : [],
          pairedChainId: c.paired_chain_id ?? null,
        })),
        publishedAt: new Date().toISOString(),
      }
      const payloadJson = JSON.stringify(payload)
      const signature = b64url(await hmac(env.CONFIG_SIGNING_SECRET, payloadJson))
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM config_versions').first<{ n: number }>()
      const version = `v${(count?.n ?? 0) + 1}`
      await env.DB.prepare('INSERT INTO config_versions (version, payload_json, signature, published_by) VALUES (?, ?, ?, ?)').bind(version, payloadJson, signature, authed).run()
      await bumpSync(env)
      await audit(env, authed, 'config.publish', `signed config ${version} published (min app ${minAppVersion})`)
      return json({ ok: true, version, payload, signature }, 201)
    }

    // ---- Locks (read-only; written by the keeper indexer) ----
    if (path === '/api/admin/locks' && req.method === 'GET') {
      const owner = url.searchParams.get('owner')
      const chainFilter = url.searchParams.get('chain')
      let sql = 'SELECT * FROM locks'
      const clauses: string[] = []
      const values: unknown[] = []
      if (owner) { clauses.push('owner = ?'); values.push(owner) }
      if (chainFilter) { clauses.push('chain_id = ?'); values.push(chainFilter) }
      if (clauses.length > 0) sql += ' WHERE ' + clauses.join(' AND ')
      sql += ' ORDER BY created_at DESC, id DESC LIMIT 100'
      const { results } = await env.DB.prepare(sql).bind(...values).all()
      return json({ locks: results ?? [] })
    }

    // ---- Launchpad Manager (free launches: gas only, no Stelix fee) ----
    // Launches are recorded here only after they exist on-chain
    // (StelixLaunchpad.createLaunch on Arc testnet). approval_status is the
    // admin's listing decision; the public feed lists approved launches only.
    // Liquidity: liquidity_manager stays null until a liquidity-manager
    // contract is set on-chain (pending Arc DEX confirmation) — the admin
    // must never present a launch as "liquidity locked on a DEX" before then.
    const launchIdMatch = /^\/api\/admin\/launches\/(\d+)(\/contributions)?$/.exec(path)
    const isDigits = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v)
    if (path === '/api/admin/launches' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM launches ORDER BY created_at DESC, id DESC LIMIT 100').all()
      const arc = await env.DB.prepare('SELECT * FROM chains WHERE id = ?').bind('arc').first<ChainRow & { launchpad_address?: string | null; token_factory_address?: string | null }>()
      return json({
        launches: results ?? [],
        launchpadAddress: arc?.launchpad_address ?? null,
        factoryAddress: arc?.token_factory_address ?? null,
        liquidityManager: null,
        note: (arc?.launchpad_address ?? null)
          ? 'Launchpad contracts are registered. Liquidity lock is pending Arc DEX confirmation until a liquidity manager is set.'
          : 'Launchpad contracts are not deployed on Arc testnet yet — launches go live once they are deployed.',
      })
    }
    if (path === '/api/admin/launches' && req.method === 'POST') {
      const body = await readJson(req)
      const chainId = String(body.chainId ?? body.chain_id ?? 'arc')
      const seller = String(body.seller ?? '').trim()
      const tokenAddress = String(body.tokenAddress ?? body.token_address ?? '').trim()
      const tokenSymbol = String(body.tokenSymbol ?? body.token_symbol ?? '').trim().toUpperCase()
      const tokenName = String(body.tokenName ?? body.token_name ?? '').trim()
      const tokenDecimals = Number(body.tokenDecimals ?? body.token_decimals ?? 18)
      const logoUrl = body.logoUrl ? String(body.logoUrl) : null
      const pricePerToken = String(body.pricePerToken ?? body.price_per_token ?? '')
      const softCap = String(body.softCap ?? body.soft_cap ?? '')
      const hardCap = String(body.hardCap ?? body.hard_cap ?? '')
      const tokensForSale = String(body.tokensForSale ?? body.tokens_for_sale ?? '')
      const startTime = Number(body.startTime ?? body.start_time ?? NaN)
      const endTime = Number(body.endTime ?? body.end_time ?? NaN)
      const liquidityLockBps = Number(body.liquidityLockBps ?? body.liquidity_lock_bps ?? 0)
      const saleId = body.saleId === undefined || body.saleId === null ? null : Number(body.saleId)
      const txHash = body.txHash ? String(body.txHash) : null
      if (!isAddress(seller)) return json({ error: 'seller must be a valid 0x address' }, 400)
      if (!isAddress(tokenAddress)) return json({ error: 'tokenAddress must be a valid 0x address' }, 400)
      if (!tokenSymbol) return json({ error: 'tokenSymbol is required' }, 400)
      if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 18) return json({ error: 'tokenDecimals must be 0–18' }, 400)
      if (logoUrl && !/^https?:\/\//.test(logoUrl)) return json({ error: 'logoUrl must be an http(s) URL' }, 400)
      if (!isDigits(pricePerToken) || BigInt(pricePerToken) <= 0n) return json({ error: 'pricePerToken must be micro-USDC per whole token, greater than 0' }, 400)
      if (!isDigits(softCap) || BigInt(softCap) <= 0n) return json({ error: 'softCap must be micro-USDC, greater than 0' }, 400)
      if (!isDigits(hardCap) || BigInt(hardCap) < BigInt(softCap)) return json({ error: 'hardCap must be micro-USDC, at least the soft cap' }, 400)
      if (!isDigits(tokensForSale) || BigInt(tokensForSale) <= 0n) return json({ error: 'tokensForSale must be token smallest units, greater than 0' }, 400)
      if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) return json({ error: 'startTime must be before endTime (epoch seconds)' }, 400)
      if (!Number.isInteger(liquidityLockBps) || liquidityLockBps < 0 || liquidityLockBps > 5000) return json({ error: 'liquidityLockBps must be 0–5000 (max 50%)' }, 400)
      if (saleId !== null && (!Number.isInteger(saleId) || saleId < 0)) return json({ error: 'saleId must be a non-negative integer' }, 400)
      const chain = await env.DB.prepare('SELECT * FROM chains WHERE id = ?').bind(chainId).first()
      if (!chain) return json({ error: 'chain not found in Chain Manager' }, 400)
      const run = await env.DB.prepare(
        'INSERT INTO launches (sale_id, chain_id, seller, token_address, token_symbol, token_name, token_decimals, logo_url, price_per_token, soft_cap, hard_cap, raised, tokens_sold, contributors, start_time, end_time, liquidity_lock_bps, tokens_for_sale, status, finalized, approval_status, liquidity_manager, liquidity_released, tx_hash, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        saleId, chainId, seller, tokenAddress, tokenSymbol, tokenName, tokenDecimals, logoUrl,
        pricePerToken, softCap, hardCap, '0', '0', 0, startTime, endTime, liquidityLockBps,
        tokensForSale, 'Active', 0, 'pending', null, 0, txHash, authed,
      ).run()
      const id = (run as unknown as { meta?: { last_row_id?: number } }).meta?.last_row_id ?? null
      await audit(env, authed, 'launchpad.register', `Launch recorded: ${tokenSymbol} on ${chainId} (sale ${saleId ?? 'unconfirmed'}), pending approval`)
      return json({ ok: true, id }, 201)
    }
    if (launchIdMatch && req.method === 'PATCH' && !launchIdMatch[2]) {
      const body = await readJson(req)
      const id = Number(launchIdMatch[1])
      const row = await env.DB.prepare('SELECT * FROM launches WHERE id = ?').bind(id).first()
      if (!row) return json({ error: 'launch not found' }, 404)
      const sets: string[] = []
      const values: unknown[] = []
      const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); values.push(v) }
      if (body.approvalStatus !== undefined || body.approval_status !== undefined) {
        const approval = String(body.approvalStatus ?? body.approval_status)
        if (!['pending', 'approved', 'rejected'].includes(approval)) return json({ error: 'approvalStatus must be pending, approved or rejected' }, 400)
        set('approval_status', approval)
      }
      if (body.status !== undefined) {
        if (!['Active', 'Success', 'Failed'].includes(String(body.status))) return json({ error: 'status must be Active, Success or Failed' }, 400)
        set('status', String(body.status))
      }
      if (body.raised !== undefined) {
        if (!isDigits(String(body.raised))) return json({ error: 'raised must be micro-USDC digits' }, 400)
        set('raised', String(body.raised))
      }
      if (body.tokensSold !== undefined) {
        if (!isDigits(String(body.tokensSold))) return json({ error: 'tokensSold must be token smallest units' }, 400)
        set('tokens_sold', String(body.tokensSold))
      }
      if (body.contributors !== undefined) {
        if (!Number.isInteger(Number(body.contributors)) || Number(body.contributors) < 0) return json({ error: 'contributors must be a non-negative integer' }, 400)
        set('contributors', Number(body.contributors))
      }
      if (body.finalized !== undefined) set('finalized', body.finalized === true || body.finalized === 1 ? 1 : 0)
      if (body.liquidityReleased !== undefined) set('liquidity_released', body.liquidityReleased === true || body.liquidityReleased === 1 ? 1 : 0)
      if (body.liquidityManager !== undefined) {
        const m = body.liquidityManager === null ? null : String(body.liquidityManager)
        if (m !== null && !isAddress(m)) return json({ error: 'liquidityManager must be a valid 0x address or null' }, 400)
        set('liquidity_manager', m)
      }
      if (body.saleId !== undefined) {
        if (body.saleId !== null && (!Number.isInteger(Number(body.saleId)) || Number(body.saleId) < 0)) return json({ error: 'saleId must be a non-negative integer' }, 400)
        set('sale_id', body.saleId === null ? null : Number(body.saleId))
      }
      if (body.txHash !== undefined) set('tx_hash', body.txHash === null ? null : String(body.txHash))
      if (sets.length === 0) return json({ error: 'nothing to update' }, 400)
      await env.DB.prepare(`UPDATE launches SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...values, id).run()
      await audit(env, authed, 'launchpad.update', `Launch id ${id} updated (${sets.map((s) => s.split(' ')[0]).join(', ')})`)
      return json({ ok: true, id })
    }
    if (launchIdMatch && launchIdMatch[2] && req.method === 'GET') {
      const id = Number(launchIdMatch[1])
      const { results } = await env.DB.prepare('SELECT * FROM launch_contributions WHERE launch_id = ? ORDER BY created_at DESC, id DESC LIMIT 100').bind(id).all()
      return json({ contributions: results ?? [] })
    }
    if (launchIdMatch && launchIdMatch[2] && req.method === 'POST') {
      const id = Number(launchIdMatch[1])
      const row = await env.DB.prepare('SELECT * FROM launches WHERE id = ?').bind(id).first()
      if (!row) return json({ error: 'launch not found' }, 404)
      const body = await readJson(req)
      const contributor = String(body.contributor ?? '').trim()
      const amount = String(body.amount ?? '')
      const txHash = body.txHash ? String(body.txHash) : null
      if (!isAddress(contributor)) return json({ error: 'contributor must be a valid 0x address' }, 400)
      if (!isDigits(amount) || BigInt(amount) <= 0n) return json({ error: 'amount must be micro-USDC, greater than 0' }, 400)
      const run = await env.DB.prepare(
        'INSERT INTO launch_contributions (launch_id, contributor, amount, tx_hash) VALUES (?, ?, ?, ?)',
      ).bind(id, contributor, amount, txHash).run()
      const cid = (run as unknown as { meta?: { last_row_id?: number } }).meta?.last_row_id ?? null
      await audit(env, authed, 'launchpad.contribution', `Contribution ${amount} micro-USDC recorded for launch id ${id}`)
      return json({ ok: true, id: cid }, 201)
    }

    // ---- Support Lookup (public on-chain state only; never seed phrases) ----
    if (path === '/api/support' && req.method === 'GET') {
      const q = (url.searchParams.get('q') ?? '').trim()
      if (!q) return json({ error: 'q (wallet, lock ID or tx hash) required' }, 400)
      if (q.split(/\s+/).length >= 11 || /seed phrase|mnemonic|private key/i.test(q)) {
        return json({ error: 'Never enter a seed phrase, mnemonic or private key here. Support can only look up public on-chain state.' }, 400)
      }
      const chains = await getChains(env)
      // Transaction hash (regex test, not the isTxHash type guard: q is
      // already a string, so the guard would narrow it to never below).
      if (/^0x[0-9a-fA-F]{64}$/.test(q)) {
        for (const chain of chains) {
          const rpcUrl = (chain.rpc_urls.split(',')[0] ?? '').trim()
          if (!rpcUrl) continue
          try {
            const [tx, receipt] = await Promise.all([
              rpcCall(rpcUrl, 'eth_getTransactionByHash', [q]),
              rpcCall(rpcUrl, 'eth_getTransactionReceipt', [q]),
            ])
            if (tx) {
              const t = tx as { from?: string; to?: string | null; value?: string; blockNumber?: string }
              const r = receipt as { status?: string; blockNumber?: string; gasUsed?: string } | null
              return json({
                found: true, type: 'transaction', chain: chain.name, chainId: chain.id,
                result: {
                  hash: q, from: t.from ?? null, to: t.to ?? null,
                  valueWei: t.value ? hexToBigInt(t.value).toString() : null,
                  blockNumber: r?.blockNumber ? Number(hexToBigInt(r.blockNumber)) : t.blockNumber ? Number(hexToBigInt(t.blockNumber)) : null,
                  status: r ? (r.status === '0x1' ? 'success' : 'failed') : 'pending',
                  explorerUrl: `${chain.explorer_url.replace(/\/$/, '')}/tx/${q}`,
                },
              })
            }
          } catch {
            // Try the next chain.
          }
        }
        return json({ found: false, type: 'transaction', query: q, note: 'No transaction with this hash was found on any configured chain.' })
      }
      // Wallet address (regex test, not the isAddress type guard, for the
      // same narrowing reason as above).
      if (/^0x[0-9a-fA-F]{40}$/.test(q)) {
        const { results: d1Locks } = await env.DB.prepare('SELECT * FROM locks WHERE owner = ? ORDER BY created_at DESC LIMIT 50').bind(q.toLowerCase()).all()
        const onChainLocks: { chain: string; lockId: string; owner: string; token: string; amountRemaining: string; status: string; unlockTime: string }[] = []
        const balances: { chain: string; balanceRaw: string }[] = []
        for (const chain of chains) {
          const rpcUrl = (chain.rpc_urls.split(',')[0] ?? '').trim()
          if (!rpcUrl) continue
          try {
            const bal = await rpcCall(rpcUrl, 'eth_getBalance', [q, 'latest'])
            if (typeof bal === 'string') balances.push({ chain: chain.name, balanceRaw: hexToBigInt(bal).toString() })
          } catch { /* balance unavailable for this chain */ }
          if (!chain.vault_address) continue
          try {
            const raw = await ethCall(rpcUrl, chain.vault_address, '0x23a35de9' + pad32(q))
            for (const id of decodeUintArray(raw)) {
              try {
                const lockRaw = await ethCall(rpcUrl, chain.vault_address, '0xd68f4dd1' + '0'.repeat(64 - id.toString(16).length) + id.toString(16))
                const decoded = decodeGetLock(lockRaw)
                if (decoded) {
                  onChainLocks.push({
                    chain: chain.name, lockId: id.toString(), owner: decoded.owner, token: decoded.token,
                    amountRemaining: decoded.amountRemaining, status: decoded.status,
                    unlockTime: new Date(decoded.unlockTime * 1000).toISOString(),
                  })
                }
              } catch { /* lock read failed; skip */ }
            }
          } catch { /* vault read failed; skip */ }
        }
        return json({
          found: (d1Locks?.length ?? 0) > 0 || onChainLocks.length > 0 || balances.length > 0,
          type: 'wallet', query: q,
          result: { d1Locks: d1Locks ?? [], onChainLocks, balances },
        })
      }
      // Lock ID: numeric (on-chain lock id) or LK-… (D1 id)
      const numericId = /^\d+$/.test(q) ? BigInt(q) : null
      const { results: d1ById } = await env.DB.prepare('SELECT * FROM locks WHERE id = ? LIMIT 1').bind(q).all()
      if (d1ById && d1ById.length > 0) {
        return json({ found: true, type: 'lock', query: q, result: { source: 'D1', lock: d1ById[0] } })
      }
      if (numericId !== null) {
        for (const chain of chains) {
          if (!chain.vault_address) continue
          const rpcUrl = (chain.rpc_urls.split(',')[0] ?? '').trim()
          if (!rpcUrl) continue
          try {
            const lockRaw = await ethCall(rpcUrl, chain.vault_address, '0xd68f4dd1' + '0'.repeat(64 - numericId.toString(16).length) + numericId.toString(16))
            const decoded = decodeGetLock(lockRaw)
            if (decoded && decoded.owner !== '0x0000000000000000000000000000000000000000') {
              return json({
                found: true, type: 'lock', query: q,
                result: {
                  source: 'on-chain', chain: chain.name, chainId: chain.id, vault: chain.vault_address,
                  lockId: q, owner: decoded.owner, token: decoded.token, amountRemaining: decoded.amountRemaining,
                  amountTotal: decoded.amountTotal, entryPriceUsd: decoded.entryPrice,
                  unlockTime: new Date(decoded.unlockTime * 1000).toISOString(), stablecoin: decoded.stablecoin,
                  status: decoded.status, explorerUrl: `${chain.explorer_url.replace(/\/$/, '')}/address/${chain.vault_address}`,
                },
              })
            }
          } catch { /* not on this chain */ }
        }
      }
      return json({ found: false, type: 'lock', query: q, note: 'No lock with this ID was found in D1 or on any deployed vault.' })
    }

    // ---- Keeper ----
    if (path === '/api/keeper/runs' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM keeper_runs ORDER BY started_at DESC LIMIT 50').all()
      return json({ runs: results ?? [] })
    }
    if (path === '/api/admin/keeper/status' && req.method === 'GET') {
      const state = await env.DB.prepare('SELECT * FROM keeper_state WHERE id = 1').first<{
        paused: number
        keeper_address: string | null
        updated_at: string
      }>()
      const lastRun = await env.DB.prepare('SELECT * FROM keeper_runs ORDER BY started_at DESC LIMIT 1').first<{
        started_at: string
        status: string
        failed: number
      }>()
      const failed24h = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM keeper_runs WHERE status = 'failed' AND datetime(started_at) > datetime('now', '-24 hours')",
      ).first<{ n: number }>()
      const balances: { chain: string; balanceRaw: string; balance: string }[] = []
      if (state?.keeper_address) {
        for (const chain of await getChains(env)) {
          const rpcUrl = (chain.rpc_urls.split(',')[0] ?? '').trim()
          if (!rpcUrl) continue
          try {
            const bal = await rpcCall(rpcUrl, 'eth_getBalance', [state.keeper_address, 'latest'])
            if (typeof bal === 'string') {
              const raw = hexToBigInt(bal)
              const decimals = chain.id === 'arc' ? 6 : 18
              balances.push({ chain: chain.name, balanceRaw: raw.toString(), balance: (Number(raw) / 10 ** decimals).toString() })
            }
          } catch { /* skip */ }
        }
      }
      return json({
        paused: (state?.paused ?? 0) === 1,
        keeperAddress: state?.keeper_address ?? null,
        updatedAt: state?.updated_at ?? null,
        keeperLive: Boolean(env.KEEPER_WORKER_URL),
        keeperWorkerUrl: env.KEEPER_WORKER_URL ? 'configured' : null,
        lastRun: lastRun ?? null,
        failedRuns24h: failed24h?.n ?? 0,
        balances,
      })
    }
    if (path === '/api/admin/keeper/pause' && req.method === 'POST') {
      const body = await readJson(req)
      const paused = body.paused === true ? 1 : 0
      const keeperAddress = body.keeperAddress ? String(body.keeperAddress) : null
      if (keeperAddress !== null && !isAddress(keeperAddress)) return json({ error: 'keeperAddress must be a valid 0x address' }, 400)
      await env.DB.prepare(
        "INSERT INTO keeper_state (id, paused, keeper_address, updated_by, updated_at) VALUES (1, ?, ?, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET paused = excluded.paused, keeper_address = COALESCE(excluded.keeper_address, keeper_address), updated_by = excluded.updated_by, updated_at = excluded.updated_at",
      ).bind(paused, keeperAddress, authed).run()
      await audit(env, authed, paused ? 'keeper.pause' : 'keeper.resume', paused ? 'Keeper paused by admin' : 'Keeper resumed by admin')
      return json({ ok: true, paused: paused === 1 })
    }
    if (path === '/api/admin/keeper/run-now' && req.method === 'POST') {
      const state = await env.DB.prepare('SELECT paused FROM keeper_state WHERE id = 1').first<{ paused: number }>()
      if ((state?.paused ?? 0) === 1) return json({ error: 'Keeper is paused. Resume it before running now.', live: false }, 409)
      if (!env.KEEPER_WORKER_URL) {
        return json({ ok: false, live: false, message: 'Keeper worker is not live yet — no KEEPER_WORKER_URL is configured. No run was started and nothing was recorded.' }, 503)
      }
      if (!env.KEEPER_RUN_KEY) {
        return json({ ok: false, live: false, message: 'Keeper worker URL is set but KEEPER_RUN_KEY is not configured. Set the secret before Run Now can trigger the keeper.' }, 503)
      }
      try {
        const r = await fetchWithTimeout(`${env.KEEPER_WORKER_URL.replace(/\/$/, '')}/run`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-stelix-keeper-key': env.KEEPER_RUN_KEY },
          body: JSON.stringify({ trigger: 'admin-run-now', by: authed }),
        }, 30000)
        const body = (await r.json().catch(() => ({}))) as Record<string, unknown>
        if (!r.ok) return json({ ok: false, live: true, message: `Keeper worker returned HTTP ${r.status}.`, detail: body }, 502)
        await audit(env, authed, 'keeper.run_now', 'Manual keeper run triggered from admin')
        return json({ ok: true, live: true, keeper: body })
      } catch {
        return json({ ok: false, live: true, message: 'Keeper worker did not respond. No run was recorded.' }, 502)
      }
    }

    // ---- Contract Studio: compile / deploy / verify / register ----
    if (path === '/api/admin/compile' && req.method === 'POST') {
      const body = await readJson(req)
      const source = String(body.source ?? '')
      if (!source || !source.includes('contract StelixVault')) {
        return json({ error: 'source must contain the StelixVault contract' }, 400)
      }
      const sourceHash = await sha256Hex(source)
      const matchesArtifact = sourceHash === ARTIFACT_SOURCE_HASH
      const warnings: string[] = []
      if (!matchesArtifact) {
        warnings.push('Source differs from the compiled artifact (solc 0.8.24, scripts/compile.mjs). Run `npm run compile:contract` in apps/admin to rebuild the artifact before deploying.')
      }
      const job = {
        sourceHash,
        compiler: `solc ${SOLC_PINNED}`,
        bytecodeHash: matchesArtifact ? ARTIFACT_BYTECODE_HASH : null,
        deployedBytes: matchesArtifact ? (artifact as { deployedBytes: number }).deployedBytes : null,
        withinSizeLimit: matchesArtifact ? ((artifact as { deployedBytes: number }).deployedBytes <= 24576 ? 1 : 0) : 0,
        warnings,
        status: matchesArtifact ? 'ok' : 'source-differs-from-artifact',
        matchesArtifact,
      }
      await env.DB.prepare(
        'INSERT INTO compile_jobs (source_hash, compiler_version, bytecode_hash, deployed_bytes, within_size_limit, warnings_json, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(job.sourceHash, job.compiler, job.bytecodeHash, job.deployedBytes, job.withinSizeLimit, JSON.stringify(warnings), job.status, authed).run()
      await audit(env, authed, 'studio.compile', `StelixVault compiled with solc ${SOLC_PINNED} — ${job.status}`)
      return json({ ok: true, ...job })
    }
    if (path === '/api/admin/compile/latest' && req.method === 'GET') {
      const row = await env.DB.prepare('SELECT * FROM compile_jobs ORDER BY id DESC LIMIT 1').first()
      return json({ job: row ?? null, artifactSourceHash: ARTIFACT_SOURCE_HASH, artifactBytecodeHash: ARTIFACT_BYTECODE_HASH })
    }
    if (path === '/api/admin/deploy/prepare' && req.method === 'POST') {
      const body = await readJson(req)
      const { params, errors } = validateDeployParams(body)
      if (!params) return json({ error: 'invalid deploy parameters', details: errors }, 400)
      const chain = await env.DB.prepare('SELECT * FROM chains WHERE id = ?').bind(params.chainId).first<ChainRow>()
      if (!chain) return json({ error: 'chain not found in Chain Manager' }, 400)
      if (params.env === 'mainnet') {
        const gate = await mainnetGate(env, params.chainId)
        if (!gate.pass) return json({ error: 'Mainnet gate not passed', reasons: gate.reasons }, 403)
        if (String(body.confirmation ?? '') !== mainnetConfirmPhrase(chain.name)) {
          return json({ error: `Typed confirmation must read exactly: ${mainnetConfirmPhrase(chain.name)}` }, 403)
        }
      }
      const sourceHash = String(body.sourceHash ?? '')
      if (sourceHash && sourceHash !== ARTIFACT_SOURCE_HASH) {
        return json({ error: 'Source hash does not match the compiled artifact. Recompile with `npm run compile:contract` first.' }, 400)
      }
      const rpcUrl = (chain.rpc_urls.split(',')[0] ?? '').trim()
      const deployNote = params.env === 'mainnet'
        ? 'The deploy itself is broadcast by the Foundry deployer flow with a mainnet deployer key (never stored here). After it confirms, register the address with POST /api/admin/deploy/register — the Worker verifies on-chain code and explorer source status before writing anything to D1.'
        : 'The deploy itself is broadcast by the Foundry deployer flow with a testnet-only key (never stored here). After it confirms, register the address with POST /api/admin/deploy/register — the Worker verifies on-chain code and explorer source status before writing anything to D1.'
      return json({
        ok: true,
        chain: chain.name,
        env: params.env,
        params,
        deployCommand: [
          'cd contracts',
          `CHAIN=${params.chainId} OWNER=${params.owner} KEEPER=${params.keeper} ROUTER=${params.router} PRICE_FEED=${params.priceFeed} PENALTY_RECIPIENT=${params.penaltyRecipient} FEE_RECIPIENT=${params.feeRecipient} FEE_BPS=${params.autoSellFeeBps}`,
          'forge script script/DeployStelixVault.s.sol --rpc-url $RPC_URL --broadcast',
        ].join(' '),
        note: deployNote,
        rpcUrl,
      })
    }
    if (path === '/api/admin/deploy/verify' && req.method === 'POST') {
      const body = await readJson(req)
      const chainId = String(body.chainId ?? '')
      const address = String(body.address ?? '')
      if (!chainId || !isAddress(address)) return json({ error: 'chainId and a valid contract address are required' }, 400)
      const chain = await env.DB.prepare('SELECT * FROM chains WHERE id = ?').bind(chainId).first<ChainRow>()
      if (!chain) return json({ error: 'chain not found' }, 404)
      const rpcUrl = (chain.rpc_urls.split(',')[0] ?? '').trim()
      let code = '0x'
      try {
        const result = await rpcCall(rpcUrl, 'eth_getCode', [address, 'latest'])
        if (typeof result === 'string') code = result
      } catch {
        return json({ error: 'Chain RPC unreachable — could not verify contract code.' }, 502)
      }
      const codePresent = code !== '0x' && code !== '0x0' && !/^0x0+$/.test(code) && code.length > 2
      const explorer = await explorerSourceVerified(env, chain, address)
      return json({
        ok: true, chain: chain.name, address,
        codePresent,
        codeLength: code.length > 2 ? (code.length - 2) / 2 : 0,
        sourceVerified: explorer.sourceVerified,
        explorerChecked: explorer.checked,
        note: explorer.note,
        explorerUrl: `${chain.explorer_url.replace(/\/$/, '')}/address/${address}`,
      })
    }
    if (path === '/api/admin/deploy/register' && req.method === 'POST') {
      const body = await readJson(req)
      const { params, errors } = validateDeployParams(body)
      if (!params) return json({ error: 'invalid deploy parameters', details: errors }, 400)
      if (!params.address) return json({ error: 'address is required to register a deployment' }, 400)
      if (params.sourceHash !== ARTIFACT_SOURCE_HASH) {
        return json({ error: 'sourceHash does not match the compiled artifact (solc 0.8.24). Only the exact compiled source can be registered.' }, 400)
      }
      const chain = await env.DB.prepare('SELECT * FROM chains WHERE id = ?').bind(params.chainId).first<ChainRow>()
      if (!chain) return json({ error: 'chain not found in Chain Manager' }, 404)
      if (params.env === 'mainnet') {
        const gate = await mainnetGate(env, params.chainId)
        if (!gate.pass) return json({ error: 'Mainnet gate not passed', reasons: gate.reasons }, 403)
        if (String(body.confirmation ?? '') !== mainnetConfirmPhrase(chain.name)) {
          return json({ error: `Typed confirmation must read exactly: ${mainnetConfirmPhrase(chain.name)}` }, 403)
        }
      }
      const rpcUrl = (chain.rpc_urls.split(',')[0] ?? '').trim()
      let code = '0x'
      try {
        const result = await rpcCall(rpcUrl, 'eth_getCode', [params.address, 'latest'])
        if (typeof result === 'string') code = result
      } catch {
        return json({ error: 'Chain RPC unreachable — the address could not be verified on-chain.' }, 502)
      }
      if (code === '0x' || code === '0x0' || /^0x0+$/.test(code) || code.length <= 2) {
        return json({ error: 'No contract code exists at this address on this chain. Check the chain and address.' }, 400)
      }
      const explorer = await explorerSourceVerified(env, chain, params.address)
      const verificationStatus = explorer.sourceVerified ? 'verified' : 'code-verified'
      await env.DB.prepare(
        'INSERT INTO deployments (chain_id, address, tx_hash, compiler_version, bytecode_hash, artifact_hash, parameters_json, verification_status, env) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(params.chainId, params.address, params.txHash ?? null, `solc ${SOLC_PINNED}`, ARTIFACT_BYTECODE_HASH, params.sourceHash, JSON.stringify(params), verificationStatus, params.env).run()
      await env.DB.prepare('UPDATE chains SET vault_address = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(params.address, params.chainId).run()
      // A registered vault changes what the wallet reads for this chain.
      await bumpSync(env)
      await audit(env, authed, 'studio.deploy_register', `StelixVault ${params.env} registered on ${chain.name} at ${params.address} (${verificationStatus})`)
      return json({
        ok: true, chain: chain.name, address: params.address, verificationStatus,
        note: explorer.note,
        explorerUrl: `${chain.explorer_url.replace(/\/$/, '')}/address/${params.address}`,
      }, 201)
    }
    if (path === '/api/admin/deployments' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM deployments ORDER BY created_at DESC, id DESC LIMIT 50').all()
      return json({ deployments: results ?? [] })
    }
    if (path === '/api/admin/deploy/gate/attest' && req.method === 'POST') {
      const body = await readJson(req)
      const chainId = String(body.chainId ?? '')
      const kind = String(body.kind ?? '')
      const note = String(body.note ?? '')
      if (!chainId || kind !== 'smoke') return json({ error: 'chainId and kind=smoke are required' }, 400)
      const chain = await env.DB.prepare('SELECT id FROM chains WHERE id = ?').bind(chainId).first()
      if (!chain) return json({ error: 'chain not found' }, 404)
      await env.DB.prepare('INSERT INTO gate_attestations (chain_id, kind, attested_by, note) VALUES (?, ?, ?, ?)').bind(chainId, kind, authed, note).run()
      await audit(env, authed, 'studio.gate_attest', `Small-value smoke-test attestation recorded for ${chainId}: ${note}`)
      return json({ ok: true }, 201)
    }

    // ---- Contract Audit (automated static audit + independent audits) ----
    if (path === '/api/admin/audit/run' && req.method === 'POST') {
      const body = await readJson(req)
      const source = String(body.source ?? '')
      if (!source || !source.includes('contract StelixVault')) {
        return json({ error: 'source must contain the StelixVault contract' }, 400)
      }
      const result = runStaticAudit(source)
      result.sourceHash = await sha256Hex(source)
      const run = await env.DB.prepare(
        'INSERT INTO audit_runs (source_hash, compiler, verdict, counts_json, findings_json, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(result.sourceHash, result.compiler, result.verdict, JSON.stringify(result.counts), JSON.stringify(result.findings), authed).run()
      const id = (run as unknown as { meta?: { last_row_id?: number } }).meta?.last_row_id ?? null
      await audit(env, authed, 'contract_audit.run', `Automated audit run ${id ?? ''}: verdict ${result.verdict}, ${result.openCriticalHigh} open critical/high`)
      return json({ ok: true, runId: id, ...result }, 201)
    }
    if (path === '/api/admin/audit/runs' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM audit_runs ORDER BY id DESC LIMIT 20').all()
      return json({ runs: results ?? [] })
    }
    const auditRunMatch = /^\/api\/admin\/audit\/runs\/(\d+)$/.exec(path)
    if (auditRunMatch && req.method === 'GET') {
      const row = await env.DB.prepare('SELECT * FROM audit_runs WHERE id = ?').bind(Number(auditRunMatch[1])).first()
      if (!row) return json({ error: 'audit run not found' }, 404)
      return json({ run: row })
    }
    if (auditRunMatch && req.method === 'PATCH') {
      const body = await readJson(req)
      const findingId = String(body.findingId ?? '')
      const status = String(body.status ?? '')
      if (!findingId || !['open', 'mitigated', 'accepted'].includes(status)) {
        return json({ error: 'findingId and status (open, mitigated or accepted) are required' }, 400)
      }
      const row = await env.DB.prepare('SELECT * FROM audit_runs WHERE id = ?').bind(Number(auditRunMatch[1])).first<{
        findings_json: string
        verdict: string
      }>()
      if (!row) return json({ error: 'audit run not found' }, 404)
      const findings = JSON.parse(row.findings_json) as AuditFinding[]
      const finding = findings.find((f) => f.id === findingId)
      if (!finding) return json({ error: 'finding not found in this run' }, 404)
      finding.status = status as AuditFinding['status']
      const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 } as Record<string, number>
      for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1
      const openCriticalHigh = findings.filter((f) => (f.severity === 'critical' || f.severity === 'high') && f.status === 'open').length
      const verdict = openCriticalHigh === 0 ? 'pass' : 'fail'
      await env.DB.prepare('UPDATE audit_runs SET verdict = ?, counts_json = ?, findings_json = ? WHERE id = ?').bind(verdict, JSON.stringify(counts), JSON.stringify(findings), Number(auditRunMatch[1])).run()
      await audit(env, authed, 'contract_audit.finding', `Finding ${findingId} in run ${auditRunMatch[1]} marked ${status}`)
      return json({ ok: true, verdict, openCriticalHigh, findings })
    }
    if (path === '/api/admin/audit/external' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM external_audits ORDER BY id DESC LIMIT 20').all()
      return json({ audits: results ?? [] })
    }
    if (path === '/api/admin/audit/external' && req.method === 'POST') {
      const body = await readJson(req)
      const auditor = String(body.auditor ?? '').trim()
      const auditDate = String(body.auditDate ?? body.audit_date ?? '').trim()
      const scope = String(body.scope ?? '').trim()
      const verdict = String(body.verdict ?? '')
      const reportUrl = body.reportUrl ? String(body.reportUrl) : null
      const reportRef = body.reportRef ? String(body.reportRef) : null
      if (!auditor || !auditDate || !scope) return json({ error: 'auditor, auditDate and scope are required' }, 400)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(auditDate)) return json({ error: 'auditDate must be YYYY-MM-DD' }, 400)
      if (!['pass', 'fail', 'passed-with-notes'].includes(verdict)) return json({ error: 'verdict must be pass, passed-with-notes or fail' }, 400)
      if (reportUrl && !/^https?:\/\//.test(reportUrl)) return json({ error: 'reportUrl must be an http(s) link' }, 400)
      if (!reportUrl && !reportRef) return json({ error: 'A report link or a stored report reference is required — do not record an audit without evidence.' }, 400)
      const run = await env.DB.prepare(
        'INSERT INTO external_audits (auditor, audit_date, scope, verdict, report_url, report_ref, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(auditor, auditDate, scope, verdict, reportUrl, reportRef, authed).run()
      const id = (run as unknown as { meta?: { last_row_id?: number } }).meta?.last_row_id ?? null
      await audit(env, authed, 'contract_audit.external', `Independent audit recorded: ${auditor}, ${auditDate}, verdict ${verdict}`)
      return json({ ok: true, id }, 201)
    }
    if (path === '/api/admin/audit/external' && req.method === 'DELETE') {
      const id = url.searchParams.get('id')
      if (!id) return json({ error: 'id required' }, 400)
      await env.DB.prepare('DELETE FROM external_audits WHERE id = ?').bind(Number(id)).run()
      await audit(env, authed, 'contract_audit.external_delete', `Independent audit record id ${id} deleted`)
      return json({ ok: true })
    }
    if (path === '/api/admin/audit/gate' && req.method === 'GET') {
      const latestRun = await env.DB.prepare('SELECT * FROM audit_runs ORDER BY id DESC LIMIT 1').first()
      const { results: externals } = await env.DB.prepare('SELECT * FROM external_audits ORDER BY id DESC LIMIT 10').all()
      let automatedPass = false
      let openCriticalHigh = 0
      if (latestRun) {
        try {
          const findings = JSON.parse((latestRun as { findings_json: string }).findings_json) as AuditFinding[]
          openCriticalHigh = findings.filter((f) => (f.severity === 'critical' || f.severity === 'high') && f.status === 'open').length
          automatedPass = (latestRun as { verdict: string }).verdict === 'pass' && openCriticalHigh === 0
        } catch { automatedPass = false }
      }
      const externalPass = (externals ?? []).some((e) => (e as { verdict: string }).verdict === 'pass')
      return json({
        automated: { latestRun: latestRun ?? null, pass: automatedPass, openCriticalHigh },
        external: { audits: externals ?? [], pass: externalPass },
        gatePass: automatedPass || externalPass,
        note: 'Automated audit is NOT a substitute for an independent human audit. Mainnet requires a passing automated audit OR a recorded passing independent audit, plus a verified testnet deployment and a smoke-test attestation.',
      })
    }

    // ---- Multisig creator (Safe protocol) ----
    // Prepare -> owners create the Safe in their own wallet (Safe web app /
    // Safe CLI / `cast safe create`) -> confirm. The Worker never deploys
    // a Safe and never holds a private key. A Safe address is recorded
    // only after on-chain verification: contract code present at the
    // address plus getThreshold() and getOwners() matching the prepared
    // set, read from the chain's own RPC. Only a deployed Safe can be
    // used as the StelixVault Owner in Contract Studio.
    const multisigIdMatch = /^\/api\/admin\/multisigs\/(\d+)(\/(predicted|confirm))?$/.exec(path)
    if (path === '/api/admin/multisigs' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM multisigs ORDER BY created_at DESC, id DESC LIMIT 100').all()
      return json({ multisigs: results ?? [] })
    }
    if (path === '/api/admin/multisigs' && req.method === 'POST') {
      const body = await readJson(req)
      const { multisig, errors } = validateMultisigInput(body)
      if (!multisig) return json({ error: 'invalid multisig', details: errors }, 400)
      // Chain-agnostic (2026-11-27): a multisig is prepared once, for all
      // EVM chains — no Chain Manager row is needed or checked. Its
      // chain_id is always 'evm' (see lib/multisig.ts).
      const run = await env.DB.prepare(
        'INSERT INTO multisigs (chain_id, label, owners_json, threshold, salt_nonce, status, predicted_address, safe_address, deploy_tx_hash, factory_address, singleton_address, safe_version, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        multisig.chainId, multisig.label, JSON.stringify(multisig.owners), multisig.threshold,
        multisig.saltNonce, 'prepared', multisig.predictedAddress, null, null,
        multisig.factoryAddress, multisig.singletonAddress, multisig.safeVersion, authed,
      ).run()
      const id = (run as unknown as { meta?: { last_row_id?: number } }).meta?.last_row_id ?? null
      await audit(env, authed, 'multisig.prepare', `Multisig prepared for all EVM chains: ${multisig.threshold}-of-${multisig.owners.length} (id ${id ?? ''}) — not deployed yet, no Safe address recorded`)
      return json({ ok: true, id }, 201)
    }
    if (multisigIdMatch && multisigIdMatch[2] === '/predicted' && req.method === 'POST') {
      const id = Number(multisigIdMatch[1])
      const row = await env.DB.prepare('SELECT * FROM multisigs WHERE id = ?').bind(id).first<{ status: string }>()
      if (!row) return json({ error: 'multisig not found' }, 404)
      if (row.status !== 'prepared') return json({ error: 'This multisig is already deployed — its Safe address is fixed and cannot be changed to a prediction.' }, 409)
      const body = await readJson(req)
      const predicted = String(body.predictedAddress ?? body.predicted_address ?? '').trim()
      if (!isAddress(predicted)) return json({ error: 'predictedAddress must be a valid 0x address (paste the address the Safe app shows before you deploy)' }, 400)
      await env.DB.prepare('UPDATE multisigs SET predicted_address = ? WHERE id = ?').bind(predicted.toLowerCase(), id).run()
      await audit(env, authed, 'multisig.predicted', `Multisig id ${id}: predicted Safe address ${predicted.toLowerCase()} recorded (not deployed yet — not usable as vault Owner)`)
      return json({ ok: true, id, predictedAddress: predicted.toLowerCase() })
    }
    if (multisigIdMatch && multisigIdMatch[2] === '/confirm' && req.method === 'POST') {
      const id = Number(multisigIdMatch[1])
      const row = await env.DB.prepare('SELECT * FROM multisigs WHERE id = ?').bind(id).first<{
        chain_id: string
        owners_json: string
        threshold: number
        status: string
      }>()
      if (!row) return json({ error: 'multisig not found' }, 404)
      if (row.status === 'deployed') return json({ error: 'This multisig is already deployed and recorded — it cannot be confirmed twice.' }, 409)
      const body = await readJson(req)
      const safeAddress = String(body.safeAddress ?? body.safe_address ?? '').trim()
      const txHash = body.txHash ? String(body.txHash) : null
      if (!isAddress(safeAddress)) return json({ error: 'safeAddress must be a valid 0x address' }, 400)
      if (txHash !== null && !isTxHash(txHash)) return json({ error: 'txHash must be a valid 0x transaction hash' }, 400)
      let owners: string[]
      try {
        owners = JSON.parse(row.owners_json) as string[]
      } catch {
        return json({ error: 'Stored owners for this multisig are corrupt — delete it and prepare it again.' }, 500)
      }
      // One Safe, globally: the same CREATE2 address on every EVM chain,
      // so it must never be recorded twice, on any chain.
      const duplicate = await env.DB.prepare('SELECT id FROM multisigs WHERE safe_address = ?').bind(safeAddress.toLowerCase()).first()
      if (duplicate) return json({ error: 'This Safe address is already recorded as a deployed multisig.' }, 409)
      // Verify on ONE EVM chain — whichever one the Safe was deployed on.
      // The Worker tries every EVM chain in Chain Manager (Solana is
      // skipped: Safe is EVM-only) until it finds contract code at the
      // address whose getThreshold/getOwners match the prepared plan.
      // The chain it is found on is recorded as verified_chain_id; the
      // Safe is then the vault Owner for ALL EVM chains, not just that one.
      const evmChains = (await getChains(env)).filter((c) => c.id !== 'solana')
      if (evmChains.length === 0) return json({ error: 'No EVM chain is configured in Chain Manager — add one before confirming.' }, 400)
      const want = [...owners].map((o) => o.toLowerCase()).sort()
      let verifiedChainId: string | null = null
      let codeFoundOn: string | null = null
      let mismatchOn: { chainId: string; threshold: number; ownerCount: number } | null = null
      let rpcReachable = false
      for (const chain of evmChains) {
        const rpcUrl = (chain.rpc_urls.split(',')[0] ?? '').trim()
        if (!rpcUrl.startsWith('https://')) continue
        let code = '0x'
        try {
          const result = await rpcCall(rpcUrl, 'eth_getCode', [safeAddress, 'latest'])
          if (typeof result === 'string') code = result
          rpcReachable = true
        } catch {
          continue // This chain's RPC is down — try the next EVM chain.
        }
        if (code === '0x' || code === '0x0' || /^0x0+$/.test(code) || code.length <= 2) continue
        codeFoundOn = chain.id
        // 2. On-chain threshold must equal the prepared threshold.
        // 3. On-chain owners must equal the prepared owner set.
        let onChainThreshold: number
        let onChainOwners: string[]
        try {
          const thresholdHex = await ethCall(rpcUrl, safeAddress, '0x0d582f13')
          onChainThreshold = Number(hexToBigInt(thresholdHex.slice(0, 2 + 64)))
          const ownersHex = await ethCall(rpcUrl, safeAddress, '0xa0e67e2b')
          onChainOwners = decodeAddressArray(ownersHex)
        } catch {
          continue // Could not read this Safe's config here — try the next chain.
        }
        const got = [...onChainOwners].map((o) => o.toLowerCase()).sort()
        if (onChainThreshold !== row.threshold || want.length !== got.length || want.some((o, i) => o !== got[i])) {
          mismatchOn = { chainId: chain.id, threshold: onChainThreshold, ownerCount: onChainOwners.length }
          continue
        }
        verifiedChainId = chain.id
        break
      }
      if (!verifiedChainId) {
        if (!rpcReachable) return json({ error: 'No EVM chain RPC was reachable — the Safe could not be verified on-chain. Try again when an RPC is reachable.' }, 502)
        if (mismatchOn) {
          return json({ error: `On-chain threshold is ${mismatchOn.threshold}-of-${mismatchOn.ownerCount} on ${mismatchOn.chainId}, but this multisig was prepared as ${row.threshold}-of-${owners.length}. This Safe does not match the prepared multisig.` }, 400)
        }
        if (codeFoundOn) {
          return json({ error: 'On-chain owners do not match the prepared owners. This Safe does not match the prepared multisig — check the Safe address.' }, 400)
        }
        return json({ error: 'No contract code exists at this address on any EVM chain. The Safe has not been deployed yet — deploy it in your wallet first, then confirm.' }, 400)
      }
      await env.DB.prepare(
        "UPDATE multisigs SET status = ?, safe_address = ?, deploy_tx_hash = ?, verified_chain_id = ?, deployed_at = datetime('now') WHERE id = ?",
      ).bind('deployed', safeAddress.toLowerCase(), txHash, verifiedChainId, id).run()
      await audit(env, authed, 'multisig.confirm', `Multisig id ${id} deployed and verified on-chain on ${verifiedChainId}: Safe ${safeAddress.toLowerCase()} (${row.threshold}-of-${owners.length}) — usable as vault Owner on all EVM chains`)
      return json({ ok: true, id, safeAddress: safeAddress.toLowerCase(), chain: verifiedChainId, verifiedChainId, threshold: row.threshold, owners }, 201)
    }
    if (multisigIdMatch && !multisigIdMatch[2] && req.method === 'DELETE') {
      const id = Number(multisigIdMatch[1])
      const row = await env.DB.prepare('SELECT * FROM multisigs WHERE id = ?').bind(id).first<{ status: string }>()
      if (!row) return json({ error: 'multisig not found' }, 404)
      if (row.status !== 'prepared') return json({ error: 'A deployed multisig is a permanent record — it cannot be deleted. Only a prepared (not yet deployed) multisig can be discarded.' }, 409)
      await env.DB.prepare('DELETE FROM multisigs WHERE id = ?').bind(id).run()
      await audit(env, authed, 'multisig.delete', `Prepared multisig id ${id} deleted (never deployed)`)
      return json({ ok: true })
    }

    // ---- Audit log + backup ----
    if (path === '/api/admin/audit' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 100').all()
      return json({ audit: results ?? [] })
    }
    if (path === '/api/admin/backup' && req.method === 'GET') {
      const chains = await getChains(env)
      const { results: deployments } = await env.DB.prepare('SELECT * FROM deployments ORDER BY id DESC LIMIT 100').all()
      const { results: fees } = await env.DB.prepare('SELECT * FROM fee_versions ORDER BY version DESC LIMIT 20').all()
      const { results: configs } = await env.DB.prepare('SELECT id, version, published_by, created_at FROM config_versions ORDER BY id DESC LIMIT 20').all()
      const { results: runs } = await env.DB.prepare('SELECT * FROM audit_runs ORDER BY id DESC LIMIT 20').all()
      const { results: externals } = await env.DB.prepare('SELECT * FROM external_audits ORDER BY id DESC LIMIT 20').all()
      const { results: launches } = await env.DB.prepare('SELECT * FROM launches ORDER BY id DESC LIMIT 100').all()
      await audit(env, authed, 'admin.backup', 'Backup export downloaded (config + deployments, no secrets)')
      return json({
        exportedAt: new Date().toISOString(),
        chains, deployments: deployments ?? [], feeVersions: fees ?? [], configVersions: configs ?? [],
        auditRuns: runs ?? [], externalAudits: externals ?? [], launches: launches ?? [],
        note: 'Secrets are never included in a backup export.',
      })
    }

    if (path.startsWith('/api/admin/')) {
      return json({ error: 'admin endpoint not implemented' }, 404)
    }
    if (path.startsWith('/api/')) return json({ error: 'not found' }, 404)

    // SPA: serve static assets, falling back to index.html for app routes.
    const asset = await env.ASSETS.fetch(req)
    if (asset.status !== 404) return asset
    if (!path.includes('.')) {
      return env.ASSETS.fetch(new Request(new URL('/index.html', req.url), req))
    }
    return asset
  },
}
