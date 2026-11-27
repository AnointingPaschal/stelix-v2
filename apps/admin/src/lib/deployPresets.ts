// Deploy presets — saved StelixVault constructor values, one per
// (chain_id, env), filled in from the Deploy Presets page and pulled
// into Contract Studio so the 7 fields never have to be re-typed.
// A preset may be partial: router / priceFeed are blank until the
// V3 adapters are deployed. Any non-blank address must be a valid
// 0x address; fee is 0–1000 bps.
import { isAddress } from './deployParams'

export interface DeployPreset {
  id: number
  chainId: string
  env: 'testnet' | 'mainnet'
  label: string
  owner: string
  keeper: string
  router: string
  priceFeed: string
  penaltyRecipient: string
  feeRecipient: string
  autoSellFeeBps: number
  updatedAt: string
}

export const EMPTY_PRESET = {
  owner: '', keeper: '', router: '', priceFeed: '',
  penaltyRecipient: '', feeRecipient: '', autoSellFeeBps: 0,
}

export function validateDeployPreset(input: unknown): { preset: Omit<DeployPreset, 'id' | 'updatedAt'> | null; errors: string[] } {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null) return { preset: null, errors: ['preset must be an object'] }
  const p = input as Record<string, unknown>
  const chainId = String(p.chainId ?? '').trim()
  const env = p.env === 'mainnet' ? 'mainnet' : p.env === 'testnet' ? 'testnet' : ''
  if (!chainId) errors.push('chainId is required')
  if (!env) errors.push('env must be testnet or mainnet')
  for (const field of ['owner', 'keeper', 'router', 'priceFeed', 'penaltyRecipient', 'feeRecipient'] as const) {
    const v = String(p[field] ?? '').trim()
    if (v && !isAddress(v)) errors.push(`${field} must be a valid 0x address, or blank`)
  }
  const feeBps = typeof p.autoSellFeeBps === 'number' ? p.autoSellFeeBps : Number(p.autoSellFeeBps ?? 0)
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000) errors.push('autoSellFeeBps must be an integer between 0 and 1000 (max 10%)')
  if (errors.length > 0) return { preset: null, errors }
  return {
    preset: {
      chainId, env: env as 'testnet' | 'mainnet',
      label: String(p.label ?? '').trim(),
      owner: String(p.owner ?? '').trim(), keeper: String(p.keeper ?? '').trim(),
      router: String(p.router ?? '').trim(), priceFeed: String(p.priceFeed ?? '').trim(),
      penaltyRecipient: String(p.penaltyRecipient ?? '').trim(),
      feeRecipient: String(p.feeRecipient ?? '').trim(),
      autoSellFeeBps: feeBps,
    },
    errors,
  }
}
