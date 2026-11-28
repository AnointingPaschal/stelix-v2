// Burn tokens — shared logic for the Contract Studio "Burn tokens" card.
// Burning is a plain ERC-20 transfer to the standard dead address: the
// LaunchToken contract has NO burn function (fixed supply, no mint /
// burn / owner / pause), so the tokens leave the sender's wallet forever
// and nobody controls the receiving address. Permanent and irreversible.
//
// Amounts use BigInt throughout. Lesson from the 2026-11-28 register-form
// bug: float math turned 100,000 x 10^18 into the string "1e+23", which
// the backend rejected. Whole-token -> smallest-units conversion here is
// string + BigInt only, and it is covered by burn.test.ts.
import { getAddress, Interface } from 'ethers'

/** The standard burn / dead address. Nobody controls this address.
 *  ONE compile-time constant, in this file only. It is NEVER
 *  user-editable, NEVER read from URL params, query strings,
 *  localStorage, the database, or any API response, and there is NO
 *  input field for the destination anywhere in the UI. A unit test pins
 *  the exact EIP-55 checksum — if this constant ever changes, the test
 *  fails. */
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD'

/** The LIVE registered STX token (Arc Mainnet). It must NEVER be
 *  prefilled as a burn target; selecting it manually needs a strong
 *  warning before the signing step. */
export const LIVE_STX_ADDRESS = '0x430e57ed7487d606b2ABe1ca08aa3D6d62141ad9'

export interface BurnPrefill {
  label: string
  chainId: string
  tokenAddress: string
  /** Whole-token amount, as a plain decimal string (never a float). */
  amountWhole: string
  note: string
}

/** One-tap burn entries, as code constants only — never sourced from
 *  storage or params a third party could poison. Both are unwanted
 *  tokens whose full supply sits in the owner's wallet; the live token
 *  (0x430e…) is deliberately absent. Decimals are NOT in the prefill:
 *  they come from the on-chain token read, never from typed-in data. */
export const BURN_PREFILLS: BurnPrefill[] = [
  {
    label: 'Old STX — full 1,000,000',
    chainId: 'arc-mainnet',
    tokenAddress: '0xC4d720e630d8aeC1F0718a1d30Ab0e5A802F74e7',
    amountWhole: '1000000',
    note: 'The old 1M-supply STX. Already out of the token registry.',
  },
  {
    label: 'Unregistered 1B STX — full 1,000,000,000',
    chainId: 'arc-mainnet',
    tokenAddress: '0x3C9ACE482cAA2c8137a04cc427dd43FD10C6edf6',
    amountWhole: '1000000000',
    note: 'The 1B-supply STX that was never registered as a launch.',
  },
]

const ERC20_TRANSFER_ABI = ['function transfer(address to, uint256 amount) returns (bool)']
const transferInterface = new Interface(ERC20_TRANSFER_ABI)

/** True when the address is the live registered STX token (any casing). */
export function isLiveToken(address: string): boolean {
  return address.trim().toLowerCase() === LIVE_STX_ADDRESS.toLowerCase()
}

/**
 * Convert a whole-token amount ("1000000", "0.5", "123.456") to smallest
 * units using BigInt only — no float math anywhere, so huge amounts such
 * as 1,000,000,000 tokens at 18 decimals stay exact (10^27, never "1e+27").
 * Throws on empty input, exponent notation ("1e+23"), a negative amount,
 * non-numeric characters, or more fraction digits than `decimals` allows.
 */
export function wholeTokensToUnits(amountWhole: string, decimals: number): bigint {
  const amount = amountWhole.trim()
  if (!/^\d+(\.\d+)?$/.test(amount)) {
    throw new Error('Amount must be a plain number like 1000000 or 0.5 — no commas, no exponent notation, no sign.')
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error('Token decimals must be a whole number from 0 to 18.')
  }
  const [whole, fraction = ''] = amount.split('.')
  if (fraction.length > decimals) {
    throw new Error(`Amount has ${fraction.length} decimal places but this token only has ${decimals}.`)
  }
  const scale = 10n ** BigInt(decimals)
  const wholeUnits = BigInt(whole === '' ? '0' : whole) * scale
  const fractionUnits = fraction === ''
    ? 0n
    : BigInt(fraction.padEnd(decimals, '0'))
  return wholeUnits + fractionUnits
}

/** Smallest units back to a human-readable whole-token string (BigInt only). */
export function unitsToWhole(units: bigint, decimals: number): string {
  if (decimals === 0) return units.toString()
  const scale = 10n ** BigInt(decimals)
  const whole = units / scale
  const rest = units % scale
  if (rest === 0n) return whole.toString()
  return `${whole}.${rest.toString().padStart(decimals, '0').replace(/0+$/, '')}`
}

/**
 * Validate a token address and return its EIP-55 checksummed form.
 * Accepts all-lowercase / all-uppercase input (valid un-checksummed
 * forms) and correctly checksummed input; rejects garbage and any
 * mixed-case address whose checksum does not verify. The checksummed
 * form is what every on-chain call and every displayed address uses.
 */
export function normalizeTokenAddress(input: string): string {
  const trimmed = input.trim()
  try {
    return getAddress(trimmed)
  } catch {
    throw new Error('Token address is not a valid checksummed 0x address — check it and try again.')
  }
}

/** True when an eth_getCode result means "a contract lives here".
 *  eth_getCode returns '0x' for an externally owned account (or an
 *  address with no code) — burning to such an address must be refused:
 *  it is not an ERC-20 token. */
export function isContractCode(code: string | null | undefined): boolean {
  return typeof code === 'string' && code.length > 2
}

/**
 * Defense in depth, check 1 of 2: the transfer recipient must be the
 * dead-address constant. Throws — and nothing is signed — on any other
 * destination. Call at transaction build time AND immediately before
 * the wallet-sign call (see assertBurnCalldata).
 */
export function assertBurnDestination(to: string): void {
  if (to.trim().toLowerCase() !== DEAD_ADDRESS.toLowerCase()) {
    throw new Error('Burn destination is not the verified dead address — refusing to sign.')
  }
}

/** Decode the recipient out of transfer calldata (throws on bad data). */
export function burnCalldataRecipient(data: string): string {
  const decoded = transferInterface.decodeFunctionData('transfer', data)
  return decoded[0] as string
}

/**
 * Defense in depth, check 2 of 2: re-verify the ALREADY-BUILT calldata
 * immediately before the wallet-sign call — decode it and confirm the
 * recipient is the dead-address constant (and, when given, that the
 * amount matches). A tampered or mis-built payload aborts here and
 * nothing is signed.
 */
export function assertBurnCalldata(data: string, expectedAmount?: bigint): void {
  let recipient: string
  let amount: bigint
  try {
    const decoded = transferInterface.decodeFunctionData('transfer', data)
    recipient = decoded[0] as string
    amount = decoded[1] as bigint
  } catch {
    throw new Error('Burn transaction data is not a valid ERC-20 transfer — refusing to sign.')
  }
  assertBurnDestination(recipient)
  if (expectedAmount !== undefined && amount !== expectedAmount) {
    throw new Error('Burn amount in the transaction data does not match the confirmed amount — refusing to sign.')
  }
}

/**
 * Build the ERC-20 transfer calldata that burns `amountUnits` of a token:
 * transfer(deadAddress, amount). The burn itself is just sending this
 * transaction from the connected wallet — no backend call, no D1 write.
 * The recipient is ALWAYS the DEAD_ADDRESS constant — this function
 * takes no destination argument, so no caller can redirect it.
 */
export function buildBurnCalldata(amountUnits: bigint): string {
  return transferInterface.encodeFunctionData('transfer', [DEAD_ADDRESS, amountUnits])
}

/**
 * Build the burn transaction: transfer(amount) of the token to the dead
 * address. Check 1 runs here (destination asserted at build time); the
 * caller MUST run assertBurnCalldata on the returned data immediately
 * before signing (check 2). Returns the checksummed token address as
 * the transaction `to` and the calldata as `data`.
 */
export function buildBurnTransaction(tokenAddress: string, amountUnits: bigint): { to: string; data: string; value: bigint } {
  const to = normalizeTokenAddress(tokenAddress)
  const data = buildBurnCalldata(amountUnits)
  assertBurnDestination(DEAD_ADDRESS)
  assertBurnCalldata(data, amountUnits)
  return { to, data, value: 0n }
}

/** The ERC-20 ABI the burn card needs for on-chain reads + the transfer. */
export const BURN_ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
] as const
