/**
 * Real token-logo resolver — no letter avatars unless every source fails.
 *
 * Sources, tried in order per chain, first URL that actually loads wins:
 *   1. Trust Wallet assets repo (raw.githubusercontent.com)
 *      blockchains/<folder>/assets/<checksummed-address>/logo.png
 *      (native asset: blockchains/<folder>/info/logo.png)
 *   2. DexScreener token API — info.imageUrl of the best pair on the chain
 *   3. GeckoTerminal token API — attributes.image_url (also yields the
 *      CoinGecko coin id for step 4)
 *   4. CoinGecko coin API — image.large for the known coingecko_coin_id
 *   5. Chain token lists (PancakeSwap extended for BSC, Uniswap default
 *      for Ethereum/Base/Polygon/Arbitrum) — logoURI by contract address
 *
 * Every candidate URL is verified with a HEAD request (GET fallback — some
 * CDNs reject HEAD) before it is trusted. Results are cached in memory and
 * in local storage (7 days for a found logo, 24h for "none") so My Assets
 * does not refetch on every render.
 *
 * Verified live from this VM on 2026-11-26 (curl):
 *   - BNB native, WBNB, USDT (BSC), WKC all 200 on Trust Wallet
 *   - GTAN 404 on Trust Wallet, but 200 via GeckoTerminal image_url
 *     (coin-images.coingecko.com/.../Giant_GTAN_200_logo.png)
 *   - DexScreener CDN imageUrl 200 via GET (422 on HEAD — hence the GET
 *     fallback in verifyImageUrl)
 *
 * No secrets, no keys. Pure TS (no react-native imports) so it is unit
 * testable under Jest with an injected fetch implementation.
 */
import { ethers } from 'ethers';
import { getChain } from './chains';
import { kvGet, kvSet } from './storage';

export type LogoSource =
  | 'trustwallet'
  | 'dexscreener'
  | 'geckoterminal'
  | 'coingecko'
  | 'tokenlist'
  | 'none';

export interface TokenLogoResult {
  url: string | null;
  source: LogoSource;
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

const CACHE_KEY = 'stelix_token_logos_v1';
const FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const NONE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 8000;

/** Trust Wallet asset-repo folder per Stelix chain id. */
export const TRUSTWALLET_CHAIN_FOLDER: Record<string, string> = {
  arc: 'arc',
  bnb: 'smartchain',
  base: 'base',
  ethereum: 'ethereum',
  polygon: 'polygon',
  solana: 'solana',
};

/** DexScreener chain slug / GeckoTerminal network slug -> Stelix chain id. */
const CHAIN_ALIASES: Record<string, string> = {
  bsc: 'bnb',
  smartchain: 'bnb',
  eth: 'ethereum',
  matic: 'polygon',
  polygon_pos: 'polygon',
};

/** CoinGecko coin id for a chain's native asset (logo fallback). */
const NATIVE_COINGECKO_ID: Record<string, string> = {
  BNB: 'binancecoin',
  ETH: 'ethereum',
  SOL: 'solana',
  POL: 'matic-network',
  USDC: 'usd-coin',
  USDT: 'tether',
};

/** Token-list URL per Stelix chain id (step 5 fallback). */
const TOKEN_LIST_URL: Record<string, string> = {
  bnb: 'https://tokens.pancakeswap.finance/pancakeswap-extended.json',
  ethereum: 'https://tokens.uniswap.org',
  base: 'https://tokens.uniswap.org',
  polygon: 'https://tokens.uniswap.org',
};

/** Normalise a chain identifier (Stelix id, DexScreener slug or
 *  GeckoTerminal network slug) to a Stelix chain id. Unknown ids pass
 *  through unchanged and fail gracefully in the source lookups. */
export function normalizeChainId(chainId: string): string {
  const lower = chainId.trim().toLowerCase();
  if (CHAIN_ALIASES[lower]) return CHAIN_ALIASES[lower];
  return lower;
}

function cacheKey(chainId: string, address: string): string {
  return `${normalizeChainId(chainId)}:${address ? address.toLowerCase() : 'native'}`;
}

function trustWalletFolder(chainId: string): string | null {
  return TRUSTWALLET_CHAIN_FOLDER[normalizeChainId(chainId)] ?? null;
}

/** Pure helper — Trust Wallet logo URL for an ERC-20 (checksummed). */
export function trustWalletLogoUrl(chainId: string, address: string): string | null {
  const folder = trustWalletFolder(chainId);
  if (!folder) return null;
  let checksummed = address;
  try {
    checksummed = ethers.getAddress(address);
  } catch {
    // Non-EVM address (e.g. Solana mint): use as-is.
  }
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${folder}/assets/${checksummed}/logo.png`;
}

/** Pure helper — Trust Wallet logo URL for a chain's native asset. */
export function trustWalletNativeLogoUrl(chainId: string): string | null {
  const folder = trustWalletFolder(chainId);
  if (!folder) return null;
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${folder}/info/logo.png`;
}

async function fetchWithTimeout(
  url: string,
  fetchImpl: FetchImpl,
  ms = FETCH_TIMEOUT_MS,
  init?: RequestInit,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Verify a logo URL actually serves an image. HEAD first (cheap); some
 * CDNs reject HEAD (DexScreener's returns 422), so a non-404 HEAD failure
 * falls back to GET. A 404/403 is final — no point retrying with GET.
 */
export async function verifyImageUrl(url: string, fetchImpl: FetchImpl = fetch): Promise<boolean> {
  try {
    const head = await fetchWithTimeout(url, fetchImpl, FETCH_TIMEOUT_MS, { method: 'HEAD' });
    if (head.ok) {
      const ct = head.headers?.get?.('content-type') ?? '';
      return !ct || ct.startsWith('image/');
    }
    if (head.status === 404 || head.status === 403) return false;
  } catch {
    // HEAD failed (network/abort) — try GET below.
  }
  try {
    const get = await fetchWithTimeout(url, fetchImpl, FETCH_TIMEOUT_MS, { method: 'GET' });
    if (!get.ok) return false;
    const ct = get.headers?.get?.('content-type') ?? '';
    return !ct || ct.startsWith('image/');
  } catch {
    return false;
  }
}

async function fetchJson<T>(url: string, fetchImpl: FetchImpl): Promise<T | null> {
  try {
    const res = await fetchWithTimeout(url, fetchImpl);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cache (memory + local storage)
// ---------------------------------------------------------------------------

interface CacheEntry {
  url: string | null;
  source: LogoSource;
  at: number;
}

const memoryCache = new Map<string, CacheEntry>();
let diskCacheLoaded = false;

async function loadDiskCache(): Promise<void> {
  if (diskCacheLoaded) return;
  diskCacheLoaded = true;
  try {
    const raw = await kvGet(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v.at === 'number') memoryCache.set(k, v);
      }
    }
  } catch {
    // Corrupt cache: ignore, memory cache stays empty.
  }
}

async function persistDiskCache(): Promise<void> {
  try {
    const obj: Record<string, CacheEntry> = {};
    for (const [k, v] of memoryCache) obj[k] = v;
    await kvSet(CACHE_KEY, JSON.stringify(obj));
  } catch {
    // Storage failure must never break logo display.
  }
}

function cachedEntry(key: string): CacheEntry | null {
  const e = memoryCache.get(key);
  if (!e) return null;
  const ttl = e.url ? FOUND_TTL_MS : NONE_TTL_MS;
  if (Date.now() - e.at > ttl) {
    memoryCache.delete(key);
    return null;
  }
  return e;
}

function storeEntry(key: string, entry: CacheEntry): void {
  memoryCache.set(key, entry);
  void persistDiskCache();
}

/** Synchronous read of the in-memory cache (warmed from disk on first
 *  resolve). Returns undefined when nothing usable is cached yet. */
export function getCachedLogo(chainId: string, address: string): TokenLogoResult | undefined {
  const e = cachedEntry(cacheKey(chainId, address));
  return e ? { url: e.url, source: e.source } : undefined;
}

// ---------------------------------------------------------------------------
// Source lookups
// ---------------------------------------------------------------------------

interface DexScreenerPair {
  chainId?: string;
  liquidity?: { usd?: number };
  info?: { imageUrl?: string };
}

async function logoFromDexScreener(
  chainId: string,
  address: string,
  fetchImpl: FetchImpl,
): Promise<string | null> {
  const json = await fetchJson<{ pairs?: DexScreenerPair[] }>(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`,
    fetchImpl,
  );
  const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
  if (pairs.length === 0) return null;
  const chain = getChain(normalizeChainId(chainId));
  const onChain = pairs.filter((p) => p.chainId === chain.dexScreenerChainId);
  const pool = [...onChain, ...pairs].sort(
    (a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0),
  )[0];
  return pool?.info?.imageUrl ?? null;
}

async function logoFromGeckoTerminal(
  chainId: string,
  address: string,
  fetchImpl: FetchImpl,
): Promise<{ imageUrl: string | null; coingeckoId: string | null }> {
  const chain = getChain(normalizeChainId(chainId));
  const json = await fetchJson<{
    data?: { attributes?: { image_url?: string; coingecko_coin_id?: string } };
  }>(
    `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(chain.geckoTerminalNetwork)}/tokens/${encodeURIComponent(address)}`,
    fetchImpl,
  );
  const a = json?.data?.attributes;
  return {
    imageUrl: typeof a?.image_url === 'string' && a.image_url ? a.image_url : null,
    coingeckoId: typeof a?.coingecko_coin_id === 'string' && a.coingecko_coin_id ? a.coingecko_coin_id : null,
  };
}

async function logoFromCoinGecko(coingeckoId: string, fetchImpl: FetchImpl): Promise<string | null> {
  const json = await fetchJson<{ image?: { large?: string; small?: string; thumb?: string } }>(
    `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coingeckoId)}`,
    fetchImpl,
  );
  return json?.image?.large ?? json?.image?.small ?? json?.image?.thumb ?? null;
}

// Token lists are fetched once per list URL per session and indexed by
// "<numeric chain id>:<lowercase address>" — the Uniswap default list
// spans chains, and the same address on two chains is a different token.
const tokenListCache = new Map<string, Promise<Map<string, string>>>();

async function loadTokenList(url: string, fetchImpl: FetchImpl): Promise<Map<string, string>> {
  const existing = tokenListCache.get(url);
  if (existing) return existing;
  const p = (async () => {
    const index = new Map<string, string>();
    const json = await fetchJson<{
      tokens?: { chainId?: number; address?: string; logoURI?: string }[];
    }>(url, fetchImpl);
    for (const t of json?.tokens ?? []) {
      if (t?.address && t?.logoURI && typeof t.chainId === 'number') {
        index.set(`${t.chainId}:${t.address.toLowerCase()}`, t.logoURI);
      }
    }
    return index;
  })();
  tokenListCache.set(url, p);
  return p;
}

async function logoFromTokenList(
  chainId: string,
  address: string,
  fetchImpl: FetchImpl,
): Promise<string | null> {
  const url = TOKEN_LIST_URL[normalizeChainId(chainId)];
  if (!url) return null;
  const chain = getChain(normalizeChainId(chainId));
  if (chain.chainId === null) return null; // Solana has no numeric chain id
  const index = await loadTokenList(url, fetchImpl);
  return index.get(`${chain.chainId}:${address.toLowerCase()}`) ?? null;
}

// ---------------------------------------------------------------------------
// Public resolver
// ---------------------------------------------------------------------------

export interface ResolveTokenLogoOptions {
  fetchImpl?: FetchImpl;
  /** CoinGecko id of the native asset, when known (native logos only). */
  nativeCoingeckoId?: string;
}

/**
 * Resolve the real logo for a token. `address` is '' for the chain's
 * native asset. Throws on a malformed EVM contract address — callers
 * must surface that as a visible inline error, never a silent failure.
 * Returns { url: null, source: 'none' } when no source has a logo.
 */
export async function resolveTokenLogo(
  chainId: string,
  address: string,
  opts: ResolveTokenLogoOptions = {},
): Promise<TokenLogoResult> {
  const fetchImpl: FetchImpl = opts.fetchImpl ?? fetch;
  const canonical = normalizeChainId(chainId);
  const isNative = address === '';
  if (!isNative) {
    const chain = getChain(canonical);
    if (chain.kind === 'evm' && !ethers.isAddress(address)) {
      throw new Error(`Invalid token address: ${address}`);
    }
    if (!address.trim()) throw new Error('Invalid token address: empty address.');
  }

  await loadDiskCache();
  const key = cacheKey(canonical, address);
  const hit = cachedEntry(key);
  if (hit) return { url: hit.url, source: hit.source };

  const finish = (url: string | null, source: LogoSource): TokenLogoResult => {
    const entry: CacheEntry = { url, source, at: Date.now() };
    storeEntry(key, entry);
    return { url, source };
  };

  // --- Native asset: Trust Wallet info logo, then CoinGecko coin image.
  if (isNative) {
    const tw = trustWalletNativeLogoUrl(canonical);
    if (tw && (await verifyImageUrl(tw, fetchImpl))) return finish(tw, 'trustwallet');
    const chain = getChain(canonical);
    const cgId = opts.nativeCoingeckoId ?? NATIVE_COINGECKO_ID[chain.nativeSymbol];
    if (cgId) {
      const cg = await logoFromCoinGecko(cgId, fetchImpl);
      if (cg && (await verifyImageUrl(cg, fetchImpl))) return finish(cg, 'coingecko');
    }
    return finish(null, 'none');
  }

  // --- 1. Trust Wallet assets repo.
  const tw = trustWalletLogoUrl(canonical, address);
  if (tw && (await verifyImageUrl(tw, fetchImpl))) return finish(tw, 'trustwallet');

  // --- 2. DexScreener pair image.
  const ds = await logoFromDexScreener(canonical, address, fetchImpl);
  if (ds && (await verifyImageUrl(ds, fetchImpl))) return finish(ds, 'dexscreener');

  // --- 3. GeckoTerminal token image (also yields the CoinGecko id).
  const gt = await logoFromGeckoTerminal(canonical, address, fetchImpl);
  if (gt.imageUrl && (await verifyImageUrl(gt.imageUrl, fetchImpl))) {
    return finish(gt.imageUrl, 'geckoterminal');
  }

  // --- 4. CoinGecko coin image (only when GeckoTerminal named the coin).
  if (gt.coingeckoId) {
    const cg = await logoFromCoinGecko(gt.coingeckoId, fetchImpl);
    if (cg && (await verifyImageUrl(cg, fetchImpl))) return finish(cg, 'coingecko');
  }

  // --- 5. Chain token list logoURI.
  const tl = await logoFromTokenList(canonical, address, fetchImpl);
  if (tl && (await verifyImageUrl(tl, fetchImpl))) return finish(tl, 'tokenlist');

  return finish(null, 'none');
}

/** Best-effort warm-up for a list of tokens (e.g. My Assets on load).
 *  Failures resolve to null and never throw. */
export async function prefetchTokenLogos(
  tokens: { chainId: string; address: string }[],
  opts: ResolveTokenLogoOptions = {},
): Promise<void> {
  await Promise.all(
    tokens.map((t) =>
      resolveTokenLogo(t.chainId, t.address, opts).catch(() => null),
    ),
  );
}

/** Clear the logo caches (memory + disk). Used by tests and by a future
 *  settings "clear cache" action — not wired to any UI yet. */
export function clearLogoCache(): void {
  memoryCache.clear();
  tokenListCache.clear();
  void kvSet(CACHE_KEY, '{}');
}
