/** Price indicators + safety score — real-data-only rules. */
import * as fs from 'fs';
import * as path from 'path';
import {
  bucketPricesToCandles,
  candlesMatchPrice,
  computeRsi,
  computeSafetyScore,
  ema,
  fetchCandlesForTfWithMeta,
  fetchCandlesWithMeta,
  indicatorsFromCandles,
  isStablecoinSymbol,
  lastEma,
  parseOhlcv,
  type Candle,
} from '../prices';

const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT = '0x55d398326f99059fF775485246999027B3197955';
const WKC = '0x6ec90334d89dbdc89e08a133271be3d104128edb';

/** Mock global.fetch, routing by URL substring. Restored after each test. */
function mockFetch(routes: Array<[string, unknown]>) {
  global.fetch = jest.fn(async (url: string) => {
    for (const [match, body] of routes) {
      if (url.includes(match)) return { ok: true, json: async () => body } as unknown as Response;
    }
    return { ok: false, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

function candles(closes: number[]): Candle[] {
  return closes.map((c, i) => ({ time: i * 86_400_000, open: c, high: c, low: c, close: c, volume: 100 }));
}

describe('EMA / RSI from real candles', () => {
  it('ema is empty for an empty series and stable for a flat series', () => {
    expect(ema([], 7)).toEqual([]);
    expect(ema([10, 10, 10, 10], 7).every((v) => v === 10)).toBe(true);
  });

  it('lastEma returns null with fewer closes than the period', () => {
    expect(lastEma([1, 2, 3], 7)).toBeNull();
    expect(lastEma([1, 2, 3, 4, 5, 6, 7], 7)).not.toBeNull();
  });

  it('RSI is null with too few closes, 100 for an all-up series, ~50 for flat', () => {
    expect(computeRsi([1, 2, 3], 14)).toBeNull();
    expect(computeRsi(Array.from({ length: 15 }, (_, i) => i + 1))).toBe(100);
    expect(computeRsi(Array.from({ length: 15 }, () => 5))).toBe(50);
  });

  it('indicatorsFromCandles returns nulls + a note when candles are missing', () => {
    const r = indicatorsFromCandles([]);
    expect(r.ema7).toBeNull();
    expect(r.ema25).toBeNull();
    expect(r.rsi14).toBeNull();
    expect(r.note).toMatch(/Not enough candle data/);
  });

  it('indicatorsFromCandles computes EMA7/EMA25/RSI from 30 real candles', () => {
    const r = indicatorsFromCandles(candles(Array.from({ length: 30 }, (_, i) => 100 + i)));
    expect(r.ema7).not.toBeNull();
    expect(r.ema25).not.toBeNull();
    expect(r.rsi14).toBe(100);
    expect(r.note).toBeNull();
  });
});

describe('safety score — real data only', () => {
  it('returns "Insufficient data" (null score) when inputs are missing', () => {
    const s = computeSafetyScore({});
    expect(s.score).toBeNull();
    expect(s.label).toBe('Insufficient data');
    expect(s.inputs.length).toBeGreaterThan(0);
  });

  it('scores deep-liquidity majors high and labels every input', () => {
    const s = computeSafetyScore({ liquidityUsd: 5_000_000, volume24h: 1_000_000, marketCap: 100_000_000, honeypot: false });
    expect(s.score).not.toBeNull();
    expect(s.score!).toBeGreaterThanOrEqual(70);
    expect(s.inputs.map((i) => i.name)).toContain('Liquidity');
  });

  it('a flagged honeypot scores 0', () => {
    const s = computeSafetyScore({ liquidityUsd: 5_000_000, honeypot: true });
    expect(s.score).toBe(0);
    expect(s.label).toMatch(/Honeypot/);
  });
});

describe('GeckoTerminal OHLCV — token-aware price scale (BNB bug)', () => {
  // Live-shaped responses, verified by curl 2026-11-26:
  // WBNB/USDT pool 0x16b9… meta.base = USDT, candles ~$1.00 (USDT's USD
  // price); WKC/WBNB pool 0x9334… meta.base = WKC, candles ~3.9e-8 (WKC's
  // USD price). OHLCV is the USD price of meta.base — NOT a ratio, so
  // 1/x inversion of the $1 series would still be ~$1, not ~$552.
  const bnbOhlcv = {
    data: {
      attributes: {
        ohlcv_list: [
          [1795651200, 1.0031618455707998, 1.0050084940191097, 0.989220798942341, 0.996726171449945, 1002919.87],
          [1795564800, 0.999677904579103, 1.05065018805153, 0.9575808090628231, 1.0031618455707998, 2290986.89],
        ],
      },
    },
    meta: {
      base: { name: 'Tether USD', symbol: 'USDT', address: USDT },
      quote: { name: 'Wrapped BNB', symbol: 'WBNB', address: WBNB },
    },
  };
  const wkcOhlcv = {
    data: {
      attributes: {
        ohlcv_list: [
          [1795651200, 3.936256036389339e-8, 4.0158433241590595e-8, 3.9077019590760796e-8, 3.9590749156319695e-8, 15291.78],
        ],
      },
    },
    meta: {
      base: { name: 'WIKI CAT', symbol: 'WKC', address: WKC },
      quote: { name: 'Wrapped BNB', symbol: 'WBNB', address: WBNB },
    },
  };

  it('parseOhlcv returns the raw USD series and its base address (no inversion)', () => {
    const r = parseOhlcv(bnbOhlcv);
    expect(r.baseAddress?.toLowerCase()).toBe(USDT.toLowerCase());
    expect(r.candles[0].close).toBeCloseTo(0.9967, 4);
  });

  it('a WBNB/USDT pool does NOT match WBNB — the $1 series is rejected, not rendered', async () => {
    mockFetch([['geckoterminal', bnbOhlcv]]);
    const r = await fetchCandlesWithMeta('bnb', '0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE', 'day', 100, 1, WBNB);
    expect(r.baseMatches).toBe(false);
    expect(r.candles).toEqual([]);
  });

  it('a WKC pool matches WKC — candles are returned as-is, NOT inverted', async () => {
    mockFetch([['geckoterminal', wkcOhlcv]]);
    const r = await fetchCandlesWithMeta('bnb', '0x933477eba23726cA95A957cB85dBB1957267EF85', 'day', 100, 1, WKC);
    expect(r.baseMatches).toBe(true);
    expect(r.candles).toHaveLength(1);
    expect(r.candles[0].close).toBeCloseTo(3.9590749156319695e-8, 14);
  });

  it('BNB falls back to CoinGecko market_chart when no pool has WBNB as base — candles ~$552', async () => {
    const t0 = 1795651200000;
    const cgPrices = Array.from({ length: 25 }, (_, i) => [t0 + i * 300_000, 545 + i * 0.3] as [number, number]);
    mockFetch([
      ['geckoterminal', bnbOhlcv],
      ['market_chart', { prices: cgPrices }],
    ]);
    const r = await fetchCandlesForTfWithMeta('bnb', '0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE', '15m', 120, WBNB, {
      candidatePairs: ['0x172fcD41E0913e95784454622d1c3724f546f849'],
      coingeckoId: 'binancecoin',
    });
    expect(r.baseMatches).toBe(true);
    expect(r.candles.length).toBeGreaterThan(0);
    const lastClose = r.candles[r.candles.length - 1].close;
    expect(lastClose).toBeGreaterThan(500);
    expect(candlesMatchPrice(r.candles, 552.67)).toBe(true);
  });

  it('USDT’s own chart stays ~$1.00 — correct for USDT', async () => {
    mockFetch([['geckoterminal', bnbOhlcv]]);
    const r = await fetchCandlesWithMeta('bnb', '0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE', 'day', 100, 1, USDT);
    expect(r.baseMatches).toBe(true);
    expect(r.candles[0].close).toBeCloseTo(0.9967, 4);
    expect(candlesMatchPrice(r.candles, 1.0)).toBe(true);
  });

  it('candlesMatchPrice: $552 candles match a $552.67 header, $1 candles do not', () => {
    const ok: Candle[] = [{ time: 1, open: 550, high: 553, low: 549, close: 552, volume: 10 }];
    const wrong: Candle[] = [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 10 }];
    expect(candlesMatchPrice(ok, 552.67)).toBe(true);
    expect(candlesMatchPrice(wrong, 552.67)).toBe(false);
    expect(candlesMatchPrice([], 552.67)).toBe(false);
    expect(candlesMatchPrice(ok, null)).toBe(false);
  });

  it('bucketPricesToCandles groups CoinGecko points into OHLC buckets', () => {
    const hour = 3_600_000;
    const pts: [number, number][] = [
      [hour + 0, 100],
      [hour + 1_000, 110],
      [hour + 2_000, 90],
      [2 * hour + 0, 95],
    ];
    const out = bucketPricesToCandles(pts, hour);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ open: 100, high: 110, low: 90, close: 90, volume: 0 });
    expect(out[1]).toMatchObject({ open: 95, high: 95, low: 95, close: 95 });
  });

  it('pool tries are capped at 6 — a token with 20 pairs does not hammer GeckoTerminal', async () => {
    const seen: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      seen.push(url);
      if (url.includes('geckoterminal')) return { ok: true, json: async () => bnbOhlcv } as unknown as Response;
      return { ok: false, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
    const manyPairs = Array.from({ length: 20 }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`);
    const r = await fetchCandlesForTfWithMeta('bnb', manyPairs[0], '15m', 120, WBNB, {
      candidatePairs: manyPairs.slice(1),
    });
    // All pools mismatch (base USDT) and no CoinGecko id was given, so
    // the result is empty — but only 6 GeckoTerminal calls were made.
    expect(r.candles).toEqual([]);
    const geckoCalls = seen.filter((u) => u.includes('geckoterminal'));
    expect(geckoCalls).toHaveLength(6);
    expect(geckoCalls.some((u) => u.includes(manyPairs[6].slice(2)))).toBe(false);
  });
});

describe('stablecoins — USDC/USDT are not scored like DEX tokens', () => {
  it('isStablecoinSymbol recognises USDC/USDT/DAI and rejects DEX tokens', () => {
    expect(isStablecoinSymbol('USDC')).toBe(true);
    expect(isStablecoinSymbol('usdt')).toBe(true);
    expect(isStablecoinSymbol('DAI')).toBe(true);
    expect(isStablecoinSymbol('GTAN')).toBe(false);
    expect(isStablecoinSymbol('WKC')).toBe(false);
    expect(isStablecoinSymbol('BNB')).toBe(false);
    expect(isStablecoinSymbol(null)).toBe(false);
    expect(isStablecoinSymbol(undefined)).toBe(false);
  });

  it('Token Detail wires the stablecoin state: chart falls back to CoinGecko and the safety card gets stablecoin=true', () => {
    const detail = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'app', 'token', '[symbol].tsx'),
      'utf8',
    );
    expect(detail).toContain('isStablecoinSymbol(sym)');
    expect(detail).toContain('fetchCoinGeckoCandles(coingeckoId, tf)');
    expect(detail).toContain('stablecoin={isStablecoin}');
    expect(detail).toContain('Price is ~$1.00 by design');
    const card = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'components', 'SafetyScoreCard.tsx'),
      'utf8',
    );
    expect(card).toContain('Pegged to USD');
    expect(card).toContain('Not applicable for a stablecoin');
  });
});
