// Stelix Admin — Multisig creator (Safe protocol).
//
// The admin NEVER deploys a multisig itself and NEVER holds a private key.
// Flow: prepare (validate + record a draft in D1) -> the owners create the
// Safe in their own wallet (Safe web app, Safe CLI / Protocol Kit, or
// `cast safe create`) and sign the deployment there -> the admin records
// the Safe address only after the Worker verifies it on-chain (contract
// code present + getThreshold() + getOwners() match the prepared set).
// Only a verified, deployed Safe can be picked as the StelixVault Owner
// in Contract Studio.
//
// Safe contracts used: Safe v1.4.1 canonical deployments
// (safe-global/safe-deployments, ContractScan "Safe 1.4.1" bundle):
//   Safe singleton               0x41675C099F32341bf84BFc5382aF534df5C7461a
//   SafeL2 singleton             0x29fcB43b46531BcA003ddC8FCB67FFE91900C762
//   SafeProxyFactory             0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67
//   CompatibilityFallbackHandler 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99
// (v1.3.0 used different addresses — e.g. factory
// 0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2 — do not mix versions.)
//
// Per-chain availability (checked 2026-11-27, do not guess others):
// - Ethereum (1), BNB Smart Chain (56), Base (8453), Polygon (137):
//   in the Safe registry and served by app.safe.global + the Safe
//   Transaction Service — create in the Safe web app.
// - Arc Testnet (5042002) and Arc Mainnet (5042): the canonical v1.4.1
//   factory + singleton code IS present on-chain — verified live on
//   2026-11-27 with eth_getCode against https://rpc.testnet.arc.io and
//   https://rpc.mainnet.arc.io (non-empty code at both canonical
//   addresses, same bytecode prefix as BNB). BUT app.safe.global does
//   not list Arc, so the Safe must be created with the Safe CLI /
//   Protocol Kit / `cast safe create` using the factory address below.
//   The Worker's confirm step verifies the deployed Safe on Arc's own
//   RPC, so an Arc Safe is still usable as vault Owner once verified.
// - Solana (101): Safe is EVM-only. There are no Safe contracts on
//   Solana (the Solana-native equivalent is Squads, which is NOT built
//   here). A Solana multisig cannot be created or recorded by this flow.
import { isAddress } from './deployParams'

export const SAFE_VERSION = '1.4.1'
export const SAFE_SINGLETON = '0x41675C099F32341bf84BFc5382aF534df5C7461a'
export const SAFE_L2_SINGLETON = '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762'
export const SAFE_PROXY_FACTORY = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67'
export const SAFE_FALLBACK_HANDLER = '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99'
export const SAFE_WEB_APP = 'https://app.safe.global'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const MIN_OWNERS = 2
export const MAX_OWNERS = 10

export type SafeChainSupport = 'supported' | 'contracts-only' | 'unsupported'

export interface SafeChainInfo {
  slug: string
  chainId: number
  name: string
  support: SafeChainSupport
  note: string
}

export const SAFE_CHAINS: SafeChainInfo[] = [
  {
    slug: 'ethereum', chainId: 1, name: 'Ethereum', support: 'supported',
    note: 'Safe web app + Transaction Service live. Create the Safe at app.safe.global.',
  },
  {
    slug: 'bnb', chainId: 56, name: 'BNB Smart Chain', support: 'supported',
    note: 'Safe web app + Transaction Service live. Create the Safe at app.safe.global.',
  },
  {
    slug: 'base', chainId: 8453, name: 'Base', support: 'supported',
    note: 'Safe web app + Transaction Service live. Create the Safe at app.safe.global.',
  },
  {
    slug: 'polygon', chainId: 137, name: 'Polygon', support: 'supported',
    note: 'Safe web app + Transaction Service live. Create the Safe at app.safe.global.',
  },
  {
    slug: 'arc', chainId: 5042002, name: 'Arc Testnet', support: 'contracts-only',
    note: 'Safe v1.4.1 factory + singleton code is present on-chain (verified live via eth_getCode 2026-11-27), but app.safe.global does not list Arc — create the Safe with the Safe CLI / Protocol Kit or `cast safe create` using the factory address below.',
  },
  {
    slug: 'arc-mainnet', chainId: 5042, name: 'Arc Mainnet', support: 'contracts-only',
    note: 'Safe v1.4.1 factory + singleton code is present on-chain (verified live via eth_getCode 2026-11-27), but app.safe.global does not list Arc — create the Safe with the Safe CLI / Protocol Kit or `cast safe create` using the factory address below.',
  },
  {
    slug: 'solana', chainId: 101, name: 'Solana', support: 'unsupported',
    note: 'Safe is EVM-only: there are no Safe contracts on Solana. Use a Solana-native multisig (e.g. Squads) instead — this creator cannot make or record one.',
  },
]

export const safeChainFor = (slug: string): SafeChainInfo | undefined =>
  SAFE_CHAINS.find((c) => c.slug === slug)

/** True when a Safe can be created and verified on this chain at all. */
export const safeAvailableOn = (slug: string): boolean => {
  const info = safeChainFor(slug)
  return info !== undefined && info.support !== 'unsupported'
}

export interface MultisigInput {
  chainId: string
  label?: string
  owners: string[]
  threshold: number
  saltNonce?: string
  predictedAddress?: string | null
}

export interface ValidMultisig {
  chainId: string
  label: string | null
  owners: string[]
  threshold: number
  saltNonce: string
  predictedAddress: string | null
  factoryAddress: string
  singletonAddress: string
  safeVersion: string
}

export function validateMultisigInput(input: unknown): { multisig: ValidMultisig | null; errors: string[] } {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null) {
    return { multisig: null, errors: ['multisig must be an object'] }
  }
  const p = input as Record<string, unknown>

  const chainId = typeof p.chainId === 'string' ? p.chainId.trim() : ''
  if (!chainId) errors.push('chainId is required')
  const chainInfo = chainId ? safeChainFor(chainId) : undefined
  if (chainId && !chainInfo) errors.push(`unknown chain "${chainId}" — add it in Chain Manager first`)
  if (chainInfo && chainInfo.support === 'unsupported') {
    errors.push(`Safe is not available on ${chainInfo.name}: ${chainInfo.note}`)
  }

  const label = typeof p.label === 'string' ? p.label.trim() : ''
  if (label.length > 80) errors.push('label must be 80 characters or fewer')

  const rawOwners = Array.isArray(p.owners) ? p.owners : []
  if (!Array.isArray(p.owners)) errors.push('owners must be a list of wallet addresses')
  const owners: string[] = []
  const seen = new Set<string>()
  for (const raw of rawOwners) {
    const owner = typeof raw === 'string' ? raw.trim() : ''
    if (!isAddress(owner)) {
      errors.push(`owner "${raw}" is not a valid 0x address`)
      continue
    }
    if (owner.toLowerCase() === ZERO_ADDRESS) {
      errors.push('owner must not be the zero address (0x000…000)')
      continue
    }
    if (seen.has(owner.toLowerCase())) {
      errors.push(`duplicate owner ${owner} — each owner may appear only once`)
      continue
    }
    seen.add(owner.toLowerCase())
    owners.push(owner)
  }
  if (Array.isArray(p.owners) && rawOwners.length < MIN_OWNERS) {
    errors.push(`at least ${MIN_OWNERS} owners are required for a multisig`)
  }
  if (rawOwners.length > MAX_OWNERS) {
    errors.push(`at most ${MAX_OWNERS} owners are supported by this creator`)
  }

  const threshold = typeof p.threshold === 'number' ? p.threshold : Number(p.threshold)
  if (!Number.isInteger(threshold)) {
    errors.push('threshold must be a whole number')
  } else if (threshold < 1) {
    errors.push('threshold must be at least 1 (threshold 0 means nobody can ever sign)')
  } else if (owners.length > 0 && threshold > owners.length) {
    errors.push(`threshold ${threshold} is greater than the number of owners (${owners.length}) — it can never be reached`)
  }

  const saltNonce = p.saltNonce === undefined || p.saltNonce === null || p.saltNonce === ''
    ? '0'
    : String(p.saltNonce).trim()
  if (!/^\d+$/.test(saltNonce)) errors.push('saltNonce must be a non-negative integer (recorded for reference only)')

  const predictedAddress = p.predictedAddress === undefined || p.predictedAddress === null || p.predictedAddress === ''
    ? null
    : String(p.predictedAddress).trim()
  if (predictedAddress !== null && !isAddress(predictedAddress)) {
    errors.push('predictedAddress must be a valid 0x address')
  }

  if (errors.length > 0) return { multisig: null, errors }
  return {
    multisig: {
      chainId,
      label: label || null,
      owners,
      threshold,
      saltNonce,
      predictedAddress,
      factoryAddress: SAFE_PROXY_FACTORY,
      singletonAddress: SAFE_SINGLETON,
      safeVersion: SAFE_VERSION,
    },
    errors,
  }
}

/** "2-of-3" style label for a threshold / owner count. */
export const thresholdLabel = (threshold: number, ownerCount: number): string =>
  `${threshold}-of-${ownerCount}`
