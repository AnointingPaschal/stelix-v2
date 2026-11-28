/**
 * Circle vault locks — StelixVault.createLock via a Circle
 * contract-execution challenge.
 *
 * How a Circle lock works, honestly:
 * 1. The vault MUST be deployed on Arc and registered (built-in
 *    registry or admin Contract Studio). There is NO vault deployed
 *    anywhere right now, so today this module always refuses — see
 *    buildCircleCreateLockChallenge() returning { ok: false } with the
 *    not-deployed message. That refusal is the correct behaviour, not
 *    a bug: a lock that was never submitted is not a lock.
 * 2. When a vault exists, locking takes TWO user-approved Circle
 *    challenges, in order: ERC-20 approve(vault, amount), then
 *    StelixVault.createLock(params). Each one opens the Circle PIN UI
 *    and the user approves it — Circle UCW cannot execute without
 *    that approval.
 * 3. Circle UCW alone CANNOT auto-sell. Auto-sell on a price target is
 *    done by the StelixVault contract + keeper (executeTrigger), not by
 *    the wallet. A Circle lock's auto-sell only happens once the vault
 *    + keeper exist — never claim otherwise.
 *
 * Arc only: Circle vault locks are offered on Arc Mainnet
 * ('arc-mainnet'). Any other chain is refused.
 *
 * Pure builder — no React Native imports, no SDK import. The provider
 * (store/CircleWalletContext.tsx) turns each returned step into a
 * POST /api/circle/challenges CONTRACT_EXECUTION call + sdk.execute().
 */
import { ethers } from 'ethers';
import {
  ERC20_APPROVE_ABI,
  STELIX_VAULT_ABI,
  resolveVaultAddress,
  toOnChainCreateLockParams,
  type CreateLockOnChainParams,
} from './vault';

/** Shown whenever a Circle lock is attempted before any vault exists. */
export const CIRCLE_VAULT_NOT_DEPLOYED_MESSAGE =
  'Vault not deployed on Arc yet — locks via Circle are unavailable until StelixVault is deployed and registered in admin.';

/** Shown when a Circle lock is attempted on a non-Arc chain. */
export const CIRCLE_VAULT_ARC_ONLY_MESSAGE =
  'Circle vault locks are Arc only — pick the Arc network to lock with a Circle wallet.';

/** One user-approved Circle contract-execution step. */
export interface CircleContractExecutionStep {
  /** 'approve' runs first (token spend), 'createLock' second. */
  kind: 'approve' | 'createLock';
  contractAddress: string;
  abiFunctionSignature: string;
  abiParameters: unknown[];
  /** Pre-encoded calldata (ethers) — the backend can verify it. */
  callData: string;
  label: string;
}

export type CircleCreateLockResult =
  | {
      ok: true;
      vaultAddress: string;
      chainId: string;
      /** Execute in order: approve first, then createLock. */
      steps: [CircleContractExecutionStep, CircleContractExecutionStep];
    }
  | { ok: false; reason: string };

/**
 * Build the Circle challenge steps for a StelixVault lock. Pure and
 * synchronous — it only encodes calldata, it submits nothing.
 *
 * Refuses ({ ok: false }) when:
 * - the chain is not Arc, or
 * - no StelixVault address is registered for the chain (not deployed),
 * - the lock params are invalid (ladder > 100%, bad penalty — the same
 *   contract rules as toOnChainCreateLockParams, which throws; the
 *   throw is converted to a refusal here so the UI gets a message,
 *   not a crash).
 */
export function buildCircleCreateLockChallenge(
  params: CreateLockOnChainParams,
): CircleCreateLockResult {
  if (params.chainId !== 'arc-mainnet') {
    return { ok: false, reason: CIRCLE_VAULT_ARC_ONLY_MESSAGE };
  }
  let vaultAddress: string;
  try {
    vaultAddress = resolveVaultAddress(params.chainId, params.vaultAddress);
  } catch {
    return { ok: false, reason: CIRCLE_VAULT_NOT_DEPLOYED_MESSAGE };
  }
  let tuple: ReturnType<typeof toOnChainCreateLockParams>;
  try {
    tuple = toOnChainCreateLockParams(params);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Invalid lock parameters.' };
  }

  const tokenIface = new ethers.Interface(ERC20_APPROVE_ABI);
  const approveCallData = tokenIface.encodeFunctionData('approve', [
    vaultAddress,
    tuple.amount,
  ]);
  const approveStep: CircleContractExecutionStep = {
    kind: 'approve',
    contractAddress: params.tokenAddress,
    abiFunctionSignature: 'approve(address,uint256)',
    abiParameters: [vaultAddress, tuple.amount.toString()],
    callData: approveCallData,
    label: `Approve ${vaultAddress.slice(0, 6)}…${vaultAddress.slice(-4)} to spend the locked tokens`,
  };

  const vaultIface = new ethers.Interface(STELIX_VAULT_ABI);
  const createLockCallData = vaultIface.encodeFunctionData('createLock', [tuple]);
  const createLockStep: CircleContractExecutionStep = {
    kind: 'createLock',
    contractAddress: vaultAddress,
    abiFunctionSignature:
      'createLock((address,uint256,uint256,uint256,(uint256,uint16,bool)[],uint16,uint8,uint16,bool,address,uint16,uint256))',
    abiParameters: [
      {
        token: tuple.token,
        amount: tuple.amount.toString(),
        unlockTime: tuple.unlockTime.toString(),
        entryPrice: tuple.entryPrice.toString(),
        ladderStages: tuple.ladderStages.map((s) => ({
          targetPrice: s.targetPrice.toString(),
          sellBps: s.sellBps,
          sold: false,
        })),
        trailingStopBps: tuple.trailingStopBps,
        breakMode: tuple.breakMode,
        penaltyBps: tuple.penaltyBps,
        autoSell: tuple.autoSell,
        stablecoin: tuple.stablecoin,
        slippageBps: tuple.slippageBps,
        minReceivePerStage: tuple.minReceivePerStage.toString(),
      },
    ],
    callData: createLockCallData,
    label: 'Create the StelixVault lock on Arc',
  };

  return { ok: true, vaultAddress, chainId: params.chainId, steps: [approveStep, createLockStep] };
}

/** Convenience refusal for callers that only need the reason. */
export function circleVaultRefusal(chainId: string, vaultAddressOverride?: string | null): string | null {
  const res = buildCircleCreateLockChallenge({
    chainId,
    vaultAddress: vaultAddressOverride,
    tokenAddress: '0x0000000000000000000000000000000000000000',
    tokenDecimals: 18,
    stablecoinAddress: '0x0000000000000000000000000000000000000000',
    amount: 0,
    unlockTime: Date.now(),
    entryPriceUsd: 0,
    ladder: [],
    trailingStopBps: null,
    breakMode: 'penalty',
    penaltyBps: 500,
    autoSell: false,
    slippageBps: 150,
    minReceiveUsd: 0,
  });
  return res.ok ? null : res.reason;
}
