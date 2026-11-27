/**
 * Fee / vault settings validation (admin/src/lib/fees.ts) — the same
 * rules guard the Fees page form and the Worker's POST /api/admin/fees,
 * so they cannot drift. The new vault fields (2026-11-27): penalty
 * break cooling-off hours, guardian break delay hours, max price
 * impact on swaps.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_FEES, validateFeePayload, type FeeConfig } from './fees';

describe('validateFeePayload', () => {
  it('accepts the defaults as a valid config', () => {
    const { config, errors } = validateFeePayload(DEFAULT_FEES);
    expect(errors).toEqual([]);
    expect(config).toEqual(DEFAULT_FEES);
  });

  it('accepts the new vault fields at their bounds', () => {
    const ok: FeeConfig = {
      ...DEFAULT_FEES,
      breakCoolingOffHours: 0,
      guardianBreakDelayHours: 168,
      maxPriceImpactPct: 50,
    };
    expect(validateFeePayload(ok).errors).toEqual([]);
    const top: FeeConfig = {
      ...DEFAULT_FEES,
      breakCoolingOffHours: 72,
      guardianBreakDelayHours: 0,
      maxPriceImpactPct: 0,
    };
    expect(validateFeePayload(top).errors).toEqual([]);
  });

  it('rejects out-of-range vault fields', () => {
    expect(
      validateFeePayload({ ...DEFAULT_FEES, breakCoolingOffHours: 73 }).errors,
    ).toContain('breakCoolingOffHours must be between 0 and 72');
    expect(
      validateFeePayload({ ...DEFAULT_FEES, breakCoolingOffHours: -1 }).errors,
    ).toContain('breakCoolingOffHours must be between 0 and 72');
    expect(
      validateFeePayload({ ...DEFAULT_FEES, guardianBreakDelayHours: 169 }).errors,
    ).toContain('guardianBreakDelayHours must be between 0 and 168');
    expect(
      validateFeePayload({ ...DEFAULT_FEES, maxPriceImpactPct: 51 }).errors,
    ).toContain('maxPriceImpactPct must be between 0 and 50');
  });

  it('fills missing new fields from the defaults (older published configs stay valid)', () => {
    const { breakCoolingOffHours: _a, guardianBreakDelayHours: _b, maxPriceImpactPct: _c, ...old } =
      DEFAULT_FEES as FeeConfig & Record<string, unknown>;
    const { config, errors } = validateFeePayload(old);
    expect(errors).toEqual([]);
    expect(config?.breakCoolingOffHours).toBe(24);
    expect(config?.guardianBreakDelayHours).toBe(48);
    expect(config?.maxPriceImpactPct).toBe(5);
  });

  it('accepts decimal fee values such as 0.1 (the form used to eat the decimal point)', () => {
    const decimals: FeeConfig = {
      ...DEFAULT_FEES,
      autoSellFeePct: 0.1,
      minLockUsd: 0.1,
      maxLockUsd: 100000.5,
      defaultPenaltyPct: 5.5,
      defaultSlippagePct: 0.1,
      maxPriceImpactPct: 0.25,
    };
    const { config, errors } = validateFeePayload(decimals);
    expect(errors).toEqual([]);
    expect(config?.autoSellFeePct).toBe(0.1);
    expect(config?.minLockUsd).toBe(0.1);
    expect(config?.defaultSlippagePct).toBe(0.1);
    expect(config?.maxPriceImpactPct).toBe(0.25);
  });

  it('still rejects the old invalid ranges', () => {
    expect(validateFeePayload({ ...DEFAULT_FEES, minLockUsd: -1 }).errors.length).toBeGreaterThan(0);
    expect(validateFeePayload({ ...DEFAULT_FEES, defaultPenaltyPct: 4 }).errors.length).toBeGreaterThan(0);
    expect(validateFeePayload({ ...DEFAULT_FEES, maxLockUsd: 5, minLockUsd: 10 }).errors).toContain(
      'maxLockUsd must be greater than minLockUsd',
    );
  });
});
