/** GoPlus token security parsing — real WKC response shape (verified live
 *  2026-11-26: is_honeypot "0", is_mintable "0", holder_count 183682,
 *  holders[] with percent). Missing/unsupported data parses to nulls. */
import { parseGoPlusSecurity } from '../prices';

const WKC = '0x6Ec90334d89dBdc89E08A133271be3d104128Edb';

function goplusPayload(overrides: Record<string, unknown> = {}) {
  return {
    code: 1,
    message: 'OK',
    result: {
      [WKC.toLowerCase()]: {
        is_honeypot: '0',
        is_mintable: '0',
        is_proxy: '0',
        owner_address: '0x0000000000000000000000000000000000000000',
        can_take_back_ownership: '0',
        holder_count: '183682',
        holders: [
          { address: '0x000000000000000000000000000000000000dead', percent: '0.360150979007265724', is_locked: 1 },
          { address: '0x1111111111111111111111111111111111111111', percent: '12.5', is_locked: 0 },
          { address: '0x2222222222222222222222222222222222222222', percent: '8.25', is_locked: 0 },
        ],
        buy_tax: '0.02',
        sell_tax: '0.02',
        ...overrides,
      },
    },
  };
}

describe('parseGoPlusSecurity', () => {
  it('parses the WKC response: not a honeypot, mint renounced, holders, top-10 share', () => {
    const s = parseGoPlusSecurity(goplusPayload(), WKC);
    expect(s).not.toBeNull();
    expect(s!.honeypot).toBe(false);
    expect(s!.mintAuthorityRenounced).toBe(true);
    expect(s!.holderCount).toBe(183682);
    // 0.36 + 12.5 + 8.25 = 21.11
    expect(s!.top10SharePct).toBeCloseTo(21.11, 2);
    expect(s!.buyTaxPct).toBeCloseTo(2, 5);
    expect(s!.sellTaxPct).toBeCloseTo(2, 5);
  });

  it('flags a honeypot and a mintable contract', () => {
    const s = parseGoPlusSecurity(goplusPayload({ is_honeypot: '1', is_mintable: '1' }), WKC);
    expect(s!.honeypot).toBe(true);
    expect(s!.mintAuthorityRenounced).toBe(false);
  });

  it('returns nulls (never a guessed pass/fail) when fields are missing', () => {
    const s = parseGoPlusSecurity(goplusPayload({ is_honeypot: undefined, is_mintable: undefined, holder_count: undefined, holders: undefined }), WKC);
    expect(s!.honeypot).toBeNull();
    expect(s!.mintAuthorityRenounced).toBeNull();
    expect(s!.holderCount).toBeNull();
    expect(s!.top10SharePct).toBeNull();
  });

  it('returns null for an empty result, a wrong address, or garbage', () => {
    expect(parseGoPlusSecurity({ code: 1, result: {} }, WKC)).toBeNull();
    expect(parseGoPlusSecurity(goplusPayload(), '0x0000000000000000000000000000000000000001')).toBeNull();
    expect(parseGoPlusSecurity(null, WKC)).toBeNull();
    expect(parseGoPlusSecurity('nope', WKC)).toBeNull();
  });
});
