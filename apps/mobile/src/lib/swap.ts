/**
 * LIVE swap quotes only — no fake swaps, no fake success.
 *
 * Quote sources (in order):
 *   1. 1inch Swap API v6 — GET https://api.1inch.dev/swap/v6.0/<chain>/quote
 *      Requires EXPO_PUBLIC_ONEINCH_API_KEY (header `Authorization: Bearer <key>`).
 *      Without the key this source is skipped, not faked.
 *   2. PancakeSwap router quote on BNB (chain 56) via ethers callStatic
 *      getAmountsOut — no key needed. Router:
 *      0x10ED43C718714eb63d5aA57B78B54704E256024E (PancakeSwap V2, well-known).
 *      Other chains have no on-chain fallback wired yet.
 *
 * Execution: NOT wired. executeSwap() throws a clear "quote only,
 * execution not wired" error. A real execution must be a signed
 * transaction from the user's wallet (approve + router swap with the
 * quoted min-receive) — that wiring is a separate, audited step and must
 * never be simulated with a success toast.
 */
import { ethers } from 'ethers';
import { getChain, VAULT_DEFAULTS } from './chains';
import { getProvider } from './balances';

export const PANCAKESWAP_V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

const ROUTER_MIN_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
] as const;

export interface SwapQuoteRequest {
  chainId: string;
  fromTokenAddress: string; // ERC-20 address, or the chain's native sentinel for 1inch
  toTokenAddress: string;
  /** Amount in, in token units (human-readable, e.g. 0.5). */
  amountIn: number;
  fromDecimals: number;
  toDecimals: number;
  slippageBps?: number; // default 150 = 1.5%
}

export interface SwapQuote {
  chainId: string;
  fromTokenAddress: string;
  toTokenAddress: string;
  amountIn: string; // raw units
  amountOut: string; // raw units, quoted
  amountOutHuman: number;
  minReceive: string; // raw units, after slippage
  minReceiveHuman: number;
  priceImpactBps: number | null; // null when the quote source gives no impact
  slippageBps: number;
  source: '1inch' | 'pancakeswap';
  quotedAt: number;
}

export class SwapQuoteUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SwapQuoteUnavailableError';
  }
}

export class SwapExecutionNotWiredError extends Error {
  constructor() {
    super(
      'Swap execution is not wired — this is a quote only. ' +
        'A real swap must be a signed transaction from your wallet (approve + router swap at the quoted minimum-receive). No swap has been executed.',
    );
    this.name = 'SwapExecutionNotWiredError';
  }
}

function getOneInchApiKey(): string | null {
  const v =
    typeof process !== 'undefined'
      ? (process.env as Record<string, string | undefined>).EXPO_PUBLIC_ONEINCH_API_KEY
      : undefined;
  return v && v.length > 0 ? v : null;
}

function minReceiveRaw(amountOut: bigint, slippageBps: number): bigint {
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

async function quoteOneInch(req: SwapQuoteRequest, slippageBps: number): Promise<SwapQuote | null> {
  const apiKey = getOneInchApiKey();
  if (!apiKey) return null;
  const chain = getChain(req.chainId);
  if (chain.chainId === null) return null;
  const amountRaw = ethers.parseUnits(req.amountIn.toString(), req.fromDecimals).toString();
  const url =
    `https://api.1inch.dev/swap/v6.0/${chain.chainId}/quote` +
    `?src=${encodeURIComponent(req.fromTokenAddress)}&dst=${encodeURIComponent(req.toTokenAddress)}&amount=${amountRaw}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const toAmount = typeof json?.dstAmount === 'string' ? BigInt(json.dstAmount) : null;
    if (toAmount === null) return null;
    const min = minReceiveRaw(toAmount, slippageBps);
    return {
      chainId: req.chainId,
      fromTokenAddress: req.fromTokenAddress,
      toTokenAddress: req.toTokenAddress,
      amountIn: amountRaw,
      amountOut: toAmount.toString(),
      amountOutHuman: Number(ethers.formatUnits(toAmount, req.toDecimals)),
      minReceive: min.toString(),
      minReceiveHuman: Number(ethers.formatUnits(min, req.toDecimals)),
      priceImpactBps: null, // 1inch v6 quote does not return price impact
      slippageBps,
      source: '1inch',
      quotedAt: Date.now(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function quotePancakeSwap(req: SwapQuoteRequest, slippageBps: number): Promise<SwapQuote | null> {
  const chain = getChain(req.chainId);
  if (chain.id !== 'bnb' || chain.chainId === null) return null;
  try {
    const provider = getProvider(chain);
    const router = new ethers.Contract(PANCAKESWAP_V2_ROUTER, ROUTER_MIN_ABI, provider);
    const amountRaw = ethers.parseUnits(req.amountIn.toString(), req.fromDecimals);
    const amounts = (await router.getAmountsOut.staticCall(amountRaw, [
      req.fromTokenAddress,
      req.toTokenAddress,
    ])) as bigint[];
    if (!amounts || amounts.length < 2) return null;
    const toAmount = amounts[amounts.length - 1];
    const min = minReceiveRaw(toAmount, slippageBps);
    return {
      chainId: req.chainId,
      fromTokenAddress: req.fromTokenAddress,
      toTokenAddress: req.toTokenAddress,
      amountIn: amountRaw.toString(),
      amountOut: toAmount.toString(),
      amountOutHuman: Number(ethers.formatUnits(toAmount, req.toDecimals)),
      minReceive: min.toString(),
      minReceiveHuman: Number(ethers.formatUnits(min, req.toDecimals)),
      priceImpactBps: null, // getAmountsOut gives no pool-impact figure; the vault impact guard (vault.ts) applies at execution
      slippageBps,
      source: 'pancakeswap',
      quotedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/** Live quote, or throws SwapQuoteUnavailableError with the exact reason. */
export async function getSwapQuote(req: SwapQuoteRequest): Promise<SwapQuote> {
  const slippageBps = req.slippageBps ?? VAULT_DEFAULTS.slippageBps;
  if (req.amountIn <= 0) throw new SwapQuoteUnavailableError('Swap amount must be greater than 0.');
  const oneInch = await quoteOneInch(req, slippageBps);
  if (oneInch) return oneInch;
  const pcs = await quotePancakeSwap(req, slippageBps);
  if (pcs) return pcs;
  const reasons: string[] = [];
  if (!getOneInchApiKey()) reasons.push('no 1inch API key (EXPO_PUBLIC_ONEINCH_API_KEY not set)');
  else reasons.push('1inch quote failed or returned no amount');
  if (req.chainId !== 'bnb') reasons.push('no on-chain router quote wired for this chain (PancakeSwap fallback is BNB only)');
  else reasons.push('PancakeSwap router quote failed (pair may not exist)');
  throw new SwapQuoteUnavailableError(`No live swap quote available: ${reasons.join('; ')}. No swap was executed.`);
}

/**
 * Swap execution is NOT wired. This always throws — callers must surface
 * the message, never a success state.
 */
export async function executeSwap(_quote: SwapQuote): Promise<never> {
  throw new SwapExecutionNotWiredError();
}
