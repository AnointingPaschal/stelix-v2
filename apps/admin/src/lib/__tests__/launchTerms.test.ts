import { describe, expect, it } from 'vitest'
import {
  decimalToMicro,
  microToDecimal,
  raisedPct,
  requiredTokensForSale,
  smallestToWhole,
  tokensCoverHardCap,
  wholeTokensToSmallest,
} from '../launchTerms'

describe('launchTerms (BigInt money math — never float math)', () => {
  it('regression: 100,000 whole tokens at 18 decimals converts to exact smallest units, never "1e+23"', () => {
    const smallest = wholeTokensToSmallest('100000', 18)
    expect(smallest).toBe('100000000000000000000000')
    expect(smallest).not.toContain('e')
    // The float-math bug this replaces: (100000 * 10**18).toString() === '1e+23'.
    expect((100000 * 10 ** 18).toString()).toBe('1e+23')
    expect(smallest).not.toBe((100000 * 10 ** 18).toString())
  })

  it('rejects scientific notation everywhere it could sneak in', () => {
    expect(wholeTokensToSmallest('1e+5', 18)).toBeNull()
    expect(wholeTokensToSmallest('1e+23', 18)).toBeNull()
    expect(decimalToMicro('1e+2')).toBeNull()
    expect(decimalToMicro('0.1e1')).toBeNull()
    expect(wholeTokensToSmallest('100000.5', 18)).toBeNull()
    expect(decimalToMicro('-0.10')).toBeNull()
    expect(decimalToMicro('')).toBeNull()
  })

  it('decimalToMicro converts USD decimals exactly (no float rounding)', () => {
    expect(decimalToMicro('0.10')).toBe('100000')
    expect(decimalToMicro('10')).toBe('10000000')
    expect(decimalToMicro('10000')).toBe('10000000000')
    expect(decimalToMicro('0.000001')).toBe('1')
    expect(decimalToMicro('0.0000001')).toBeNull() // more than 6dp is rejected, not rounded
    expect(decimalToMicro(' 0.10 ')).toBe('100000')
  })

  it('microToDecimal / smallestToWhole round-trip the stored values', () => {
    expect(microToDecimal('100000')).toBe('0.1')
    expect(microToDecimal('10000000')).toBe('10')
    expect(microToDecimal('10000000000')).toBe('10000')
    expect(smallestToWhole('100000000000000000000000', 18)).toBe('100000')
    expect(smallestToWhole('100000000000000000000000', 6)).toBe('100000000000000000')
    expect(microToDecimal('not-digits')).toBe('0')
  })

  it('tokensForSale must cover hardCap / price', () => {
    // Hard cap $10,000 at $0.10 needs exactly 100,000 tokens (18 dec).
    expect(requiredTokensForSale('10000000000', '100000', 18)).toBe('100000000000000000000000')
    expect(tokensCoverHardCap('100000000000000000000000', '10000000000', '100000', 18)).toBe(true)
    expect(tokensCoverHardCap('10000000000000000000000', '10000000000', '100000', 18)).toBe(false) // only 10,000 tokens
    expect(tokensCoverHardCap('100000000000000000000000', '10000000000', '100000', 6)).toBe(true)
    expect(requiredTokensForSale('10000000000', '0', 18)).toBeNull()
  })

  it('raisedPct is computed with BigInt division', () => {
    expect(raisedPct('2500000000', '10000000000')).toBe(25)
    expect(raisedPct('0', '10000000000')).toBe(0)
    expect(raisedPct('10000000000', '10000000000')).toBe(100)
    expect(raisedPct('1', '3')).toBe(33.33)
    expect(raisedPct('5000000', '0')).toBe(0)
  })
})
