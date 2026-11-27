import { describe, expect, it } from 'vitest'
import { evmTestnetFor, testnetIdForFamily } from '../evmNetworks'

describe('EVM testnet registry (verified 2026-11-27)', () => {
  it('maps every EVM family to its testnet row, Solana to none', () => {
    expect(testnetIdForFamily('arc')).toBe('arc')
    expect(testnetIdForFamily('bnb')).toBe('bnb-testnet')
    expect(testnetIdForFamily('base')).toBe('base-sepolia')
    expect(testnetIdForFamily('ethereum')).toBe('ethereum-sepolia')
    expect(testnetIdForFamily('polygon')).toBe('polygon-amoy')
    expect(testnetIdForFamily('solana')).toBeNull()
  })

  it('BNB Testnet uses the V2 router directly, with the V2 TWAP feed', () => {
    const n = evmTestnetFor('bnb-testnet')
    expect(n?.chainId).toBe(97)
    expect(n?.routerKind).toBe('v2')
    expect(n?.feedKind).toBe('v2-twap')
    expect(n?.dexRouter).toBe('0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3')
    expect(n?.stablecoin).toBe('BUSD')
    expect(n?.stablecoinDecimals).toBe(18)
  })

  it('Ethereum Sepolia uses the corrected V2 router, never the mainnet one', () => {
    const n = evmTestnetFor('ethereum-sepolia')
    expect(n?.chainId).toBe(11155111)
    expect(n?.routerKind).toBe('v2')
    expect(n?.dexRouter).toBe('0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3')
    expect(n?.dexRouter).not.toBe('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D')
    expect(n?.stablecoinAddress).toBe('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238')
  })

  it('Base Sepolia is V3-only, with the verified V3 router and USDC', () => {
    const n = evmTestnetFor('base-sepolia')
    expect(n?.chainId).toBe(84532)
    expect(n?.routerKind).toBe('v3')
    expect(n?.feedKind).toBe('v3-twap')
    expect(n?.dexRouter).toBe('0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4')
    expect(n?.stablecoinAddress).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e')
  })

  it('Polygon Amoy has no verified router and is blocked from deploying', () => {
    const n = evmTestnetFor('polygon-amoy')
    expect(n?.chainId).toBe(80002)
    expect(n?.routerKind).toBe('none')
    expect(n?.dexRouter).toBe('')
    expect(n?.blocker).toMatch(/No verified V3 router/)
  })
})
