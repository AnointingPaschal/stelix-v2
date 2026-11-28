import { describe, expect, it } from 'vitest'
import { isValidLogoUrl, normalizeDisplayName, normalizeDisplaySymbol, parseSortOrder } from './tokenEdit'

describe('parseSortOrder', () => {
  it('accepts plain digits, including 0', () => {
    expect(parseSortOrder('0')).toBe(0)
    expect(parseSortOrder('3')).toBe(3)
    expect(parseSortOrder('  12 ')).toBe(12)
  })
  it('rejects scientific notation, negatives, decimals and junk', () => {
    expect(parseSortOrder('1e+3')).toBeNull()
    expect(parseSortOrder('-1')).toBeNull()
    expect(parseSortOrder('1.5')).toBeNull()
    expect(parseSortOrder('')).toBeNull()
    expect(parseSortOrder('abc')).toBeNull()
  })
  it('rejects absurdly large values', () => {
    expect(parseSortOrder('1000001')).toBeNull()
    expect(parseSortOrder('1000000')).toBe(1000000)
  })
})

describe('isValidLogoUrl', () => {
  it('accepts empty (clear the logo) and https URLs', () => {
    expect(isValidLogoUrl('')).toBe(true)
    expect(isValidLogoUrl('https://stelix-admin.pages.dev/api/logo/l0123456789abcdef01234567')).toBe(true)
    expect(isValidLogoUrl('https://example.com/logo.png')).toBe(true)
  })
  it('rejects http, relative paths and junk', () => {
    expect(isValidLogoUrl('http://example.com/logo.png')).toBe(false)
    expect(isValidLogoUrl('/api/logo/l0123456789abcdef01234567')).toBe(false)
    expect(isValidLogoUrl('not a url')).toBe(false)
    expect(isValidLogoUrl('l0123456789abcdef01234567')).toBe(false)
  })
})

describe('normalizeDisplayName', () => {
  it('trims, allows empty, rejects over 64 chars', () => {
    expect(normalizeDisplayName('  Stelix  ')).toBe('Stelix')
    expect(normalizeDisplayName('')).toBe('')
    expect(normalizeDisplayName('x'.repeat(64))).toBe('x'.repeat(64))
    expect(normalizeDisplayName('x'.repeat(65))).toBeNull()
  })
})

describe('normalizeDisplaySymbol', () => {
  it('trims and upper-cases, rejects empty and over 32 chars', () => {
    expect(normalizeDisplaySymbol(' stx ')).toBe('STX')
    expect(normalizeDisplaySymbol('')).toBeNull()
    expect(normalizeDisplaySymbol('   ')).toBeNull()
    expect(normalizeDisplaySymbol('x'.repeat(33))).toBeNull()
  })
})
