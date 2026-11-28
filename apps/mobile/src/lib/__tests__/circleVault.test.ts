/**
 * Unit tests for the Circle vault-lock builder (src/lib/circleVault.ts).
 * Run: npm test
 */
import { ethers } from 'ethers';
import {
  buildCircleCreateLockChallenge,
  CIRCLE_VAULT_ARC_ONLY_MESSAGE,
  CIRCLE_VAULT_NOT_DEPLOYED_MESSAGE,
  circleVaultRefusal,
} from '../circleVault';
import { STELIX_VAULT_ABI, ERC20_APPROVE_ABI } from '../vault';
import type { CreateLockOnChainParams } from '../vault';

const TOKEN = '0x1111111111111111111111111111111111111111';
const STABLECOIN = '0x3600000000000000000000000000000000000000';
const VAULT = '0x2222222222222222222222222222222222222222';

function makeParams(over: Partial<CreateLockOnChainParams> = {}): CreateLockOnChainParams {
  return {
    chainId: 'arc-mainnet',
    vaultAddress: VAULT,
    tokenAddress: TOKEN,
    tokenDecimals: 6,
    stablecoinAddress: STABLECOIN,
    amount: 100,
    unlockTime: Date.now() + 30 * 86_400_000,
    entryPriceUsd: 1,
    ladder: [{ multiple: 2, percent: 100 }],
    trailingStopBps: null,
    breakMode: 'penalty',
    penaltyBps: 500,
    autoSell: true,
    slippageBps: 150,
    minReceiveUsd: 0,
    ...over,
  };
}

describe('buildCircleCreateLockChallenge', () => {
  it('refuses honestly when no vault is deployed on Arc (today: always)', () => {
    const res = buildCircleCreateLockChallenge(makeParams({ vaultAddress: null }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe(CIRCLE_VAULT_NOT_DEPLOYED_MESSAGE);
  });

  it('refuses on a non-Arc chain', () => {
    const res = buildCircleCreateLockChallenge(makeParams({ chainId: 'bnb' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe(CIRCLE_VAULT_ARC_ONLY_MESSAGE);
  });

  it('refuses when the ladder totals over 100%', () => {
    const res = buildCircleCreateLockChallenge(
      makeParams({ ladder: [{ multiple: 2, percent: 60 }, { multiple: 3, percent: 60 }] }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/at most 100%/i);
  });

  it('refuses when a Penalty lock is outside 5–10%', () => {
    const res = buildCircleCreateLockChallenge(makeParams({ penaltyBps: 200 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/5–10%/);
  });

  it('with a vault registered, returns approve + createLock steps in order', () => {
    const res = buildCircleCreateLockChallenge(makeParams());
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.vaultAddress).toBe(VAULT);
    expect(res.chainId).toBe('arc-mainnet');
    expect(res.steps).toHaveLength(2);
    expect(res.steps[0].kind).toBe('approve');
    expect(res.steps[1].kind).toBe('createLock');
  });

  it('approve step targets the token with approve(address,uint256)', () => {
    const res = buildCircleCreateLockChallenge(makeParams());
    if (!res.ok) throw new Error('expected ok');
    const step = res.steps[0];
    expect(step.contractAddress).toBe(TOKEN);
    expect(step.abiFunctionSignature).toBe('approve(address,uint256)');
    // approve selector 0x095ea7b3
    expect(step.callData.startsWith('0x095ea7b3')).toBe(true);
    expect(step.abiParameters).toEqual([VAULT, '100000000']); // 100 USDC, 6 decimals
    // Calldata decodes back to the same spender + amount.
    const iface = new ethers.Interface(ERC20_APPROVE_ABI);
    const decoded = iface.decodeFunctionData('approve', step.callData);
    expect(decoded[0]).toBe(VAULT);
    expect(decoded[1]).toBe(100000000n);
  });

  it('createLock step targets the vault and its calldata decodes to the lock params', () => {
    const res = buildCircleCreateLockChallenge(makeParams());
    if (!res.ok) throw new Error('expected ok');
    const step = res.steps[1];
    expect(step.contractAddress).toBe(VAULT);
    expect(step.abiFunctionSignature).toContain('createLock(');
    const iface = new ethers.Interface(STELIX_VAULT_ABI);
    // Selector matches the ABI's createLock function.
    const selector = iface.getFunction('createLock')?.selector;
    expect(step.callData.startsWith(selector ?? '0x')).toBe(true);
    const decoded = iface.decodeFunctionData('createLock', step.callData);
    const params = decoded[0] as unknown as {
      token: string;
      amount: bigint;
      entryPrice: bigint;
      autoSell: boolean;
      stablecoin: string;
    };
    expect(params.token).toBe(TOKEN);
    expect(params.amount).toBe(100000000n); // 100 tokens, 6 decimals
    expect(params.entryPrice).toBe(ethers.parseUnits('1', 18));
    expect(params.autoSell).toBe(true);
    expect(params.stablecoin).toBe(STABLECOIN);
  });
});

describe('circleVaultRefusal', () => {
  it('returns the not-deployed message when no vault is registered', () => {
    expect(circleVaultRefusal('arc-mainnet', null)).toBe(CIRCLE_VAULT_NOT_DEPLOYED_MESSAGE);
  });

  it('returns null (no refusal) when a vault is registered', () => {
    expect(circleVaultRefusal('arc-mainnet', VAULT)).toBeNull();
  });
});
