/** Token-logo resolver tests — stubbed fetch, no network.
 *  Covers: known token resolves (Trust Wallet first), DexScreener
 *  fallback incl. the HEAD-422 -> GET retry, GeckoTerminal fallback,
 *  token-list fallback, unknown address -> 'none', invalid address
 *  throws, native-asset logo, and caching (no second fetch). */
import {
  clearLogoCache,
  fetchFactoryLogo,
  normalizeChainId,
  resolveTokenLogo,
  trustWalletLogoUrl,
  verifyImageUrl,
} from '../tokenLogos';

const WKC = '0x6Ec90334d89dBdc89E08A133271be3d104128Edb';
const GTAN = '0xbD7909318b9Ca4ff140B840F69bB310a785d1095';
const UNKNOWN = '0x1111111111111111111111111111111111111111';

type Route = { status: number; body?: unknown; contentType?: string };

function stubFetch(routes: Record<string, Route>) {
  const calls: { url: string; method: string }[] = [];
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const route = key ? routes[key] : { status: 404 };
    const ok = route.status >= 200 && route.status < 300;
    return {
      ok,
      status: route.status,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-type' ? (route.contentType ?? 'application/json') : null,
      },
      json: async () => route.body ?? {},
    } as unknown as Response;
  });
  return { fetch: fn, calls };
}

beforeEach(() => {
  clearLogoCache();
});

describe('normalizeChainId', () => {
  it('maps DexScreener slugs to Stelix ids', () => {
    expect(normalizeChainId('bsc')).toBe('bnb');
    expect(normalizeChainId('eth')).toBe('ethereum');
    expect(normalizeChainId('bnb')).toBe('bnb');
  });
});

describe('trustWalletLogoUrl', () => {
  it('builds the checksummed smartchain URL for a BSC token', () => {
    expect(trustWalletLogoUrl('bnb', WKC)).toBe(
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x6Ec90334d89dBdc89E08A133271be3d104128Edb/logo.png',
    );
  });
});

describe('verifyImageUrl', () => {
  it('accepts a 200 HEAD with an image content-type', async () => {
    const { fetch } = stubFetch({
      'logo.png': { status: 200, contentType: 'image/png' },
    });
    await expect(verifyImageUrl('https://example.com/logo.png', fetch)).resolves.toBe(true);
  });

  it('retries with GET when HEAD is rejected (DexScreener CDN returns 422 on HEAD)', async () => {
    const { fetch, calls } = stubFetch({
      'cdn.dexscreener.com': { status: 422 },
    });
    // HEAD 422 -> GET: the stub returns 422 for GET too here, so false.
    await expect(verifyImageUrl('https://cdn.dexscreener.com/img.png', fetch)).resolves.toBe(false);
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
  });

  it('returns false on 404 without retrying', async () => {
    const { fetch, calls } = stubFetch({});
    await expect(verifyImageUrl('https://example.com/missing.png', fetch)).resolves.toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('HEAD');
  });
});

describe('resolveTokenLogo', () => {
  it('resolves WKC on BSC from Trust Wallet first', async () => {
    const { fetch } = stubFetch({
      'raw.githubusercontent.com': { status: 200, contentType: 'image/png' },
    });
    const r = await resolveTokenLogo('bnb', WKC, { fetchImpl: fetch });
    expect(r.source).toBe('trustwallet');
    expect(r.url).toBe(trustWalletLogoUrl('bnb', WKC));
  });

  it('resolves GTAN via GeckoTerminal when Trust Wallet 404s', async () => {
    const gtanImage = 'https://coin-images.coingecko.com/coins/images/68338/large/Giant_GTAN_200_logo.png';
    const { fetch } = stubFetch({
      'raw.githubusercontent.com': { status: 404 },
      'api.dexscreener.com': { status: 200, body: { pairs: [] } },
      'api.geckoterminal.com': {
        status: 200,
        body: { data: { attributes: { image_url: gtanImage, coingecko_coin_id: 'giant' } } },
      },
      'coin-images.coingecko.com': { status: 200, contentType: 'image/png' },
    });
    const r = await resolveTokenLogo('bnb', GTAN, { fetchImpl: fetch });
    expect(r.source).toBe('geckoterminal');
    expect(r.url).toBe(gtanImage);
  });

  it('resolves via DexScreener imageUrl when Trust Wallet 404s (GET fallback after HEAD 422)', async () => {
    const dsImage = 'https://cdn.dexscreener.com/cms/images/abc123?width=800';
    // Custom fetch: Trust Wallet 404s, DexScreener returns a pair image,
    // HEAD on the CDN image 422s, GET 200s — the resolver must still win.
    const custom = jest.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('raw.githubusercontent.com')) {
        return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) } as unknown as Response;
      }
      if (url.includes('api.dexscreener.com')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            pairs: [{ chainId: 'bsc', liquidity: { usd: 1000 }, info: { imageUrl: dsImage } }],
          }),
        } as unknown as Response;
      }
      if (method === 'HEAD') {
        return { ok: false, status: 422, headers: { get: () => null }, json: async () => ({}) } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (n: string) => (n === 'content-type' ? 'image/png' : null) },
        json: async () => ({}),
      } as unknown as Response;
    });
    const r = await resolveTokenLogo('bnb', WKC, { fetchImpl: custom });
    expect(r.source).toBe('dexscreener');
    expect(r.url).toBe(dsImage);
  });

  it('falls back to the PancakeSwap token list when all APIs have no image', async () => {
    const listLogo = 'https://example.com/list-logo.png';
    const { fetch } = stubFetch({
      'raw.githubusercontent.com': { status: 404 },
      'api.dexscreener.com': { status: 200, body: { pairs: [] } },
      'api.geckoterminal.com': { status: 404 },
      'tokens.pancakeswap.finance': {
        status: 200,
        body: { tokens: [{ chainId: 56, address: UNKNOWN, logoURI: listLogo }] },
      },
      'example.com': { status: 200, contentType: 'image/png' },
    });
    const r = await resolveTokenLogo('bnb', UNKNOWN, { fetchImpl: fetch });
    expect(r.source).toBe('tokenlist');
    expect(r.url).toBe(listLogo);
  });

  it('returns none (not an error) for an unknown address', async () => {
    const { fetch } = stubFetch({
      'raw.githubusercontent.com': { status: 404 },
      'api.dexscreener.com': { status: 200, body: { pairs: [] } },
      'api.geckoterminal.com': { status: 404 },
      'tokens.pancakeswap.finance': { status: 200, body: { tokens: [] } },
    });
    const r = await resolveTokenLogo('bnb', UNKNOWN, { fetchImpl: fetch });
    expect(r).toEqual({ url: null, source: 'none' });
  });

  it('throws on an invalid contract address', async () => {
    const { fetch } = stubFetch({});
    await expect(resolveTokenLogo('bnb', 'not-an-address', { fetchImpl: fetch })).rejects.toThrow(
      /Invalid token address/,
    );
    await expect(resolveTokenLogo('bnb', '0x1234', { fetchImpl: fetch })).rejects.toThrow(
      /Invalid token address/,
    );
  });

  it('resolves the native BNB logo from the Trust Wallet info folder', async () => {
    const { fetch } = stubFetch({
      'raw.githubusercontent.com': { status: 200, contentType: 'image/png' },
    });
    const r = await resolveTokenLogo('bnb', '', { fetchImpl: fetch });
    expect(r.source).toBe('trustwallet');
    expect(r.url).toBe(
      'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/info/logo.png',
    );
  });

  it('caches: the second resolve makes no further fetches', async () => {
    const { fetch } = stubFetch({
      'raw.githubusercontent.com': { status: 200, contentType: 'image/png' },
    });
    const first = await resolveTokenLogo('bnb', WKC, { fetchImpl: fetch });
    const callsAfterFirst = fetch.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    const second = await resolveTokenLogo('bnb', WKC, { fetchImpl: fetch });
    expect(second).toEqual(first);
    expect(fetch.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('Stelix sources (registry + on-chain factory)', () => {
  const REGISTRY_LOGO = 'https://stelix-admin.pages.dev/api/logo/l0123456789abcdef01234567';
  const FACTORY_LOGO = 'https://stelix-admin.pages.dev/api/logo/lfedcba9876543210fedcba98';

  it('registry logo wins over Trust Wallet even when Trust Wallet has one', async () => {
    const { fetch } = stubFetch({
      'stelix-admin.pages.dev': { status: 200, contentType: 'image/png' },
      'raw.githubusercontent.com': { status: 200, contentType: 'image/png' },
    });
    const r = await resolveTokenLogo('bnb', WKC, { fetchImpl: fetch, registryLogoUrl: REGISTRY_LOGO });
    expect(r).toEqual({ url: REGISTRY_LOGO, source: 'registry' });
  });

  it('factory logoURI wins when there is no registry logo', async () => {
    const { fetch } = stubFetch({
      'stelix-admin.pages.dev': { status: 200, contentType: 'image/png' },
      'raw.githubusercontent.com': { status: 200, contentType: 'image/png' },
    });
    const r = await resolveTokenLogo('bnb', WKC, {
      fetchImpl: fetch,
      factoryLogo: async () => FACTORY_LOGO,
    });
    expect(r).toEqual({ url: FACTORY_LOGO, source: 'factory' });
  });

  it('registry logo wins over the factory logo when both exist', async () => {
    const { fetch } = stubFetch({
      'stelix-admin.pages.dev': { status: 200, contentType: 'image/png' },
    });
    const r = await resolveTokenLogo('bnb', WKC, {
      fetchImpl: fetch,
      registryLogoUrl: REGISTRY_LOGO,
      factoryLogo: async () => FACTORY_LOGO,
    });
    expect(r).toEqual({ url: REGISTRY_LOGO, source: 'registry' });
  });

  it('a dead registry URL falls through to Trust Wallet', async () => {
    const { fetch } = stubFetch({
      'stelix-admin.pages.dev': { status: 404 },
      'raw.githubusercontent.com': { status: 200, contentType: 'image/png' },
    });
    const r = await resolveTokenLogo('bnb', WKC, { fetchImpl: fetch, registryLogoUrl: REGISTRY_LOGO });
    expect(r.source).toBe('trustwallet');
    expect(r.url).toBe(trustWalletLogoUrl('bnb', WKC));
  });

  it('a failing factory read falls through to the public sources', async () => {
    const { fetch } = stubFetch({
      'raw.githubusercontent.com': { status: 200, contentType: 'image/png' },
    });
    const r = await resolveTokenLogo('bnb', WKC, {
      fetchImpl: fetch,
      factoryLogo: async () => { throw new Error('rpc down'); },
    });
    expect(r.source).toBe('trustwallet');
  });

  it('fetchFactoryLogo returns null with no factory, or an invalid address, without touching the network', async () => {
    await expect(fetchFactoryLogo({ tokenFactoryAddress: null, rpcUrl: 'https://example.invalid' }, WKC)).resolves.toBeNull();
    await expect(fetchFactoryLogo({ tokenFactoryAddress: 'not-an-address', rpcUrl: 'https://example.invalid' }, WKC)).resolves.toBeNull();
    await expect(fetchFactoryLogo({ tokenFactoryAddress: '0x1111111111111111111111111111111111111111', rpcUrl: 'https://example.invalid' }, 'not-an-address')).resolves.toBeNull();
  });
});
