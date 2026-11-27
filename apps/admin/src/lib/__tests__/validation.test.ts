import { describe, expect, it } from 'vitest'
import { DEFAULT_FEES, validateFeePayload } from '../fees'
import { isAddress, isTxHash, mainnetConfirmPhrase, testnetChainIdFor, validateDeployParams } from '../deployParams'

describe('validateFeePayload', () => {
  it('accepts the defaults', () => {
    const { config, errors } = validateFeePayload(DEFAULT_FEES)
    expect(errors).toEqual([])
    expect(config?.autoSellFeePct).toBe(1)
  })

  it('rejects an auto-sell fee above 10%', () => {
    const { config, errors } = validateFeePayload({ ...DEFAULT_FEES, autoSellFeePct: 25 })
    expect(config).toBeNull()
    expect(errors.join(' ')).toMatch(/autoSellFeePct/)
  })

  it('rejects a penalty outside 5–10% and max lock below min lock', () => {
    const { errors } = validateFeePayload({ ...DEFAULT_FEES, defaultPenaltyPct: 2, minLockUsd: 500, maxLockUsd: 100 })
    expect(errors.some((e) => e.includes('defaultPenaltyPct'))).toBe(true)
    expect(errors.some((e) => e.includes('maxLockUsd'))).toBe(true)
  })

  it('rejects a bad penalty destination', () => {
    const { config } = validateFeePayload({ ...DEFAULT_FEES, penaltyDestination: 'owner-pocket' })
    expect(config).toBeNull()
  })
})

describe('validateDeployParams', () => {
  const good = {
    chainId: 'arc', env: 'testnet',
    owner: '0x1111111111111111111111111111111111111111',
    keeper: '0x2222222222222222222222222222222222222222',
    router: '0x3333333333333333333333333333333333333333',
    priceFeed: '0x4444444444444444444444444444444444444444',
    penaltyRecipient: '0x5555555555555555555555555555555555555555',
    feeRecipient: '0x6666666666666666666666666666666666666666',
    autoSellFeeBps: 100,
  }
  it('accepts a complete, valid testnet parameter set', () => {
    const { params, errors } = validateDeployParams(good)
    expect(errors).toEqual([])
    expect(params?.chainId).toBe('arc')
  })

  it('rejects a fee above 1000 bps and a malformed address', () => {
    const { errors } = validateDeployParams({ ...good, autoSellFeeBps: 1001, router: 'not-an-address' })
    expect(errors.some((e) => e.includes('autoSellFeeBps'))).toBe(true)
    expect(errors.some((e) => e.includes('router'))).toBe(true)
  })

  it('rejects mainnet as an env typo and a bad tx hash', () => {
    const { errors } = validateDeployParams({ ...good, env: 'main', txHash: '0x1234' })
    expect(errors.some((e) => e.includes('env'))).toBe(true)
    expect(errors.some((e) => e.includes('txHash'))).toBe(true)
  })

  it('builds the exact typed mainnet confirmation phrase', () => {
    expect(mainnetConfirmPhrase('Arc')).toBe('Deploy StelixVault to Arc mainnet')
    expect(mainnetConfirmPhrase('BNB Smart Chain')).toBe('Deploy StelixVault to BNB Smart Chain mainnet')
    // A chain already named "... Mainnet" must not get a doubled suffix.
    expect(mainnetConfirmPhrase('Arc Mainnet')).toBe('Deploy StelixVault to Arc Mainnet')
  })

  it('maps a mainnet chain slug to its testnet counterpart', () => {
    expect(testnetChainIdFor('arc-mainnet')).toBe('arc')
    expect(testnetChainIdFor('arc')).toBe('arc')
    expect(testnetChainIdFor('bnb')).toBe('bnb')
  })

  it('validates addresses and tx hashes', () => {
    expect(isAddress('0x3600000000000000000000000000000000000000')).toBe(true)
    expect(isAddress('0xZZZ')).toBe(false)
    expect(isTxHash('0x' + 'a'.repeat(64))).toBe(true)
    expect(isTxHash('0xabc')).toBe(false)
  })
})
