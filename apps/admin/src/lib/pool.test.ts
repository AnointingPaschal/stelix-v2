/**
 * Uniswap V3 pool reads (admin/src/lib/pool.ts): getPool calldata,
 * slot0 / liquidity decoding, and sqrt-price maths. All maths is
 * BigInt — a V3 sqrt price is a 160-bit fixed-point number.
 */
import { describe, expect, it } from 'vitest';
import {
  STX_USDC_FEE_TIER,
  UNISWAP_V3_FACTORY_ARC_MAINNET,
  decodePoolAddress,
  decodeSlot0,
  decodeUint128,
  formatRatio,
  getPoolCalldata,
  poolPrices,
  sqrtPriceRatio,
  ZERO_ADDRESS,
} from './pool';

const USDC_ARC_MAINNET = '0x3600000000000000000000000000000000000000';
// A dummy token address for the calldata test — the pool view never
// hardcodes a token address; the Worker resolves STX from the registry
// at runtime (see the pool route in src/worker/index.ts).
const TEST_TOKEN = '0x1111111111111111111111111111111111111111';

describe('getPoolCalldata', () => {
  it('encodes getPool(token, USDC, 3000) with the 0x1698ee82 selector', () => {
    const data = getPoolCalldata(TEST_TOKEN, USDC_ARC_MAINNET, STX_USDC_FEE_TIER);
    expect(data.startsWith('0x1698ee82')).toBe(true);
    expect(data.endsWith('0bb8')).toBe(true); // 3000 = 0xbb8
    expect(data.length).toBe(2 + 8 + 64 + 64 + 64);
    expect(data).toContain(TEST_TOKEN.slice(2).toLowerCase());
  });
});

describe('decodePoolAddress', () => {
  it('reads the address from the low 20 bytes of the word', () => {
    const pool = '0x1234567890abcdef1234567890abcdef12345678';
    expect(decodePoolAddress('0x' + '0'.repeat(24) + pool.slice(2))).toBe(pool);
  });

  it('returns the zero address for empty / short data', () => {
    expect(decodePoolAddress('0x')).toBe(ZERO_ADDRESS);
    expect(decodePoolAddress('')).toBe(ZERO_ADDRESS);
  });
});

describe('decodeSlot0', () => {
  it('decodes sqrtPriceX96 = 2^96 and tick 0', () => {
    const sqrt = (2n ** 96n).toString(16).padStart(64, '0');
    const tick = (0).toString(16).padStart(64, '0');
    const decoded = decodeSlot0('0x' + sqrt + tick);
    expect(decoded?.sqrtPriceX96).toBe(2n ** 96n);
    expect(decoded?.tick).toBe(0);
  });

  it('decodes a negative tick (int24 two’s complement)', () => {
    const sqrt = (2n ** 96n).toString(16).padStart(64, '0');
    const tickNeg1 = ((2n ** 24n) - 1n).toString(16).padStart(64, '0');
    expect(decodeSlot0('0x' + sqrt + tickNeg1)?.tick).toBe(-1);
  });

  it('returns null for short data', () => {
    expect(decodeSlot0('0x1234')).toBeNull();
  });
});

describe('decodeUint128', () => {
  it('decodes liquidity', () => {
    const raw = '0x' + (123456789n).toString(16).padStart(64, '0');
    expect(decodeUint128(raw)).toBe(123456789n);
  });
});

describe('sqrtPriceRatio / formatRatio', () => {
  it('price 1 when sqrt = 2^96 and decimals are equal', () => {
    const { num, den } = sqrtPriceRatio(2n ** 96n, 6, 6);
    expect(formatRatio(num, den)).toBe('1');
  });

  it('price 4 when sqrt = 2^97 (doubled)', () => {
    const { num, den } = sqrtPriceRatio(2n ** 97n, 6, 6);
    expect(formatRatio(num, den)).toBe('4');
  });

  it('adjusts for the decimals gap (USDC 6 vs STX 18)', () => {
    const { num, den } = sqrtPriceRatio(2n ** 96n, 6, 18);
    expect(formatRatio(num, den, 12)).toBe('0.000000000001');
    // Default precision (8) cannot show a 1e-12 price — it rounds to 0.
    expect(formatRatio(num, den)).toBe('0');
  });
});

describe('poolPrices', () => {
  it('STX/USDC at parity: 1 STX = 1 USDC when sqrt = 2^96 * 10^6', () => {
    const sqrt = 2n ** 96n * 10n ** 6n;
    const prices = poolPrices(sqrt, 6, 18, true); // token0 = USDC
    expect(prices.priceUsdcPerStx).toBe('1');
    expect(prices.priceStxPerUsdc).toBe('1');
  });

  it('STX at $0.25: sqrt = 2^96 * 2 * 10^6', () => {
    const sqrt = 2n ** 96n * 2n * 10n ** 6n;
    const prices = poolPrices(sqrt, 6, 18, true);
    expect(prices.priceStxPerUsdc).toBe('4');
    expect(prices.priceUsdcPerStx).toBe('0.25');
  });

  it('factory address is the verified Arc Mainnet factory', () => {
    expect(UNISWAP_V3_FACTORY_ARC_MAINNET).toBe('0xf0db7b58379503491d857dB50AC9ece64c653918');
  });
});
