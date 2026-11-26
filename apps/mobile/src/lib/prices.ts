/**
 * Live price hooks — DexScreener + CoinGecko with graceful offline fallback
 * to demo prices. All fetches time out quickly and never throw to the UI.
 */
import { useEffect, useState } from 'react';
import { demoToken } from './demoData';

export interface LivePrice {
  price: number;
  change24h: number | null;
  source: 'live' | 'demo';
  updatedAt: number;
}

async function fetchWithTimeout(url: string, ms = 6000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** CoinGecko simple price for a token id. */
export async function fetchCoinGeckoPrice(coingeckoId: string): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coingeckoId)}&vs_currencies=usd&include_24hr_change=true`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    const entry = json[coingeckoId];
    return typeof entry?.usd === 'number' ? entry.usd : null;
  } catch {
    return null;
  }
}

/** DexScreener pair lookup by token address (chain-scoped). */
export async function fetchDexScreenerPrice(chainId: string, address: string): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(
      `https://api.dexscreener.com/tokens/v1/${encodeURIComponent(chainId)}/${encodeURIComponent(address)}`,
    );
    if (!res.ok) return null;
    const json = await res.json();
    const pair = Array.isArray(json) ? json[0] : null;
    const p = pair?.priceUsd ? Number(pair.priceUsd) : null;
    return p && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/** Hook: live price for a symbol, falling back to the demo price offline. */
export function useLivePrice(symbol: string): LivePrice {
  const token = demoToken(symbol);
  const [state, setState] = useState<LivePrice>({
    price: token.price,
    change24h: token.change24h,
    source: 'demo',
    updatedAt: Date.now(),
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cg, ds] = await Promise.all([
        token.coingeckoId ? fetchCoinGeckoPrice(token.coingeckoId) : Promise.resolve(null),
        token.address ? fetchDexScreenerPrice(token.chainId, token.address) : Promise.resolve(null),
      ]);
      const price = ds ?? cg;
      if (!cancelled && price !== null && price > 0) {
        setState({ price, change24h: token.change24h, source: 'live', updatedAt: Date.now() });
      }
    })();
    const t = setInterval(async () => {
      const price = token.coingeckoId ? await fetchCoinGeckoPrice(token.coingeckoId) : null;
      if (!cancelled && price !== null && price > 0) {
        setState({ price, change24h: token.change24h, source: 'live', updatedAt: Date.now() });
      }
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  return state;
}
