// Stelix Admin — fee / limits config. Shared by the Worker (server-side
// validation) and the Fees page (client-side validation), so the rules cannot
// drift between the form and the API. Fees are snapshotted per lock at
// creation — changing them never affects existing locks.
export interface FeeConfig {
  autoSellFeePct: number // % charged on a successful auto-sell only; 0–10
  minLockUsd: number
  maxLockUsd: number
  defaultPenaltyPct: number // 5–10
  twapMinutes: number // 5–120
  trailingStopOptions: string // e.g. 'Off, 10%, 15%, 20%'
  defaultSlippagePct: number // 0–50
  penaltyDestination: 'burn' | 'treasury' | 'relock'
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
  if (typeof p.trailingStopOptions !== 'string' || p.trailingStopOptions.trim() === '') {
    errors.push('trailingStopOptions must be a non-empty string')
  }
  if (p.penaltyDestination !== 'burn' && p.penaltyDestination !== 'treasury' && p.penaltyDestination !== 'relock') {
    errors.push('penaltyDestination must be burn, treasury or relock')
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
    },
    errors,
  }
}
