// Launch sale-terms math — BigInt throughout, never float math.
//
// Background: the register form once converted whole tokens with float
// math, so 100,000 × 10^18 became the string "1e+23", which the worker's
// digits-only check rejected. Every conversion here goes through BigInt
// and every input is validated as plain digits / plain decimals first —
// scientific notation ("1e+23", "1e+5") is rejected, never silently
// converted. Shared by the worker (server-side validation) and the
// Launchpad page (edit form), so both sides agree on the same math.

export const MICRO_PER_USD = 1_000_000n

const DIGITS = /^\d+$/

/** "0.10" -> "100000" (micro-USDC digits). Null when the input is not a
 *  plain non-negative decimal with at most 6 decimal places — scientific
 *  notation, negatives and non-numeric input are all rejected. */
export function decimalToMicro(value: string): string | null {
  const v = value.trim()
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(v)
  if (!m) return null
  const frac = (m[2] ?? '').padEnd(6, '0')
  return (BigInt(m[1]) * MICRO_PER_USD + BigInt(frac)).toString()
}

/** "100000" (micro-USDC) -> "0.10". Returns "0" for non-digit input. */
export function microToDecimal(micro: string): string {
  if (!DIGITS.test(micro)) return '0'
  const n = BigInt(micro)
  const whole = n / MICRO_PER_USD
  const frac = n % MICRO_PER_USD
  if (frac === 0n) return whole.toString()
  return `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`
}

/** "100000" whole tokens at 18 decimals -> "100000000000000000000000"
 *  (exact smallest units — never "1e+23"). Null when the input is not
 *  plain digits (scientific notation rejected) or decimals are out of range. */
export function wholeTokensToSmallest(whole: string, decimals: number): string | null {
  const v = whole.trim()
  if (!DIGITS.test(v)) return null
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null
  return (BigInt(v) * 10n ** BigInt(decimals)).toString()
}

/** "100000000000000000000000" smallest units at 18 decimals -> "100000".
 *  Returns "0" for non-digit input. */
export function smallestToWhole(smallest: string, decimals: number): string {
  if (!DIGITS.test(smallest)) return '0'
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return '0'
  const scale = 10n ** BigInt(decimals)
  const n = BigInt(smallest)
  const whole = n / scale
  const frac = n % scale
  if (frac === 0n) return whole.toString()
  return `${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

/** Smallest units of token that must be for sale so the hard cap can be
 *  reached at the given price: ceil(hardCapMicro * 10^decimals /
 *  pricePerTokenMicro). Null for non-digit input or a zero price. */
export function requiredTokensForSale(hardCapMicro: string, pricePerTokenMicro: string, decimals: number): string | null {
  if (!DIGITS.test(hardCapMicro) || !DIGITS.test(pricePerTokenMicro)) return null
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) return null
  const price = BigInt(pricePerTokenMicro)
  if (price <= 0n) return null
  return ((BigInt(hardCapMicro) * 10n ** BigInt(decimals) + price - 1n) / price).toString()
}

/** True when tokensForSale (smallest units) covers the hard cap at the
 *  given price — i.e. the sale can actually sell out at the hard cap. */
export function tokensCoverHardCap(tokensForSale: string, hardCapMicro: string, pricePerTokenMicro: string, decimals: number): boolean {
  if (!DIGITS.test(tokensForSale)) return false
  const required = requiredTokensForSale(hardCapMicro, pricePerTokenMicro, decimals)
  if (required === null) return false
  return BigInt(tokensForSale) >= BigInt(required)
}

/** Raised progress as a percentage (0–100, 2dp) computed with BigInt so
 *  large micro-USDC values never lose precision to float division. */
export function raisedPct(raisedMicro: string, hardCapMicro: string): number {
  if (!DIGITS.test(raisedMicro) || !DIGITS.test(hardCapMicro)) return 0
  const hard = BigInt(hardCapMicro)
  if (hard <= 0n) return 0
  return Number((BigInt(raisedMicro) * 10000n) / hard) / 100
}
