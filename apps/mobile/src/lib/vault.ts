/**
 * Bull Lock engine — pure TypeScript, no React Native imports.
 * Mirrors the StelixVault contract rules from spec Part B / F.
 *
 * Core rule: Unlock = whichever comes first — the unlock date OR the price
 * target (30-min TWAP must hold above target). At the date, tokens return
 * to the wallet. At the price, the due share is auto-sold to the chain's
 * exit stablecoin (registry-driven) and delivered to the wallet.
 *
 * No early-break penalty is ever charged when a price target or the
 * maturity date triggers the exit — a penalty only applies to breaking
 * discipline early with no trigger met.
 *
 * The on-chain section at the bottom (STELIX_VAULT_ABI, createLockOnChain,
 * getUserLocksOnChain, claimMaturedOnChain, claimTriggeredStageOnChain,
 * requestBreakOnChain, executeBreakOnChain) is the live contract layer:
 * it refuses with the not-deployed message until StelixVault is deployed
 * and registered per chain (see lib/chains.ts).
 */
import { ethers } from 'ethers';
import { getChain, requireVaultAddress, VAULT_NOT_DEPLOYED_MESSAGE } from './chains';
import { getProvider } from './balances';
import { fmtPrice } from './format';

/** Minimal StelixVault ABI — only the functions the app calls.
 *  Matches contracts/src/StelixVault.sol exactly (createLock with a
 *  CreateLockParams tuple, claimMatured, claimTriggeredStage,
 *  requestBreak / executeBreak, getLock, getUserLocks). */
export const STELIX_VAULT_ABI = [
  'function createLock((address token, uint256 amount, uint256 unlockTime, uint256 entryPrice, (uint256 targetPrice, uint16 sellBps, bool sold)[] ladderStages, uint16 trailingStopBps, uint8 breakMode, uint16 penaltyBps, bool autoSell, address stablecoin, uint16 slippageBps, uint256 minReceivePerStage) params) returns (uint256 lockId)',
  'function claimMatured(uint256 lockId)',
  'function claimTriggeredStage(uint256 lockId, uint256 stageIndex)',
  'function executeTrigger(uint256 lockId)',
  'function requestBreak(uint256 lockId)',
  'function executeBreak(uint256 lockId)',
  'function getLock(uint256 lockId) view returns ((address owner, address token, uint256 amountRemaining, uint256 amountTotal, uint256 entryPrice, uint256 unlockTime, (uint256 targetPrice, uint16 sellBps, bool sold)[] ladderStages, uint16 trailingStopBps, uint256 peakPrice, uint8 breakMode, uint16 penaltyBps, bool autoSell, address stablecoin, address router, uint16 slippageBps, uint256 minReceivePerStage, uint8 status, uint256 feeBps, address penaltyRecipient, uint256 breakRequestedAt))',
  'function getUserLocks(address user) view returns (uint256[])',
  'event Locked(uint256 indexed lockId, address indexed owner, address indexed token, uint256 amount, uint256 unlockTime, uint256 entryPrice)',
] as const;

export const ERC20_APPROVE_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
] as const;

export { VAULT_NOT_DEPLOYED_MESSAGE };

/**
 * Resolve the vault address for a chain. `override` is the vault address
 * from the merged admin registry (chain.vaultContract, see
 * store/AppContext.tsx) — it wins when it is a well-formed 0x address,
 * so a vault registered in Contract Studio takes effect in the wallet on
 * the next admin sync with no app rebuild. Otherwise the built-in
 * registry decides (and throws the not-deployed message when nothing is
 * registered anywhere).
 */
export function resolveVaultAddress(chainId: string, override?: string | null): string {
  if (override && /^0x[0-9a-fA-F]{40}$/.test(override.trim())) return override.trim();
  return requireVaultAddress(chainId);
}

export function getVaultContract(chainId: string, runner: ethers.ContractRunner, vaultAddressOverride?: string | null): ethers.Contract {
  const address = resolveVaultAddress(chainId, vaultAddressOverride); // throws not-deployed
  return new ethers.Contract(address, STELIX_VAULT_ABI, runner);
}

/** Raw on-chain lock as returned by getLock (ethers v6 named tuple). */
export interface ChainLock {
  lockId: number;
  owner: string;
  token: string;
  amountRemaining: bigint;
  amountTotal: bigint;
  entryPrice: bigint; // USD, 18 decimals
  unlockTime: bigint;
  ladderStages: { targetPrice: bigint; sellBps: number; sold: boolean }[];
  trailingStopBps: number;
  peakPrice: bigint;
  breakMode: number; // 0 Immutable, 1 Penalty, 2 Guardian
  penaltyBps: number;
  autoSell: boolean;
  stablecoin: string;
  slippageBps: number;
  minReceivePerStage: bigint;
  status: number; // 0 Active, 1 PartiallySold, 2 Completed, 3 Matured, 4 Broken
  breakRequestedAt: bigint; // epoch seconds, 0 = not requested
  chainId: string;
}

const CHAIN_LOCK_STATUSES: LockStatus[] = ['active', 'partially-sold', 'completed', 'matured', 'broken'];
const CHAIN_BREAK_MODES: BreakMode[] = ['immutable', 'penalty', 'guardian'];

function usd18ToNumber(v: bigint): number {
  return Number(ethers.formatUnits(v, 18));
}

/** Map an on-chain lock to the app's BullLock (amounts in token units). */
export function mapChainLockToBullLock(lock: ChainLock, tokenDecimals: number, tokenSymbol: string): BullLock {
  const entryPrice = usd18ToNumber(lock.entryPrice);
  const total = Number(ethers.formatUnits(lock.amountTotal, tokenDecimals));
  const remaining = Number(ethers.formatUnits(lock.amountRemaining, tokenDecimals));
  const ladder: LadderStage[] = lock.ladderStages.map((s) => ({
    multiple: entryPrice > 0 ? usd18ToNumber(s.targetPrice) / entryPrice : 1,
    percent: s.sellBps / 100,
    status: s.sold ? 'sold' : 'pending',
  }));
  const targetStage = lock.ladderStages.find((s) => !s.sold);
  return {
    id: `onchain-${lock.chainId}-${lock.lockId}`,
    chainId: lock.chainId,
    tokenSymbol,
    tokenAddress: lock.token,
    amount: total,
    amountRemaining: remaining,
    entryPrice,
    unlockTime: Number(lock.unlockTime) * 1000,
    targetPrice: targetStage ? usd18ToNumber(targetStage.targetPrice) : null,
    targetMultiple: targetStage && entryPrice > 0 ? usd18ToNumber(targetStage.targetPrice) / entryPrice : null,
    ladder,
    trailingStopBps: lock.trailingStopBps > 0 ? lock.trailingStopBps : null,
    peakPrice: usd18ToNumber(lock.peakPrice),
    breakMode: CHAIN_BREAK_MODES[lock.breakMode] ?? 'penalty',
    penaltyBps: lock.penaltyBps,
    autoSell: lock.autoSell,
    slippageBps: lock.slippageBps,
    minReceiveUsd: Number(ethers.formatUnits(lock.minReceivePerStage, 18)),
    status: CHAIN_LOCK_STATUSES[lock.status] ?? 'active',
    breakRequestedAt: lock.breakRequestedAt > 0n ? Number(lock.breakRequestedAt) * 1000 : undefined,
    createdAt: 0, // on-chain locks carry no createdAt; use unlockTime/creation tx in the UI
    txHash: undefined,
  };
}

export interface OnChainLocksResult {
  chainId: string;
  deployed: boolean;
  note: string | null;
  lockIds: number[];
  locks: ChainLock[];
}

/** Read a user's locks from chain. When the vault is not deployed on the
 *  chain this returns an EMPTY list with the not-deployed note — never
 *  sample locks. */
export async function getUserLocksOnChain(
  chainId: string,
  userAddress: string,
  vaultAddressOverride?: string | null,
): Promise<OnChainLocksResult> {
  const chain = getChain(chainId);
  if (chain.kind !== 'evm' || chain.chainId === null) {
    return { chainId, deployed: false, note: 'Solana vault is an Anchor program — not wired yet.', lockIds: [], locks: [] };
  }
  let vaultAddress: string;
  try {
    vaultAddress = resolveVaultAddress(chainId, vaultAddressOverride);
  } catch {
    return { chainId, deployed: false, note: VAULT_NOT_DEPLOYED_MESSAGE, lockIds: [], locks: [] };
  }
  // Reads go through getProvider() (balances.ts) so a dead primary RPC
  // fails over to the registry fallbacks instead of breaking vault reads.
  const provider = getProvider(chain);
  const vault = new ethers.Contract(vaultAddress, STELIX_VAULT_ABI, provider);
  const ids = (await vault.getUserLocks(userAddress)) as bigint[];
  const locks: ChainLock[] = [];
  for (const id of ids) {
    const raw = (await vault.getLock(id)) as unknown as Record<string, unknown> & {
      ladderStages: { targetPrice: bigint; sellBps: number; sold: boolean }[];
    };
    locks.push({
      lockId: Number(id),
      owner: raw.owner as string,
      token: raw.token as string,
      amountRemaining: raw.amountRemaining as bigint,
      amountTotal: raw.amountTotal as bigint,
      entryPrice: raw.entryPrice as bigint,
      unlockTime: raw.unlockTime as bigint,
      ladderStages: raw.ladderStages,
      trailingStopBps: Number(raw.trailingStopBps),
      peakPrice: raw.peakPrice as bigint,
      breakMode: Number(raw.breakMode),
      penaltyBps: Number(raw.penaltyBps),
      autoSell: raw.autoSell as boolean,
      stablecoin: raw.stablecoin as string,
      slippageBps: Number(raw.slippageBps),
      minReceivePerStage: raw.minReceivePerStage as bigint,
      status: Number(raw.status),
      breakRequestedAt: raw.breakRequestedAt as bigint,
      chainId,
    });
  }
  return { chainId, deployed: true, note: null, lockIds: ids.map(Number), locks };
}

export interface CreateLockOnChainParams {
  chainId: string;
  /** Vault address from the merged admin registry (chain.vaultContract).
   *  Wins when well-formed; otherwise the built-in registry decides. */
  vaultAddress?: string | null;
  tokenAddress: string;
  tokenDecimals: number;
  stablecoinAddress: string;
  amount: number; // token units
  unlockTime: number; // epoch ms
  entryPriceUsd: number;
  ladder: { multiple: number; percent: number }[]; // percent of original, total <= 100
  trailingStopBps: number | null;
  breakMode: BreakMode;
  penaltyBps: number;
  autoSell: boolean;
  slippageBps: number;
  minReceiveUsd: number;
}

/** Build the on-chain CreateLockParams tuple from real lock parameters.
 *  Throws when the ladder totals over 100% (contract rule) or when a
 *  Penalty lock is outside 5–10% (contract rule). */
export function toOnChainCreateLockParams(
  p: CreateLockOnChainParams,
): {
  token: string;
  amount: bigint;
  unlockTime: bigint;
  entryPrice: bigint;
  ladderStages: { targetPrice: bigint; sellBps: number; sold: boolean }[];
  trailingStopBps: number;
  breakMode: number;
  penaltyBps: number;
  autoSell: boolean;
  stablecoin: string;
  slippageBps: number;
  minReceivePerStage: bigint;
} {
  const totalPct = p.ladder.reduce((s, x) => s + x.percent, 0);
  if (totalPct > 100) throw new Error(`Ladder stages must total at most 100% (currently ${totalPct}%).`);
  if (p.breakMode === 'penalty' && (p.penaltyBps < 500 || p.penaltyBps > 1000)) {
    throw new Error('Penalty locks must use a penalty of 5–10% (500–1000 bps).');
  }
  if (p.breakMode !== 'penalty' && p.penaltyBps !== 0) {
    throw new Error('Only Penalty locks carry a penaltyBps value.');
  }
  const entryPrice = ethers.parseUnits(p.entryPriceUsd.toFixed(6), 18);
  return {
    token: p.tokenAddress,
    amount: ethers.parseUnits(p.amount.toString(), p.tokenDecimals),
    unlockTime: BigInt(Math.floor(p.unlockTime / 1000)),
    entryPrice,
    ladderStages: p.ladder.map((s) => ({
      targetPrice: ethers.parseUnits((p.entryPriceUsd * s.multiple).toFixed(6), 18),
      sellBps: Math.round(s.percent * 100),
      sold: false,
    })),
    trailingStopBps: p.trailingStopBps ?? 0,
    breakMode: p.breakMode === 'immutable' ? 0 : p.breakMode === 'penalty' ? 1 : 2,
    penaltyBps: p.penaltyBps,
    autoSell: p.autoSell,
    stablecoin: p.stablecoinAddress,
    slippageBps: p.slippageBps,
    minReceivePerStage: ethers.parseUnits(p.minReceiveUsd.toFixed(6), 18),
  };
}

/**
 * Create a REAL on-chain lock: ERC-20 approve, then StelixVault.createLock.
 * The signer must be the user's unlocked wallet. REFUSES (throws the
 * not-deployed message) when no StelixVault address is registered for
 * the active chain. Returns the mined tx hash and the on-chain lock id
 * parsed from the Locked event.
 */
export async function createLockOnChain(
  signer: ethers.Signer,
  params: CreateLockOnChainParams,
): Promise<{ txHash: string; lockId: number | null }> {
  const vaultAddress = resolveVaultAddress(params.chainId, params.vaultAddress); // throws not-deployed
  const chain = getChain(params.chainId);
  const tuple = toOnChainCreateLockParams(params);
  const token = new ethers.Contract(params.tokenAddress, ERC20_APPROVE_ABI, signer);
  const approveTx = await token.approve(vaultAddress, tuple.amount);
  await approveTx.wait();
  const vault = new ethers.Contract(vaultAddress, STELIX_VAULT_ABI, signer);
  const tx = await vault.createLock(tuple);
  const receipt = await tx.wait();
  let lockId: number | null = null;
  try {
    const iface = new ethers.Interface(STELIX_VAULT_ABI);
    for (const log of receipt?.logs ?? []) {
      try {
        const parsed = iface.parseLog(log as { topics: string[]; data: string });
        if (parsed?.name === 'Locked') lockId = Number(parsed.args.lockId);
      } catch {
        // not our event — ignore
      }
    }
  } catch {
    // lock id unknown from receipt; the tx hash still identifies the lock
  }
  void chain;
  return { txHash: tx.hash as string, lockId };
}

async function sendVaultTx(
  signer: ethers.Signer,
  chainId: string,
  method: 'claimMatured' | 'claimTriggeredStage' | 'requestBreak' | 'executeBreak',
  args: unknown[],
  vaultAddressOverride?: string | null,
): Promise<string> {
  const vaultAddress = resolveVaultAddress(chainId, vaultAddressOverride); // throws not-deployed
  const vault = new ethers.Contract(vaultAddress, STELIX_VAULT_ABI, signer);
  const tx = await (vault[method] as (...a: unknown[]) => Promise<ethers.TransactionResponse>)(...args);
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

/** Owner claims a matured lock on-chain (penalty-free by construction). */
export async function claimMaturedOnChain(signer: ethers.Signer, chainId: string, lockId: number, vaultAddressOverride?: string | null): Promise<string> {
  return sendVaultTx(signer, chainId, 'claimMatured', [lockId], vaultAddressOverride);
}

/** Owner manually claims a triggered ladder stage (no swap, no fee). */
export async function claimTriggeredStageOnChain(
  signer: ethers.Signer,
  chainId: string,
  lockId: number,
  stageIndex: number,
  vaultAddressOverride?: string | null,
): Promise<string> {
  return sendVaultTx(signer, chainId, 'claimTriggeredStage', [lockId, stageIndex], vaultAddressOverride);
}

/** Owner requests an early break (starts the 24h / 48h cooling-off). */
export async function requestBreakOnChain(signer: ethers.Signer, chainId: string, lockId: number, vaultAddressOverride?: string | null): Promise<string> {
  return sendVaultTx(signer, chainId, 'requestBreak', [lockId], vaultAddressOverride);
}

/** Owner executes a break after cooling-off (penalty per the lock terms). */
export async function executeBreakOnChain(signer: ethers.Signer, chainId: string, lockId: number, vaultAddressOverride?: string | null): Promise<string> {
  return sendVaultTx(signer, chainId, 'executeBreak', [lockId], vaultAddressOverride);
}

/**
 * Keeper trigger — StelixVault.executeTrigger is `onlyKeeper`, so the
 * user's wallet CANNOT call it: the contract reverts for anyone except
 * the registered keeper. This function exists so the keeper service
 * reuses the same ABI/call; the mobile UI never exposes it. When the
 * keeper calls it, the contract checks the 30-minute TWAP against the
 * next target (or the trailing stop) and auto-sells the due stage.
 * Throws the not-deployed message when no vault is registered.
 */
export async function executeTriggerOnChain(
  keeperSigner: ethers.Signer,
  chainId: string,
  lockId: number,
  vaultAddressOverride?: string | null,
): Promise<string> {
  const vaultAddress = resolveVaultAddress(chainId, vaultAddressOverride); // throws not-deployed
  const vault = new ethers.Contract(vaultAddress, STELIX_VAULT_ABI, keeperSigner);
  const tx = await (vault.executeTrigger as (id: number) => Promise<ethers.TransactionResponse>)(lockId);
  const receipt = await tx.wait();
  return receipt?.hash ?? tx.hash;
}

/** Parse an on-chain lock id of the form `onchain-<chainId>-<lockId>`
 *  (see mapChainLockToBullLock). Returns null for local-only ids. */
export function parseOnChainLockId(id: string): { chainId: string; lockId: number } | null {
  const m = /^onchain-([a-z0-9]+)-(\d+)$/.exec(id);
  if (!m) return null;
  return { chainId: m[1], lockId: Number(m[2]) };
}

export type BreakMode = 'immutable' | 'penalty' | 'guardian';
export type LockStatus =
  | 'active'
  | 'partially-sold'
  | 'target-triggered'
  | 'matured'
  | 'completed'
  | 'broken';

export interface LadderStage {
  /** Multiple of entry price, e.g. 2 = 2x. */
  multiple: number;
  /** Share of the ORIGINAL lock amount sold at this stage (percent). */
  percent: number;
  status: 'pending' | 'sold';
  soldUsd?: number;
  soldAt?: number;
}

export interface BullLock {
  id: string;
  chainId: string;
  tokenSymbol: string;
  tokenAddress: string;
  amount: number; // original locked amount (tokens)
  amountRemaining: number;
  entryPrice: number; // USD price recorded at lock time
  unlockTime: number; // epoch ms
  targetPrice: number | null; // null = pure date lock
  targetMultiple: number | null;
  ladder: LadderStage[];
  trailingStopBps: number | null; // e.g. 1500 = 15%
  peakPrice: number; // highest TWAP seen since lock / since last target hit
  breakMode: BreakMode;
  penaltyBps: number; // e.g. 500 = 5% — only on early break, never on trigger
  autoSell: boolean; // sell to stablecoin on target, else unlock to wallet
  slippageBps: number; // default 150 = 1.5%
  minReceiveUsd: number; // minimum acceptable stablecoin for a stage
  status: LockStatus;
  /** Epoch ms when an early break was requested on-chain (cooling-off
   *  runs from here); undefined = no break requested. */
  breakRequestedAt?: number;
  createdAt: number;
  txHash?: string;
}

export interface TwapSample {
  price: number;
  at: number; // epoch ms
}

/** 30-minute time-weighted average price. Returns null with too few samples. */
export function computeTwap(samples: TwapSample[], windowMinutes = 30): number | null {
  if (samples.length === 0) return null;
  const now = Math.max(...samples.map((s) => s.at));
  const cutoff = now - windowMinutes * 60_000;
  const inWindow = samples.filter((s) => s.at >= cutoff);
  if (inWindow.length === 0) return null;
  // Time-weighted: weight each sample by the gap to the next sample.
  const sorted = [...inWindow].sort((a, b) => a.at - b.at);
  let weighted = 0;
  let totalWeight = 0;
  for (let i = 0; i < sorted.length; i++) {
    const nextAt = i + 1 < sorted.length ? sorted[i + 1].at : now;
    const w = Math.max(nextAt - sorted[i].at, 1);
    weighted += sorted[i].price * w;
    totalWeight += w;
  }
  if (totalWeight === 0) return null;
  return weighted / totalWeight;
}

/** Has the maturity date been reached? */
export function isDateReached(lock: BullLock, now = Date.now()): boolean {
  return now >= lock.unlockTime;
}

/** Has the TWAP held at/above the price target? (guards against fake wicks) */
export function isPriceTargetHit(lock: BullLock, twapPrice: number | null): boolean {
  if (lock.targetPrice === null || twapPrice === null) return false;
  return twapPrice >= lock.targetPrice;
}

/** Unlock = whichever comes first: date OR price target. */
export function unlockReason(
  lock: BullLock,
  now: number,
  twapPrice: number | null,
): 'date' | 'price' | null {
  if (isPriceTargetHit(lock, twapPrice)) return 'price';
  if (isDateReached(lock, now)) return 'date';
  return null;
}

export function isUnlocked(lock: BullLock, now: number, twapPrice: number | null): boolean {
  return unlockReason(lock, now, twapPrice) !== null;
}

/** Progress (0..1) towards the price target from the entry price. */
export function targetProgress(lock: BullLock, currentPrice: number): number {
  if (lock.targetPrice === null || lock.targetPrice <= lock.entryPrice) return 0;
  const p = (currentPrice - lock.entryPrice) / (lock.targetPrice - lock.entryPrice);
  return Math.min(1, Math.max(0, p));
}

/** Ladder stages whose multiple has been reached by the TWAP and are pending. */
export function dueLadderStages(lock: BullLock, twapPrice: number | null): LadderStage[] {
  if (twapPrice === null) return [];
  return lock.ladder.filter(
    (s) => s.status === 'pending' && twapPrice >= lock.entryPrice * s.multiple,
  );
}

/** Validate a ladder: percentages must total 100. */
export function validateLadder(stages: LadderStage[]): string | null {
  if (stages.length === 0) return null;
  const total = stages.reduce((sum, s) => sum + s.percent, 0);
  if (total !== 100) return `Ladder stages must total 100% (currently ${total}%).`;
  if (stages.some((s) => s.percent <= 0)) return 'Every ladder stage must sell more than 0%.';
  if (stages.some((s) => s.multiple <= 1)) return 'Ladder multiples must be above 1x.';
  return null;
}

/**
 * Trailing stop: after any target is hit, the vault tracks the peak price.
 * A fall of the chosen % from the peak auto-sells the remainder.
 * Returns true when the stop is breached.
 */
export function isTrailingStopBreached(
  lock: BullLock,
  currentPrice: number,
  anyTargetHit: boolean,
): boolean {
  if (lock.trailingStopBps === null || !anyTargetHit) return false;
  const peak = Math.max(lock.peakPrice, currentPrice);
  if (peak <= 0) return false;
  const dropBps = ((peak - currentPrice) / peak) * 10_000;
  return dropBps >= lock.trailingStopBps;
}

/** Update the tracked peak price (never moves down). */
export function updatePeak(lock: BullLock, currentPrice: number): BullLock {
  return { ...lock, peakPrice: Math.max(lock.peakPrice, currentPrice) };
}

/**
 * Break penalty. Returns the penalty in TOKENS (0 when no penalty applies).
 * - Immutable: breaking is not allowed at all (throws).
 * - Penalty is WAIVED when a price target or the maturity date has triggered.
 * - Guardian: no token penalty, but requires approval + 48h delay (enforced
 *   by the contract / app flow, not by this amount calc).
 */
export function breakPenaltyTokens(
  lock: BullLock,
  now: number,
  twapPrice: number | null,
): number {
  if (lock.breakMode === 'immutable') {
    throw new Error('This lock is Immutable: it cannot be broken early.');
  }
  if (unlockReason(lock, now, twapPrice) !== null) return 0; // trigger met: waived
  if (lock.breakMode === 'guardian') return 0; // guardian break has no token penalty
  return (lock.amountRemaining * lock.penaltyBps) / 10_000;
}

export function canBreak(lock: BullLock): boolean {
  return lock.breakMode !== 'immutable';
}

/**
 * Locked token units per token, from on-chain locks. Keyed
 * `${chainId}:${symbol}`; a lock's remaining amount is what is still
 * locked. Completed / broken locks hold nothing. The store fills each
 * token's `locked` from this, so Home's Spendable / Locked split, the
 * Discipline locked ratio and Send's spendable check use real figures
 * instead of the always-0 placeholder. Unit-tested (see
 * __tests__/audit-fixes.test.ts).
 */
export function lockedByToken(locks: BullLock[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of locks) {
    if (l.status === 'completed' || l.status === 'broken') continue;
    const key = `${l.chainId}:${l.tokenSymbol}`;
    out[key] = (out[key] ?? 0) + Math.max(0, l.amountRemaining);
  }
  return out;
}

/** Minimum acceptable stablecoin for a stage, after slippage. */
export function minimumReceive(stageUsdValue: number, slippageBps: number): number {
  return stageUsdValue * (1 - slippageBps / 10_000);
}

/**
 * Minimum acceptable stablecoin for ONE ladder stage (USD), after
 * slippage — the value written to the contract's minReceivePerStage.
 * The binding stage is the FIRST (smallest) one: a min-receive sized
 * to a later, bigger stage would make the first stage revert on-chain.
 * Date-only locks have no stage: 0. The old create screen hardcoded
 * $100 here, which would revert any lock whose stage is worth less
 * than $100 — and mis-stated the review screen's own figure.
 */
export function minReceivePerStageUsd(args: {
  amount: number;
  entryPrice: number;
  targetPrice: number | null;
  ladder: { multiple: number; percent: number }[];
  ladderOn: boolean;
  slippageBps: number;
}): number {
  const { amount, entryPrice, targetPrice, ladder, ladderOn, slippageBps } = args;
  if (amount <= 0 || entryPrice <= 0) return 0;
  let stageUsd = 0;
  if (ladderOn && ladder.length > 0) {
    const first = ladder[0];
    stageUsd = amount * entryPrice * first.multiple * (first.percent / 100);
  } else if (targetPrice !== null && targetPrice > 0) {
    stageUsd = amount * targetPrice;
  }
  return minimumReceive(stageUsd, slippageBps);
}

/**
 * Price-impact guard. If selling this stage would move the pool price
 * beyond the configured limit (default 5%), the stage must be split into
 * smaller pieces or paused — never dumped. Returns the number of pieces.
 */
export function priceImpactPieces(
  stageUsdValue: number,
  poolLiquidityUsd: number,
  maxImpactBps = 500,
): { ok: boolean; pieces: number; impactBps: number } {
  if (poolLiquidityUsd <= 0) return { ok: false, pieces: 0, impactBps: Infinity };
  const impactBps = (stageUsdValue / poolLiquidityUsd) * 10_000;
  if (impactBps <= maxImpactBps) return { ok: true, pieces: 1, impactBps };
  const pieces = Math.ceil(impactBps / maxImpactBps);
  return { ok: false, pieces, impactBps };
}

/** Fail-safe retry: a failed swap leaves the lock locked; retry on schedule. */
export interface SwapAttempt {
  attempt: number;
  maxAttempts: number;
  lastError?: string;
}

export function shouldRetrySwap(attempt: SwapAttempt): boolean {
  return attempt.attempt < attempt.maxAttempts;
}

export function nextRetryDelayMs(attempt: number): number {
  // Backoff: 1m, 2m, 4m, 8m ... capped at 30m.
  return Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));
}

/** Plain-English lock sentence shown on the review screen (spec Part D). */
export function lockSummarySentence(lock: BullLock, exitLabel: string): string {
  const date = new Date(lock.unlockTime).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  if (lock.targetPrice === null || lock.targetMultiple === null) {
    return `These funds cannot be spent until ${date}.`;
  }
  if (lock.autoSell) {
    const pct = lock.ladder.length > 0 ? 'the due ladder stage' : '100%';
    return (
      `These funds cannot be spent until ${date}, unless ${lock.targetMultiple}x ` +
      `(${fmtPrice(lock.targetPrice)}) is reached, when ${pct} will be sold ${exitLabel} automatically.`
    );
  }
  return (
    `These funds cannot be spent until ${date}, unless ${lock.targetMultiple}x ` +
    `(${fmtPrice(lock.targetPrice)}) is reached, when the funds unlock to your wallet.`
  );
}

/** Discipline score inputs: locked ratio, streak, break rate. 0..100. */
export function disciplineScore(args: {
  lockedRatio: number; // 0..1 locked / total portfolio
  streakDays: number;
  locksCompleted: number;
  locksBroken: number;
}): number {
  const { lockedRatio, streakDays, locksCompleted, locksBroken } = args;
  const total = locksCompleted + locksBroken;
  const completion = total === 0 ? 0.5 : locksCompleted / total;
  const score =
    lockedRatio * 40 + Math.min(streakDays, 30) * 1 + completion * 30;
  return Math.round(Math.min(100, Math.max(0, score)));
}
