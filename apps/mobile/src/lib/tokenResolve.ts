/**
 * Token Detail routing / resolution — pure, no React Native imports.
 *
 * Token Detail lives at /token/[symbol], but the `symbol` segment may
 * carry either a symbol (BNB, WKC) or a contract address (imported and
 * Discover tokens). This module resolves that segment — plus the optional
 * address / chainId params — against the wallet's tokens, so EVERY asset
 * in My Assets (default or imported) opens its full detail page.
 *
 * Chain ids are normalised (DexScreener slugs like 'bsc' -> Stelix 'bnb')
 * so a Discover token never lands on the wrong chain.
 */
import type { TokenBalance } from './balances';

/** DexScreener / GeckoTerminal slug -> Stelix chain id. */
const CHAIN_ALIASES: Record<string, string> = {
  bsc: 'bnb',
  smartchain: 'bnb',
  eth: 'ethereum',
  matic: 'polygon',
  polygon_pos: 'polygon',
};

export function normalizeChainIdForRoute(chainId: string): string {
  const lower = chainId.trim().toLowerCase();
  return CHAIN_ALIASES[lower] ?? lower;
}

export function isAddressLike(v: string | null | undefined): boolean {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v.trim());
}

export interface TokenRefParams {
  symbol?: string;
  address?: string;
  chainId?: string;
}

export interface ResolvedTokenRef {
  /** Display symbol ('' when only an address is known and it is not held). */
  symbol: string;
  /** Contract address, '' for the chain's native asset. */
  address: string;
  chainId: string;
  /** The wallet's token row, when this asset is held / imported. */
  storeToken: TokenBalance | null;
  /** True when the page has enough to render full detail (a held token,
   *  or a contract address that live sources can resolve). */
  found: boolean;
}

export function resolveTokenRef(
  params: TokenRefParams,
  tokens: TokenBalance[],
  activeChainId: string,
): ResolvedTokenRef {
  const paramChain = params.chainId ? normalizeChainIdForRoute(params.chainId) : undefined;
  const raw = (params.symbol ?? '').trim();
  const byAddress = (addr: string) =>
    tokens.find((t) => t.address && t.address.toLowerCase() === addr.toLowerCase()) ?? null;
  const bySymbol = (sym: string) =>
    tokens.filter((t) => t.symbol.toLowerCase() === sym.toLowerCase());

  // The route segment itself is a contract address.
  if (isAddressLike(raw)) {
    const storeToken = byAddress(raw);
    return {
      symbol: storeToken?.symbol ?? '',
      address: raw,
      chainId: storeToken?.chainId ?? paramChain ?? activeChainId,
      storeToken,
      found: true, // an address can always be resolved from live sources
    };
  }

  // An address param was given alongside the symbol (Discover flow).
  if (isAddressLike(params.address)) {
    const storeToken = byAddress(params.address as string);
    return {
      symbol: storeToken?.symbol ?? raw,
      address: params.address as string,
      chainId: storeToken?.chainId ?? paramChain ?? activeChainId,
      storeToken,
      found: true,
    };
  }

  // Plain symbol: prefer a held token, on the requested chain when given.
  const matches = bySymbol(raw);
  const storeToken =
    (paramChain ? matches.find((t) => t.chainId === paramChain) : undefined) ??
    matches[0] ??
    null;
  return {
    symbol: raw,
    address: storeToken?.address ?? '',
    chainId: storeToken?.chainId ?? paramChain ?? activeChainId,
    storeToken,
    found: storeToken !== null,
  };
}

/** Route to a token's full detail page. Uses the contract address when
 *  the token has one (unique across chains and duplicate symbols), so an
 *  imported token never collides with a default token of the same symbol. */
export function tokenDetailRoute(token: { symbol: string; address: string; chainId: string }): {
  pathname: '/token/[symbol]';
  params: { symbol: string; address?: string; chainId: string };
} {
  const chainId = normalizeChainIdForRoute(token.chainId);
  if (token.address) {
    return {
      pathname: '/token/[symbol]',
      params: { symbol: token.address, address: token.address, chainId },
    };
  }
  return { pathname: '/token/[symbol]', params: { symbol: token.symbol, chainId } };
}
