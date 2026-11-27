import { describe, expect, it } from 'vitest'
import { evmMainnetFor, evmTestnetFor, mainnetIdForFamily, testnetIdForFamily } from '../evmNetworks'

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

describe('EVM mainnet registry (verified 2026-11-27)', () => {
  it('maps every EVM family to its mainnet row, Solana to none', () => {
    expect(mainnetIdForFamily('arc')).toBe('arc-mainnet')
    expect(mainnetIdForFamily('bnb')).toBe('bnb')
    expect(mainnetIdForFamily('base')).toBe('base')
    expect(mainnetIdForFamily('ethereum')).toBe('ethereum')
    expect(mainnetIdForFamily('polygon')).toBe('polygon')
    expect(mainnetIdForFamily('solana')).toBeNull()
  })

  it('Arc Mainnet is V3 with the verified SwapRouter02', () => {
    const n = evmMainnetFor('arc-mainnet')
    expect(n?.chainId).toBe(5042)
    expect(n?.routerKind).toBe('v3')
    expect(n?.dexRouter).toBe('0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77')
    expect(n?.stablecoinAddress).toBe('0x3600000000000000000000000000000000000000')
  })

  it('BNB Mainnet uses the V2 router directly; its USDT is 18 decimals, not 6', () => {
    const n = evmMainnetFor('bnb')
    expect(n?.chainId).toBe(56)
    expect(n?.routerKind).toBe('v2')
    expect(n?.feedKind).toBe('v2-twap')
    expect(n?.dexRouter).toBe('0x10ED43C718714eb63d5aA57B78B54704E256024E')
    expect(n?.stablecoin).toBe('USDT')
    expect(n?.stablecoinDecimals).toBe(18)
  })

  it('Ethereum Mainnet uses the V2 Router02 that Sepolia must never use', () => {
    const n = evmMainnetFor('ethereum')
    expect(n?.chainId).toBe(1)
    expect(n?.routerKind).toBe('v2')
    expect(n?.dexRouter).toBe('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D')
    expect(n?.stablecoinAddress).toBe('0xdAC17F958D2ee523a2206206994597C13D831ec7')
  })

  it('Base Mainnet uses the corrected V3 SwapRouter02 and the corrected USDC — never the lookalike values', () => {
    const n = evmMainnetFor('base')
    expect(n?.chainId).toBe(8453)
    expect(n?.routerKind).toBe('v3')
    expect(n?.dexRouter).toBe('0x2626664c2603336E57B271c5C0b26F421741e481')
    expect(n?.dexRouter).not.toBe('0x2626664c2603336E57B271c5C0b26F21AB9933d8')
    expect(n?.stablecoinAddress).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
    expect(n?.stablecoinAddress).not.toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bd029029')
  })

  it('Polygon Mainnet uses SwapRouter02, never the v1 router, and POL gas', () => {
    const n = evmMainnetFor('polygon')
    expect(n?.chainId).toBe(137)
    expect(n?.routerKind).toBe('v3')
    expect(n?.dexRouter).toBe('0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45')
    expect(n?.dexRouter).not.toBe('0xE592427A0AEce92De3Edee1F18E0157C05861564')
    expect(n?.nativeSymbol).toBe('POL')
    expect(n?.stablecoinAddress).toBe('0xc2132D05D31c914a87C6611C10748AEb04B58e8F')
  })

  it('every mainnet entry has a verified router and a real stablecoin', () => {
    for (const id of ['arc-mainnet', 'bnb', 'base', 'ethereum', 'polygon']) {
      const n = evmMainnetFor(id)
      expect(n?.env).toBe('mainnet')
      expect(n?.routerKind).not.toBe('none')
      expect(n?.dexRouter).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(n?.stablecoinAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
    }
  })
})
