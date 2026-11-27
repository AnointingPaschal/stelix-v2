/**
 * LIVE send — real signed transfers, native + ERC-20, with gas estimation.
 *
 * - Validates the recipient (EVM address, not the zero address, and not
 *   the sender's own address unless the caller explicitly allows it).
 * - Native: a plain value transfer. ERC-20: transfer() on the token
 *   contract. Amounts are parsed with the token's real decimals — the
 *   native asset's RPC unit is always wei (18 decimals, see
 *   EVM_NATIVE_RPC_DECIMALS in lib/chains.ts), even on Arc, where the
 *   USDC *token* has 6 decimals. A native amount parsed with 6 would
 *   send 10^12 times too little.
 * - Gas is estimated from the live RPC before sending; the caller shows
 *   the estimate and the user signs once. Nothing is recorded in History
 *   until the transaction is mined — the returned receipt hash is the
 *   only proof a send happened.
 * - Testnet only for live testing. Never send mainnet funds from a test
 *   build; the UI labels the chain (testnet) at review time.
 */
import { ethers } from 'ethers';
import { EVM_NATIVE_RPC_DECIMALS, getChain } from './chains';
import { getProvider, ERC20_MIN_ABI } from './balances';
import { isValidEvmAddress } from './wallet';

export interface SendRequest {
  chainId: string;
  /** '' = the chain's native asset, otherwise the ERC-20 contract address. */
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  to: string;
  /** Amount in token units (human-readable, e.g. 0.5). */
  amount: number;
}

export interface SendEstimate {
  /** Estimated gas limit (live RPC estimate). */
  gasLimit: bigint;
  /** Fee in native units, formatted. */
  feeNative: string;
  /** Fee in native units, raw wei (always 18 decimals, even on Arc). */
  feeRaw: bigint;
  /** Fee in USD when a price is supplied, else null. */
  feeUsd: number | null;
}

export interface SendResult {
  hash: string;
  blockNumber: number | null;
  from: string;
  to: string;
  amountRaw: string;
}

export class SendValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SendValidationError';
  }
}

const ERC20_TRANSFER_ABI = [
  ...ERC20_MIN_ABI,
  'function transfer(address to, uint256 amount) returns (bool)',
] as const;

function validateSend(req: SendRequest, fromAddress: string): bigint {
  if (!isValidEvmAddress(req.to)) {
    throw new SendValidationError('Recipient address is not a valid address on this chain.');
  }
  if (req.to.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
    throw new SendValidationError('Recipient cannot be the zero address.');
  }
  if (req.to.toLowerCase() === fromAddress.toLowerCase()) {
    throw new SendValidationError('Recipient is your own address — sending to yourself is blocked.');
  }
  if (!Number.isFinite(req.amount) || req.amount <= 0) {
    throw new SendValidationError('Send amount must be greater than 0.');
  }
  let amountRaw: bigint;
  try {
    amountRaw = ethers.parseUnits(req.amount.toString(), req.tokenDecimals);
  } catch {
    throw new SendValidationError(`Amount has too many decimals for ${req.tokenSymbol} (${req.tokenDecimals} decimals).`);
  }
  if (amountRaw <= 0n) throw new SendValidationError('Send amount must be greater than 0.');
  return amountRaw;
}

function buildTx(
  req: SendRequest,
  amountRaw: bigint,
): { to: string; value: bigint; data: string } {
  if (!req.tokenAddress) {
    return { to: req.to, value: amountRaw, data: '0x' };
  }
  const iface = new ethers.Interface(ERC20_TRANSFER_ABI);
  return { to: req.tokenAddress, value: 0n, data: iface.encodeFunctionData('transfer', [req.to, amountRaw]) };
}

/** Live gas estimate for a send. Throws SendValidationError on bad input,
 *  otherwise the provider's own estimate error (e.g. insufficient funds
 *  for gas) is surfaced as-is. */
export async function estimateSendFee(
  req: SendRequest,
  fromAddress: string,
  nativePriceUsd: number | null = null,
  providerOverride?: ethers.AbstractProvider,
): Promise<SendEstimate> {
  const amountRaw = validateSend(req, fromAddress);
  const chain = getChain(req.chainId);
  const provider = providerOverride ?? getProvider(chain);
  const tx = buildTx(req, amountRaw);
  const [gasLimit, feeData] = await Promise.all([
    provider.estimateGas({ ...tx, from: fromAddress }),
    provider.getFeeData(),
  ]);
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
  const feeRaw = gasLimit * gasPrice;
  // Gas is priced in wei, always 18 decimals — never nativeDecimals
  // (6 on Arc would inflate the displayed fee by 10^12).
  const feeNative = ethers.formatUnits(feeRaw, EVM_NATIVE_RPC_DECIMALS);
  const feeUsd =
    nativePriceUsd !== null ? Number(feeNative) * nativePriceUsd : null;
  return { gasLimit, feeNative, feeRaw, feeUsd };
}

/** Send a real signed transfer and wait for it to be mined.
 *  Returns the mined receipt hash. The caller records it in History. */
export async function sendToken(
  signer: ethers.Signer,
  req: SendRequest,
): Promise<SendResult> {
  const fromAddress = await signer.getAddress();
  const amountRaw = validateSend(req, fromAddress);
  const tx = buildTx(req, amountRaw);
  // Balance guard before signing: native sends need amount + gas, token
  // sends need the token balance (checked by the caller against the
  // store) plus a native balance for gas.
  const provider = signer.provider;
  if (!provider) throw new SendValidationError('Signer has no provider — cannot send.');
  if (!req.tokenAddress) {
    const balance = await provider.getBalance(fromAddress);
    const gasLimit = await provider.estimateGas({ ...tx, from: fromAddress });
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? 0n;
    if (balance < amountRaw + gasLimit * gasPrice) {
      throw new SendValidationError('Insufficient balance for the amount plus the network fee.');
    }
  } else {
    const token = new ethers.Contract(req.tokenAddress, ERC20_MIN_ABI, provider);
    const tokenBalance = (await token.balanceOf(fromAddress)) as bigint;
    if (tokenBalance < amountRaw) {
      throw new SendValidationError(`Insufficient ${req.tokenSymbol} balance.`);
    }
    const nativeBalance = await provider.getBalance(fromAddress);
    if (nativeBalance <= 0n) {
      throw new SendValidationError('No native balance to pay the network fee.');
    }
  }
  const sent = await signer.sendTransaction(tx);
  const receipt = await sent.wait();
  return {
    hash: receipt?.hash ?? sent.hash,
    blockNumber: receipt?.blockNumber ?? null,
    from: fromAddress,
    to: req.to,
    amountRaw: amountRaw.toString(),
  };
}
