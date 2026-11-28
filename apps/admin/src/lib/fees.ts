// Stelix Admin — fee / limits config. Shared by the Worker (server-side
// validation) and the Fees page (client-side validation), so the rules cannot
// drift between the form and the API. Fees are snapshotted per lock at
// creation — changing them never affects existing locks.
import { isAddress } from './deployParams'

export interface FeeConfig {
  autoSellFeePct: number // % charged on a successful auto-sell only; 0–10
  minLockUsd: number
  maxLockUsd: number
  defaultPenaltyPct: number // 5–10
  twapMinutes: number // 5–120
  trailingStopOptions: string // e.g. 'Off, 10%, 15%, 20%'
  defaultSlippagePct: number // 0–50
  penaltyDestination: 'burn' | 'treasury' | 'relock'
  breakCoolingOffHours: number // hours after locking before a penalty break is allowed; 0–72
  guardianBreakDelayHours: number // hours a guardian break waits for approval; 0–168
  maxPriceImpactPct: number // swaps above this price impact are split or blocked; 0–50
  /** Global default fee recipient for FUTURE vaults: new Deploy Presets
   *  saved with a blank fee recipient take this address. null = not set
   *  (presets then fall back to the deployer address, as before).
   *  Existing vaults keep the recipient set in their constructor — an
   *  on-chain recipient cannot be changed by the admin alone. */
  feeRecipient: string | null
}

export const DEFAULT_FEES: FeeConfig = {
  autoSellFeePct: 1,
  minLockUsd: 10,
  maxLockUsd: 100000,
  defaultPenaltyPct: 5,
  twapMinutes: 30,
  trailingStopOptions: 'Off, 10%, 15%, 20%',
  defaultSlippagePct: 1.5,
  penaltyDestination: 'treasury',
  breakCoolingOffHours: 24,
  guardianBreakDelayHours: 48,
  maxPriceImpactPct: 5,
  feeRecipient: null,
}

export function validateFeePayload(input: unknown): { config: FeeConfig | null; errors: string[] } {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null) return { config: null, errors: ['fee config must be an object'] }
  const p = input as Record<string, unknown>
  const num = (key: string): number | null => {
    const v = typeof p[key] === 'number' ? p[key] : Number(p[key])
    return Number.isFinite(v) ? v : null
  }
  const fee = num('autoSellFeePct')
  if (fee === null || fee < 0 || fee > 10) errors.push('autoSellFeePct must be between 0 and 10')
  const min = num('minLockUsd')
  if (min === null || min < 0) errors.push('minLockUsd must be 0 or more')
  const max = num('maxLockUsd')
  if (max === null || max <= 0) errors.push('maxLockUsd must be greater than 0')
  if (min !== null && max !== null && max <= min) errors.push('maxLockUsd must be greater than minLockUsd')
  const penalty = num('defaultPenaltyPct')
  if (penalty === null || penalty < 5 || penalty > 10) errors.push('defaultPenaltyPct must be between 5 and 10')
  const twap = num('twapMinutes')
  if (twap === null || twap < 5 || twap > 120) errors.push('twapMinutes must be between 5 and 120')
  const slippage = num('defaultSlippagePct')
  if (slippage === null || slippage < 0 || slippage > 50) errors.push('defaultSlippagePct must be between 0 and 50')
  const coolingOff = num('breakCoolingOffHours')
  if (coolingOff !== null && (coolingOff < 0 || coolingOff > 72)) errors.push('breakCoolingOffHours must be between 0 and 72')
  const guardianDelay = num('guardianBreakDelayHours')
  if (guardianDelay !== null && (guardianDelay < 0 || guardianDelay > 168)) errors.push('guardianBreakDelayHours must be between 0 and 168')
  const maxImpact = num('maxPriceImpactPct')
  if (maxImpact !== null && (maxImpact < 0 || maxImpact > 50)) errors.push('maxPriceImpactPct must be between 0 and 50')
  if (typeof p.trailingStopOptions !== 'string' || p.trailingStopOptions.trim() === '') {
    errors.push('trailingStopOptions must be a non-empty string')
  }
  if (p.penaltyDestination !== 'burn' && p.penaltyDestination !== 'treasury' && p.penaltyDestination !== 'relock') {
    errors.push('penaltyDestination must be burn, treasury or relock')
  }
  // Global fee recipient: blank / missing / null = not set; otherwise it
  // must be a well-formed 0x address. Older published configs omit it.
  const feeRecipientRaw = p.feeRecipient
  let feeRecipient: string | null = null
  if (feeRecipientRaw === null || feeRecipientRaw === undefined || feeRecipientRaw === '') {
    feeRecipient = null
  } else if (typeof feeRecipientRaw === 'string' && isAddress(feeRecipientRaw.trim())) {
    feeRecipient = feeRecipientRaw.trim()
  } else {
    errors.push('feeRecipient must be a valid 0x address, or blank')
  }
  if (errors.length > 0) return { config: null, errors }
  return {
    config: {
      autoSellFeePct: fee as number,
      minLockUsd: min as number,
      maxLockUsd: max as number,
      defaultPenaltyPct: penalty as number,
      twapMinutes: twap as number,
      trailingStopOptions: (p.trailingStopOptions as string).trim(),
      defaultSlippagePct: slippage as number,
      penaltyDestination: p.penaltyDestination as FeeConfig['penaltyDestination'],
      // Newer fields (2026-11-27): older published configs and older
      // clients omit them — they default instead of failing validation.
      breakCoolingOffHours: coolingOff ?? DEFAULT_FEES.breakCoolingOffHours,
      guardianBreakDelayHours: guardianDelay ?? DEFAULT_FEES.guardianBreakDelayHours,
      maxPriceImpactPct: maxImpact ?? DEFAULT_FEES.maxPriceImpactPct,
      feeRecipient,
    },
    errors,
  }
}
