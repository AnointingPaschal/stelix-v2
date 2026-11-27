import { describe, expect, it } from 'vitest'
import { validateDeployParams } from '../deployParams'
import {
  SAFE_FALLBACK_HANDLER, SAFE_PROXY_FACTORY, SAFE_SINGLETON, SAFE_VERSION,
  UNIVERSAL_MULTISIG_CHAIN_ID,
  safeChainFor, thresholdLabel, validateMultisigInput,
} from '../multisig'

const OWNERS = [
  '0x1111111111111111111111111111111111111111',
  '0x2222222222222222222222222222222222222222',
  '0x3333333333333333333333333333333333333333',
]

describe('validateMultisigInput', () => {
  it('accepts a 2-of-3 multisig with no chain — one multisig for all EVM chains', () => {
    const { multisig, errors } = validateMultisigInput({ label: 'Treasury', owners: OWNERS, threshold: 2, saltNonce: '0' })
    expect(errors).toEqual([])
    expect(multisig?.chainId).toBe(UNIVERSAL_MULTISIG_CHAIN_ID)
    expect(multisig?.chainId).toBe('evm')
    expect(multisig?.threshold).toBe(2)
    expect(multisig?.owners).toEqual(OWNERS)
    expect(multisig?.factoryAddress).toBe(SAFE_PROXY_FACTORY)
    expect(multisig?.singletonAddress).toBe(SAFE_SINGLETON)
    expect(multisig?.safeVersion).toBe(SAFE_VERSION)
    expect(thresholdLabel(2, 3)).toBe('2-of-3')
  })

  it('normalises a legacy per-chain chainId to the universal marker', () => {
    for (const chainId of ['bnb', 'ethereum', 'arc', 'arc-mainnet']) {
      const { multisig, errors } = validateMultisigInput({ chainId, owners: OWNERS, threshold: 2 })
      expect(errors).toEqual([])
      expect(multisig?.chainId).toBe('evm')
    }
  })

  it('refuses Solana outright — Safe is EVM-only, no chain selector can pick it', () => {
    const { multisig, errors } = validateMultisigInput({ chainId: 'solana', owners: OWNERS, threshold: 2 })
    expect(multisig).toBeNull()
    expect(errors.some((e) => e.includes('Safe is not available on Solana'))).toBe(true)
  })

  it('accepts 3-of-3 and a 2-owner multisig', () => {
    const full = validateMultisigInput({ chainId: 'ethereum', owners: OWNERS, threshold: 3 })
    expect(full.errors).toEqual([])
    const two = validateMultisigInput({ chainId: 'base', owners: OWNERS.slice(0, 2), threshold: 2 })
    expect(two.errors).toEqual([])
  })

  it('rejects a bad owner address', () => {
    const { multisig, errors } = validateMultisigInput({
      chainId: 'bnb', owners: [OWNERS[0], 'not-an-address', OWNERS[2]], threshold: 2,
    })
    expect(multisig).toBeNull()
    expect(errors.some((e) => e.includes('not-an-address'))).toBe(true)
  })

  it('rejects a threshold greater than the number of owners', () => {
    const { multisig, errors } = validateMultisigInput({ chainId: 'bnb', owners: OWNERS, threshold: 4 })
    expect(multisig).toBeNull()
    expect(errors.some((e) => e.includes('threshold 4 is greater than'))).toBe(true)
  })

  it('rejects threshold 0', () => {
    const { multisig, errors } = validateMultisigInput({ chainId: 'bnb', owners: OWNERS, threshold: 0 })
    expect(multisig).toBeNull()
    expect(errors.some((e) => e.includes('threshold must be at least 1'))).toBe(true)
  })

  it('rejects a duplicate owner, even with different casing', () => {
    const { multisig, errors } = validateMultisigInput({
      chainId: 'bnb',
      owners: [
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '0x2222222222222222222222222222222222222222',
        '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ],
      threshold: 2,
    })
    expect(multisig).toBeNull()
    expect(errors.some((e) => e.includes('duplicate owner'))).toBe(true)
  })

  it('rejects a single-owner "multisig" and the zero address', () => {
    const one = validateMultisigInput({ chainId: 'bnb', owners: [OWNERS[0]], threshold: 1 })
    expect(one.multisig).toBeNull()
    expect(one.errors.some((e) => e.includes('at least 2 owners'))).toBe(true)
    const zero = validateMultisigInput({
      chainId: 'bnb',
      owners: [OWNERS[0], '0x0000000000000000000000000000000000000000'],
      threshold: 1,
    })
    expect(zero.multisig).toBeNull()
    expect(zero.errors.some((e) => e.includes('zero address'))).toBe(true)
  })

  it('rejects a bad predicted address', () => {
    const { multisig, errors } = validateMultisigInput({
      chainId: 'bnb', owners: OWNERS, threshold: 2, predictedAddress: '0x1234',
    })
    expect(multisig).toBeNull()
    expect(errors.some((e) => e.includes('predictedAddress'))).toBe(true)
  })
})

describe('Safe availability per chain', () => {
  it('uses the Safe v1.4.1 canonical addresses (not v1.3.0)', () => {
    expect(SAFE_VERSION).toBe('1.4.1')
    expect(SAFE_SINGLETON).toBe('0x41675C099F32341bf84BFc5382aF534df5C7461a')
    expect(SAFE_PROXY_FACTORY).toBe('0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67')
    expect(SAFE_FALLBACK_HANDLER).toBe('0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99')
    // v1.3.0 factory — must never be used as the v1.4.1 factory.
    expect(SAFE_PROXY_FACTORY).not.toBe('0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2')
  })

  it('supports Ethereum, BNB, Base and Polygon in the Safe web app', () => {
    for (const slug of ['ethereum', 'bnb', 'base', 'polygon']) {
      expect(safeChainFor(slug)?.support).toBe('supported')
    }
  })

  it('marks Arc testnet and mainnet as contracts-on-chain only (no Safe web app)', () => {
    expect(safeChainFor('arc')).toMatchObject({ chainId: 5042002, support: 'contracts-only' })
    expect(safeChainFor('arc-mainnet')).toMatchObject({ chainId: 5042, support: 'contracts-only' })
    // Preparing a multisig needs no chain at all — creation happens via CLI/cast on Arc.
    const { multisig, errors } = validateMultisigInput({ owners: OWNERS, threshold: 2 })
    expect(errors).toEqual([])
    expect(multisig?.chainId).toBe('evm')
  })

  it('refuses Solana: Safe is EVM-only', () => {
    expect(safeChainFor('solana')).toMatchObject({ chainId: 101, support: 'unsupported' })
    const { multisig, errors } = validateMultisigInput({ chainId: 'solana', owners: OWNERS, threshold: 2 })
    expect(multisig).toBeNull()
    expect(errors.some((e) => e.includes('Safe is not available on Solana'))).toBe(true)
  })
})

describe('Contract Studio Owner accepts a created multisig', () => {
  // A deployed Safe is just an address to StelixVault's constructor — the
  // existing deploy-params validator must accept it as Owner, so the
  // one-tap pick in Contract Studio can never be rejected by prepare/register.
  const safeAddress = '0x9B3E9B6B8f3D2C1A4E5F60718293A4B5C6D7E8F9'

  it('accepts the multisig Safe address as the vault Owner', () => {
    const { params, errors } = validateDeployParams({
      chainId: 'bnb', env: 'mainnet',
      owner: safeAddress,
      keeper: '0x2222222222222222222222222222222222222222',
      router: '0x3333333333333333333333333333333333333333',
      priceFeed: '0x4444444444444444444444444444444444444444',
      penaltyRecipient: '0x5555555555555555555555555555555555555555',
      feeRecipient: '0x6666666666666666666666666666666666666666',
      autoSellFeeBps: 100,
    })
    expect(errors).toEqual([])
    expect(params?.owner).toBe(safeAddress)
  })

  it('still rejects a non-address Owner', () => {
    const { errors } = validateDeployParams({
      chainId: 'bnb', env: 'testnet',
      owner: 'my-multisig',
      keeper: '0x2222222222222222222222222222222222222222',
      router: '0x3333333333333333333333333333333333333333',
      priceFeed: '0x4444444444444444444444444444444444444444',
      penaltyRecipient: '0x5555555555555555555555555555555555555555',
      feeRecipient: '0x6666666666666666666666666666666666666666',
      autoSellFeeBps: 100,
    })
    expect(errors.some((e) => e.includes('owner'))).toBe(true)
  })
})
