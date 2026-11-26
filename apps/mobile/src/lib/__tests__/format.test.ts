/** Formatting helpers. */
import { fmtDate, fmtNum, fmtPct, fmtPrice, fmtUsd, shortAddress, timeLeft } from '../format';

describe('formatting', () => {
  it('formats USD and numbers', () => {
    expect(fmtUsd(1234.5)).toBe('$1,234.50');
    expect(fmtUsd(0)).toBe('$0.00');
    expect(fmtNum(1234.567, 2)).toBe('1,234.57');
    expect(fmtPct(2.4)).toBe('+2.4%');
    expect(fmtPct(-1.2)).toBe('-1.2%');
  });

  it('formats tiny prices without inventing precision', () => {
    expect(fmtPrice(0.00001234)).toBe('$0.000012');
    expect(fmtPrice(1500)).toBe('$1,500.00');
  });

  it('formats more than 5 zeros after the decimal as subscript notation', () => {
    expect(fmtPrice(0.00000006399)).toBe('$0.0₇6399');
    expect(fmtPrice(0.000000001273)).toBe('$0.0₈1273'); // GTAN
    expect(fmtPrice(0.0000001)).toBe('$0.0₆1');
    expect(fmtPrice(0.0000009999)).toBe('$0.0₆9999');
  });

  it('never shows $0.000000 for a non-zero price; true zero is $0.00', () => {
    expect(fmtPrice(0)).toBe('$0.00');
    expect(fmtPrice(-0)).toBe('$0.00');
    expect(fmtPrice(0.000000000001)).not.toBe('$0.000000');
    expect(fmtPrice(0.000000000001)).toBe('$0.0₁₁1');
  });

  it('keeps normal prices in their existing format', () => {
    expect(fmtPrice(553.1)).toBe('$553.10');
    expect(fmtPrice(3.91)).toBe('$3.91');
    expect(fmtPrice(0.0355)).toBe('$0.0355');
    expect(fmtPrice(0.000001)).toBe('$0.000001'); // exactly 5 zeros — plain decimals
  });

  it('shortens addresses and reports time left', () => {
    expect(shortAddress('0x1234567890abcdef')).toBe('0x123456...abcdef');
    expect(timeLeft(0)).toBe('Matured');
    expect(timeLeft(2 * 86_400_000)).toBe('2d 0h left');
    expect(fmtDate(0)).toMatch(/1970/);
  });
});
