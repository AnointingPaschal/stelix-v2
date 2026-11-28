/**
 * Discover (full DEX) — dedupe, filters, sorting, age formatting, live
 * mappers and tab fetching with a mocked fetch. Guards the regressions
 * from the 2026-11-26 screenshots: PONS appearing 3 times, letter-only
 * rows, 24h always "—", and an empty chainId breaking logo resolution.
 */
import {
  applyDiscoverFilters,
  dedupeDiscoverTokens,
  fetchDiscoverPage,
  fetchDiscoverTab,
  fetchTokenProfilesNew,
  formatTokenAge,
  mapDexScreenerPair,
  mapGeckoPool,
  searchTokens,
  sortDiscoverTokens,
  type DiscoverToken,
} from '../discover';

function token(over: Partial<DiscoverToken> = {}): DiscoverToken {
  return {
    symbol: 'PONS',
    name: 'Pons',
    chainId: 'bnb',
    address: '0x39dbed3a2bd333467115de45665cc57f813c4571',
    pairAddress: '0xpair1',
    priceUsd: 0.086,
    change24h: 6.15,
    change1h: -2.4,
    marketCap: 57_919_518,
    marketCapSource: 'marketcap',
    fdvUsd: 57_918_790,
    liquidityUsd: 329_224,
    volume24h: 1_033_931,
    txns24h: 7160,
    dexId: 'pancakeswap_v2',
    url: null,
    pairCreatedAt: Date.now() - 2 * 60 * 60 * 1000,
    iconUrl: null,
    ...over,
  };
}

function geckoPool(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'bsc_0xf2a0be59ab76b96f957bd5e5b967f2b75e8db269',
    attributes: {
      address: '0xf2a0be59ab76b96f957bd5e5b967f2b75e8db269',
      name: 'PONS / WBNB',
      base_token_price_usd: '0.0860134846120872',
      market_cap_usd: '57919518.92662',
      fdv_usd: '57918790.4971143',
      reserve_in_usd: '329224.2425',
      pool_created_at: '2026-08-11T03:34:02Z',
      price_change_percentage: { h24: '6.151', h1: '-2.468' },
      volume_usd: { h24: '1033931.66328805' },
      transactions: { h24: { buys: 3536, sells: 3624 } },
    },
    relationships: {
      base_token: { data: { id: 'bsc_0x39dbed3a2bd333467115de45665cc57f813c4571' } },
      network: { data: { id: 'bsc' } },
      dex: { data: { id: 'pancakeswap_v2' } },
    },
    ...over,
  };
}

describe('mapGeckoPool', () => {
  it('populates chainId, 24h change and pair age (no blank chain / "—" 24h)', () => {
    const t = mapGeckoPool(geckoPool() as never);
    expect(t.chainId).toBe('bnb');
    expect(t.symbol).toBe('PONS');
    expect(t.address).toBe('0x39dbed3a2bd333467115de45665cc57f813c4571');
    expect(t.change24h).toBeCloseTo(6.151);
    expect(t.change1h).toBeCloseTo(-2.468);
    expect(t.priceUsd).toBeCloseTo(0.086);
    expect(t.marketCap).toBeCloseTo(57_919_518.93, 1);
    expect(t.marketCapSource).toBe('marketcap');
    expect(t.liquidityUsd).toBeCloseTo(329_224.24, 1);
    expect(t.volume24h).toBeCloseTo(1_033_931.66, 1);
    expect(t.txns24h).toBe(7160);
    expect(t.dexId).toBe('pancakeswap_v2');
    expect(t.pairCreatedAt).toBe(Date.parse('2026-08-11T03:34:02Z'));
  });

  it('falls back to FDV for market cap when market_cap_usd is null', () => {
    const pool = geckoPool();
    (pool.attributes as Record<string, unknown>).market_cap_usd = null;
    const t = mapGeckoPool(pool as never);
    expect(t.marketCap).toBeCloseTo(57_918_790.5, 0);
    expect(t.marketCapSource).toBe('fdv');
  });
});

describe('mapDexScreenerPair', () => {
  it('carries the logo, pair age and 1h change', () => {
    const t = mapDexScreenerPair({
      chainId: 'bsc',
      dexId: 'pancakeswap_v2',
      pairAddress: '0xpair',
      baseToken: { symbol: 'WBNB', name: 'Wrapped BNB', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
      priceUsd: '552.72',
      priceChange: { h24: 4.1, h1: 0.3 },
      marketCap: 80_000_000_000,
      liquidity: { usd: 19_054_975 },
      volume: { h24: 12_000_000 },
      pairCreatedAt: 1700000000000,
      info: { imageUrl: 'https://cdn.dexscreener.com/token-images/wbnb.png' },
    });
    expect(t.chainId).toBe('bnb');
    expect(t.iconUrl).toBe('https://cdn.dexscreener.com/token-images/wbnb.png');
    expect(t.pairCreatedAt).toBe(1700000000000);
    expect(t.change1h).toBe(0.3);
    expect(t.marketCapSource).toBe('marketcap');
  });
});

describe('dedupeDiscoverTokens', () => {
  it('collapses PONS on three DEXes to one row — the highest-liquidity pair', () => {
    const rows = dedupeDiscoverTokens([
      token({ pairAddress: '0xa', dexId: 'pancakeswap_v2', liquidityUsd: 100_000 }),
      token({ pairAddress: '0xb', dexId: 'ramses-v3-robinhood', liquidityUsd: 329_224, chainId: 'bnb' }),
      token({ pairAddress: '0xc', dexId: 'four-meme', liquidityUsd: 50_000 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].pairAddress).toBe('0xb');
    expect(rows[0].dexId).toBe('ramses-v3-robinhood');
  });

  it('keeps the same symbol on different chains as separate rows', () => {
    const rows = dedupeDiscoverTokens([
      token({ chainId: 'bnb' }),
      token({ chainId: 'solana', address: 'So11111111111111111111111111111111111111112' }),
    ]);
    expect(rows).toHaveLength(2);
  });

  it('drops rows with no symbol or address', () => {
    expect(dedupeDiscoverTokens([token({ symbol: '' }), token({ address: '' })])).toHaveLength(0);
  });
});

describe('applyDiscoverFilters', () => {
  const now = Date.now();
  const list = [
    token({ symbol: 'AAA', liquidityUsd: 5000, volume24h: 1000, marketCap: 100_000, dexId: 'pancakeswap_v2', pairCreatedAt: now - 30 * 60 * 1000 }),
    token({ symbol: 'BBB', liquidityUsd: 500_000, volume24h: 200_000, marketCap: 50_000_000, dexId: 'uniswap_v3', pairCreatedAt: now - 5 * 24 * 60 * 60 * 1000 }),
    token({ symbol: 'CCC', liquidityUsd: 50_000, volume24h: 50_000, marketCap: 5_000_000, dexId: 'pancakeswap_v2', pairCreatedAt: null }),
  ];

  it('applies minimum liquidity / volume / market cap', () => {
    expect(applyDiscoverFilters(list, { minLiquidityUsd: 100_000 }).map((t) => t.symbol)).toEqual(['BBB']);
    expect(applyDiscoverFilters(list, { minVolume24h: 100_000 }).map((t) => t.symbol)).toEqual(['BBB']);
    expect(applyDiscoverFilters(list, { minMarketCap: 10_000_000 }).map((t) => t.symbol)).toEqual(['BBB']);
  });

  it('filters by DEX and chain', () => {
    expect(applyDiscoverFilters(list, { dexId: 'uniswap_v3' }).map((t) => t.symbol)).toEqual(['BBB']);
    expect(applyDiscoverFilters(list, { chainId: 'solana' })).toHaveLength(0);
    expect(applyDiscoverFilters(list, { chainId: 'bnb' })).toHaveLength(3);
  });

  it('keeps tokens on every active chain when the filter is "all"', () => {
    const mixed = [
      token({ symbol: 'AAA', chainId: 'bnb' }),
      token({ symbol: 'BBB', chainId: 'base' }),
      token({ symbol: 'CCC', chainId: 'solana', address: 'So11111111111111111111111111111111111111112' }),
      token({ symbol: 'DDD', chainId: 'arc' }),
      token({ symbol: 'EEE', chainId: 'ethereum' }),
      token({ symbol: 'FFF', chainId: 'polygon' }),
    ];
    expect(applyDiscoverFilters(mixed, { chainId: 'all' }).map((t) => t.symbol)).toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF']);
  });

  it('maxAge and newOnly use pair age; unknown age is excluded', () => {
    expect(applyDiscoverFilters(list, { maxAgeMs: 60 * 60 * 1000 }, now).map((t) => t.symbol)).toEqual(['AAA']);
    expect(applyDiscoverFilters(list, { newOnly: true }, now).map((t) => t.symbol)).toEqual(['AAA']);
  });

  it('matches symbol, name and contract address', () => {
    expect(applyDiscoverFilters(list, { query: 'bbb' }).map((t) => t.symbol)).toEqual(['BBB']);
    expect(applyDiscoverFilters(list, { query: '0x39dbed' })).toHaveLength(3);
  });
});

describe('sortDiscoverTokens', () => {
  const list = [
    token({ symbol: 'A', volume24h: 10, marketCap: 300, change24h: 1, pairCreatedAt: 1000 }),
    token({ symbol: 'B', volume24h: 30, marketCap: 100, change24h: 50, pairCreatedAt: 3000 }),
    token({ symbol: 'C', volume24h: 20, marketCap: 200, change24h: null, pairCreatedAt: 2000 }),
  ];
  it('sorts by volume, market cap, newest and gainers (nulls last)', () => {
    expect(sortDiscoverTokens(list, 'volume').map((t) => t.symbol)).toEqual(['B', 'C', 'A']);
    expect(sortDiscoverTokens(list, 'marketcap').map((t) => t.symbol)).toEqual(['A', 'C', 'B']);
    expect(sortDiscoverTokens(list, 'newest').map((t) => t.symbol)).toEqual(['B', 'C', 'A']);
    expect(sortDiscoverTokens(list, 'gainers').map((t) => t.symbol)).toEqual(['B', 'A', 'C']);
  });
});

describe('formatTokenAge', () => {
  const now = 1_800_000_000_000;
  it('formats minutes, hours, days and unknown ages', () => {
    expect(formatTokenAge(null, now)).toBe('—');
    expect(formatTokenAge(now - 30_000, now)).toBe('just now');
    expect(formatTokenAge(now - 12 * 60_000, now)).toBe('12m ago');
    expect(formatTokenAge(now - 2 * 60 * 60_000, now)).toBe('2h ago');
    expect(formatTokenAge(now - 3 * 24 * 60 * 60_000, now)).toBe('3d ago');
  });
});

// --- mocked fetch for the tab fetchers -------------------------------------

function mockFetch(routes: [string, unknown][]): (url: string) => Promise<Response> {
  return async (url: string) => {
    for (const [substr, body] of routes) {
      if (url.includes(substr)) {
        return { ok: true, status: 200, json: async () => body } as Response;
      }
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  };
}

const dexBatchBody = {
  pairs: [
    {
      chainId: 'bsc',
      dexId: 'pancakeswap_v2',
      pairAddress: '0xf2a0be59ab76b96f957bd5e5b967f2b75e8db269',
      baseToken: { symbol: 'PONS', name: 'Pons Token', address: '0x39dbed3a2bd333467115de45665cc57f813c4571' },
      priceUsd: '0.086',
      priceChange: { h24: 6.151 },
      marketCap: 57_919_518,
      liquidity: { usd: 329_224 },
      volume: { h24: 1_033_931 },
      pairCreatedAt: 1786432442000,
      info: { imageUrl: 'https://cdn.dexscreener.com/token-images/pons.png' },
    },
  ],
};

describe('fetchDiscoverPage (mocked network, infinite scroll)', () => {
  it('trending page 1: fetches only page 1 and reports hasMore when the page is full', async () => {
    const pool = geckoPool();
    const page1 = Array.from({ length: 20 }, (_, i) => geckoPool({
      id: `bsc_0xpool${i}`,
      attributes: {
        ...(pool.attributes as Record<string, unknown>),
        name: `TOK${i} / WBNB`,
        address: `0xpool${i}`,
      },
      relationships: {
        base_token: { data: { id: `bsc_0xtok${i}` } },
        network: { data: { id: 'bsc' } },
        dex: { data: { id: 'pancakeswap_v2' } },
      },
    }));
    const fetchImpl = mockFetch([
      ['trending_pools?page=1', { data: page1 }],
      ['/latest/dex/tokens/', { pairs: [] }],
    ]);
    const res = await fetchDiscoverPage('trending', 'all', 1, fetchImpl as never);
    expect(res.source).toBe('geckoterminal');
    expect(res.error).toBeNull();
    expect(res.tokens).toHaveLength(20);
    expect(res.hasMore).toBe(true);
  });

  it('trending page 2: a short page reports hasMore false (scrolling stops)', async () => {
    const fetchImpl = mockFetch([
      ['trending_pools?page=2', { data: [geckoPool()] }],
      ['/latest/dex/tokens/', { pairs: [] }],
    ]);
    const res = await fetchDiscoverPage('trending', 'all', 2, fetchImpl as never);
    expect(res.tokens).toHaveLength(1);
    expect(res.hasMore).toBe(false);
  });

  it('trending: an empty page is unavailable with hasMore false', async () => {
    const fetchImpl = mockFetch([['trending_pools?page=3', { data: [] }]]);
    const res = await fetchDiscoverPage('trending', 'all', 3, fetchImpl as never);
    expect(res.tokens).toHaveLength(0);
    expect(res.hasMore).toBe(false);
    expect(res.source).toBe('unavailable');
    expect(res.error).toMatch(/unavailable|failed/i);
  });

  it('new: pages new_pools per network and dedupes across pages', async () => {
    const fetchImpl = mockFetch([
      ['networks/bsc/new_pools?page=2', { data: [geckoPool()] }],
      ['networks/solana/new_pools?page=2', { data: [] }],
      ['/latest/dex/tokens/', { pairs: [] }],
    ]);
    const res = await fetchDiscoverPage('new', 'all', 2, fetchImpl as never);
    expect(res.source).toBe('geckoterminal');
    expect(res.tokens).toHaveLength(1);
    expect(res.tokens[0].symbol).toBe('PONS');
    expect(res.hasMore).toBe(false);
  });

  it('new: a full page on any network reports hasMore true', async () => {
    const pool = geckoPool();
    const full = Array.from({ length: 20 }, (_, i) => geckoPool({
      id: `bsc_0xpool${i}`,
      attributes: { ...(pool.attributes as Record<string, unknown>), name: `TOK${i} / WBNB`, address: `0xpool${i}` },
      relationships: {
        base_token: { data: { id: `bsc_0xtok${i}` } },
        network: { data: { id: 'bsc' } },
        dex: { data: { id: 'pancakeswap_v2' } },
      },
    }));
    const fetchImpl = mockFetch([
      ['networks/bsc/new_pools?page=1', { data: full }],
      ['/latest/dex/tokens/', { pairs: [] }],
    ]);
    const res = await fetchDiscoverPage('new', 'bnb', 1, fetchImpl as never);
    expect(res.tokens).toHaveLength(20);
    expect(res.hasMore).toBe(true);
  });

  it('gainers: ranks the page by 24h change', async () => {
    const pool = geckoPool();
    const mk = (sym: string, chg: string) => geckoPool({
      id: `bsc_0x${sym}`,
      attributes: {
        ...(pool.attributes as Record<string, unknown>),
        name: `${sym} / WBNB`,
        address: `0x${sym}`,
        price_change_percentage: { h24: chg, h1: '0' },
      },
      relationships: {
        base_token: { data: { id: `bsc_0x${sym}tok` } },
        network: { data: { id: 'bsc' } },
        dex: { data: { id: 'pancakeswap_v2' } },
      },
    });
    const fetchImpl = mockFetch([
      ['trending_pools?page=1', { data: [mk('LOW', '2.5'), mk('HIGH', '99.1')] }],
      ['/latest/dex/tokens/', { pairs: [] }],
    ]);
    const res = await fetchDiscoverPage('gainers', 'all', 1, fetchImpl as never);
    expect(res.tokens.map((t) => t.symbol)).toEqual(['HIGH', 'LOW']);
  });
});

describe('fetchDiscoverTab (mocked network)', () => {
  it('trending: dedupes GeckoTerminal pools, enriches logo+name from DexScreener', async () => {
    const fetchImpl = mockFetch([
      ['trending_pools?page=1', { data: [geckoPool(), geckoPool({ id: 'bsc_0xother', relationships: { base_token: { data: { id: 'bsc_0x39dbed3a2bd333467115de45665cc57f813c4571' } }, network: { data: { id: 'bsc' } }, dex: { data: { id: 'ramses' } } } })] }],
      ['trending_pools?page=2', { data: [] }],
      ['/latest/dex/tokens/', dexBatchBody],
    ]);
    const res = await fetchDiscoverTab('trending', 'all', 30, fetchImpl as never);
    expect(res.source).toBe('geckoterminal');
    expect(res.error).toBeNull();
    // Same token on two pools -> one row.
    expect(res.tokens).toHaveLength(1);
    expect(res.tokens[0].symbol).toBe('PONS');
    expect(res.tokens[0].name).toBe('Pons Token');
    expect(res.tokens[0].iconUrl).toBe('https://cdn.dexscreener.com/token-images/pons.png');
    expect(res.tokens[0].change24h).toBeCloseTo(6.151);
  });

  it('trending: falls back to DexScreener boosts when GeckoTerminal fails', async () => {
    const fetchImpl = mockFetch([
      ['token-boosts/top/v1', [{ chainId: 'bsc', tokenAddress: '0x39dbed3a2bd333467115de45665cc57f813c4571' }]],
      ['/latest/dex/tokens/', dexBatchBody],
    ]);
    const res = await fetchDiscoverTab('trending', 'all', 30, fetchImpl as never);
    expect(res.source).toBe('dexscreener');
    expect(res.tokens).toHaveLength(1);
    expect(res.tokens[0].symbol).toBe('PONS');
  });

  it('new: merges new pools across networks and sorts newest first', async () => {
    const bscPool = geckoPool();
    const solPool = geckoPool({
      id: 'solana_FnHWfV49ywCtGCDTyf34AVN8BiXxcgXUKqLctkrkP1gQ',
      attributes: {
        ...(geckoPool().attributes as Record<string, unknown>),
        name: 'JIMMY / SOL',
        pool_created_at: '2026-11-26T10:00:00Z',
      },
      relationships: {
        base_token: { data: { id: 'solana_So11111111111111111111111111111111111111112' } },
        network: { data: { id: 'solana' } },
        dex: { data: { id: 'pumpswap' } },
      },
    });
    const fetchImpl = mockFetch([
      ['networks/bsc/new_pools', { data: [bscPool] }],
      ['networks/solana/new_pools', { data: [solPool] }],
      ['/latest/dex/tokens/', { pairs: [] }],
    ]);
    const res = await fetchDiscoverTab('new', 'all', 30, fetchImpl as never);
    expect(res.source).toBe('geckoterminal');
    expect(res.tokens.map((t) => t.symbol)).toEqual(['JIMMY', 'PONS']);
    expect(res.tokens[0].chainId).toBe('solana');
  });

  it('returns an honest unavailable result when every feed fails', async () => {
    const fetchImpl = mockFetch([]);
    const res = await fetchDiscoverTab('trending', 'all', 30, fetchImpl as never);
    expect(res.tokens).toHaveLength(0);
    expect(res.source).toBe('unavailable');
    expect(res.error).toMatch(/unavailable|failed/i);
  });
});

describe('fetchTokenProfilesNew (mocked network)', () => {
  it('filters profiles by chain and enriches them', async () => {
    const fetchImpl = mockFetch([
      ['token-profiles/latest/v1', [
        { chainId: 'bsc', tokenAddress: '0x39dbed3a2bd333467115de45665cc57f813c4571', icon: 'https://cdn.dexscreener.com/cms/images/x.png' },
        { chainId: 'solana', tokenAddress: 'So11111111111111111111111111111111111111112' },
      ]],
      ['/latest/dex/tokens/', dexBatchBody],
    ]);
    const res = await fetchTokenProfilesNew('bnb', 30, fetchImpl as never);
    expect(res.source).toBe('dexscreener');
    expect(res.tokens).toHaveLength(1);
    expect(res.tokens[0].symbol).toBe('PONS');
  });
});

describe('searchTokens (mocked network)', () => {
  it('dedupes search pairs to one row per token', async () => {
    const realFetch = global.fetch;
    (global as { fetch?: unknown }).fetch = mockFetch([
      ['latest/dex/search', { pairs: [
        { chainId: 'bsc', dexId: 'a', baseToken: { symbol: 'PONS', name: 'Pons', address: '0x39dbed3a2bd333467115de45665cc57f813c4571' }, priceUsd: '0.086', priceChange: { h24: 6 }, marketCap: 100, liquidity: { usd: 20 }, volume: { h24: 5 }, info: { imageUrl: 'https://x/y.png' } },
        { chainId: 'bsc', dexId: 'b', baseToken: { symbol: 'PONS', name: 'Pons', address: '0x39dbed3a2bd333467115de45665cc57f813c4571' }, priceUsd: '0.086', priceChange: { h24: 6 }, marketCap: 100, liquidity: { usd: 10 }, volume: { h24: 5 } },
      ] }],
    ]);
    try {
      const res = await searchTokens('pons');
      expect(res.tokens).toHaveLength(1);
      expect(res.tokens[0].dexId).toBe('a');
      expect(res.tokens[0].iconUrl).toBe('https://x/y.png');
    } finally {
      (global as { fetch?: unknown }).fetch = realFetch;
    }
  });
});
