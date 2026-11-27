import { describe, expect, it } from 'vitest'
import { validateChainInput } from '../chainValidation'

const GOOD = {
  id: 'arbitrum',
  name: 'Arbitrum One',
  chainId: 42161,
  rpcUrls: 'https://arb1.arbitrum.io/rpc',
  explorerUrl: 'https://arbiscan.io',
  nativeToken: 'ETH',
  nativeDecimals: 18,
  stablecoin: 'USDC',
  stablecoinAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  stablecoinDecimals: 6,
  gasToken: 'ETH',
  dexRouter: '',
  vaultAddress: '',
  status: 'testnet',
  isTestnet: true,
  active: true,
  pairedChainId: '',
  isDefault: false,
}

describe('validateChainInput (create)', () => {
  it('accepts a complete valid chain and normalises it', () => {
    const { value, errors } = validateChainInput(GOOD)
    expect(errors).toEqual({})
    expect(value?.id).toBe('arbitrum')
    expect(value?.chainId).toBe(42161)
    expect(value?.rpcUrls).toEqual(['https://arb1.arbitrum.io/rpc'])
    expect(value?.stablecoin).toBe('USDC')
    expect(value?.stablecoinDecimals).toBe(6)
    expect(value?.isTestnet).toBe(true)
    expect(value?.active).toBe(true)
  })

  it('defaults gas token to the native currency and stablecoin decimals to 6', () => {
    const { value } = validateChainInput({ ...GOOD, gasToken: '', stablecoinDecimals: undefined })
    expect(value?.gasToken).toBe('ETH')
  })

  it('rejects a non-numeric chain id, zero and fractions', () => {
    for (const chainId of ['not-a-number', 0, -1, 1.5, '']) {
      const { value, errors } = validateChainInput({ ...GOOD, chainId })
      expect(value).toBeNull()
      expect(errors.chainId).toMatch(/chain id/)
    }
  })

  it('accepts a numeric-string chain id', () => {
    const { value } = validateChainInput({ ...GOOD, chainId: '42161' })
    expect(value?.chainId).toBe(42161)
  })

  it('rejects http (non-https) RPC and explorer URLs', () => {
    const badRpc = validateChainInput({ ...GOOD, rpcUrls: 'http://arb1.arbitrum.io/rpc' })
    expect(badRpc.value).toBeNull()
    expect(badRpc.errors.rpcUrls).toMatch(/https/)
    const badExplorer = validateChainInput({ ...GOOD, explorerUrl: 'http://arbiscan.io' })
    expect(badExplorer.value).toBeNull()
    expect(badExplorer.errors.explorerUrl).toMatch(/https/)
    const badOneOfMany = validateChainInput({ ...GOOD, rpcUrls: 'https://arb1.arbitrum.io/rpc, http://evil.example/rpc' })
    expect(badOneOfMany.value).toBeNull()
    expect(badOneOfMany.errors.rpcUrls).toMatch(/https/)
  })

  it('rejects malformed EVM addresses but allows blank router/vault/stablecoin', () => {
    const badStable = validateChainInput({ ...GOOD, stablecoinAddress: '0x1234' })
    expect(badStable.value).toBeNull()
    expect(badStable.errors.stablecoinAddress).toMatch(/0x address/)
    const badRouter = validateChainInput({ ...GOOD, dexRouter: 'not-an-address' })
    expect(badRouter.value).toBeNull()
    expect(badRouter.errors.dexRouter).toMatch(/0x address/)
    const badVault = validateChainInput({ ...GOOD, vaultAddress: '0xZZZ' })
    expect(badVault.value).toBeNull()
    expect(badVault.errors.vaultAddress).toMatch(/0x address/)
    const blankOk = validateChainInput({ ...GOOD, stablecoinAddress: '', dexRouter: '', vaultAddress: '' })
    expect(blankOk.value?.stablecoinAddress).toBe('')
    expect(blankOk.value?.dexRouter).toBe('')
    expect(blankOk.value?.vaultAddress).toBeNull()
  })

  it('accepts verified launchpad + factory addresses, rejects malformed ones, blanks to null', () => {
    const good = validateChainInput({
      ...GOOD,
      launchpadAddress: '0x1111111111111111111111111111111111111111',
      tokenFactoryAddress: '0x2222222222222222222222222222222222222222',
    })
    expect(good.errors).toEqual({})
    expect(good.value?.launchpadAddress).toBe('0x1111111111111111111111111111111111111111')
    expect(good.value?.tokenFactoryAddress).toBe('0x2222222222222222222222222222222222222222')
    const badLaunchpad = validateChainInput({ ...GOOD, launchpadAddress: '0xZZZ' })
    expect(badLaunchpad.value).toBeNull()
    expect(badLaunchpad.errors.launchpadAddress).toMatch(/0x address/)
    const badFactory = validateChainInput({ ...GOOD, tokenFactoryAddress: 'guess-me' })
    expect(badFactory.value).toBeNull()
    expect(badFactory.errors.tokenFactoryAddress).toMatch(/0x address/)
    const blank = validateChainInput({ ...GOOD, launchpadAddress: '', tokenFactoryAddress: '' })
    expect(blank.value?.launchpadAddress).toBeNull()
    expect(blank.value?.tokenFactoryAddress).toBeNull()
    // Partial updates validate only the supplied launchpad fields.
    const partial = validateChainInput({ launchpadAddress: '0x1111111111111111111111111111111111111111' }, { partial: true })
    expect(partial.errors).toEqual({})
    expect(partial.value?.launchpadAddress).toBe('0x1111111111111111111111111111111111111111')
  })

  it('rejects a bad slug (spaces, uppercase-only shapes, too short)', () => {
    for (const id of ['Bad Slug', 'a', 'has_underscore', '']) {
      const { value, errors } = validateChainInput({ ...GOOD, id })
      expect(value).toBeNull()
      expect(errors.id).toMatch(/slug/)
    }
  })

  it('rejects decimals outside 0-18 and a bad status', () => {
    expect(validateChainInput({ ...GOOD, nativeDecimals: 19 }).value).toBeNull()
    expect(validateChainInput({ ...GOOD, stablecoinDecimals: -1 }).value).toBeNull()
    expect(validateChainInput({ ...GOOD, status: 'soon' }).value).toBeNull()
  })

  it('rejects a chain paired with itself', () => {
    const { value, errors } = validateChainInput({ ...GOOD, pairedChainId: 'arbitrum' })
    expect(value).toBeNull()
    expect(errors.pairedChainId).toMatch(/itself/)
  })

  it('requires name, RPC, explorer, native token and stablecoin', () => {
    for (const patch of [{ name: '' }, { rpcUrls: '' }, { explorerUrl: '' }, { nativeToken: '' }, { stablecoin: '' }]) {
      expect(validateChainInput({ ...GOOD, ...patch }).value).toBeNull()
    }
  })
})

describe('validateChainInput (partial update)', () => {
  it('validates only the supplied fields', () => {
    const { value, errors } = validateChainInput({ status: 'paused' }, { partial: true })
    expect(errors).toEqual({})
    expect(value?.status).toBe('paused')
    expect(value?.name).toBeUndefined()
  })

  it('rejects a bad value in a partial update', () => {
    const { value, errors } = validateChainInput({ stablecoinAddress: '0x1234' }, { partial: true })
    expect(value).toBeNull()
    expect(errors.stablecoinAddress).toMatch(/0x address/)
  })

  it('derives isTestnet from a testnet status when the flag is absent', () => {
    const { value } = validateChainInput({ status: 'testnet' }, { partial: true })
    expect(value?.isTestnet).toBe(true)
    const live = validateChainInput({ status: 'live' }, { partial: true })
    expect(live.value?.isTestnet).toBe(false)
  })
})
