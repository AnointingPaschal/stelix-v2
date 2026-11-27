/**
 * LIVE balances — real RPC reads only. No placeholder balances.
 *
 * A new wallet has NO tokens: balances start empty and the portfolio is
 * $0.00 until the user receives funds on-chain. The imported-token list
 * is stored locally and is EMPTY by default — the user adds tokens by
 * address; nothing is pre-seeded.
 *
 * - Native balance: ethers provider.getBalance (per-chain public RPCs,
 *   env-overridable via EXPO_PUBLIC_<CHAIN>_RPC_URL — see chains.ts).
 *   Reads go through getProvider(), an ethers FallbackProvider over ALL
 *   registry RPCs for the chain (quorum 1), so one dead RPC hostname
 *   can no longer break balances / Import Token / send / swap — Arc
 *   testnet's old rpc.testnet.arc.network hostname stopped resolving
 *   on device (2026-11-27) and the wallet had no fallback.
 * - ERC-20 balanceOf via a minimal ABI (balanceOf / decimals / symbol / name).
 * - Prices come from prices.ts (DexScreener/CoinGecko) and are labelled
 *   with source + timestamp; a token with no live price has priceUsd null
 *   and contributes $0 to the displayed total (it is still listed).
 * - Solana: SOL + SPL tokens via @solana/web3.js (see lib/solana.ts).
 *   The caller passes the wallet's derived Solana address (stored in the
 *   wallet meta) as `address`; the EVM address is meaningless on Solana.
 *   Restored 2026-11-27 (all chains active again).
 */
import { ethers } from 'ethers';
import { getChain, type ChainConfig } from './chains';
import { fetchDexScreenerToken, fetchMajorPrices } from './prices';
import { fetchSolanaBalances } from './solana';
import { kvGet, kvSet } from './storage';

export const ERC20_MIN_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
] as const;

export interface ImportedToken {
  chainId: string;
  address: string; // ERC-20 contract address (EVM); mint address on Solana
  symbol: string;
  name: string;
  decimals: number;
  coingeckoId?: string;
  /** Logo URL verified at import time (user saw it in the preview card). */
  logoUrl?: string | null;
}

export interface TokenBalance {
  symbol: string;
  name: string;
  chainId: string;
  address: string; // '' for the native asset
  decimals: number;
  balance: number; // spendable, in token units (float for display)
  balanceRaw: string; // exact raw units as a decimal string
  locked: number; // locked amount is filled in by the store from on-chain locks; 0 here
  priceUsd: number | null;
  /** Alias of priceUsd, kept so existing callers reading `.price` keep working. */
  price: number | null;
  priceSource: 'dexscreener' | 'coingecko' | 'unavailable';
  priceUpdatedAt: number | null;
  coingeckoId?: string;
  /** Verified logo URL (imported tokens) — null = no logo found anywhere. */
  logoUrl?: string | null;
  isSpam: boolean; // true only when flagged by the dust/spam filter (see history.ts)
}

export interface BalancesResult {
  chain: ChainConfig;
  address: string;
  tokens: TokenBalance[];
  totalUsd: number; // sum over tokens with a live price only
  loading: boolean;
  error: string | null;
  updatedAt: number;
}

/** The token rows actually listed on Home: spam hidden unless the user
 *  opted to show it. The "Assets N tokens" header count must equal this
 *  list's length — counting by balance (balance > 0) undercounts, because
 *  0-balance default/imported rows are still listed. */
export function visibleTokens<T extends { isSpam: boolean }>(tokens: T[], showSpam: boolean): T[] {
  return tokens.filter((t) => !t.isSpam || showSpam);
}

const IMPORTED_TOKENS_KEY = 'stelix_imported_tokens_v2';

/** Ordered RPC URLs for a chain: the (env-overridable) primary first,
 *  then the registry fallbacks, de-duplicated. The env override wins
 *  when EXPO_PUBLIC_<CHAIN>_RPC_URL is set — it is already baked into
 *  chain.rpcUrl by chains.ts, so it sorts first here. */
export function getRpcUrls(chain: ChainConfig): string[] {
  const urls = [chain.rpcUrl, ...chain.rpcUrls];
  return [...new Set(urls.filter((u) => typeof u === 'string' && u.startsWith('http')))];
}

/**
 * Provider for an EVM chain, with RPC fallback.
 *
 * The old code used only chain.rpcUrl: when that one hostname died
 * (Arc testnet rpc.testnet.arc.network stopped resolving — see
 * chains.ts), every balance / import-token / send / swap read broke.
 * This builds an ethers FallbackProvider over ALL registry RPCs in
 * order (primary first), quorum 1 so a single live RPC is enough, and
 * the default 400 ms stall timeout so a dead primary fails over fast.
 * One dead hostname can no longer break the wallet.
 *
 * Callers keep using it as a normal ethers provider (getBalance, call,
 * estimateGas, getFeeData, signer.connect); the return type is
 * ethers.AbstractProvider because a FallbackProvider is not a
 * JsonRpcProvider. A chain with a single RPC still gets a plain
 * JsonRpcProvider (no fallback overhead).
 *
 * Sub-providers are built with `{ staticNetwork: true }`: the chain id
 * is pinned by the registry, so no eth_chainId detection round-trip is
 * needed — and a dead host's provider would otherwise retry detection
 * every 1s forever (ethers _start loop), spamming the console and
 * leaking a timer per getProvider() call while the host is down. The
 * FallbackProvider still requires all sub-providers to agree on the
 * network (it reads each one's static network at initial sync).
 */
export function getProvider(chain: ChainConfig): ethers.AbstractProvider {
  if (chain.kind !== 'evm' || chain.chainId === null) {
    throw new Error(`${chain.name} is not an EVM chain — use its native RPC client, not ethers.`);
  }
  const chainId: number = chain.chainId;
  const urls = getRpcUrls(chain);
  if (urls.length === 1) {
    return new ethers.JsonRpcProvider(urls[0], chainId, { staticNetwork: true });
  }
  return new ethers.FallbackProvider(
    urls.map((url) => new ethers.JsonRpcProvider(url, chainId, { staticNetwork: true })),
    chainId,
    { quorum: 1 },
  );
}

export async function loadImportedTokens(): Promise<ImportedToken[]> {
  try {
    const raw = await kvGet(IMPORTED_TOKENS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ImportedToken[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveImportedTokens(tokens: ImportedToken[]): Promise<void> {
  await kvSet(IMPORTED_TOKENS_KEY, JSON.stringify(tokens));
}

export async function addImportedToken(token: ImportedToken): Promise<ImportedToken[]> {
  const list = await loadImportedTokens();
  if (
    list.some(
      (t) => t.chainId === token.chainId && t.address.toLowerCase() === token.address.toLowerCase(),
    )
  ) {
    return list;
  }
  const next = [...list, token];
  await saveImportedTokens(next);
  return next;
}

export async function removeImportedToken(chainId: string, address: string): Promise<ImportedToken[]> {
  const list = await loadImportedTokens();
  const next = list.filter(
    (t) => !(t.chainId === chainId && t.address.toLowerCase() === address.toLowerCase()),
  );
  await saveImportedTokens(next);
  return next;
}

/** Resolve an ERC-20's symbol/name/decimals from chain (used when adding a token by address).
 * EVM-only: on Solana the import sheet must refuse before calling this
 * (SPL tokens are discovered from the wallet's token accounts, not by
 * pasting a mint) — the raw getProvider() error ('not an EVM chain')
 * used to leak into the import preview as a confusing message. */
export async function resolveTokenMetadata(
  chain: ChainConfig,
  address: string,
): Promise<{ symbol: string; name: string; decimals: number }> {
  if (chain.kind !== 'evm' || chain.chainId === null) {
    throw new Error(
      `${chain.name} is not an EVM chain — tokens are added by contract address on EVM chains only. On Solana, tokens appear automatically from the wallet's token accounts.`,
    );
  }
  const provider = getProvider(chain);
  const contract = new ethers.Contract(address, ERC20_MIN_ABI, provider);
  const [symbol, name, decimals] = await Promise.all([
    contract.symbol() as Promise<string>,
    contract.name() as Promise<string>,
    contract.decimals() as Promise<number>,
  ]);
  return { symbol, name, decimals: Number(decimals) };
}

async function fetchNativeBalance(
  chain: ChainConfig,
  provider: ethers.AbstractProvider,
  address: string,
): Promise<TokenBalance> {
  const raw = await provider.getBalance(address);
  const balance = Number(ethers.formatUnits(raw, chain.nativeDecimals));
  return {
    symbol: chain.nativeSymbol,
    name: chain.nativeName,
    chainId: chain.id,
    address: '',
    decimals: chain.nativeDecimals,
    balance,
    balanceRaw: raw.toString(),
    locked: 0,
    priceUsd: null,
    price: null,
    priceSource: 'unavailable',
    priceUpdatedAt: null,
    isSpam: false,
  };
}

async function fetchErc20Balance(
  chain: ChainConfig,
  provider: ethers.AbstractProvider,
  address: string,
  token: ImportedToken,
): Promise<TokenBalance> {
  const contract = new ethers.Contract(token.address, ERC20_MIN_ABI, provider);
  const raw = (await contract.balanceOf(address)) as bigint;
  return {
    symbol: token.symbol,
    name: token.name,
    chainId: token.chainId,
    address: token.address,
    decimals: token.decimals,
    balance: Number(ethers.formatUnits(raw, token.decimals)),
    balanceRaw: raw.toString(),
    locked: 0,
    priceUsd: null,
    price: null,
    priceSource: 'unavailable',
    priceUpdatedAt: null,
    coingeckoId: token.coingeckoId,
    logoUrl: token.logoUrl ?? null,
    isSpam: false,
  };
}

const MAJOR_COINGECKO_IDS: Record<string, string> = {
  BNB: 'binancecoin',
  ETH: 'ethereum',
  SOL: 'solana',
  POL: 'matic-network',
  USDC: 'usd-coin',
  USDT: 'tether',
};

/** Fetch live balances for the native asset + the user's imported tokens. */
export async function fetchBalances(
  chainId: string,
  address: string,
  importedTokens?: ImportedToken[],
): Promise<BalancesResult> {
  const chain = getChain(chainId);
  const startedAt = Date.now();
  // NOTE (2026-11-27): the EVM address check MUST come after the Solana
  // branch below. A valid base58 Solana address fails ethers.isAddress,
  // so validating it here rejected every Solana balance read with
  // 'Invalid wallet address.' — Solana showed an empty portfolio even
  // though the Solana branch itself was correctly placed. EVM chains
  // are validated just before getProvider() further down.
  if (chain.kind === 'solana') {
    if (!address || address.startsWith('0x')) {
      return {
        chain,
        address,
        tokens: [],
        totalUsd: 0,
        loading: false,
        error:
          'No Solana address for this wallet — it was imported from a raw private key, so no Solana address could be derived. Import the seed phrase to use Solana.',
        updatedAt: startedAt,
      };
    }
    try {
      const sol = await fetchSolanaBalances(address);
      const tokens: TokenBalance[] = [];
      const solPrice = (await fetchMajorPrices(['solana']))?.solana?.price ?? null;
      tokens.push({
        symbol: chain.nativeSymbol,
        name: chain.nativeName,
        chainId: chain.id,
        address: '',
        decimals: chain.nativeDecimals,
        balance: sol.sol,
        balanceRaw: sol.lamports.toString(),
        locked: 0,
        priceUsd: solPrice,
        price: solPrice,
        priceSource: solPrice !== null ? 'coingecko' : 'unavailable',
        priceUpdatedAt: solPrice !== null ? Date.now() : null,
        isSpam: false,
      });
      for (const t of sol.tokens) {
        const ds = await fetchDexScreenerToken(chain.id, t.mint);
        tokens.push({
          symbol: ds?.symbol ?? `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`,
          name: ds?.name ?? `SPL token ${t.mint.slice(0, 8)}…`,
          chainId: chain.id,
          address: t.mint,
          decimals: t.decimals,
          balance: t.balance,
          balanceRaw: t.balanceRaw,
          locked: 0,
          priceUsd: ds?.priceUsd ?? null,
          price: ds?.priceUsd ?? null,
          priceSource: ds?.priceUsd ? 'dexscreener' : 'unavailable',
          priceUpdatedAt: ds?.updatedAt ?? null,
          logoUrl: null,
          isSpam: false,
        });
      }
      const totalUsd = tokens.reduce((s, t) => s + (t.priceUsd !== null ? t.balance * t.priceUsd : 0), 0);
      return { chain, address, tokens, totalUsd, loading: false, error: null, updatedAt: Date.now() };
    } catch (e) {
      return {
        chain,
        address,
        tokens: [],
        totalUsd: 0,
        loading: false,
        error: `Could not read Solana balances from ${chain.rpcUrl}: ${e instanceof Error ? e.message : String(e)}`,
        updatedAt: startedAt,
      };
    }
  }
  // EVM-only address check (see the note above the Solana branch): a
  // base58 Solana address must never reach this point — it returns
  // inside the Solana branch above.
  if (!ethers.isAddress(address)) {
    return { chain, address, tokens: [], totalUsd: 0, loading: false, error: 'Invalid wallet address.', updatedAt: startedAt };
  }
  const provider = getProvider(chain);
  const imported = (importedTokens ?? (await loadImportedTokens())).filter((t) => t.chainId === chain.id);
  let native: TokenBalance;
  try {
    native = await fetchNativeBalance(chain, provider, address);
  } catch (e) {
    return {
      chain,
      address,
      tokens: [],
      totalUsd: 0,
      loading: false,
      error: `Could not read ${chain.name} balance from ${chain.rpcUrl} (tried ${getRpcUrls(chain).join(', ')}): ${e instanceof Error ? e.message : String(e)}`,
      updatedAt: startedAt,
    };
  }
  const erc20 = await Promise.all(
    imported.map(async (t) => {
      try {
        return await fetchErc20Balance(chain, provider, address, t);
      } catch {
        return null; // unreadable token: dropped, not zero-filled silently
      }
    }),
  );
  const tokens = [native, ...erc20.filter((t): t is TokenBalance => t !== null)];

  // Prices: DexScreener per ERC-20, CoinGecko for majors (native + stables).
  const cgIds = [...new Set(tokens.map((t) => t.coingeckoId ?? MAJOR_COINGECKO_IDS[t.symbol]).filter(Boolean))] as string[];
  const cg = cgIds.length > 0 ? await fetchMajorPrices(cgIds) : {};
  for (const t of tokens) {
    const cgId = t.coingeckoId ?? MAJOR_COINGECKO_IDS[t.symbol];
    if (t.address) {
      const ds = await fetchDexScreenerToken(chain.id, t.address);
      if (ds?.priceUsd) {
        t.priceUsd = ds.priceUsd;
        t.price = ds.priceUsd;
        t.priceSource = 'dexscreener';
        t.priceUpdatedAt = ds.updatedAt;
        continue;
      }
    }
    if (cgId && cg[cgId]?.price !== null) {
      t.priceUsd = cg[cgId].price;
      t.price = cg[cgId].price;
      t.priceSource = 'coingecko';
      t.priceUpdatedAt = cg[cgId].updatedAt;
    }
  }

  const totalUsd = tokens.reduce((s, t) => s + (t.priceUsd !== null ? t.balance * t.priceUsd : 0), 0);
  return { chain, address, tokens, totalUsd, loading: false, error: null, updatedAt: Date.now() };
}
