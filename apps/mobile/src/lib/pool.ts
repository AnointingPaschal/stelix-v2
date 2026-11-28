/**
 * Uniswap V3 Add Liquidity — STX/USDC on Arc Mainnet (chain 5042).
 *
 * The pool token is NEVER hardcoded here. The STX token is resolved
 * at runtime from the synced admin registry (see resolvePoolToken):
 * the old STX (fixed 1,000,000 supply, no mint) cannot grow, and a
 * NEW STX token (same name/symbol, bigger supply) is being deployed
 * from the admin Launchpad — when the registry + launchpad record
 * switch to the new address, the pool follows with no code change.
 * Until a token is registered, there is no pool to seed and the
 * screen says so plainly.
 *
 * Contract addresses — verified with eth_getCode on
 * https://rpc.mainnet.arc.io on 2026-11-28 (all return real bytecode):
 *   Factory                  0xf0db7b58379503491d857dB50AC9ece64c653918 (24,535 bytes)
 *   NonfungiblePositionManager 0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377 (24,384 bytes)
 *   QuoterV2                 0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468 (8,273 bytes)
 *   SwapRouter02             0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77 (24,497 bytes)
 * The canonical Ethereum addresses are NOT Uniswap on Arc (they hold
 * small squatter contracts) — never use them here.
 *
 * Token order in a pool is by address (lower = token0), and the new
 * token's address is not known yet — so every price here is expressed
 * as "quote per base" (USDC per STX) and converted to the pool's
 * token0/token1 frame inside the helpers. Never assume which side
 * STX lands on.
 *
 * Fees: Uniswap V3 trading fees (0.3% of each swap in this pool)
 * accrue to the LP position owner — the wallet that holds the
 * position NFT — by protocol design. There is no Stelix fee
 * recipient on a mint: the mint call takes no fee parameter and no
 * fee is charged for adding liquidity. resolveFeeRecipient below
 * reads a `fees.feeRecipient` from the sync payload defensively (it
 * is not part of the published fee config today); it is exported so
 * a future fee flow can use it, not because a mint needs one.
 *
 * No @uniswap/v3-sdk dependency: the tick / sqrt-price math here is
 * small, pure BigInt + float log math, and avoids a heavy SDK in the
 * mobile bundle. Reads go through a minimal provider.call helper so
 * unit tests can pass a fake provider; writes use ethers v6
 * contracts + the self-custody signer, exactly like lib/vault.ts.
 * The signing modal is fingerprint-first (see SignTransactionModal)
 * — this module never touches passwords, seeds or keys.
 */
import { ethers } from 'ethers';
import { getChain } from './chains';
import { getProvider } from './balances';
import { recordBroadcastTx } from './localHistory';
import type { AdminTokenEntry } from './adminSync';

export const POOL_CHAIN_ID = 'arc-mainnet';
/** Registry symbol of the pool token — the lookup key, not an address. */
export const POOL_TOKEN_SYMBOL = 'STX';
/** Fee tier for the STX/USDC pool, agreed with the admin Pool view. */
export const POOL_FEE_TIER = 3000; // 0.3%
export const UNISWAP_V3_FACTORY = '0xf0db7b58379503491d857dB50AC9ece64c653918';
export const UNISWAP_V3_POSITION_MANAGER = '0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377';
export const UNISWAP_V3_QUOTER = '0x7DfD4F31be6814D2906BDE155c3e1B146EAc1468';
export const UNISWAP_V3_SWAP_ROUTER = '0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77';
/** Uniswap V3 tick bounds. */
export const MIN_TICK = -887272;
export const MAX_TICK = 887272;
/** Default slippage guard on mint min-amounts (0.5%). */
export const DEFAULT_MINT_SLIPPAGE_BPS = 50;
/** Mint deadline: 20 minutes from signing. */
export const MINT_DEADLINE_SECONDS = 20 * 60;

/** A pool token as resolved from the registry (or chain config). */
export interface PoolToken {
  address: string;
  symbol: string;
  decimals: number;
}

/**
 * Resolve the pool token from the synced admin registry: the STX
 * entry for the pool chain. Prefers a verified entry, then the
 * admin's display order. Returns null when no STX token is
 * registered yet (new token not deployed / not registered) — the
 * caller must show the "no token configured" state, never fall back
 * to a hardcoded address. Pure — unit-tested.
 */
export function resolvePoolToken(
  registryTokens: AdminTokenEntry[],
  chainId: string = POOL_CHAIN_ID,
  symbol: string = POOL_TOKEN_SYMBOL,
): PoolToken | null {
  const matches = registryTokens.filter(
    (t) => t.chainId === chainId && t.symbol.toUpperCase() === symbol.toUpperCase(),
  );
  if (matches.length === 0) return null;
  const sorted = [...matches].sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });
  const entry = sorted[0];
  if (!isAddress(entry.address) || !(entry.decimals > 0)) return null;
  return { address: entry.address, symbol: entry.symbol, decimals: entry.decimals };
}

/**
 * The pool's quote token (USDC) from the chain config — Arc's exit
 * stablecoin / native gas asset — not a hardcoded address in pool
 * code. The chain registry owns it.
 */
export function getPoolQuoteToken(chainId: string = POOL_CHAIN_ID): PoolToken {
  const chain = getChain(chainId);
  const address = chain.exitStablecoinAddress;
  if (!address) throw new Error(`No exit stablecoin is registered for ${chain.name}.`);
  return { address, symbol: chain.exitStablecoin, decimals: chain.nativeDecimals };
}

const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
] as const;

const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function tickSpacing() view returns (int24)',
  'function liquidity() view returns (uint128)',
] as const;

const POSITION_MANAGER_ABI = [
  'function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
] as const;

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const;

const FACTORY_IFACE = new ethers.Interface(FACTORY_ABI);
const POOL_IFACE = new ethers.Interface(POOL_ABI);
const NPM_IFACE = new ethers.Interface(POSITION_MANAGER_ABI);
const ERC20_IFACE = new ethers.Interface(ERC20_ABI);

const Q96 = 2n ** 96n;
const Q192 = 2n ** 192n;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Minimal provider surface the read helpers need — a real ethers
 *  provider, or a fake `{ call }` in tests. */
export type CallProvider = Pick<ethers.AbstractProvider, 'call'>;

async function readCall(
  provider: CallProvider,
  to: string,
  iface: ethers.Interface,
  fragment: string,
  args: unknown[] = [],
): Promise<ethers.Result> {
  const data = iface.encodeFunctionData(fragment, args);
  const raw = await provider.call({ to, data });
  return iface.decodeFunctionResult(fragment, raw);
}

function isAddress(v: unknown): v is string {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
}

// ---------------------------------------------------------------------------
// Pure math — sqrtPriceX96 / tick / price conversions (BigInt + log).
// ---------------------------------------------------------------------------

/** Integer square root (Newton). Throws on a negative input. */
export function bigintSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('bigintSqrt: negative input.');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * Price of token1 in token0 units (human units, e.g. USDC per STX)
 * from a pool sqrtPriceX96. price = (2^192 / sqrt^2) * 10^(dec1-dec0).
 * Computed in scaled BigInt math (1e18 scale) so tiny prices do not
 * collapse to zero the way a float division would.
 */
export function sqrtPriceX96ToPriceToken1PerToken0(
  sqrtPriceX96: bigint,
  dec0: number,
  dec1: number,
): number {
  if (sqrtPriceX96 <= 0n) throw new Error('Invalid sqrtPriceX96: must be positive.');
  const exp = dec1 - dec0;
  const scale = 10n ** 18n;
  const scaled =
    exp >= 0
      ? (Q192 * 10n ** BigInt(exp) * scale) / (sqrtPriceX96 * sqrtPriceX96)
      : (Q192 * scale) / (sqrtPriceX96 * sqrtPriceX96 * 10n ** BigInt(-exp));
  return Number(scaled) / 1e18;
}

/** Inverse: sqrtPriceX96 for a human price of token1 in token0 units. */
export function priceToken1PerToken0ToSqrtPriceX96(
  price: number,
  dec0: number,
  dec1: number,
): bigint {
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('Price must be a positive number.');
  }
  // Same toFixed(18) trick as vault.ts usdToWei: sub-cent prices keep
  // their full precision instead of rounding to zero.
  const priceScaled = ethers.parseUnits(price.toFixed(18), 18);
  if (priceScaled <= 0n) throw new Error('Price is too small to encode.');
  const exp = dec1 - dec0;
  const numerator =
    exp >= 0
      ? Q192 * 10n ** BigInt(exp) * 10n ** 18n
      : (Q192 * 10n ** 18n) / 10n ** BigInt(-exp);
  return bigintSqrt(numerator / priceScaled);
}

/**
 * Tick for a sqrtPriceX96: the largest tick whose sqrt price is at
 * most the given sqrt. Binary search over tickToSqrtPriceX96 (not a
 * float log): the log form is off by a tick at the range extremes
 * (float rounding of 1.0001^(tick/2)), and the search guarantees
 * round-trip consistency with tickToSqrtPriceX96 by construction.
 */
export function sqrtPriceX96ToTick(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 <= 0n) throw new Error('Invalid sqrtPriceX96: must be positive.');
  let lo = MIN_TICK;
  let hi = MAX_TICK;
  // Invariant: tickToSqrtPriceX96(lo) <= sqrt < tickToSqrtPriceX96(hi + 1).
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (tickToSqrtPriceX96(mid) <= sqrtPriceX96) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** sqrtPriceX96 for a tick: 2^96 * 1.0001^(tick/2). */
export function tickToSqrtPriceX96(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`Tick ${tick} is outside the Uniswap V3 range (${MIN_TICK}..${MAX_TICK}).`);
  }
  return BigInt(Math.round(Number(Q96) * 1.0001 ** (tick / 2)));
}

/** Human price of token1 in token0 units at a tick. */
export function tickToPriceToken1PerToken0(tick: number, dec0: number, dec1: number): number {
  return sqrtPriceX96ToPriceToken1PerToken0(tickToSqrtPriceX96(tick), dec0, dec1);
}

/** Tick for a human price of token1 in token0 units. */
export function priceToken1PerToken0ToTick(price: number, dec0: number, dec1: number): number {
  return sqrtPriceX96ToTick(priceToken1PerToken0ToSqrtPriceX96(price, dec0, dec1));
}

/** Tick spacing for a fee tier (null = unknown tier). */
export function tickSpacingForFee(fee: number): number | null {
  if (fee === 500) return 10;
  if (fee === 3000) return 60;
  if (fee === 10000) return 200;
  return null;
}

/** Round a tick to a usable tick (multiple of spacing). 'down' is for
 *  the lower bound, 'up' for the upper bound. */
export function roundTickToSpacing(
  tick: number,
  spacing: number,
  direction: 'down' | 'up',
): number {
  if (spacing <= 0) throw new Error('Tick spacing must be positive.');
  return direction === 'down'
    ? Math.floor(tick / spacing) * spacing
    : Math.ceil(tick / spacing) * spacing;
}

/** Widest usable range for a spacing — the "full-range-ish" default.
 *  The true extremes (±887272) are almost never spacing-aligned, so
 *  the bounds are pulled just inside them. */
export function defaultFullRangeTicks(spacing: number): { tickLower: number; tickUpper: number } {
  return {
    tickLower: roundTickToSpacing(MIN_TICK, spacing, 'up'),
    tickUpper: roundTickToSpacing(MAX_TICK, spacing, 'down'),
  };
}

/** Parse a user-entered decimal amount string into raw units, without
 *  float rounding: the fraction is truncated (never rounded up) to the
 *  token's decimals. Throws on a non-numeric or negative amount. */
export function parseTokenAmount(amount: string | number, decimals: number): bigint {
  const s = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid amount: "${s}".`);
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded || '0');
}

/** Format raw units back to a human decimal string (no float). */
export function formatTokenAmount(raw: bigint, decimals: number): string {
  if (raw < 0n) throw new Error('Negative raw amount.');
  const s = raw.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

/**
 * USDC needed for an STX amount at a price (USDC per STX), and the
 * inverse. Pure number math for the UI's live ratio display; the
 * on-chain builder below uses exact BigInt amounts.
 */
export function usdcForStx(stxAmount: number, priceUsdcPerStx: number): number {
  return stxAmount * priceUsdcPerStx;
}

export function stxForUsdc(usdcAmount: number, priceUsdcPerStx: number): number {
  if (!(priceUsdcPerStx > 0)) throw new Error('Price must be positive to convert USDC to STX.');
  return usdcAmount / priceUsdcPerStx;
}

/** Do two entered amounts match a price within `tolerancePct`?
 *  Used when the pool already exists: the ratio is the pool's, not
 *  the user's — a mismatch means the amounts cannot mint as entered. */
export function amountsMatchPrice(
  amount0: number,
  amount1: number,
  priceToken1PerToken0: number,
  tolerancePct = 0.5,
): boolean {
  if (!(amount0 > 0) || !(amount1 > 0) || !(priceToken1PerToken0 > 0)) return false;
  const implied = amount0 / amount1;
  return Math.abs(implied - priceToken1PerToken0) / priceToken1PerToken0 <= tolerancePct / 100;
}

// ---------------------------------------------------------------------------
// Pair-frame helpers — prices as "quote per base" (USDC per STX),
// converted to the pool's token0/token1 frame. The pool token's
// address is not known until it is deployed, so its pool side is
// decided by address comparison at call time, never assumed.
// ---------------------------------------------------------------------------

/** True when `base` is token0 of the pair (lower address). */
export function baseIsToken0(base: PoolToken, quote: PoolToken): boolean {
  return base.address.toLowerCase() < quote.address.toLowerCase();
}

/** Decimals of token0 / token1 for a base/quote pair. */
function pairDecimals(base: PoolToken, quote: PoolToken): { dec0: number; dec1: number } {
  return baseIsToken0(base, quote)
    ? { dec0: base.decimals, dec1: quote.decimals }
    : { dec0: quote.decimals, dec1: base.decimals };
}

/**
 * Price of `base` in `quote` units (e.g. USDC per STX) from a pool
 * state, whichever side of the pool each token sits on.
 */
export function poolStateToBasePrice(state: PoolState, base: PoolToken, quote: PoolToken): number {
  const baseIsToken1 = state.token1.toLowerCase() === base.address.toLowerCase();
  const baseIsToken0 = state.token0.toLowerCase() === base.address.toLowerCase();
  if (!baseIsToken1 && !baseIsToken0) throw new Error('Base token is not in this pool.');
  const quoteIsOther =
    (baseIsToken1 && state.token0.toLowerCase() === quote.address.toLowerCase()) ||
    (baseIsToken0 && state.token1.toLowerCase() === quote.address.toLowerCase());
  if (!quoteIsOther) throw new Error('Quote token is not in this pool.');
  return baseIsToken1 ? state.priceToken1PerToken0 : state.priceToken0PerToken1;
}

/**
 * sqrtPriceX96 for a "quote per base" price (e.g. the starting price
 * implied by the user's amounts when the pool does not exist yet).
 */
export function priceQuotePerBaseToSqrtPriceX96(
  priceQuotePerBase: number,
  base: PoolToken,
  quote: PoolToken,
): bigint {
  if (!Number.isFinite(priceQuotePerBase) || priceQuotePerBase <= 0) {
    throw new Error('Price must be a positive number.');
  }
  const { dec0, dec1 } = pairDecimals(base, quote);
  const priceToken1PerToken0 = baseIsToken0(base, quote)
    ? 1 / priceQuotePerBase
    : priceQuotePerBase;
  return priceToken1PerToken0ToSqrtPriceX96(priceToken1PerToken0, dec0, dec1);
}

/**
 * A user-chosen price range ("quote per base") to mint ticks: the
 * lower bound rounds down, the upper rounds up, so the range always
 * covers what the user asked for. Throws on an inverted range.
 */
export function priceRangeToTicks(
  minPriceQuotePerBase: number,
  maxPriceQuotePerBase: number,
  base: PoolToken,
  quote: PoolToken,
  spacing: number,
): { tickLower: number; tickUpper: number } {
  if (
    !Number.isFinite(minPriceQuotePerBase) ||
    !Number.isFinite(maxPriceQuotePerBase) ||
    !(minPriceQuotePerBase > 0) ||
    !(maxPriceQuotePerBase > minPriceQuotePerBase)
  ) {
    throw new Error('Price range is invalid: need 0 < min price < max price.');
  }
  const { dec0, dec1 } = pairDecimals(base, quote);
  // Token1-per-token0 prices at the bounds — inverted when the base
  // token is token0, which also swaps which bound is which.
  const pLow = baseIsToken0(base, quote) ? 1 / maxPriceQuotePerBase : minPriceQuotePerBase;
  const pHigh = baseIsToken0(base, quote) ? 1 / minPriceQuotePerBase : maxPriceQuotePerBase;
  const tickA = priceToken1PerToken0ToTick(pLow, dec0, dec1);
  const tickB = priceToken1PerToken0ToTick(pHigh, dec0, dec1);
  const tickLower = roundTickToSpacing(Math.min(tickA, tickB), spacing, 'down');
  const tickUpper = roundTickToSpacing(Math.max(tickA, tickB), spacing, 'up');
  if (tickLower >= tickUpper) throw new Error('Price range is too narrow for this tick spacing.');
  return { tickLower, tickUpper };
}

// ---------------------------------------------------------------------------
// Pool reads (Arc Mainnet).
// ---------------------------------------------------------------------------

export interface PoolState {
  pool: string;
  token0: string;
  token1: string;
  fee: number;
  tickSpacing: number;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  /** Human price of token1 in token0 units (USDC per STX here). */
  priceToken1PerToken0: number;
  /** Human price of token0 in token1 units (STX per USDC here). */
  priceToken0PerToken1: number;
}

/** Pool address for a token pair + fee tier, or null when no pool
 *  exists yet. */
export async function getPoolAddress(
  provider: CallProvider,
  tokenA: string,
  tokenB: string,
  fee: number = POOL_FEE_TIER,
): Promise<string | null> {
  const res = await readCall(provider, UNISWAP_V3_FACTORY, FACTORY_IFACE, 'getPool', [
    tokenA,
    tokenB,
    fee,
  ]);
  const pool = res[0] as string;
  return pool.toLowerCase() === ZERO_ADDRESS ? null : pool;
}

/** Full on-chain state for a pool address. `pair` supplies the two
 *  tokens' decimals — looked up by address, so either token may be
 *  token0. Throws when a pool token is not one of the pair. */
export async function getPoolState(
  provider: CallProvider,
  poolAddress: string,
  pair: [PoolToken, PoolToken],
): Promise<PoolState> {
  const [slot0, token0, token1, fee, tickSpacing, liquidity] = await Promise.all([
    readCall(provider, poolAddress, POOL_IFACE, 'slot0'),
    readCall(provider, poolAddress, POOL_IFACE, 'token0'),
    readCall(provider, poolAddress, POOL_IFACE, 'token1'),
    readCall(provider, poolAddress, POOL_IFACE, 'fee'),
    readCall(provider, poolAddress, POOL_IFACE, 'tickSpacing'),
    readCall(provider, poolAddress, POOL_IFACE, 'liquidity'),
  ]);
  const sqrtPriceX96 = slot0[0] as bigint;
  const t0 = (token0[0] as string).toLowerCase();
  const t1 = (token1[0] as string).toLowerCase();
  const decFor = (addr: string): number => {
    const hit = pair.find((t) => t.address.toLowerCase() === addr);
    if (!hit) throw new Error(`Pool token ${addr} is not part of this pair.`);
    return hit.decimals;
  };
  const dec0 = decFor(t0);
  const dec1 = decFor(t1);
  const priceToken1PerToken0 = sqrtPriceX96ToPriceToken1PerToken0(sqrtPriceX96, dec0, dec1);
  return {
    pool: poolAddress,
    token0: token0[0] as string,
    token1: token1[0] as string,
    fee: Number(fee[0]),
    tickSpacing: Number(tickSpacing[0]),
    sqrtPriceX96,
    tick: Number(slot0[1]),
    liquidity: liquidity[0] as bigint,
    priceToken1PerToken0,
    priceToken0PerToken1: priceToken1PerToken0 > 0 ? 1 / priceToken1PerToken0 : 0,
  };
}

/**
 * Pool address + state for a base/quote pair, or null when the pool
 * does not exist yet.
 */
export async function getPoolForPair(
  provider: CallProvider,
  base: PoolToken,
  quote: PoolToken,
  fee: number = POOL_FEE_TIER,
): Promise<{ pool: string; state: PoolState } | null> {
  const pool = await getPoolAddress(provider, base.address, quote.address, fee);
  if (!pool) return null;
  return { pool, state: await getPoolState(provider, pool, [base, quote]) };
}

/**
 * Market price of `base` in `quote` units (e.g. USDC per STX), read
 * straight from the pool — or null when the pool does not exist yet.
 * This is the price source the token detail screen falls back to
 * when DexScreener / GeckoTerminal have no pair: a pool price is
 * real, a missing pool is honestly "no market price", never a
 * guessed number.
 */
export async function getPoolPrice(
  provider: CallProvider,
  base: PoolToken,
  quote: PoolToken,
  fee: number = POOL_FEE_TIER,
): Promise<number | null> {
  const found = await getPoolForPair(provider, base, quote, fee);
  if (!found) return null;
  return poolStateToBasePrice(found.state, base, quote);
}

/** Arc Mainnet provider for pool reads (same RPC failover as balances). */
export function getPoolProvider(): ethers.AbstractProvider {
  return getProvider(getChain(POOL_CHAIN_ID));
}

// ---------------------------------------------------------------------------
// Fee recipient — defensive read of the sync payload.
// ---------------------------------------------------------------------------

/**
 * Read a `fees.feeRecipient` address from an admin fee config payload
 * when one is present, else null. The published fee config has no
 * feeRecipient today, so this returns null and current behaviour
 * applies. Note: even when a recipient exists, it does NOT apply to
 * a Uniswap V3 mint — V3 trading fees accrue to the LP position
 * (NFT) holder by protocol design, and the mint takes no fee
 * parameter. This reader exists so a future fee flow can use it.
 */
export function resolveFeeRecipient(fees: unknown): string | null {
  if (typeof fees !== 'object' || fees === null) return null;
  const v = (fees as Record<string, unknown>).feeRecipient;
  return isAddress(v) ? (v as string) : null;
}

// ---------------------------------------------------------------------------
// Allowances + balances.
// ---------------------------------------------------------------------------

export async function getAllowance(
  provider: CallProvider,
  tokenAddress: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  const res = await readCall(provider, tokenAddress, ERC20_IFACE, 'allowance', [owner, spender]);
  return res[0] as bigint;
}

export async function getTokenBalance(
  provider: CallProvider,
  tokenAddress: string,
  owner: string,
): Promise<bigint> {
  const res = await readCall(provider, tokenAddress, ERC20_IFACE, 'balanceOf', [owner]);
  return res[0] as bigint;
}

/**
 * Approve `spender` for `amountRaw` when the current allowance is
 * short. Returns the approve tx hash, or null when no approve was
 * needed. The approve is broadcast + recorded before waiting, like
 * vault.ts — a broadcast approve is never silently lost.
 */
export async function ensureTokenAllowance(
  signer: ethers.Signer,
  tokenAddress: string,
  tokenSymbol: string,
  spender: string,
  amountRaw: bigint,
): Promise<string | null> {
  const fromAddress = await signer.getAddress();
  const provider = signer.provider;
  if (!provider) throw new Error('Signer has no provider.');
  const current = await getAllowance(provider, tokenAddress, fromAddress, spender);
  if (current >= amountRaw) return null;
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const tx = await token.approve(spender, amountRaw);
  await recordBroadcastTx({
    hash: tx.hash,
    chain: POOL_CHAIN_ID,
    wallet: fromAddress,
    type: 'approve',
    tokenSymbol,
    tokenAddress,
    amount: '',
    amountRaw: amountRaw.toString(),
    from: fromAddress,
    to: spender,
    timestamp: Date.now(),
  });
  await tx.wait();
  return tx.hash;
}

// ---------------------------------------------------------------------------
// Mint.
// ---------------------------------------------------------------------------

export interface MintParamsInput {
  tokenA: string;
  tokenB: string;
  decimalsA: number;
  decimalsB: number;
  /** Display symbols, for the history record (optional). */
  symbolA?: string;
  symbolB?: string;
  fee?: number;
  tickLower: number;
  tickUpper: number;
  /** Human amounts, as entered (decimal strings). */
  amountADesired: string;
  amountBDesired: string;
  /** Slippage guard on min amounts, in bps (default 50 = 0.5%). */
  slippageBps?: number;
  recipient: string;
  /** Deadline as epoch seconds. */
  deadline: number;
  /** Current pool sqrt price (pool exists) or the implied starting
   *  price (no pool yet — the ratio of the two amounts sets it). */
  sqrtPriceX96: bigint;
}

export interface BuiltMintParams {
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  recipient: string;
  deadline: number;
  sqrtPriceX96: bigint;
}

/**
 * Build NonfungiblePositionManager.mint params. Tokens are ordered
 * (lower address = token0), amounts follow their token, and min
 * amounts apply the slippage guard. Throws on a bad range, bad
 * amounts, misaligned ticks, or a non-positive starting price.
 * Pure — unit-tested with no provider.
 */
export function buildMintParams(input: MintParamsInput): BuiltMintParams {
  const fee = input.fee ?? POOL_FEE_TIER;
  const spacing = tickSpacingForFee(fee);
  if (spacing === null) throw new Error(`Unsupported fee tier: ${fee}.`);
  if (input.tickLower >= input.tickUpper) {
    throw new Error('Price range is invalid: the lower bound must be below the upper bound.');
  }
  if (input.tickLower % spacing !== 0 || input.tickUpper % spacing !== 0) {
    throw new Error(`Ticks must be multiples of the tick spacing (${spacing}).`);
  }
  if (input.tickLower < MIN_TICK || input.tickUpper > MAX_TICK) {
    throw new Error('Price range is outside the Uniswap V3 tick bounds.');
  }
  if (input.sqrtPriceX96 <= 0n) throw new Error('Starting price must be positive.');
  if (!isAddress(input.recipient)) throw new Error('Invalid recipient address.');
  const slippageBps = input.slippageBps ?? DEFAULT_MINT_SLIPPAGE_BPS;
  if (slippageBps < 0 || slippageBps > 10000) throw new Error('Slippage must be 0–10000 bps.');
  const aIsToken0 = input.tokenA.toLowerCase() < input.tokenB.toLowerCase();
  const token0 = aIsToken0 ? input.tokenA : input.tokenB;
  const token1 = aIsToken0 ? input.tokenB : input.tokenA;
  const amount0Desired = parseTokenAmount(aIsToken0 ? input.amountADesired : input.amountBDesired, aIsToken0 ? input.decimalsA : input.decimalsB);
  const amount1Desired = parseTokenAmount(aIsToken0 ? input.amountBDesired : input.amountADesired, aIsToken0 ? input.decimalsB : input.decimalsA);
  if (amount0Desired <= 0n || amount1Desired <= 0n) {
    throw new Error('Both amounts must be above 0.');
  }
  const keep = BigInt(10000 - slippageBps);
  return {
    token0,
    token1,
    fee,
    tickLower: input.tickLower,
    tickUpper: input.tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min: (amount0Desired * keep) / 10000n,
    amount1Min: (amount1Desired * keep) / 10000n,
    recipient: input.recipient,
    deadline: input.deadline,
    sqrtPriceX96: input.sqrtPriceX96,
  };
}

export interface MintPositionResult {
  txHash: string;
  /** Position NFT id, or null when the receipt could not be parsed
   *  (the tx hash still identifies the position). */
  tokenId: number | null;
  liquidity: bigint | null;
  amount0: bigint | null;
  amount1: bigint | null;
}

/**
 * Send the mint: approve both tokens (only when short), then
 * NonfungiblePositionManager.mint. When the pool does not exist yet,
 * mint creates it at the given sqrtPriceX96 — so the ratio of the
 * two amounts IS the starting price. The position NFT goes to the
 * recipient (the user's wallet). Returns the tx hash + token id.
 */
export async function mintPosition(
  signer: ethers.Signer,
  input: MintParamsInput,
): Promise<MintPositionResult> {
  const built = buildMintParams(input);
  const fromAddress = await signer.getAddress();
  const symbolFor = (addr: string): string =>
    addr.toLowerCase() === input.tokenA.toLowerCase()
      ? (input.symbolA ?? '')
      : (input.symbolB ?? '');
  await ensureTokenAllowance(signer, built.token0, symbolFor(built.token0), UNISWAP_V3_POSITION_MANAGER, built.amount0Desired);
  await ensureTokenAllowance(signer, built.token1, symbolFor(built.token1), UNISWAP_V3_POSITION_MANAGER, built.amount1Desired);
  const npm = new ethers.Contract(UNISWAP_V3_POSITION_MANAGER, POSITION_MANAGER_ABI, signer);
  const tx = await npm.mint({
    token0: built.token0,
    token1: built.token1,
    fee: built.fee,
    tickLower: built.tickLower,
    tickUpper: built.tickUpper,
    amount0Desired: built.amount0Desired,
    amount1Desired: built.amount1Desired,
    amount0Min: built.amount0Min,
    amount1Min: built.amount1Min,
    recipient: built.recipient,
    deadline: built.deadline,
  });
  await recordBroadcastTx({
    hash: tx.hash as string,
    chain: POOL_CHAIN_ID,
    wallet: fromAddress,
    type: 'other',
    tokenSymbol: input.symbolA ?? '',
    tokenAddress: input.tokenA,
    amount: input.amountADesired,
    amountRaw: built.amount1Desired.toString(),
    from: fromAddress,
    to: UNISWAP_V3_POSITION_MANAGER,
    timestamp: Date.now(),
  });
  const receipt = await tx.wait();
  let tokenId: number | null = null;
  let liquidity: bigint | null = null;
  let amount0: bigint | null = null;
  let amount1: bigint | null = null;
  try {
    // mint emits IncreaseLiquidity(tokenId, liquidity, amount0, amount1).
    for (const log of receipt?.logs ?? []) {
      try {
        const parsed = NPM_IFACE.parseLog(log as { topics: string[]; data: string });
        if (parsed?.name === 'IncreaseLiquidity') {
          tokenId = Number(parsed.args.tokenId);
          liquidity = parsed.args.liquidity as bigint;
          amount0 = parsed.args.amount0 as bigint;
          amount1 = parsed.args.amount1 as bigint;
        }
      } catch {
        // Not our event — ignore.
      }
    }
  } catch {
    // token id unknown from receipt; the tx hash still identifies it
  }
  return { txHash: tx.hash as string, tokenId, liquidity, amount0, amount1 };
}

/**
 * One call for the screen: approve + mint for a pool-token/quote
 * position. The pool may not exist yet — then the ratio of the two
 * amounts sets the starting price. `tickLower` / `tickUpper` come
 * from the user's range (default full range). The caller passes the
 * registry-resolved pool token, so a new token address flows through
 * with no code change.
 */
export async function addLiquidity(
  signer: ethers.Signer,
  args: {
    poolToken: PoolToken;
    quoteToken: PoolToken;
    /** Human amount of the pool token (e.g. STX), as entered. */
    baseAmount: string;
    /** Human amount of the quote token (e.g. USDC), as entered. */
    quoteAmount: string;
    tickLower: number;
    tickUpper: number;
    sqrtPriceX96: bigint;
    slippageBps?: number;
    deadlineSeconds?: number;
  },
): Promise<MintPositionResult> {
  const recipient = await signer.getAddress();
  return mintPosition(signer, {
    tokenA: args.poolToken.address,
    tokenB: args.quoteToken.address,
    decimalsA: args.poolToken.decimals,
    decimalsB: args.quoteToken.decimals,
    symbolA: args.poolToken.symbol,
    symbolB: args.quoteToken.symbol,
    fee: POOL_FEE_TIER,
    tickLower: args.tickLower,
    tickUpper: args.tickUpper,
    amountADesired: args.baseAmount,
    amountBDesired: args.quoteAmount,
    slippageBps: args.slippageBps ?? DEFAULT_MINT_SLIPPAGE_BPS,
    recipient,
    deadline: Math.floor(Date.now() / 1000) + (args.deadlineSeconds ?? MINT_DEADLINE_SECONDS),
    sqrtPriceX96: args.sqrtPriceX96,
  });
}

export interface LpPosition {
  tokenId: number;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
  /** Human bounds of the range, in quote per base (USDC per STX).
   *  Null when the position is not this pair. */
  minPriceQuotePerBase: number | null;
  maxPriceQuotePerBase: number | null;
}

/** Read a minted position back from the position manager, for the
 *  "your position" view after minting. */
export async function getPosition(
  provider: CallProvider,
  tokenId: number,
  base: PoolToken,
  quote: PoolToken,
): Promise<LpPosition> {
  const res = await readCall(provider, UNISWAP_V3_POSITION_MANAGER, NPM_IFACE, 'positions', [tokenId]);
  const token0 = (res[2] as string).toLowerCase();
  const token1 = (res[3] as string).toLowerCase();
  const tickLower = Number(res[5]);
  const tickUpper = Number(res[6]);
  const isPair =
    (token0 === base.address.toLowerCase() && token1 === quote.address.toLowerCase()) ||
    (token0 === quote.address.toLowerCase() && token1 === base.address.toLowerCase());
  // Range bounds are prices of token1 in token0; convert to quote
  // per base, inverting when the base token is token0.
  const { dec0, dec1 } = pairDecimals(base, quote);
  const minRaw = tickToPriceToken1PerToken0(tickLower, dec0, dec1);
  const maxRaw = tickToPriceToken1PerToken0(tickUpper, dec0, dec1);
  const baseIsToken1 = token1 === base.address.toLowerCase();
  return {
    tokenId,
    token0: res[2] as string,
    token1: res[3] as string,
    fee: Number(res[4]),
    tickLower,
    tickUpper,
    liquidity: res[7] as bigint,
    tokensOwed0: res[10] as bigint,
    tokensOwed1: res[11] as bigint,
    minPriceQuotePerBase: !isPair ? null : baseIsToken1 ? minRaw : 1 / maxRaw,
    maxPriceQuotePerBase: !isPair ? null : baseIsToken1 ? maxRaw : 1 / minRaw,
  };
}
