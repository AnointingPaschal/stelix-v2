// Stelix Admin — chain registry validation. Shared by the Worker
// (server-side, the authority) and the Chain Manager page (client-side,
// inline errors before anything is sent), so the form and the API enforce
// the same rules.
//
// Rules:
// - slug: lowercase alphanumeric/dash, 2-32 chars, unique (uniqueness is
//   checked server-side against D1; the page also checks the loaded list).
// - chain id: a positive safe integer, unique server-side.
// - RPC / explorer: https URLs only (http is rejected — RPC credentials
//   and traffic must not go over plaintext).
// - EVM addresses (stablecoin, DEX router, vault): 0x + 40 hex chars when
//   present. Router and vault are OPTIONAL and must only ever be filled
//   with an address verified on the explorer — never a guess. A blank
//   value is stored as '' (router/stablecoin) or NULL (vault).
// - decimals: integers 0-18. Stablecoin defaults to 6 (USDC/USDT).
// - Solana note: SPL mint addresses are base58, not 0x, so this form
//   cannot set a Solana stablecoin address; the wallet keeps its built-in
//   value for Solana until a base58-aware field is added.
import { isAddress } from './deployParams'

export type ChainStatus = 'testnet' | 'live' | 'paused' | 'hidden'

export const CHAIN_STATUSES: ChainStatus[] = ['testnet', 'live', 'paused', 'hidden']

export interface ChainInput {
  id: string
  name: string
  chainId: number
  rpcUrls: string[]
  explorerUrl: string
  nativeToken: string
  nativeDecimals: number
  stablecoin: string
  stablecoinAddress: string
  stablecoinDecimals: number
  gasToken: string
  dexRouter: string
  vaultAddress: string | null
  /** Launchpad sale contract on this chain (deployed from the Launchpad
   *  page). Null until deployed — launches cannot go live without it. */
  launchpadAddress: string | null
  /** Token factory contract on this chain (deploys new ERC-20s for free,
   *  gas only). Null until deployed. */
  tokenFactoryAddress: string | null
  status: ChainStatus
  isTestnet: boolean
  active: boolean
  isDefault: boolean
  pairedChainId: string | null
  /** Shown in the wallet picker but disabled — never selectable. */
  comingSoon?: boolean
}

export type ChainFieldErrors = Partial<Record<string, string>>

const SLUG_RE = /^[a-z0-9-]{2,32}$/
const SYMBOL_RE = /^[A-Za-z0-9]{1,12}$/

export function isHttpsUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.trim() === '') return false
  try {
    const u = new URL(v.trim())
    return u.protocol === 'https:' && u.hostname.length > 0
  } catch {
    return false
  }
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim()
}

function asInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && /^-?\d+$/.test(v.trim())) {
    const n = Number(v.trim())
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

function asBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v
  if (v === 1 || v === '1' || v === 'true') return true
  if (v === 0 || v === '0' || v === 'false') return false
  return fallback
}

function parseRpcUrls(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter(Boolean)
  return asString(v).split(',').map((s) => s.trim()).filter(Boolean)
}

/** Read a field accepting either camelCase (admin UI / API) or snake_case (D1 rows). */
function pick(body: Record<string, unknown>, camel: string, snake: string): unknown {
  return body[camel] !== undefined ? body[camel] : body[snake]
}

export interface ChainValidationResult {
  /** Normalised chain on success; on partial updates, only the fields that
   *  were supplied (plus derived defaults such as gasToken). Null when the
   *  input has any error. */
  value: Partial<ChainInput> | null
  errors: ChainFieldErrors
}

/**
 * Validate a chain create (partial=false: every required field must be
 * present) or a chain update (partial=true: only supplied fields are
 * validated; absent fields are left untouched server-side).
 * Never throws; all problems are returned as field errors.
 */
export function validateChainInput(input: unknown, opts?: { partial?: boolean }): ChainValidationResult {
  const partial = opts?.partial === true
  const errors: ChainFieldErrors = {}
  const value: Partial<ChainInput> = {}
  if (typeof input !== 'object' || input === null) {
    return { value: null, errors: { _form: 'chain data must be an object' } }
  }
  const body = input as Record<string, unknown>
  const present = (camel: string, snake: string) => body[camel] !== undefined || body[snake] !== undefined

  // --- slug (create only; the slug is the primary key and never changes) ---
  if (!partial || present('id', 'id')) {
    const id = asString(body.id).toLowerCase()
    if (!SLUG_RE.test(id)) errors.id = 'slug must be lowercase letters, numbers or dashes (2-32 chars), e.g. arbitrum'
    else value.id = id
  }

  // --- name ---
  if (!partial || present('name', 'name')) {
    const name = asString(body.name)
    if (name.length < 1 || name.length > 64) errors.name = 'name is required (1-64 characters)'
    else value.name = name
  }

  // --- chain id ---
  if (!partial || present('chainId', 'chain_id')) {
    const chainId = asInt(pick(body, 'chainId', 'chain_id'))
    if (chainId === null || chainId <= 0) errors.chainId = 'chain id must be a positive whole number (e.g. 5042002 for Arc testnet)'
    else value.chainId = chainId
  }

  // --- RPC URLs ---
  if (!partial || present('rpcUrls', 'rpc_urls')) {
    const rpcUrls = parseRpcUrls(pick(body, 'rpcUrls', 'rpc_urls'))
    if (rpcUrls.length === 0) {
      errors.rpcUrls = 'at least one RPC URL is required'
    } else {
      const bad = rpcUrls.find((u) => !isHttpsUrl(u))
      if (bad) errors.rpcUrls = `RPC URLs must be https URLs — "${bad}" is not`
      else value.rpcUrls = rpcUrls
    }
  }

  // --- explorer URL ---
  if (!partial || present('explorerUrl', 'explorer_url')) {
    const explorerUrl = asString(pick(body, 'explorerUrl', 'explorer_url'))
    if (!isHttpsUrl(explorerUrl)) errors.explorerUrl = 'explorer URL must be an https URL (e.g. https://explorer.testnet.arc.io)'
    else value.explorerUrl = explorerUrl
  }

  // --- native currency ---
  if (!partial || present('nativeToken', 'native_token')) {
    const nativeToken = asString(pick(body, 'nativeToken', 'native_token'))
    if (!SYMBOL_RE.test(nativeToken)) errors.nativeToken = 'native currency symbol is required (e.g. USDC, BNB, ETH)'
    else value.nativeToken = nativeToken
  }
  if (present('nativeDecimals', 'native_decimals')) {
    const d = asInt(pick(body, 'nativeDecimals', 'native_decimals'))
    if (d === null || d < 0 || d > 18) errors.nativeDecimals = 'native decimals must be a whole number 0-18 (Arc USDC gas is 6)'
    else value.nativeDecimals = d
  } else if (!partial) {
    value.nativeDecimals = 18
  }

  // --- stablecoin ---
  if (!partial || present('stablecoin', 'stablecoin')) {
    const stablecoin = asString(body.stablecoin)
    if (!SYMBOL_RE.test(stablecoin)) errors.stablecoin = 'stablecoin symbol is required (USDC or USDT)'
    else value.stablecoin = stablecoin.toUpperCase()
  }
  if (present('stablecoinAddress', 'stablecoin_address')) {
    const addr = asString(pick(body, 'stablecoinAddress', 'stablecoin_address'))
    if (addr !== '' && !isAddress(addr)) errors.stablecoinAddress = 'stablecoin address must be a valid 0x address (40 hex chars) or left blank until verified on the explorer'
    else value.stablecoinAddress = addr
  } else if (!partial) {
    value.stablecoinAddress = ''
  }
  if (present('stablecoinDecimals', 'stablecoin_decimals')) {
    const d = asInt(pick(body, 'stablecoinDecimals', 'stablecoin_decimals'))
    if (d === null || d < 0 || d > 18) errors.stablecoinDecimals = 'stablecoin decimals must be a whole number 0-18 (USDC/USDT are 6)'
    else value.stablecoinDecimals = d
  } else if (!partial) {
    value.stablecoinDecimals = 6
  }

  // --- gas token (defaults to the native currency) ---
  if (present('gasToken', 'gas_token')) {
    const gasToken = asString(pick(body, 'gasToken', 'gas_token'))
    if (gasToken !== '' && !SYMBOL_RE.test(gasToken)) errors.gasToken = 'gas token must be a currency symbol (e.g. USDC) or left blank to use the native currency'
    else value.gasToken = gasToken
  }

  // --- DEX router: optional, verified on explorer only — never guessed ---
  if (present('dexRouter', 'dex_router')) {
    const router = asString(pick(body, 'dexRouter', 'dex_router'))
    if (router !== '' && !isAddress(router)) errors.dexRouter = 'DEX router must be a valid 0x address (40 hex chars) or left blank — only paste an address verified on the explorer, never guess one'
    else value.dexRouter = router
  } else if (!partial) {
    value.dexRouter = ''
  }

  // --- vault address: optional, verified on explorer only — never guessed ---
  if (present('vaultAddress', 'vault_address')) {
    const raw = pick(body, 'vaultAddress', 'vault_address')
    const vault = raw === null ? null : asString(raw)
    if (vault !== null && vault !== '' && !isAddress(vault)) errors.vaultAddress = 'vault address must be a valid 0x address (40 hex chars) or left blank — only paste an address verified on the explorer, never guess one'
    else value.vaultAddress = vault === '' ? null : vault
  } else if (!partial) {
    value.vaultAddress = null
  }

  // --- launchpad + token factory: optional, set by the Launchpad page
  // after a wallet-signed deploy (the deploy writes the real address
  // through the chain update API). Verified on the explorer only.
  if (present('launchpadAddress', 'launchpad_address')) {
    const raw = pick(body, 'launchpadAddress', 'launchpad_address')
    const addr = raw === null ? null : asString(raw)
    if (addr !== null && addr !== '' && !isAddress(addr)) errors.launchpadAddress = 'launchpad address must be a valid 0x address (40 hex chars) or left blank — it is filled in automatically when the launchpad is deployed'
    else value.launchpadAddress = addr === '' ? null : addr
  } else if (!partial) {
    value.launchpadAddress = null
  }
  if (present('tokenFactoryAddress', 'token_factory_address')) {
    const raw = pick(body, 'tokenFactoryAddress', 'token_factory_address')
    const addr = raw === null ? null : asString(raw)
    if (addr !== null && addr !== '' && !isAddress(addr)) errors.tokenFactoryAddress = 'token factory address must be a valid 0x address (40 hex chars) or left blank — it is filled in automatically when the factory is deployed'
    else value.tokenFactoryAddress = addr === '' ? null : addr
  } else if (!partial) {
    value.tokenFactoryAddress = null
  }

  // --- status / testnet flag ---
  let status: ChainStatus | undefined
  if (!partial || present('status', 'status')) {
    const s = asString(body.status)
    if (!CHAIN_STATUSES.includes(s as ChainStatus)) errors.status = 'status must be testnet, live, paused or hidden'
    else { status = s as ChainStatus; value.status = status }
  } else if (!partial) {
    status = 'testnet'
    value.status = 'testnet'
  }
  if (present('isTestnet', 'is_testnet')) {
    value.isTestnet = asBool(pick(body, 'isTestnet', 'is_testnet'), false)
  } else if (status !== undefined) {
    // A testnet status implies the testnet flag unless explicitly set.
    value.isTestnet = status === 'testnet'
  } else if (!partial) {
    value.isTestnet = true
  }

  // --- active flag (the enable/disable toggle) ---
  if (present('active', 'active')) {
    value.active = asBool(body.active, true)
  } else if (!partial) {
    value.active = true
  }
  // --- coming-soon flag (shown in the wallet picker, disabled) ---
  if (present('comingSoon', 'coming_soon')) {
    value.comingSoon = asBool(pick(body, 'comingSoon', 'coming_soon'), false)
  } else if (!partial) {
    value.comingSoon = false
  }

  // --- default chain ---
  if (present('isDefault', 'is_default')) {
    value.isDefault = asBool(pick(body, 'isDefault', 'is_default'), false)
  } else if (!partial) {
    value.isDefault = false
  }

  // --- testnet/mainnet pair (slug of the paired chain, or blank) ---
  if (present('pairedChainId', 'paired_chain_id')) {
    const raw = pick(body, 'pairedChainId', 'paired_chain_id')
    const paired = raw === null ? null : asString(raw).toLowerCase()
    if (paired !== null && paired !== '' && !SLUG_RE.test(paired)) {
      errors.pairedChainId = 'paired chain must be another chain slug (lowercase letters, numbers or dashes) or left blank'
    } else if (paired !== null && paired !== '' && value.id !== undefined && paired === value.id) {
      errors.pairedChainId = 'a chain cannot be paired with itself'
    } else {
      value.pairedChainId = paired === '' ? null : paired
    }
  } else if (!partial) {
    value.pairedChainId = null
  }

  // Gas token falls back to the native currency when blank / absent.
  if (!partial && (value.gasToken === undefined || value.gasToken === '')) {
    value.gasToken = value.nativeToken ?? ''
  }

  if (Object.keys(errors).length > 0) return { value: null, errors }
  return { value, errors: {} }
}
