// Token registry display edits — shared validation for the worker
// (PATCH /api/admin/tokens/:id) and the Tokens page Edit modal, so both
// sides agree on the same rules.
//
// GUARDRAIL: on-chain truth is NEVER editable — address, chain and
// decimals are not in this module at all. Only the registry display
// changes here: display name, display symbol, verified, featured, sort
// order and logo. A name/symbol edit only changes what the app shows;
// the on-chain token is untouched.
//
// Sort order is plain digits only — the same rule as launchTerms.ts:
// scientific notation ("1e+3") is rejected, never silently converted.
// The logo is validated the same way the existing logo scheme works:
// an uploaded logo is stored in D1 and served at a short https URL
// (/api/logo/<key>), so a logo value is either empty (clear it) or a
// valid https URL (at most 2048 chars).

/** Non-negative integer sort order from a text field. Null when the
 *  input is not plain digits (scientific notation rejected) or is
 *  absurdly large — sort order is a small display position. */
export function parseSortOrder(value: string): number | null {
  const v = value.trim()
  if (!/^\d+$/.test(v)) return null
  const n = BigInt(v)
  if (n > 1_000_000n) return null
  return Number(n)
}

/** True when a logo value is acceptable: empty (clears the logo) or a
 *  valid https URL. Uploaded logos come back from
 *  POST /api/admin/launches/logo as an https URL of the
 *  /api/logo/<key> form, so they pass this check as-is. */
export function isValidLogoUrl(value: string): boolean {
  const v = value.trim()
  if (v === '') return true
  if (v.length > 2048) return false
  try {
    const u = new URL(v)
    return u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Display name: trimmed, at most 64 chars. Empty means "no display
 *  name" (the app falls back to the symbol). Null when too long. */
export function normalizeDisplayName(value: string): string | null {
  const v = value.trim()
  if (v.length > 64) return null
  return v
}

/** Display symbol: trimmed, upper-cased, 1–32 chars. Null when empty
 *  or too long. */
export function normalizeDisplaySymbol(value: string): string | null {
  const v = value.trim().toUpperCase()
  if (v.length === 0 || v.length > 32) return null
  return v
}
