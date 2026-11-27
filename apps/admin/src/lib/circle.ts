// Stelix Admin — Circle User-Controlled Wallets (Arc only, EOA first).
//
// Sources (read 2026-11-27, developers.circle.com — do not guess shapes):
// - POST /v1/w3s/users { userId } -> 201 { data: { id } } — create a user.
//   userId is the external id (5-50 chars); Circle returns its own UUID id.
// - POST /v1/w3s/users/token { userId } -> { data: { userToken,
//   encryptionKey } } — mint a 60-minute user session token. The userToken
//   goes in the X-User-Token header of every user-scoped call below; the
//   backend mints it, uses it once, and NEVER returns it to any client.
// - POST /v1/w3s/user/initialize (X-User-Token) { idempotencyKey,
//   accountType: "EOA", blockchains: ["ARC-TESTNET"] } -> { data:
//   { challengeId } } — PIN setup + first wallet creation.
// - POST /v1/w3s/user/wallets (X-User-Token) { idempotencyKey, accountType:
//   "EOA", blockchains, metadata } -> { data: { challengeId } }.
// - POST /v1/w3s/user/transactions/transfer (X-User-Token) {
//   idempotencyKey, walletId, destinationAddress, amounts: ["1.5"],
//   tokenId | tokenAddress, feeLevel } -> { data: { challengeId } }.
//   Amounts are decimal strings in whole token units, not base units.
// - POST /v1/w3s/user/transactions/contractExecution (X-User-Token) {
//   idempotencyKey, walletId, contractAddress, abiFunctionSignature,
//   abiParameters, feeLevel } -> { data: { challengeId } }.
// - GET /v1/w3s/wallets?userId=<circle user id> — list a user's wallets.
// - GET /v1/w3s/transactions/{id} — transaction status.
// - GET /v1/w3s/config/entity -> { data: { appId } } — harmless read used
//   to test the API key and to confirm the App ID Circle reports.
// - Blockchain enum includes ARC and ARC-TESTNET. Auth is always
//   `Authorization: Bearer <CIRCLE_API_KEY>` (format PREFIX:ID:SECRET).
//
// Custody: UCW is non-custodial MPC, challenge-response. The backend
// creates the challenge, the mobile SDK executes it
// (sdk.execute(challengeId)) and the user approves with their PIN. The
// backend NEVER holds a user key share and NEVER signs for a user. A
// Circle wallet cannot auto-sell — auto-sell is the StelixVault contract
// plus the keeper, never the wallet. Scope for now is Arc only, EOA
// first; SCA and Gas Station are NOT built (labelled as such in the admin).
import { ARC_USDC } from './arcNetworks'
import { isAddress } from './deployParams'

export const CIRCLE_API_BASE = 'https://api.circle.com'

export const CIRCLE_BLOCKCHAINS = ['ARC-TESTNET', 'ARC'] as const
export type CircleBlockchain = (typeof CIRCLE_BLOCKCHAINS)[number]

export const CIRCLE_CHALLENGE_TYPES = ['createWallet', 'transfer', 'executeContract'] as const
export type CircleChallengeType = (typeof CIRCLE_CHALLENGE_TYPES)[number]

export const CIRCLE_FEE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const
export type CircleFeeLevel = (typeof CIRCLE_FEE_LEVELS)[number]

/** The Circle App ID is a UUID (Circle Console -> Web3 Services). It is a
 *  PUBLIC identifier, not a secret — only the API key is secret. */
const APP_ID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
export const isValidCircleAppId = (v: unknown): v is string => typeof v === 'string' && APP_ID_RE.test(v.trim())

/** Default Circle App ID, supplied by the user on 2026-11-27. PUBLIC
 *  identifier, not a secret — never put the API key next to it.
 *  Migration 0010 seeds this into circle_config for fresh D1 databases;
 *  the admin Circle page can overwrite it. NOT yet confirmed against
 *  Circle: the API key still returns HTTP 403 on GET
 *  /v1/w3s/config/entity (re-checked 2026-11-27 with the updated key),
 *  so Circle has not reported an appId to compare it with yet — the
 *  GET /api/circle/config check confirms the match once the key works. */
export const DEFAULT_CIRCLE_APP_ID = 'd15deb9f-8d3c-5c06-be01-de05897d30ea'

/** Masked App ID for display: first 8 chars + ellipsis. Never show the
 *  full App ID from the config endpoint, and never show the API key. */
export function maskAppId(appId: string | null | undefined): string | null {
  if (!appId) return null
  return `${appId.slice(0, 8)}…`
}

export interface CircleChallengeInput {
  type?: unknown
  userId?: unknown
  blockchain?: unknown
  walletId?: unknown
  destinationAddress?: unknown
  amount?: unknown
  amounts?: unknown
  tokenId?: unknown
  tokenAddress?: unknown
  /** Convenience alias for tokenAddress (an 0x address) or "USDC" (Arc USDC). */
  token?: unknown
  contractAddress?: unknown
  abiFunctionSignature?: unknown
  /** Alias for abiFunctionSignature, e.g. "lock(uint256,uint256)". */
  function?: unknown
  abiParameters?: unknown
  /** Alias for abiParameters. */
  args?: unknown
  feeLevel?: unknown
}

export interface CircleChallengeRequest {
  type: CircleChallengeType
  userId: string
  blockchain: CircleBlockchain
  walletId?: string
  destinationAddress?: string
  amounts?: string[]
  tokenId?: string
  tokenAddress?: string
  contractAddress?: string
  abiFunctionSignature?: string
  abiParameters?: (string | number | boolean | unknown[])[]
  feeLevel: CircleFeeLevel
}

const isDecimalAmount = (v: unknown): v is string =>
  typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) && Number(v) > 0

/** Validate a challenge request the way validateDeployParams does: pure,
 *  no D1, no network. The Worker adds the checks that need D1 (Circle
 *  user mapping, registered-vault check for executeContract). */
export function validateCircleChallengeInput(input: unknown): { value: CircleChallengeRequest | null; errors: string[] } {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null) return { value: null, errors: ['challenge must be an object'] }
  const p = input as CircleChallengeInput

  if (typeof p.type !== 'string' || !(CIRCLE_CHALLENGE_TYPES as readonly string[]).includes(p.type)) {
    errors.push('type must be createWallet, transfer or executeContract')
  }
  const type = p.type as CircleChallengeType | undefined

  if (typeof p.blockchain !== 'string' || !(CIRCLE_BLOCKCHAINS as readonly string[]).includes(p.blockchain)) {
    errors.push('blockchain must be ARC-TESTNET or ARC — Circle is Arc-only for now')
  }
  const blockchain = p.blockchain as CircleBlockchain | undefined

  const userId = typeof p.userId === 'string' ? p.userId.trim() : ''
  if (userId.length < 5 || userId.length > 50) {
    errors.push('userId is required (5–50 characters) — the Stelix user id already registered with Circle')
  }

  const walletId = typeof p.walletId === 'string' ? p.walletId.trim() : ''
  if ((type === 'transfer' || type === 'executeContract') && !walletId) {
    errors.push('walletId is required for transfer and executeContract challenges')
  }
  if (walletId.length > 100) errors.push('walletId is too long')

  let destinationAddress: string | undefined
  if (type === 'transfer') {
    if (!isAddress(p.destinationAddress)) errors.push('destinationAddress must be a valid 0x address')
    else destinationAddress = p.destinationAddress as string
  }

  let amounts: string[] | undefined
  if (type === 'transfer') {
    if (Array.isArray(p.amounts) && p.amounts.length > 0 && p.amounts.every(isDecimalAmount)) {
      amounts = p.amounts as string[]
    } else if (isDecimalAmount(p.amount)) {
      amounts = [p.amount as string]
    } else {
      errors.push('amount is required — a decimal string in whole token units, greater than 0 (e.g. "1.5" for 1.5 USDC)')
    }
  }

  let tokenId: string | undefined
  let tokenAddress: string | undefined
  if (type === 'transfer') {
    if (typeof p.tokenId === 'string' && p.tokenId.trim() !== '') tokenId = p.tokenId.trim()
    if (typeof p.tokenAddress === 'string' && p.tokenAddress.trim() !== '') {
      if (!isAddress(p.tokenAddress)) errors.push('tokenAddress must be a valid 0x address')
      else tokenAddress = p.tokenAddress as string
    } else if (typeof p.token === 'string' && p.token.trim() !== '') {
      const t = p.token.trim()
      // Regex test, not the isAddress type guard: t is already a string,
      // so the guard would narrow it to never in the else branch.
      if (/^0x[0-9a-fA-F]{40}$/.test(t)) tokenAddress = t
      else if (t.toUpperCase() === 'USDC') tokenAddress = ARC_USDC
      else errors.push('token must be a token contract address or "USDC" (Arc USDC)')
    }
    if (!tokenId && !tokenAddress) {
      errors.push(`tokenId or tokenAddress is required — for Arc USDC use ${ARC_USDC}`)
    }
  }

  let contractAddress: string | undefined
  let abiFunctionSignature: string | undefined
  let abiParameters: (string | number | boolean | unknown[])[] | undefined
  if (type === 'executeContract') {
    if (!isAddress(p.contractAddress)) errors.push('contractAddress must be a valid 0x address')
    else contractAddress = p.contractAddress as string
    const fn = typeof p.abiFunctionSignature === 'string' ? p.abiFunctionSignature.trim()
      : typeof p.function === 'string' ? p.function.trim() : ''
    if (!fn) errors.push('abiFunctionSignature (or "function") is required, e.g. "lock(uint256,uint256)"')
    else abiFunctionSignature = fn
    const args = p.abiParameters !== undefined ? p.abiParameters : p.args
    if (args !== undefined && !Array.isArray(args)) errors.push('abiParameters (or "args") must be an array')
    else if (Array.isArray(args)) abiParameters = args as (string | number | boolean | unknown[])[]
  }

  let feeLevel: CircleFeeLevel = 'MEDIUM'
  if (p.feeLevel !== undefined) {
    if (typeof p.feeLevel === 'string' && (CIRCLE_FEE_LEVELS as readonly string[]).includes(p.feeLevel)) {
      feeLevel = p.feeLevel as CircleFeeLevel
    } else {
      errors.push('feeLevel must be LOW, MEDIUM or HIGH')
    }
  }

  if (errors.length > 0 || !type || !blockchain || !userId) return { value: null, errors }
  return {
    value: {
      type, userId, blockchain, feeLevel,
      ...(walletId ? { walletId } : {}),
      ...(destinationAddress ? { destinationAddress } : {}),
      ...(amounts ? { amounts } : {}),
      ...(tokenId ? { tokenId } : {}),
      ...(tokenAddress ? { tokenAddress } : {}),
      ...(contractAddress ? { contractAddress } : {}),
      ...(abiFunctionSignature ? { abiFunctionSignature } : {}),
      ...(abiParameters ? { abiParameters } : {}),
    },
    errors: [],
  }
}

/** Map a validated challenge to the exact Circle endpoint + body (Circle
 *  docs above). The caller adds the Authorization + X-User-Token headers;
 *  this function never touches secrets. */
export function buildCircleChallengeRequest(
  value: CircleChallengeRequest,
  idempotencyKey: string,
): { path: string; body: Record<string, unknown> } {
  if (value.type === 'createWallet') {
    return {
      path: '/v1/w3s/user/wallets',
      body: {
        idempotencyKey,
        accountType: 'EOA',
        blockchains: [value.blockchain],
        metadata: [{ name: 'Stelix' }],
      },
    }
  }
  if (value.type === 'transfer') {
    return {
      path: '/v1/w3s/user/transactions/transfer',
      body: {
        idempotencyKey,
        walletId: value.walletId,
        destinationAddress: value.destinationAddress,
        amounts: value.amounts,
        ...(value.tokenId ? { tokenId: value.tokenId } : {}),
        ...(value.tokenAddress ? { tokenAddress: value.tokenAddress } : {}),
        feeLevel: value.feeLevel,
      },
    }
  }
  return {
    path: '/v1/w3s/user/transactions/contractExecution',
    body: {
      idempotencyKey,
      walletId: value.walletId,
      contractAddress: value.contractAddress,
      abiFunctionSignature: value.abiFunctionSignature,
      ...(value.abiParameters ? { abiParameters: value.abiParameters } : {}),
      feeLevel: value.feeLevel,
    },
  }
}

/** Pull Circle's { code, message } out of an error body, honestly. Circle
 *  error bodies look like { code: 155106, message: "..." }. Never include
 *  request headers (the API key) in the result. */
export function parseCircleError(body: unknown, status: number): { code: number | string; message: string } {
  if (typeof body === 'object' && body !== null) {
    const b = body as { code?: unknown; message?: unknown }
    const message = typeof b.message === 'string' && b.message.trim() !== '' ? b.message : `Circle API returned HTTP ${status}.`
    const code = typeof b.code === 'number' || typeof b.code === 'string' ? b.code : status
    return { code, message }
  }
  return { code: status, message: `Circle API returned HTTP ${status}.` }
}
