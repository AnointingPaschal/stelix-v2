/**
 * Watchlist — starred tokens, persisted per token.
 *
 * The star on Token Detail used to be a dead end: it wrote to kv storage
 * (in-memory only on native before the AsyncStorage fix) and no screen
 * ever listed the watched tokens. This module owns the list: load /
 * toggle / resolve. Home renders the resolved list, so a watched token
 * is one tap from its detail page.
 *
 * Keys are `${chainId}:${address || symbol}` — the same format Token
 * Detail always used, so stars saved by earlier builds keep working.
 * Non-secret: symbols, addresses and prices are public.
 */
import { kvGet, kvSet } from './storage';
import type { TokenBalance } from './balances';
import { fetchTokenMarketData } from './prices';

export const WATCHLIST_KEY = 'stelix:watchlist';

/** Storage key for one token: `${chainId}:${address || symbol}`. */
export function watchKey(chainId: string, address: string, symbol: string): string {
  return `${chainId}:${address || symbol}`;
}

export async function loadWatchlist(): Promise<string[]> {
  try {
    const raw = await kvGet(WATCHLIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export async function isWatched(key: string): Promise<boolean> {
  return (await loadWatchlist()).includes(key);
}

/** Flip the star for one token. Returns the new watched state. */
export async function toggleWatchlist(key: string): Promise<boolean> {
  const list = await loadWatchlist();
  const next = list.includes(key) ? list.filter((k) => k !== key) : [...new Set([...list, key])];
  await kvSet(WATCHLIST_KEY, JSON.stringify(next));
  return next.includes(key);
}

export interface WatchlistEntry {
  key: string;
  chainId: string;
  /** Contract/mint address, '' for the chain's native asset. */
  address: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  change24h: number | null;
  /** True when the token is held/imported in the wallet. */
  held: boolean;
  balance: number;
}

function isAddressLike(v: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(v) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
}

/**
 * Resolve stored keys to display rows. Held tokens use the wallet's own
 * row (real balance + price); anything else is resolved live from
 * DexScreener/GeckoTerminal by contract address. A key that resolves
 * nowhere keeps its symbol with no price — never an invented value.
 */
export async function resolveWatchlistEntries(
  keys: string[],
  storeTokens: TokenBalance[],
): Promise<WatchlistEntry[]> {
  const out: WatchlistEntry[] = [];
  for (const key of keys) {
    const [chainId, rest = ''] = key.split(':');
    if (!chainId || !rest) continue;
    const held =
      storeTokens.find(
        (t) =>
          t.chainId === chainId &&
          (t.address ? t.address.toLowerCase() === rest.toLowerCase() : t.symbol === rest),
      ) ?? null;
    if (held) {
      out.push({
        key,
        chainId,
        address: held.address,
        symbol: held.symbol,
        name: held.name,
        priceUsd: held.priceUsd,
        change24h: null,
        held: true,
        balance: held.balance,
      });
      continue;
    }
    if (isAddressLike(rest)) {
      const market = await fetchTokenMarketData(chainId, rest).catch(() => null);
      out.push({
        key,
        chainId,
        address: rest,
        symbol: market?.symbol ?? '',
        name: market?.name ?? '',
        priceUsd: market?.priceUsd ?? null,
        change24h: market?.change24h ?? null,
        held: false,
        balance: 0,
      });
      continue;
    }
    // Native asset by symbol (e.g. `bnb:BNB`) with no store row.
    out.push({
      key,
      chainId,
      address: '',
      symbol: rest,
      name: rest,
      priceUsd: null,
      change24h: null,
      held: false,
      balance: 0,
    });
  }
  return out;
}
