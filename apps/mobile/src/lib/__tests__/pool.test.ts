/**
 * Unit tests for the Uniswap V3 pool layer (src/lib/pool.ts).
 * Pure price/tick math + pool-exists logic with a mocked provider.
 * No network, no React Native imports. Run: npm test
 *
 * The pool token is resolved from the registry at runtime — so the
 * tests use fixture token addresses, never a real deployed token.
 * A fixture "new token" address proves the generic path: the math
 * and the pool reads do not depend on any particular address.
 */
import { ethers } from 'ethers';
import {
  POOL_FEE_TIER,
  MIN_TICK,
  MAX_TICK,
  amountsMatchPrice,
  baseIsToken0,
  bigintSqrt,
  buildMintParams,
  defaultFullRangeTicks,
  formatTokenAmount,
  getPoolAddress,
  getPoolForPair,
  getPoolPrice,
  getPoolState,
  parseTokenAmount,
  poolStateToBasePrice,
  priceQuotePerBaseToSqrtPriceX96,
  priceRangeToTicks,
  priceToken1PerToken0ToSqrtPriceX96,
  priceToken1PerToken0ToTick,
  resolveFeeRecipient,
  resolvePoolToken,
  roundTickToSpacing,
  sqrtPriceX96ToPriceToken1PerToken0,
  sqrtPriceX96ToTick,
  stxForUsdc,
  tickSpacingForFee,
  tickToPriceToken1PerToken0,
  tickToSqrtPriceX96,
  usdcForStx,
  type PoolToken,
} from '../pool';
import type { AdminTokenEntry } from '../adminSync';

// Fixture pair: BASE is the pool token (18 dec), QUOTE is the
// stablecoin (6 dec). BASE's address is HIGHER than QUOTE's, so
// BASE is token1 — the same layout as STX/USDC on Arc Mainnet —
// and the flipped pair below proves the other order works too.
const BASE: PoolToken = {
  address: '0xc0ffee254729296a45a3885639ac7e10f9d54979',
  symbol: 'STX',
  decimals: 18,
};
const QUOTE: PoolToken = {
  address: '0x3600000000000000000000000000000000000000',
  symbol: 'USDC',
  decimals: 6,
};
// Flipped layout: base address LOWER than quote — base is token0.
const BASE_LOW: PoolToken = {
  address: '0x1111111111111111111111111111111111111111',
  symbol: 'STX',
  decimals: 18,
};
const QUOTE_HIGH: PoolToken = {
  address: '0x9999999999999999999999999999999999999999',
  symbol: 'USDC',
  decimals: 6,
};

/** Fake provider: `call` returns canned ABI-encoded results keyed by
 *  the function selector + target address. */
function fakeProvider(
  handlers: Record<string, (data: string) => string>,
): { call: (tx: { to?: string; data?: string }) => Promise<string> } {
  return {
    call: async (tx: { to?: string; data?: string }) => {
      const to = (tx.to ?? '').toLowerCase();
      const selector = (tx.data ?? '').slice(0, 10).toLowerCase();
      const h = handlers[`${to}:${selector}`] ?? handlers[selector];
      if (!h) throw new Error(`Unexpected call to ${to} ${selector}`);
      return h(tx.data ?? '');
    },
  };
}

const coder = ethers.AbiCoder.defaultAbiCoder();
const addrWord = (a: string) => coder.encode(['address'], [a]);

function registryEntry(over: Partial<AdminTokenEntry> = {}): AdminTokenEntry {
  return {
    id: 1,
    symbol: 'STX',
    chainId: 'arc-mainnet',
    address: '0x2222222222222222222222222222222222222222',
    decimals: 18,
    verified: true,
    featured: false,
    logoUrl: null,
    sortOrder: 0,
    ...over,
  };
}

describe('resolvePoolToken', () => {
  it('returns null when no STX token is registered yet', () => {
    expect(resolvePoolToken([])).toBeNull();
    expect(resolvePoolToken([registryEntry({ symbol: 'USDT', chainId: 'arc-mainnet' })])).toBeNull();
    expect(resolvePoolToken([registryEntry({ chainId: 'bnb' })])).toBeNull();
  });
  it('resolves the registered STX token for the pool chain', () => {
    const t = resolvePoolToken([registryEntry()]);
    expect(t).toEqual({
      address: '0x2222222222222222222222222222222222222222',
      symbol: 'STX',
      decimals: 18,
    });
  });
  it('prefers a verified entry, then the admin display order', () => {
    const unverifiedFirst = registryEntry({ verified: false, sortOrder: 0 });
    const verifiedSecond = registryEntry({
      verified: true,
      sortOrder: 5,
      address: '0x3333333333333333333333333333333333333333',
    });
    expect(resolvePoolToken([unverifiedFirst, verifiedSecond])?.address).toBe(
      '0x3333333333333333333333333333333333333333',
    );
    const earlier = registryEntry({ sortOrder: 0 });
    const later = registryEntry({ sortOrder: 2, address: '0x4444444444444444444444444444444444444444' });
    expect(resolvePoolToken([later, earlier])?.address).toBe(
      '0x2222222222222222222222222222222222222222',
    );
  });
  it('rejects a malformed registry entry instead of returning it', () => {
    expect(resolvePoolToken([registryEntry({ address: 'not-an-address' })])).toBeNull();
    expect(resolvePoolToken([registryEntry({ decimals: 0 })])).toBeNull();
  });
  it('swapping the registry address changes the resolved token (no hardcoded address)', () => {
    const oldToken = resolvePoolToken([registryEntry()]);
    const newToken = resolvePoolToken([
      registryEntry({ address: '0x5555555555555555555555555555555555555555' }),
    ]);
    expect(oldToken?.address).not.toBe(newToken?.address);
    expect(newToken?.address).toBe('0x5555555555555555555555555555555555555555');
  });
});

describe('bigintSqrt', () => {
  it('returns exact roots and floors non-squares', () => {
    expect(bigintSqrt(0n)).toBe(0n);
    expect(bigintSqrt(1n)).toBe(1n);
    expect(bigintSqrt(144n)).toBe(12n);
    expect(bigintSqrt(150n)).toBe(12n);
    expect(bigintSqrt(2n ** 192n)).toBe(2n ** 96n);
  });
  it('throws on negative input', () => {
    expect(() => bigintSqrt(-1n)).toThrow();
  });
});

describe('sqrt price <-> quote-per-base price', () => {
  it('round-trips a 2.50 USDC/STX price (token0 USDC 6 dec, token1 STX 18 dec)', () => {
    const sqrt = priceToken1PerToken0ToSqrtPriceX96(2.5, QUOTE.decimals, BASE.decimals);
    expect(sqrt > 0n).toBe(true);
    const back = sqrtPriceX96ToPriceToken1PerToken0(sqrt, QUOTE.decimals, BASE.decimals);
    expect(Math.abs(back - 2.5) / 2.5).toBeLessThan(0.001);
  });
  it('round-trips tiny and large prices', () => {
    for (const p of [0.000001, 0.01, 1, 100, 10000]) {
      const sqrt = priceToken1PerToken0ToSqrtPriceX96(p, QUOTE.decimals, BASE.decimals);
      const back = sqrtPriceX96ToPriceToken1PerToken0(sqrt, QUOTE.decimals, BASE.decimals);
      expect(Math.abs(back - p) / p).toBeLessThan(0.001);
    }
  });
  it('a higher sqrt price means a cheaper token1 (more token1 per token0)', () => {
    const cheap = sqrtPriceX96ToPriceToken1PerToken0(2n ** 100n, QUOTE.decimals, BASE.decimals);
    const dear = sqrtPriceX96ToPriceToken1PerToken0(2n ** 90n, QUOTE.decimals, BASE.decimals);
    expect(cheap).toBeLessThan(dear);
  });
  it('throws on a non-positive sqrt price or price', () => {
    expect(() => sqrtPriceX96ToPriceToken1PerToken0(0n, 6, 18)).toThrow();
    expect(() => priceToken1PerToken0ToSqrtPriceX96(0, 6, 18)).toThrow();
    expect(() => priceToken1PerToken0ToSqrtPriceX96(-1, 6, 18)).toThrow();
  });
});

describe('pair-frame price helpers', () => {
  it('baseIsToken0 follows address order', () => {
    expect(baseIsToken0(BASE, QUOTE)).toBe(false); // STX address > USDC
    expect(baseIsToken0(BASE_LOW, QUOTE_HIGH)).toBe(true);
  });
  it('quote-per-base price <-> sqrt round-trips on both pool layouts', () => {
    for (const [base, quote] of [
      [BASE, QUOTE],
      [BASE_LOW, QUOTE_HIGH],
    ] as [PoolToken, PoolToken][]) {
      const sqrt = priceQuotePerBaseToSqrtPriceX96(2.5, base, quote);
      const state = {
        pool: '0x0',
        token0: '',
        token1: '',
        fee: 3000,
        tickSpacing: 60,
        sqrtPriceX96: sqrt,
        tick: 0,
        liquidity: 0n,
        priceToken1PerToken0: 0,
        priceToken0PerToken1: 0,
      };
      // Re-derive the pool-frame prices from the sqrt for the check.
      const dec0 = baseIsToken0(base, quote) ? base.decimals : quote.decimals;
      const dec1 = baseIsToken0(base, quote) ? quote.decimals : base.decimals;
      const p1 = sqrtPriceX96ToPriceToken1PerToken0(sqrt, dec0, dec1);
      state.priceToken1PerToken0 = p1;
      state.priceToken0PerToken1 = 1 / p1;
      state.token0 = baseIsToken0(base, quote) ? base.address : quote.address;
      state.token1 = baseIsToken0(base, quote) ? quote.address : base.address;
      const back = poolStateToBasePrice(state, base, quote);
      expect(Math.abs(back - 2.5) / 2.5).toBeLessThan(0.001);
    }
  });
  it('priceRangeToTicks covers the asked range on both layouts', () => {
    for (const [base, quote] of [
      [BASE, QUOTE],
      [BASE_LOW, QUOTE_HIGH],
    ] as [PoolToken, PoolToken][]) {
      const { tickLower, tickUpper } = priceRangeToTicks(1, 4, base, quote, 60);
      expect(tickLower % 60 === 0).toBe(true);
      expect(tickUpper % 60 === 0).toBe(true);
      expect(tickLower).toBeLessThan(tickUpper);
      const dec0 = baseIsToken0(base, quote) ? base.decimals : quote.decimals;
      const dec1 = baseIsToken0(base, quote) ? quote.decimals : base.decimals;
      const lo = tickToPriceToken1PerToken0(tickLower, dec0, dec1);
      const hi = tickToPriceToken1PerToken0(tickUpper, dec0, dec1);
      // Convert the tick-edge prices back to quote-per-base and check
      // the range covers [1, 4].
      const toBase = (p1: number) => (baseIsToken0(base, quote) ? 1 / p1 : p1);
      expect(Math.min(toBase(lo), toBase(hi))).toBeLessThanOrEqual(1.01);
      expect(Math.max(toBase(lo), toBase(hi))).toBeGreaterThanOrEqual(3.99);
    }
  });
  it('priceRangeToTicks rejects an inverted range', () => {
    expect(() => priceRangeToTicks(4, 1, BASE, QUOTE, 60)).toThrow();
    expect(() => priceRangeToTicks(0, 1, BASE, QUOTE, 60)).toThrow();
  });
});

describe('tick math', () => {
  it('tick 0 is the 1:1 raw price', () => {
    const sqrt = tickToSqrtPriceX96(0);
    expect(sqrt).toBe(2n ** 96n);
    expect(sqrtPriceX96ToTick(sqrt)).toBe(0);
  });
  it('tick <-> sqrt round-trips across the range', () => {
    for (const t of [-887220, -100000, -60, 0, 60, 100000, 887220]) {
      const sqrt = tickToSqrtPriceX96(t);
      expect(sqrtPriceX96ToTick(sqrt)).toBe(t);
    }
  });
  it('tick <-> price round-trips for USDC/STX', () => {
    for (const p of [0.01, 0.5, 2.5, 100]) {
      const tick = priceToken1PerToken0ToTick(p, QUOTE.decimals, BASE.decimals);
      const back = tickToPriceToken1PerToken0(tick, QUOTE.decimals, BASE.decimals);
      expect(Math.abs(back - p) / p).toBeLessThan(0.001);
    }
  });
  it('rejects ticks outside the V3 bounds', () => {
    expect(() => tickToSqrtPriceX96(MIN_TICK - 1)).toThrow();
    expect(() => tickToSqrtPriceX96(MAX_TICK + 1)).toThrow();
  });
  it('tick spacing is 60 for the 0.3% tier', () => {
    expect(tickSpacingForFee(500)).toBe(10);
    expect(tickSpacingForFee(3000)).toBe(60);
    expect(tickSpacingForFee(10000)).toBe(200);
    expect(tickSpacingForFee(123)).toBeNull();
  });
  it('rounds ticks to the spacing in the right direction', () => {
    expect(roundTickToSpacing(100, 60, 'down')).toBe(60);
    expect(roundTickToSpacing(100, 60, 'up')).toBe(120);
    expect(roundTickToSpacing(-100, 60, 'down')).toBe(-120);
    expect(roundTickToSpacing(-100, 60, 'up')).toBe(-60);
    expect(roundTickToSpacing(120, 60, 'down')).toBe(120);
  });
  it('default full range is inside the bounds and spacing-aligned', () => {
    const { tickLower, tickUpper } = defaultFullRangeTicks(60);
    expect(tickLower).toBeGreaterThanOrEqual(MIN_TICK);
    expect(tickUpper).toBeLessThanOrEqual(MAX_TICK);
    expect(tickLower % 60 === 0).toBe(true);
    expect(tickUpper % 60 === 0).toBe(true);
    expect(tickLower).toBeLessThan(tickUpper);
  });
});

describe('amount parsing', () => {
  it('parses decimal strings to raw units without float error', () => {
    expect(parseTokenAmount('1.5', 6)).toBe(1500000n);
    expect(parseTokenAmount('0.1', 18)).toBe(100000000000000000n);
    expect(parseTokenAmount('1000', 18)).toBe(1000n * 10n ** 18n);
  });
  it('truncates (never rounds up) past the token decimals', () => {
    expect(parseTokenAmount('1.1234567', 6)).toBe(1123456n);
  });
  it('throws on non-numeric or negative amounts', () => {
    expect(() => parseTokenAmount('abc', 6)).toThrow();
    expect(() => parseTokenAmount('-1', 6)).toThrow();
    expect(() => parseTokenAmount('', 6)).toThrow();
  });
  it('formats raw units back to a decimal string', () => {
    expect(formatTokenAmount(1500000n, 6)).toBe('1.5');
    expect(formatTokenAmount(100000000000000000n, 18)).toBe('0.1');
    expect(formatTokenAmount(0n, 18)).toBe('0');
  });
});

describe('amount ratio helpers', () => {
  it('converts between STX and USDC at a price', () => {
    expect(usdcForStx(100, 2.5)).toBe(250);
    expect(stxForUsdc(250, 2.5)).toBe(100);
    expect(() => stxForUsdc(250, 0)).toThrow();
  });
  it('amountsMatchPrice accepts a matching ratio and rejects a wrong one', () => {
    expect(amountsMatchPrice(250, 100, 2.5)).toBe(true);
    expect(amountsMatchPrice(251, 100, 2.5)).toBe(true); // within 0.5%
    expect(amountsMatchPrice(300, 100, 2.5)).toBe(false);
    expect(amountsMatchPrice(0, 100, 2.5)).toBe(false);
  });
});

describe('buildMintParams', () => {
  const base = {
    tokenA: BASE.address,
    tokenB: QUOTE.address,
    decimalsA: BASE.decimals,
    decimalsB: QUOTE.decimals,
    symbolA: 'STX',
    symbolB: 'USDC',
    fee: POOL_FEE_TIER,
    tickLower: -887220,
    tickUpper: 887220,
    amountADesired: '100',
    amountBDesired: '250',
    recipient: '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383',
    deadline: 1795000000,
    sqrtPriceX96: priceToken1PerToken0ToSqrtPriceX96(2.5, QUOTE.decimals, BASE.decimals),
  };
  it('orders tokens (USDC token0, STX token1) and maps amounts', () => {
    const p = buildMintParams(base);
    expect(p.token0.toLowerCase()).toBe(QUOTE.address.toLowerCase());
    expect(p.token1.toLowerCase()).toBe(BASE.address.toLowerCase());
    expect(p.fee).toBe(3000);
    expect(p.amount0Desired).toBe(250000000n); // 250 USDC, 6 dec
    expect(p.amount1Desired).toBe(100n * 10n ** 18n); // 100 STX, 18 dec
    // Default 0.5% slippage guard on the mins.
    expect(p.amount0Min).toBe((250000000n * 9950n) / 10000n);
    expect(p.amount1Min).toBe((100n * 10n ** 18n * 9950n) / 10000n);
    expect(p.recipient).toBe(base.recipient);
    expect(p.sqrtPriceX96).toBe(base.sqrtPriceX96);
  });
  it('is order-independent: swapping tokenA/tokenB gives the same params', () => {
    const swapped = buildMintParams({
      ...base,
      tokenA: QUOTE.address,
      tokenB: BASE.address,
      decimalsA: QUOTE.decimals,
      decimalsB: BASE.decimals,
      symbolA: 'USDC',
      symbolB: 'STX',
      amountADesired: '250',
      amountBDesired: '100',
    });
    const p = buildMintParams(base);
    expect(swapped).toEqual(p);
  });
  it('rejects a bad range, misaligned ticks, zero amounts and bad slippage', () => {
    expect(() => buildMintParams({ ...base, tickLower: 100, tickUpper: 60 })).toThrow();
    expect(() => buildMintParams({ ...base, tickLower: 61, tickUpper: 120 })).toThrow();
    expect(() => buildMintParams({ ...base, amountADesired: '0' })).toThrow();
    expect(() => buildMintParams({ ...base, slippageBps: 10001 })).toThrow();
    expect(() => buildMintParams({ ...base, sqrtPriceX96: 0n })).toThrow();
  });
});

describe('pool-exists logic with a mocked provider', () => {
  const poolAddr = '0x1111111111111111111111111111111111111111';
  it('getPoolForPair / getPoolPrice return null when the factory returns the zero address (no pool yet)', async () => {
    const provider = fakeProvider({
      '0x1698ee82': () => addrWord('0x0000000000000000000000000000000000000000'),
    });
    expect(await getPoolAddress(provider, BASE.address, QUOTE.address, 3000)).toBeNull();
    expect(await getPoolForPair(provider, BASE, QUOTE)).toBeNull();
    expect(await getPoolPrice(provider, BASE, QUOTE)).toBeNull();
  });
  it('getPoolAddress returns the pool when one exists', async () => {
    const provider = fakeProvider({
      '0x1698ee82': () => addrWord(poolAddr),
    });
    expect(await getPoolAddress(provider, BASE.address, QUOTE.address, 3000)).toBe(poolAddr);
  });
  it('getPoolState reads slot0 and returns the USDC-per-STX price', async () => {
    const sqrt = priceToken1PerToken0ToSqrtPriceX96(2.5, QUOTE.decimals, BASE.decimals);
    const slot0 = coder.encode(
      ['uint160', 'int24', 'uint16', 'uint16', 'uint16', 'uint8', 'bool'],
      [sqrt, 100, 1, 1, 1, 0, true],
    );
    const provider = fakeProvider({
      '0x1698ee82': () => addrWord(poolAddr), // Factory.getPool -> pool exists
      [`${poolAddr.toLowerCase()}:0x3850c7bd`]: () => slot0, // slot0()
      [`${poolAddr.toLowerCase()}:0x0dfe1681`]: () => addrWord(QUOTE.address), // token0()
      [`${poolAddr.toLowerCase()}:0xd21220a7`]: () => addrWord(BASE.address), // token1()
      [`${poolAddr.toLowerCase()}:0xddca3f43`]: () => coder.encode(['uint24'], [3000]), // fee()
      [`${poolAddr.toLowerCase()}:0xd0c93a7c`]: () => coder.encode(['int24'], [60]), // tickSpacing()
      [`${poolAddr.toLowerCase()}:0x1a686502`]: () => coder.encode(['uint128'], [123456n]), // liquidity()
    });
    // Selectors verified against the ethers Interface (fee 0xddca3f43,
    // tickSpacing 0xd0c93a7c, liquidity 0x1a686502); a wrong selector
    // makes the fake throw and this test fail loudly.
    const state = await getPoolState(provider, poolAddr, [BASE, QUOTE]);
    expect(state.token0.toLowerCase()).toBe(QUOTE.address.toLowerCase());
    expect(state.token1.toLowerCase()).toBe(BASE.address.toLowerCase());
    expect(state.fee).toBe(3000);
    expect(state.tickSpacing).toBe(60);
    expect(state.tick).toBe(100);
    expect(Math.abs(state.priceToken1PerToken0 - 2.5) / 2.5).toBeLessThan(0.001);
    expect(poolStateToBasePrice(state, BASE, QUOTE)).toBeCloseTo(2.5, 2);
    expect(await getPoolPrice(provider, BASE, QUOTE)).toBeCloseTo(2.5, 2);
  });
  it('getPoolState throws when a pool token is not in the pair', async () => {
    const sqrt = priceToken1PerToken0ToSqrtPriceX96(2.5, QUOTE.decimals, BASE.decimals);
    const slot0 = coder.encode(
      ['uint160', 'int24', 'uint16', 'uint16', 'uint16', 'uint8', 'bool'],
      [sqrt, 100, 1, 1, 1, 0, true],
    );
    const provider = fakeProvider({
      [`${poolAddr.toLowerCase()}:0x3850c7bd`]: () => slot0,
      [`${poolAddr.toLowerCase()}:0x0dfe1681`]: () => addrWord(QUOTE.address),
      [`${poolAddr.toLowerCase()}:0xd21220a7`]: () => addrWord('0x7777777777777777777777777777777777777777'),
      [`${poolAddr.toLowerCase()}:0xddca3f43`]: () => coder.encode(['uint24'], [3000]),
      [`${poolAddr.toLowerCase()}:0xd0c93a7c`]: () => coder.encode(['int24'], [60]),
      [`${poolAddr.toLowerCase()}:0x1a686502`]: () => coder.encode(['uint128'], [1n]),
    });
    await expect(getPoolState(provider, poolAddr, [BASE, QUOTE])).rejects.toThrow();
  });
});

describe('resolveFeeRecipient', () => {
  it('returns null when the payload has no feeRecipient (current behaviour)', () => {
    expect(resolveFeeRecipient(null)).toBeNull();
    expect(resolveFeeRecipient({})).toBeNull();
    expect(resolveFeeRecipient({ autoSellFeePct: 1 })).toBeNull();
    expect(resolveFeeRecipient({ feeRecipient: 'not-an-address' })).toBeNull();
  });
  it('returns the address when the payload carries one', () => {
    expect(
      resolveFeeRecipient({ feeRecipient: '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383' }),
    ).toBe('0xCca907AE079DB7638A4d2D3e82defaea5FBDF383');
  });
});
