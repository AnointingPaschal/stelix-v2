// Burn helpers (admin/src/lib/burn.ts) — the BigInt conversion is the
// regression guard for the 2026-11-28 register-form bug, where float math
// turned 100,000 x 10^18 into the string "1e+23" and the backend rejected
// it. Whole-token -> smallest-units conversion here is string + BigInt
// only, so huge amounts stay exact.
import { describe, expect, it } from 'vitest'
import { getAddress, Interface } from 'ethers'
import {
  BURN_PREFILLS,
  DEAD_ADDRESS,
  LIVE_STX_ADDRESS,
  assertBurnCalldata,
  assertBurnDestination,
  buildBurnCalldata,
  buildBurnTransaction,
  burnCalldataRecipient,
  isContractCode,
  isLiveToken,
  normalizeTokenAddress,
  unitsToWhole,
  wholeTokensToUnits,
} from './burn'

describe('wholeTokensToUnits', () => {
  it('converts 1,000,000,000 tokens at 18 decimals to exactly 10^27 (the unregistered 1B STX prefill)', () => {
    expect(wholeTokensToUnits('1000000000', 18)).toBe(10n ** 27n)
    expect(wholeTokensToUnits('1000000000', 18).toString()).toBe('1000000000000000000000000000')
  })

  it('converts 1,000,000 tokens at 18 decimals to exactly 10^24 (the old STX prefill)', () => {
    expect(wholeTokensToUnits('1000000', 18)).toBe(10n ** 24n)
  })

  it('converts the 100,000 case from the 2026-11-28 bug without exponent notation', () => {
    expect(wholeTokensToUnits('100000', 18).toString()).toBe('100000000000000000000000')
    expect(wholeTokensToUnits('100000', 18).toString()).not.toContain('e')
  })

  it('handles fractional amounts and 6-decimal tokens', () => {
    expect(wholeTokensToUnits('0.5', 18)).toBe(5n * 10n ** 17n)
    expect(wholeTokensToUnits('123.456', 6)).toBe(123456000n)
    expect(wholeTokensToUnits('1', 0)).toBe(1n)
    expect(wholeTokensToUnits('0', 18)).toBe(0n)
  })

  it('rejects exponent notation, commas, signs and non-numeric input', () => {
    expect(() => wholeTokensToUnits('1e+23', 18)).toThrow()
    expect(() => wholeTokensToUnits('1,000,000', 18)).toThrow()
    expect(() => wholeTokensToUnits('-5', 18)).toThrow()
    expect(() => wholeTokensToUnits('', 18)).toThrow()
    expect(() => wholeTokensToUnits('abc', 18)).toThrow()
  })

  it('rejects more fraction digits than the token has decimals', () => {
    expect(() => wholeTokensToUnits('1.1234567', 6)).toThrow()
  })
})

describe('unitsToWhole', () => {
  it('round-trips the 1B prefill amount', () => {
    expect(unitsToWhole(wholeTokensToUnits('1000000000', 18), 18)).toBe('1000000000')
    expect(unitsToWhole(wholeTokensToUnits('123.456', 6), 6)).toBe('123.456')
    expect(unitsToWhole(0n, 18)).toBe('0')
  })
})

describe('buildBurnCalldata', () => {
  it('targets the dead address, not the token contract or the sender', () => {
    const data = buildBurnCalldata(10n ** 27n)
    // transfer(address,uint256) selector, then the ABI-encoded dead address.
    expect(data.startsWith('0xa9059cbb')).toBe(true)
    expect(data.slice(10, 74).toLowerCase()).toBe(DEAD_ADDRESS.slice(2).toLowerCase().padStart(64, '0'))
    // The amount is the last 32-byte word: 10^27 in hex, no float anywhere.
    expect(data.slice(-64)).toBe((10n ** 27n).toString(16).padStart(64, '0'))
  })
})

describe('live token guard', () => {
  it('recognises the live STX address in any casing', () => {
    expect(isLiveToken(LIVE_STX_ADDRESS)).toBe(true)
    expect(isLiveToken(LIVE_STX_ADDRESS.toLowerCase())).toBe(true)
    expect(isLiveToken('0xC4d720e630d8aeC1F0718a1d30Ab0e5A802F74e7')).toBe(false)
    expect(isLiveToken('0x3C9ACE482cAA2c8137a04cc427dd43FD10C6edf6')).toBe(false)
  })

  it('never prefills the live token', () => {
    for (const p of BURN_PREFILLS) {
      expect(isLiveToken(p.tokenAddress)).toBe(false)
    }
    expect(BURN_PREFILLS).toHaveLength(2)
  })
})
