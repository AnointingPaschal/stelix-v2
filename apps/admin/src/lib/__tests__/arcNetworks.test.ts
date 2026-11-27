import { describe, expect, it } from 'vitest'
import { ARC_MAINNET, ARC_TESTNET, ARC_USDC, arcNetworkFor } from '../arcNetworks'

describe('Arc network parameters (verified against docs.arc.io)', () => {
  it('testnet: chain 5042002 on the new .arc.io endpoints', () => {
    expect(ARC_TESTNET.id).toBe('arc')
    expect(ARC_TESTNET.chainId).toBe(5042002)
    expect(ARC_TESTNET.rpcUrl).toBe('https://rpc.testnet.arc.io')
    expect(ARC_TESTNET.explorerUrl).toBe('https://explorer.testnet.arc.io')
    expect(ARC_TESTNET.stablecoin).toBe('USDC')
    expect(ARC_TESTNET.stablecoinAddress).toBe(ARC_USDC)
    expect(ARC_TESTNET.stablecoinDecimals).toBe(6)
    // Full address already in the repo (DeployAdapters.s.sol) — never truncated.
    expect(ARC_TESTNET.dexRouter).toBe('0xfA845604F52843a7b5cfA4030120c6238741F420')
  })

  it('mainnet: chain 5042 on the new .arc.io endpoints', () => {
    expect(ARC_MAINNET.id).toBe('arc-mainnet')
    expect(ARC_MAINNET.chainId).toBe(5042)
    expect(ARC_MAINNET.rpcUrl).toBe('https://rpc.mainnet.arc.io')
    expect(ARC_MAINNET.explorerUrl).toBe('https://explorer.arc.io')
    expect(ARC_MAINNET.stablecoin).toBe('USDC')
    expect(ARC_MAINNET.stablecoinAddress).toBe(ARC_USDC)
    expect(ARC_MAINNET.stablecoinDecimals).toBe(6)
    // Uniswap V3 SwapRouter02 + Factory on Arc mainnet (chain 5042).
    expect(ARC_MAINNET.dexRouter).toBe('0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77')
    expect(ARC_MAINNET.factory).toBe('0xf0db7b58379503491d857dB50AC9ece64c653918')
    expect(ARC_MAINNET.v2Router).toBe('0x1f7d7550B1b028f7571E69A784071F0205FD2EfA')
  })

  it('USDC is the same predeploy on both Arc networks', () => {
    expect(ARC_USDC).toBe('0x3600000000000000000000000000000000000000')
    expect(ARC_TESTNET.stablecoinAddress).toBe(ARC_MAINNET.stablecoinAddress)
  })

  it('arcNetworkFor picks the right network per env', () => {
    expect(arcNetworkFor('testnet')).toBe(ARC_TESTNET)
    expect(arcNetworkFor('mainnet')).toBe(ARC_MAINNET)
  })
})
