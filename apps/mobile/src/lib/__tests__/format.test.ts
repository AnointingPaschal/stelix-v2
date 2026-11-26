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

  it('shortens addresses and reports time left', () => {
    expect(shortAddress('0x1234567890abcdef')).toBe('0x123456...abcdef');
    expect(timeLeft(0)).toBe('Matured');
    expect(timeLeft(2 * 86_400_000)).toBe('2d 0h left');
    expect(fmtDate(0)).toMatch(/1970/);
  });
});
