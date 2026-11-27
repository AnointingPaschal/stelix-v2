/**
 * LIVE swap quotes + LIVE swap execution — no fake swaps, no fake success.
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
 * Execution (executeSwap, signed by the user's wallet):
 *   - BNB: PancakeSwap V2 router directly — approve (only when the
 *     allowance is short) + swapExactETHForTokens / swapExactTokensForETH
 *     / swapExactTokensForTokens, with the quoted min-receive as
 *     amountOutMin and a 20-minute deadline. Native BNB routes via WBNB.
 *   - Other EVM chains: 1inch Swap API v6 /swap when the API key is set
 *     (the API returns the unsigned tx; the user signs it).
 *   - Arc: NO router is registered. Uniswap V2/V3 router addresses are
 *     published for Arc MAINNET (5042) only; they were NOT verified on
 *     Arc testnet (5042002; the old testnet.arcscan.app explorer host
 *     returned rate-limited on 2026-11-26 — explorer is now
 *     explorer.testnet.arc.io) and mainnet addresses must never be used on testnet.
 *     Arc swaps therefore refuse with an honest "router not confirmed
 *     yet" error — never a fake swap — until a testnet router is
 *     verified and registered in ROUTER_ADDRESSES below.
 */
import { ethers } from 'ethers';
import { EVM_NATIVE_RPC_DECIMALS, getChain, VAULT_DEFAULTS } from './chains';
import { getProvider } from './balances';

export const PANCAKESWAP_V2_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
/** WBNB — the wrapped-native hop for PancakeSwap V2 paths on BNB. */
export const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
/** 1inch native-asset sentinel (also accepted as '' from callers). */
export const NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

/** DEX router per chain — ONLY addresses verified on that chain.
 *  null = no router confirmed for this chain; swaps refuse honestly. */
export const ROUTER_ADDRESSES: Record<string, string | null> = {
  bnb: PANCAKESWAP_V2_ROUTER,
  arc: null, // Arc testnet router NOT confirmed yet — see header comment
  base: null,
  ethereum: null,
  polygon: null,
};

const ROUTER_SWAP_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
  'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
] as const;

const ERC20_ALLOWANCE_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
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

export class SwapExecutionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SwapExecutionUnavailableError';
  }
}

/** Backwards-compatible alias (old name). */
export { SwapExecutionUnavailableError as SwapExecutionNotWiredError };

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
  const src = req.fromTokenAddress || NATIVE_SENTINEL;
  const dst = req.toTokenAddress || NATIVE_SENTINEL;
  const url =
    `https://api.1inch.dev/swap/v6.0/${chain.chainId}/quote` +
    `?src=${encodeURIComponent(src)}&dst=${encodeURIComponent(dst)}&amount=${amountRaw}`;
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

/** PancakeSwap path for a quote: native ('', or the 1inch sentinel) routes
 *  via WBNB; token-to-token routes via WBNB too. */
export function pancakeSwapPath(fromTokenAddress: string, toTokenAddress: string): string[] {
  const from = !fromTokenAddress || fromTokenAddress.toLowerCase() === NATIVE_SENTINEL.toLowerCase() ? WBNB_ADDRESS : fromTokenAddress;
  const to = !toTokenAddress || toTokenAddress.toLowerCase() === NATIVE_SENTINEL.toLowerCase() ? WBNB_ADDRESS : toTokenAddress;
  if (from.toLowerCase() === to.toLowerCase()) throw new SwapQuoteUnavailableError('Swap source and destination are the same token.');
  if (from.toLowerCase() === WBNB_ADDRESS.toLowerCase() || to.toLowerCase() === WBNB_ADDRESS.toLowerCase()) {
    return [from, to];
  }
  return [from, WBNB_ADDRESS, to];
}

async function quotePancakeSwap(req: SwapQuoteRequest, slippageBps: number): Promise<SwapQuote | null> {
  const chain = getChain(req.chainId);
  if (chain.id !== 'bnb' || chain.chainId === null) return null;
  try {
    const provider = getProvider(chain);
    const router = new ethers.Contract(PANCAKESWAP_V2_ROUTER, ROUTER_SWAP_ABI, provider);
    const amountRaw = ethers.parseUnits(req.amountIn.toString(), req.fromDecimals);
    const path = pancakeSwapPath(req.fromTokenAddress, req.toTokenAddress);
    const amounts = (await router.getAmountsOut.staticCall(amountRaw, path)) as bigint[];
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

export interface SwapExecutionResult {
  hash: string;
  blockNumber: number | null;
  /** Hash of the ERC-20 approve tx when one was needed, else null. */
  approveHash: string | null;
}

/**
 * Execute a REAL swap from a live quote, signed by the user's wallet.
 *
 * BNB: PancakeSwap V2 (approve only when the allowance is short, then
 * the router swap with the quote's min-receive and a 20-minute
 * deadline). Other EVM chains: 1inch Swap API v6 /swap when the API key
 * is set. Arc (and any chain with no confirmed router and no 1inch
 * key): throws SwapExecutionUnavailableError — never a fake swap.
 *
 * The quote must be fresh: execution re-checks the quote is younger
 * than 5 minutes, so a stale min-receive cannot be signed.
 */
export async function executeSwap(
  signer: ethers.Signer,
  quote: SwapQuote,
): Promise<SwapExecutionResult> {
  const chain = getChain(quote.chainId);
  if (chain.kind !== 'evm' || chain.chainId === null) {
    throw new SwapExecutionUnavailableError(
      `${chain.name} swaps are not wired — this chain has no EVM DEX execution path. No swap was executed.`,
    );
  }
  if (Date.now() - quote.quotedAt > 5 * 60_000) {
    throw new SwapExecutionUnavailableError(
      'This quote is stale (older than 5 minutes). Get a fresh quote before swapping — no swap was executed.',
    );
  }
  // Router availability is checked BEFORE the signer is touched, so a
  // refused swap never asks for (or needs) a signature.
  if (chain.id === 'arc') {
    throw new SwapExecutionUnavailableError(
      'Arc swap execution is unavailable — no DEX router address has been verified on Arc testnet yet ' +
        '(explorer.testnet.arc.io). Uniswap router addresses published for Arc mainnet (5042) must not be used on testnet (5042002). ' +
        'No swap was executed. BNB swaps are live via PancakeSwap.',
    );
  }
  if (chain.id !== 'bnb' && !getOneInchApiKey()) {
    throw new SwapExecutionUnavailableError(
      `No DEX router is confirmed for ${chain.name} and no 1inch API key is set ` +
        '(EXPO_PUBLIC_ONEINCH_API_KEY). Swap execution is unavailable on this chain. No swap was executed.',
    );
  }
  const fromAddress = await signer.getAddress();
  const amountIn = BigInt(quote.amountIn);
  const amountOutMin = BigInt(quote.minReceive);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const fromNative = !quote.fromTokenAddress || quote.fromTokenAddress.toLowerCase() === NATIVE_SENTINEL.toLowerCase();
  const toNative = !quote.toTokenAddress || quote.toTokenAddress.toLowerCase() === NATIVE_SENTINEL.toLowerCase();

  if (chain.id === 'bnb') {
    return executePancakeSwap(signer, fromAddress, quote, amountIn, amountOutMin, deadline, fromNative, toNative);
  }
  return executeOneInchSwap(signer, fromAddress, quote, amountIn, chain.chainId);
}

export interface SwapFeeEstimate {
  feeNative: string;
  feeUsd: number | null;
  gasLimit: bigint;
}

/** Live gas estimate for a PancakeSwap (BNB) swap from a fresh quote.
 *  Returns null when no estimate is possible — non-BNB chains (1inch
 *  builds the tx at execution time), Arc (no router), or an RPC failure
 *  (e.g. a token→token estimate reverts before the router allowance is
 *  set). The caller shows "estimated at signing" instead of inventing
 *  a fee. Never throws. */
export async function estimateSwapFee(
  quote: SwapQuote,
  fromAddress: string,
  nativePriceUsd: number | null,
): Promise<SwapFeeEstimate | null> {
  if (quote.chainId !== 'bnb') return null;
  try {
    const chain = getChain(quote.chainId);
    const provider = getProvider(chain);
    const router = new ethers.Contract(PANCAKESWAP_V2_ROUTER, ROUTER_SWAP_ABI, provider);
    const path = pancakeSwapPath(quote.fromTokenAddress, quote.toTokenAddress);
    const amountIn = BigInt(quote.amountIn);
    const amountOutMin = BigInt(quote.minReceive);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
    const fromNative =
      !quote.fromTokenAddress || quote.fromTokenAddress.toLowerCase() === NATIVE_SENTINEL.toLowerCase();
    const toNative =
      !quote.toTokenAddress || quote.toTokenAddress.toLowerCase() === NATIVE_SENTINEL.toLowerCase();
    let populated: ethers.TransactionRequest;
    if (fromNative) {
      populated = await router.swapExactETHForTokens.populateTransaction(amountOutMin, path, fromAddress, deadline, {
        value: amountIn,
      });
    } else if (toNative) {
      populated = await router.swapExactTokensForETH.populateTransaction(
        amountIn,
        amountOutMin,
        path,
        fromAddress,
        deadline,
      );
    } else {
      populated = await router.swapExactTokensForTokens.populateTransaction(
        amountIn,
        amountOutMin,
        path,
        fromAddress,
        deadline,
      );
    }
    const [gasLimit, feeData] = await Promise.all([
      provider.estimateGas({ ...populated, from: fromAddress }),
      provider.getFeeData(),
    ]);
    const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
    const feeRaw = gasLimit * gasPrice;
    // Gas is priced in wei, always 18 decimals — never nativeDecimals.
    const feeNative = ethers.formatUnits(feeRaw, EVM_NATIVE_RPC_DECIMALS);
    return {
      feeNative,
      feeUsd: nativePriceUsd !== null ? Number(feeNative) * nativePriceUsd : null,
      gasLimit,
    };
  } catch {
    return null;
  }
}

async function executePancakeSwap(
  signer: ethers.Signer,
  fromAddress: string,
  quote: SwapQuote,
  amountIn: bigint,
  amountOutMin: bigint,
  deadline: bigint,
  fromNative: boolean,
  toNative: boolean,
): Promise<SwapExecutionResult> {
  const router = new ethers.Contract(PANCAKESWAP_V2_ROUTER, ROUTER_SWAP_ABI, signer);
  const path = pancakeSwapPath(quote.fromTokenAddress, quote.toTokenAddress);
  let approveHash: string | null = null;
  let tx: ethers.TransactionResponse;
  if (fromNative) {
    // BNB -> token: value is the amount, no approval needed.
    tx = (await router.swapExactETHForTokens(amountOutMin, path, fromAddress, deadline, {
      value: amountIn,
    })) as ethers.TransactionResponse;
  } else {
    // Token -> ... : approve the router first, only when short.
    const token = new ethers.Contract(quote.fromTokenAddress, ERC20_ALLOWANCE_ABI, signer);
    const allowance = (await token.allowance(fromAddress, PANCAKESWAP_V2_ROUTER)) as bigint;
    if (allowance < amountIn) {
      const approveTx = (await token.approve(PANCAKESWAP_V2_ROUTER, amountIn)) as ethers.TransactionResponse;
      const approveReceipt = await approveTx.wait();
      approveHash = approveReceipt?.hash ?? approveTx.hash;
    }
    if (toNative) {
      tx = (await router.swapExactTokensForETH(amountIn, amountOutMin, path, fromAddress, deadline)) as ethers.TransactionResponse;
    } else {
      tx = (await router.swapExactTokensForTokens(amountIn, amountOutMin, path, fromAddress, deadline)) as ethers.TransactionResponse;
    }
  }
  const receipt = await tx.wait();
  return { hash: receipt?.hash ?? tx.hash, blockNumber: receipt?.blockNumber ?? null, approveHash };
}

/** 1inch Swap API v6 /swap: the API builds the unsigned tx; the user signs it. */
async function executeOneInchSwap(
  signer: ethers.Signer,
  fromAddress: string,
  quote: SwapQuote,
  amountIn: bigint,
  chainIdNum: number,
): Promise<SwapExecutionResult> {
  const apiKey = getOneInchApiKey();
  if (!apiKey) {
    throw new SwapExecutionUnavailableError(
      `No DEX router is confirmed for ${getChain(quote.chainId).name} and no 1inch API key is set ` +
        '(EXPO_PUBLIC_ONEINCH_API_KEY). Swap execution is unavailable on this chain. No swap was executed.',
    );
  }
  const url =
    `https://api.1inch.dev/swap/v6.0/${chainIdNum}/swap` +
    `?src=${encodeURIComponent(quote.fromTokenAddress || NATIVE_SENTINEL)}` +
    `&dst=${encodeURIComponent(quote.toTokenAddress || NATIVE_SENTINEL)}` +
    `&amount=${amountIn.toString()}&from=${fromAddress}&slippage=${quote.slippageBps / 100}&receiver=${fromAddress}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      throw new SwapExecutionUnavailableError(`1inch swap failed (HTTP ${res.status}). No swap was executed.`);
    }
    const json = await res.json();
    const txData = json?.tx;
    if (!txData?.to || typeof txData.data !== 'string') {
      throw new SwapExecutionUnavailableError('1inch returned no swap transaction. No swap was executed.');
    }
    const sent = await signer.sendTransaction({
      to: txData.to as string,
      data: txData.data as string,
      value: txData.value ? BigInt(txData.value as string) : 0n,
    });
    const receipt = await sent.wait();
    return { hash: receipt?.hash ?? sent.hash, blockNumber: receipt?.blockNumber ?? null, approveHash: null };
  } finally {
    clearTimeout(t);
  }
}
