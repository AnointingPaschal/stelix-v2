// Stelix Admin — Uniswap V3 pool reads (STX/USDC on Arc Mainnet).
// Shared by the Worker (server-side RPC reads for the Stelix Pool
// page) and unit tests, so the calldata encoding and price maths
// cannot drift. All maths here is BigInt — no floats — because a V3
// sqrt price is a 160-bit fixed-point number.
//
// Selectors (Uniswap V3 core, canonical):
//   Factory.getPool(address,address,uint24) 0x1698ee82
//   IUniswapV3Pool.slot0() 0x3850c7bd, liquidity() 0x1a686502,
//   token0() 0x0dfe1681, token1() 0xd21220a7.
// The factory address below is the verified Arc Mainnet factory
// (migration 0006); the Worker still verifies it holds code with
// eth_getCode before trusting any read from it.
export const UNISWAP_V3_FACTORY_ARC_MAINNET = '0xf0db7b58379503491d857dB50AC9ece64c653918'
export const STX_USDC_FEE_TIER = 3000

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const padAddress = (a: string): string => '0'.repeat(24) + a.slice(2).toLowerCase()

/** Calldata for Factory.getPool(tokenA, tokenB, fee). The factory
 *  sorts the tokens itself, so either order works. */
export function getPoolCalldata(tokenA: string, tokenB: string, fee: number): string {
  return '0x1698ee82' + padAddress(tokenA) + padAddress(tokenB) + fee.toString(16).padStart(64, '0')
}

/** Decode the address getPool returns (a 32-byte word, address in the
 *  low 20 bytes). Short / empty data decodes as the zero address. */
export function decodePoolAddress(hex: string): string {
  if (!hex || hex.length < 66) return ZERO_ADDRESS
  return '0x' + hex.slice(-40)
}

/** Decode slot0(): word 0 is sqrtPriceX96 (uint160), word 1 is the
 *  tick (int24, two's complement). */
export function decodeSlot0(hex: string): { sqrtPriceX96: bigint; tick: number } | null {
  if (!hex || hex.length < 2 + 128) return null
  const sqrtPriceX96 = BigInt('0x' + hex.slice(2, 66))
  const tickRaw = BigInt('0x' + hex.slice(66, 130))
  const tick = tickRaw >= 2n ** 23n ? Number(tickRaw - 2n ** 24n) : Number(tickRaw)
  return { sqrtPriceX96, tick }
}

/** Decode a single uint128 return (liquidity()). */
export function decodeUint128(hex: string): bigint | null {
  if (!hex || hex.length < 66) return null
  return BigInt('0x' + hex.slice(2, 66))
}

/** Exact rational token1-per-token0 from a V3 sqrt price:
 *  (sqrtPriceX96 / 2^96)^2 * 10^(dec0 - dec1). Returned unreduced —
 *  formatRatio divides it. */
export function sqrtPriceRatio(
  sqrtPriceX96: bigint,
  dec0: number,
  dec1: number,
): { num: bigint; den: bigint } {
  return {
    num: sqrtPriceX96 * sqrtPriceX96 * 10n ** BigInt(dec0),
    den: 2n ** 192n * 10n ** BigInt(dec1),
  }
}

/** Format a non-negative rational as a decimal string with up to
 *  `precision` fractional digits (trailing zeros trimmed). Values
 *  smaller than the precision round down to "0" — pass a larger
 *  precision for tiny prices. */
export function formatRatio(num: bigint, den: bigint, precision = 8): string {
  if (den === 0n || num === 0n) return '0'
  const scale = 10n ** BigInt(precision)
  const scaled = (num * scale) / den
  const int = scaled / scale
  const frac = scaled % scale
  if (frac === 0n) return int.toString()
  return `${int}.${frac.toString().padStart(precision, '0').replace(/0+$/, '')}`
}

/** Both directions of the STX/USDC price from one slot0 read.
 *  `token0IsUsdc` says which side of the pair token0 is (on Arc
 *  Mainnet USDC 0x3600… sorts below STX 0xC4d7…, so token0 is USDC). */
export function poolPrices(
  sqrtPriceX96: bigint,
  dec0: number,
  dec1: number,
  token0IsUsdc: boolean,
): { priceUsdcPerStx: string; priceStxPerUsdc: string } {
  const { num, den } = sqrtPriceRatio(sqrtPriceX96, dec0, dec1)
  // num/den is token1 per token0.
  const token1PerToken0 = formatRatio(num, den)
  const token0PerToken1 = formatRatio(den, num)
  return token0IsUsdc
    ? { priceUsdcPerStx: token0PerToken1, priceStxPerUsdc: token1PerToken0 }
    : { priceUsdcPerStx: token1PerToken0, priceStxPerUsdc: token0PerToken1 }
}
