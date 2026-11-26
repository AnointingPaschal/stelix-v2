// On-chain access for the keeper (spec Part G) — viem over the chain RPC.
// Reads are plain eth_calls; the only write is StelixVault.executeTrigger
// (preceded by pokePrice, per the vault's peak-tracking design). The keeper
// key NEVER leaves env (KEEPER_PRIVATE_KEY is a Cloudflare secret) and is
// never logged. No live run is possible until the coordinator sets
// RPC_URL_ARC, VAULT_ADDRESS_ARC and KEEPER_PRIVATE_KEY — see README.
import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Hex, PublicClient, WalletClient } from 'viem'
import type { LockInput, SwapSimulation } from './types'
import { lockInputFromGetLock, nextStageAmount, impactVsTwap } from './mapping'

export interface ChainConfig {
  rpcUrl: string
  vaultAddress: Hex
  keeperPrivateKey?: Hex
}

export const ARC_TESTNET = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { decimals: 18, name: 'USDC', symbol: 'USDC' },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
  blockExplorers: { default: { name: 'Arcscan', url: 'https://testnet.arcscan.app' } },
})

// Minimal ABIs — only the functions the keeper calls.
export const VAULT_ABI = [
  {
    type: 'function', name: 'getLock', stateMutability: 'view',
    inputs: [{ name: 'lockId', type: 'uint256' }],
    outputs: [{
      name: '', type: 'tuple',
      components: [
        { name: 'owner', type: 'address' },
        { name: 'token', type: 'address' },
        { name: 'amountRemaining', type: 'uint256' },
        { name: 'amountTotal', type: 'uint256' },
        { name: 'entryPrice', type: 'uint256' },
        { name: 'unlockTime', type: 'uint256' },
        { name: 'ladderStages', type: 'tuple[]', components: [
          { name: 'targetPrice', type: 'uint256' },
          { name: 'sellBps', type: 'uint16' },
          { name: 'sold', type: 'bool' },
        ] },
        { name: 'trailingStopBps', type: 'uint16' },
        { name: 'peakPrice', type: 'uint256' },
        { name: 'breakMode', type: 'uint8' },
        { name: 'penaltyBps', type: 'uint16' },
        { name: 'autoSell', type: 'bool' },
        { name: 'stablecoin', type: 'address' },
        { name: 'stablecoinDecimals', type: 'uint8' },
        { name: 'router', type: 'address' },
        { name: 'slippageBps', type: 'uint16' },
        { name: 'minReceivePerStage', type: 'uint256' },
        { name: 'status', type: 'uint8' },
        { name: 'feeBps', type: 'uint16' },
        { name: 'penaltyRecipient', type: 'address' },
        { name: 'breakRequestedAt', type: 'uint256' },
      ],
    }],
  },
  { type: 'function', name: 'priceFeed', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'router', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'pokePrice', stateMutability: 'nonpayable', inputs: [{ name: 'lockId', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'executeTrigger', stateMutability: 'nonpayable', inputs: [{ name: 'lockId', type: 'uint256' }], outputs: [] },
] as const

export const FEED_ABI = [
  { type: 'function', name: 'twapPrice', stateMutability: 'view', inputs: [{ name: 'token', type: 'address' }, { name: 'windowSeconds', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'latestPrice', stateMutability: 'view', inputs: [{ name: 'token', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

export const ROUTER_ABI = [
  { type: 'function', name: 'getAmountsOut', stateMutability: 'nonpayable', inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }], outputs: [{ type: 'uint256[]' }] },
] as const

export function publicClientFor(rpcUrl: string): PublicClient {
  const chain = { ...ARC_TESTNET, rpcUrls: { default: { http: [rpcUrl] } } }
  return createPublicClient({ chain, transport: http(rpcUrl) })
}

export function walletClientFor(rpcUrl: string, keeperPrivateKey: Hex): WalletClient {
  const chain = { ...ARC_TESTNET, rpcUrls: { default: { http: [rpcUrl] } } }
  return createWalletClient({ chain, transport: http(rpcUrl), account: privateKeyToAccount(keeperPrivateKey) })
}

export async function readVaultAddresses(client: PublicClient, vault: Hex): Promise<{ priceFeed: Hex; router: Hex }> {
  const [priceFeed, router] = await Promise.all([
    client.readContract({ address: vault, abi: VAULT_ABI, functionName: 'priceFeed' }),
    client.readContract({ address: vault, abi: VAULT_ABI, functionName: 'router' }),
  ])
  return { priceFeed, router }
}

/** Read the raw vault lock struct (used by the worker for both the mapped LockInput and the simulation inputs, so the chain is only read once per lock). */
export async function readRawLock(client: PublicClient, vault: Hex, lockId: bigint) {
  return client.readContract({ address: vault, abi: VAULT_ABI, functionName: 'getLock', args: [lockId] })
}

/** Read one lock from the vault and map it to the keeper's LockInput. Returns null when the lock is not triggerable (no unsold target and no trailing stop, or a terminal status). */
export async function readLockInput(client: PublicClient, vault: Hex, lockId: bigint, chain: string): Promise<LockInput | null> {
  const lock = await readRawLock(client, vault, lockId)
  return lockInputFromGetLock(lock, lockId.toString(), chain)
}

/** On-chain 30-min TWAP for a token (already a TWAP — the keeper uses it as its single price point; see index.ts). Returns USD as a float. */
export async function readTwapUsd(client: PublicClient, feed: Hex, token: Hex, windowSeconds = 1800): Promise<number> {
  const twap = await client.readContract({ address: feed, abi: FEED_ABI, functionName: 'twapPrice', args: [token, BigInt(windowSeconds)] })
  return Number(twap) / 1e18
}

/** Quote the next due stage's swap via the router adapter. Returns null when the router has no quoter configured (getAmountsOut reverts) — the keeper then retries instead of forcing a sell. */
export async function simulateStageSwap(
  client: PublicClient, router: Hex, lock: LockInput, lockRaw: { amountTotal: bigint; nextSellBps: number; stablecoin: Hex; stablecoinDecimals: number; tokenDecimals: number }, twapUsd: number,
): Promise<SwapSimulation | null> {
  const stageAmount = nextStageAmount(lockRaw.amountTotal, lockRaw.nextSellBps)
  if (stageAmount === 0n) return null
  try {
    const amounts = await client.readContract({
      address: router, abi: ROUTER_ABI, functionName: 'getAmountsOut',
      args: [stageAmount, [lock.token as Hex, lockRaw.stablecoin]],
    })
    const expectedOut = Number(amounts[1] ?? 0n)
    return {
      expectedOut,
      priceImpactBps: impactVsTwap(expectedOut, stageAmount, twapUsd, lockRaw.tokenDecimals, lockRaw.stablecoinDecimals),
      reserveIn: 0, // V3 has no pair reserves; impact is measured vs the TWAP reference
      reserveOut: 0,
    }
  } catch {
    return null
  }
}

/** Minimal ERC-20 decimals() read (needed to convert a stage amount to whole tokens for the TWAP comparison). */
export async function readTokenDecimals(client: PublicClient, token: Hex): Promise<number> {
  const decimals = await client.readContract({
    address: token,
    abi: [{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }] as const,
    functionName: 'decimals',
  })
  return Number(decimals)
}

/** Keeper write path: poke the peak first (separate tx — a reverted trigger must not roll the peak update back), then execute the trigger. Returns the trigger tx hash. */
export async function sendTrigger(
  publicClient: PublicClient, wallet: WalletClient, vault: Hex, lockId: bigint,
): Promise<{ txHash: string }> {
  const pokeHash = await wallet.writeContract({ address: vault, abi: VAULT_ABI, functionName: 'pokePrice', args: [lockId], chain: wallet.chain ?? undefined } as never)
  await publicClient.waitForTransactionReceipt({ hash: pokeHash })
  const txHash = await wallet.writeContract({ address: vault, abi: VAULT_ABI, functionName: 'executeTrigger', args: [lockId], chain: wallet.chain ?? undefined } as never)
  await publicClient.waitForTransactionReceipt({ hash: txHash })
  return { txHash }
}
