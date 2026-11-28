/**
 * Circle CCTP V2 bridge — move native USDC between supported chains.
 *
 * Mainnet only: the wallet serves mainnet chains, and this module never
 * builds a burn/mint for any other network. CCTP V1 is phased out
 * (phase-out began 31 Oct 2026) — only V2 calls are built here.
 *
 * How it works (Circle's burn-and-mint flow):
 *   1. Approve USDC to TokenMessengerV2 on the source chain, then call
 *      depositForBurn — the USDC is burned on the source chain.
 *   2. Circle's attestation service (public Iris API, no key) signs the
 *      burn message. Standard transfers are free — Circle charges no
 *      CCTP fee, only source- and destination-chain gas. Fast transfers
 *      carry a small on-chain fee deducted from the minted amount; the
 *      live rate is fetched at runtime, never hardcoded.
 *   3. Call receiveMessage on MessageTransmitterV2 on the destination
 *      chain with the message + attestation — the same USDC is minted
 *      to the user's own address there.
 *
 * Signing: the self-custody mnemonic wallet signs both legs (it holds
 * the keys on every chain). The Circle challenge path is NOT wired here:
 *   CIRCLE_CHALLENGE_AVAILABLE is false because the Circle API key is
 *   still unverified (403 on config/entity as of 2026-11-27) — no
 *   Circle-backed challenge can be created until the key/entitlement
 *   is fixed in Console. The self-custody path below is the working one.
 *
 * USDC ONLY — CCTP moves native USDC and nothing else. BNB is excluded
 * (Circle offers USYC only on BNB, no CCTP USDC), Solana is excluded
 * (its CCTP program is a different, non-ethers flow), and any chain the
 * wallet does not serve is excluded. Supported = (chains the wallet
 * serves) intersect (Circle-verified CCTP chains).
 *
 * Contract addresses: Circle docs, CCTP V2 contract addresses —
 * the same deterministic addresses on every supported EVM mainnet.
 * Domains and USDC addresses: Circle docs, supported chains and
 * domains (Arc 26, Ethereum 0, Base 6, Polygon PoS 7, Plasma 33).
 */
import { ethers } from 'ethers';
import { getChain, isChainUsable, type ChainConfig } from './chains';
import { getProvider } from './balances';

/** Circle challenge signing is gated OFF: the Circle API key is still
 *  unverified (403 on config/entity, 2026-11-27). The self-custody
 *  signer below is the working path. Flip only after the key returns
 *  200 on config/entity. */
export const CIRCLE_CHALLENGE_AVAILABLE = false;

/** USDC has 6 decimals on every chain in this module. */
export const USDC_DECIMALS = 6;

/** Public Iris attestation API — no key, no signup. */
export const CCTP_IRIS_API = 'https://iris-api.circle.com';
/** Live Fast-transfer fee schedule — rates must be fetched, never hardcoded. */
export const CCTP_FAST_FEE_URL = `${CCTP_IRIS_API}/v2/burn/USDC/fees`;

/** CCTP V2 contracts (mainnet, same addresses on every EVM mainnet). */
export const CCTP_V2_ADDRESSES = {
  tokenMessenger: '0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d',
  messageTransmitter: '0x81D40F21F12A8F0E3252Bccb954D722d4c464B64',
  tokenMinter: '0xfd78EE919681417d192449715b2594ab58f5D002',
  tokenMessengerWithFees: '0x71f54F818671cD0D7ea140Da213e5C8b5C92a408',
} as const;

/** minFinalityThreshold: <= 1000 = Fast, >= 2000 = Standard. */
export const CCTP_FINALITY_FAST = 1000;
export const CCTP_FINALITY_STANDARD = 2000;

/** Attestation polling: Iris is rate-limited (35 req/s) — poll no
 *  faster than every 5s. Standard attestation takes ~0.5s from Arc
 *  but ~15–19 min from Ethereum/Base; the default timeout covers it. */
export const CCTP_POLL_INTERVAL_MS = 5000;
export const CCTP_POLL_TIMEOUT_MS = 30 * 60 * 1000;

export interface CctpChain {
  /** Stelix chain id (matches lib/chains.ts). */
  id: string;
  name: string;
  /** EVM chain id. */
  chainId: number;
  /** Circle CCTP domain — NOT the chain id. */
  domain: number;
  /** Native USDC contract on this chain. */
  usdcAddress: string;
  /** Fast Transfer offered as a source on this chain. */
  fastAsSource: boolean;
}

/**
 * Circle-verified CCTP chains the wallet can serve, keyed by Stelix
 * chain id. BNB is deliberately absent (USYC only, no CCTP USDC).
 * Solana is deliberately absent (non-EVM CCTP program, no ethers path).
 */
export const CCTP_CHAINS: Record<string, CctpChain> = {
  'arc-mainnet': {
    id: 'arc-mainnet',
    name: 'Arc Mainnet',
    chainId: 5042,
    domain: 26,
    usdcAddress: '0x3600000000000000000000000000000000000000',
    fastAsSource: false,
  },
  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    chainId: 1,
    domain: 0,
    usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    fastAsSource: true,
  },
  base: {
    id: 'base',
    name: 'Base',
    chainId: 8453,
    domain: 6,
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    fastAsSource: true,
  },
  polygon: {
    id: 'polygon',
    name: 'Polygon',
    chainId: 137,
    domain: 7,
    usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    fastAsSource: false,
  },
  plasma: {
    id: 'plasma',
    name: 'Plasma',
    chainId: 9745,
    domain: 33,
    usdcAddress: '0x2d661c89d812261039af9764eceaaee884f5f67f',
    fastAsSource: false,
  },
};

export function getCctpChain(chainId: string): CctpChain | null {
  return CCTP_CHAINS[chainId] ?? null;
}

export function isCctpSupported(chainId: string): boolean {
  return getCctpChain(chainId) !== null;
}

/**
 * Chains the Bridge screen may offer: usable, EVM, mainnet chains the
 * wallet serves that are also Circle-verified CCTP chains. A chain the
 * wallet does not serve, a coming-soon chain, or BNB (no CCTP USDC)
 * never appears here.
 */
export function supportedBridgeChains(chains: ChainConfig[]): CctpChain[] {
  return chains
    .filter((c) => c.kind === 'evm' && !c.testnet && isChainUsable(c))
    .map((c) => getCctpChain(c.id))
    .filter((c): c is CctpChain => c !== null);
}

export class CctpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CctpError';
  }
}

const TOKEN_MESSENGER_V2_ABI = [
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (uint64 nonce)',
] as const;

const MESSAGE_TRANSMITTER_V2_ABI = [
  'function receiveMessage(bytes message, bytes attestation) returns (bool success)',
] as const;

const ERC20_CCTP_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
] as const;

const messengerInterface = new ethers.Interface(TOKEN_MESSENGER_V2_ABI);
const transmitterInterface = new ethers.Interface(MESSAGE_TRANSMITTER_V2_ABI);

/** An EVM address as a 32-byte mint recipient / destination caller. */
export function addressToBytes32(address: string): string {
  if (!ethers.isAddress(address)) throw new CctpError('Not a valid address.');
  return ethers.zeroPadValue(address.toLowerCase(), 32);
}

export interface DepositForBurnArgs {
  amountRaw: bigint;
  destinationDomain: number;
  /** Recipient of the minted USDC on the destination chain. */
  mintRecipient: string;
  burnToken: string;
  /** Max Fast-transfer fee the user will pay (0 for Standard). */
  maxFee: bigint;
  /** CCTP_FINALITY_FAST or CCTP_FINALITY_STANDARD. */
  minFinalityThreshold: number;
}

/** Calldata for TokenMessengerV2.depositForBurn. destinationCaller is
 *  the zero bytes32: anyone may submit the attestation to mint. */
export function buildDepositForBurnCalldata(args: DepositForBurnArgs): string {
  return messengerInterface.encodeFunctionData('depositForBurn', [
    args.amountRaw,
    args.destinationDomain,
    addressToBytes32(args.mintRecipient),
    args.burnToken,
    ethers.ZeroHash,
    args.maxFee,
    args.minFinalityThreshold,
  ]);
}

/** Calldata for MessageTransmitterV2.receiveMessage. */
export function buildReceiveMessageCalldata(message: string, attestation: string): string {
  return transmitterInterface.encodeFunctionData('receiveMessage', [message, attestation]);
}

function usdcContract(chainId: string, runner: ethers.ContractRunner): ethers.Contract {
  const cctp = getCctpChain(chainId);
  if (!cctp) throw new CctpError(`USDC bridging is not supported on ${getChain(chainId).name}.`);
  return new ethers.Contract(cctp.usdcAddress, ERC20_CCTP_ABI, runner);
}

function messengerContract(signer: ethers.Signer): ethers.Contract {
  return new ethers.Contract(CCTP_V2_ADDRESSES.tokenMessenger, TOKEN_MESSENGER_V2_ABI, signer);
}

/** Native USDC balance of an address on a supported chain (6 decimals). */
export async function getUsdcBalance(chainId: string, owner: string): Promise<bigint> {
  const cctp = getCctpChain(chainId);
  if (!cctp) throw new CctpError(`USDC bridging is not supported on ${getChain(chainId).name}.`);
  if (!ethers.isAddress(owner)) throw new CctpError('Not a valid address.');
  const token = new ethers.Contract(cctp.usdcAddress, ERC20_CCTP_ABI, getProvider(getChain(chainId)));
  return (await token.balanceOf(owner)) as bigint;
}

/**
 * Approve the TokenMessenger to spend USDC when the current allowance
 * is short. Returns the approval tx hash, or null when already allowed.
 */
export async function approveUsdcIfNeeded(
  signer: ethers.Signer,
  chainId: string,
  amountRaw: bigint,
): Promise<string | null> {
  const cctp = getCctpChain(chainId);
  if (!cctp) throw new CctpError(`USDC bridging is not supported on ${getChain(chainId).name}.`);
  const from = await signer.getAddress();
  const token = usdcContract(chainId, signer);
  const allowance = (await token.allowance(from, CCTP_V2_ADDRESSES.tokenMessenger)) as bigint;
  if (allowance >= amountRaw) return null;
  const tx = (await token.approve(CCTP_V2_ADDRESSES.tokenMessenger, amountRaw)) as ethers.TransactionResponse;
  await tx.wait();
  return tx.hash;
}

/** Send USDC to an address on the same chain (used for the bridge fee, when one is set). */
export async function transferUsdc(
  signer: ethers.Signer,
  chainId: string,
  to: string,
  amountRaw: bigint,
): Promise<string> {
  if (!ethers.isAddress(to)) throw new CctpError('Not a valid recipient address.');
  if (amountRaw <= 0n) throw new CctpError('Transfer amount must be greater than 0.');
  const token = usdcContract(chainId, signer);
  const tx = (await token.transfer(to, amountRaw)) as ethers.TransactionResponse;
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

export interface BurnResult {
  hash: string;
  blockNumber: number | null;
}

/**
 * Burn USDC on the source chain via depositForBurn. Waits for the tx
 * to mine — Iris only attests mined burns. Returns the burn tx hash,
 * which is what attestation polling keys off.
 */
export async function burnUsdc(
  signer: ethers.Signer,
  sourceChainId: string,
  args: DepositForBurnArgs,
): Promise<BurnResult> {
  const cctp = getCctpChain(sourceChainId);
  if (!cctp) throw new CctpError(`USDC bridging is not supported on ${getChain(sourceChainId).name}.`);
  if (args.amountRaw <= 0n) throw new CctpError('Bridge amount must be greater than 0.');
  if (args.burnToken.toLowerCase() !== cctp.usdcAddress.toLowerCase()) {
    throw new CctpError('Only native USDC can be bridged.');
  }
  const messenger = messengerContract(signer);
  const tx = (await messenger.depositForBurn(
    args.amountRaw,
    args.destinationDomain,
    addressToBytes32(args.mintRecipient),
    args.burnToken,
    ethers.ZeroHash,
    args.maxFee,
    args.minFinalityThreshold,
  )) as ethers.TransactionResponse;
  const receipt = await tx.wait();
  return { hash: receipt?.hash ?? tx.hash, blockNumber: receipt?.blockNumber ?? null };
}

export interface MintResult {
  hash: string;
  blockNumber: number | null;
}

/** Mint the burned USDC on the destination chain via receiveMessage. */
export async function mintUsdc(
  signer: ethers.Signer,
  destinationChainId: string,
  message: string,
  attestation: string,
): Promise<MintResult> {
  if (!getCctpChain(destinationChainId)) {
    throw new CctpError(`USDC bridging is not supported on ${getChain(destinationChainId).name}.`);
  }
  if (!message || !attestation) throw new CctpError('Message and attestation are required to mint.');
  const transmitter = new ethers.Contract(
    CCTP_V2_ADDRESSES.messageTransmitter,
    MESSAGE_TRANSMITTER_V2_ABI,
    signer,
  );
  const tx = (await transmitter.receiveMessage(message, attestation)) as ethers.TransactionResponse;
  const receipt = await tx.wait();
  return { hash: receipt?.hash ?? tx.hash, blockNumber: receipt?.blockNumber ?? null };
}

/** Live gas estimate for the burn leg (best-effort; null when the RPC cannot estimate). */
export async function estimateBurnGas(
  sourceChainId: string,
  fromAddress: string,
  args: DepositForBurnArgs,
): Promise<bigint | null> {
  try {
    const messenger = new ethers.Contract(
      CCTP_V2_ADDRESSES.tokenMessenger,
      TOKEN_MESSENGER_V2_ABI,
      getProvider(getChain(sourceChainId)),
    );
    return (await messenger.depositForBurn.estimateGas(
      args.amountRaw,
      args.destinationDomain,
      addressToBytes32(args.mintRecipient),
      args.burnToken,
      ethers.ZeroHash,
      args.maxFee,
      args.minFinalityThreshold,
      { from: fromAddress },
    )) as bigint;
  } catch {
    return null;
  }
}

/** Live gas estimate for the mint leg (needs the attested message, so only after polling). */
export async function estimateMintGas(
  destinationChainId: string,
  fromAddress: string,
  message: string,
  attestation: string,
): Promise<bigint | null> {
  try {
    const transmitter = new ethers.Contract(
      CCTP_V2_ADDRESSES.messageTransmitter,
      MESSAGE_TRANSMITTER_V2_ABI,
      getProvider(getChain(destinationChainId)),
    );
    return (await transmitter.receiveMessage.estimateGas(message, attestation, {
      from: fromAddress,
    })) as bigint;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Attestation polling (public Iris API, no key)
// ---------------------------------------------------------------------------

export interface Attestation {
  message: string;
  attestation: string;
  status: string;
}

type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

function asHexString(v: unknown): string | null {
  return typeof v === 'string' && v.startsWith('0x') && v.length > 4 ? v : null;
}

function parseAttestation(body: unknown): Attestation | null {
  const root = asRecord(body);
  if (!root) return null;
  const list = Array.isArray(root.messages) ? root.messages : [root];
  for (const item of list) {
    const rec = asRecord(item);
    if (!rec) continue;
    const status = typeof rec.status === 'string' ? rec.status : '';
    if (status !== 'complete') continue;
    const message = asHexString(rec.message);
    const attestation = asHexString(rec.attestation);
    if (message && attestation) return { message, attestation, status };
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll Iris until Circle attests the burn, then return the message +
 * attestation for receiveMessage. A 404 / empty / pending reply is
 * normal while waiting — only a real fetch failure throws. Messages
 * expire after ~24h; a stale burn can be re-attested via Iris
 * POST /v2/reattest (not built here — the burn tx hash stays in
 * History, so the transfer can be collected again later).
 *
 * pollIntervalMs defaults to 5000 — never pass a smaller value in
 * production (Iris rate limit is 35 req/s). Tests may inject a
 * custom fetchFn and a short interval.
 */
export async function pollAttestation(args: {
  sourceDomain: number;
  txHash: string;
  fetchFn?: FetchFn;
  pollIntervalMs?: number;
  timeoutMs?: number;
  irisBaseUrl?: string;
}): Promise<Attestation> {
  const interval = args.pollIntervalMs ?? CCTP_POLL_INTERVAL_MS;
  const timeout = args.timeoutMs ?? CCTP_POLL_TIMEOUT_MS;
  const base = args.irisBaseUrl ?? CCTP_IRIS_API;
  const url = `${base}/v2/messages/${args.sourceDomain}?transactionHash=${args.txHash}`;
  const doFetch: FetchFn =
    args.fetchFn ??
    ((u: string) => fetch(u) as Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>);
  const started = Date.now();
  for (;;) {
    let res: { ok: boolean; status: number; json: () => Promise<unknown> };
    try {
      res = await doFetch(url);
    } catch (e) {
      throw new CctpError(`Attestation check failed: ${e instanceof Error ? e.message : 'network error'}`);
    }
    if (res.ok || res.status === 404) {
      const body = res.ok ? await res.json().catch(() => null) : null;
      const found = body ? parseAttestation(body) : null;
      if (found) return found;
    }
    if (Date.now() - started >= timeout) {
      throw new CctpError(
        'Circle has not attested this burn yet. The USDC is burned on the source chain — keep the burn transaction hash from History and try collecting again later.',
      );
    }
    await sleep(interval);
  }
}

// ---------------------------------------------------------------------------
// Fast-transfer fees (live, never hardcoded)
// ---------------------------------------------------------------------------

export interface FastFeeInfo {
  sourceDomain: number;
  destinationDomain: number;
  /** Smallest fee Circle will accept for this route, in USDC base units (6 decimals). */
  minFee: bigint | null;
  /** Largest fee for this route, in USDC base units. */
  maxFee: bigint | null;
}

function asBigint(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === 'string' && /^\d+$/.test(v)) {
    try {
      return BigInt(v);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Fetch the live Fast-transfer fee schedule and return the entry for
 * this route, or null when Fast is not offered / the schedule cannot
 * be read. Standard transfers are free, so null also means "use
 * Standard". The fee is deducted from the minted amount on the
 * destination chain.
 */
export async function fetchFastFee(args: {
  sourceDomain: number;
  destinationDomain: number;
  fetchFn?: FetchFn;
}): Promise<FastFeeInfo | null> {
  const doFetch: FetchFn =
    args.fetchFn ??
    ((u: string) => fetch(u) as Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>);
  let body: unknown;
  try {
    const res = await doFetch(CCTP_FAST_FEE_URL);
    if (!res.ok) return null;
    body = await res.json();
  } catch {
    return null;
  }
  const root = asRecord(body);
  const list = root && Array.isArray(root.fees) ? root.fees : Array.isArray(body) ? body : [];
  for (const item of list) {
    const rec = asRecord(item);
    if (!rec) continue;
    const src = asBigint(rec.sourceDomain);
    const dst = asBigint(rec.destinationDomain);
    if (src !== BigInt(args.sourceDomain) || dst !== BigInt(args.destinationDomain)) continue;
    return {
      sourceDomain: args.sourceDomain,
      destinationDomain: args.destinationDomain,
      minFee: asBigint(rec.minimumFee ?? rec.minFee ?? null),
      maxFee: asBigint(rec.maximumFee ?? rec.maxFee ?? null),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bridge fee from the published fee config (defensive read)
// ---------------------------------------------------------------------------

export interface BridgeFeeConfig {
  /** Where a bridge fee goes, or null when no fee is configured. */
  recipient: string | null;
  /** Bridge fee in basis points (0 = no fee). */
  feeBps: number;
}

/**
 * Read the bridge fee defensively from whatever fee config the wallet
 * holds: `fees.feeRecipient` is where any bridge fee goes,
 * `fees.bridgeFeeBps` is how much. When neither is present the
 * behaviour is unchanged — NO bridge fee is invented.
 */
export function resolveBridgeFee(feeConfig: unknown): BridgeFeeConfig {
  const root = asRecord(feeConfig);
  const fees = asRecord(root?.fees) ?? root;
  const recipientRaw = fees?.feeRecipient;
  const recipient =
    typeof recipientRaw === 'string' && ethers.isAddress(recipientRaw) ? recipientRaw : null;
  const bpsRaw = fees?.bridgeFeeBps;
  const feeBps =
    typeof bpsRaw === 'number' && Number.isFinite(bpsRaw)
      ? Math.max(0, Math.min(10000, Math.floor(bpsRaw)))
      : 0;
  return { recipient: recipient && feeBps > 0 ? recipient : null, feeBps };
}

/** Split a bridge amount into the fee portion and the amount to burn. */
export function applyBridgeFee(
  amountRaw: bigint,
  feeBps: number,
): { burnAmount: bigint; feeAmount: bigint } {
  if (feeBps <= 0) return { burnAmount: amountRaw, feeAmount: 0n };
  const feeAmount = (amountRaw * BigInt(feeBps)) / 10000n;
  return { burnAmount: amountRaw - feeAmount, feeAmount };
}
