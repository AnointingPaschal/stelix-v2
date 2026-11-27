import { describe, expect, it } from 'vitest'
import {
  buildCircleChallengeRequest,
  DEFAULT_CIRCLE_APP_ID,
  isValidCircleAppId,
  maskAppId,
  parseCircleError,
  validateCircleChallengeInput,
} from '../circle'

describe('Circle validation (Arc only, EOA first)', () => {
  it('rejects a non-Arc blockchain', () => {
    const { value, errors } = validateCircleChallengeInput({
      type: 'createWallet', userId: 'stelix-user-1', blockchain: 'ETH',
    })
    expect(value).toBeNull()
    expect(errors.join(' ')).toMatch(/ARC-TESTNET or ARC/)
  })

  it('accepts ARC-TESTNET and ARC', () => {
    for (const blockchain of ['ARC-TESTNET', 'ARC']) {
      const { value, errors } = validateCircleChallengeInput({
        type: 'createWallet', userId: 'stelix-user-1', blockchain,
      })
      expect(errors).toEqual([])
      expect(value?.blockchain).toBe(blockchain)
    }
  })

  it('rejects an unknown challenge type and a short userId', () => {
    const bad = validateCircleChallengeInput({ type: 'sign', userId: 'stelix-user-1', blockchain: 'ARC-TESTNET' })
    expect(bad.value).toBeNull()
    expect(bad.errors.join(' ')).toMatch(/createWallet, transfer or executeContract/)
    const short = validateCircleChallengeInput({ type: 'createWallet', userId: 'ab', blockchain: 'ARC-TESTNET' })
    expect(short.value).toBeNull()
    expect(short.errors.join(' ')).toMatch(/userId/)
  })

  it('transfer requires destination, amount and a token', () => {
    const base = { type: 'transfer', userId: 'stelix-user-1', blockchain: 'ARC-TESTNET', walletId: 'wallet-1' }
    expect(validateCircleChallengeInput(base).errors.join(' ')).toMatch(/destinationAddress/)
    expect(validateCircleChallengeInput({ ...base, destinationAddress: '0x1111111111111111111111111111111111111111' }).errors.join(' ')).toMatch(/amount/)
    const noToken = validateCircleChallengeInput({
      ...base, destinationAddress: '0x1111111111111111111111111111111111111111', amount: '1.5',
    })
    expect(noToken.errors.join(' ')).toMatch(/tokenId or tokenAddress/)
    const usdc = validateCircleChallengeInput({
      ...base, destinationAddress: '0x1111111111111111111111111111111111111111', amount: '1.5', token: 'USDC',
    })
    expect(usdc.errors).toEqual([])
    expect(usdc.value?.tokenAddress).toBe('0x3600000000000000000000000000000000000000')
    expect(usdc.value?.amounts).toEqual(['1.5'])
  })

  it('executeContract requires a contract address, function and args alias', () => {
    const base = { type: 'executeContract', userId: 'stelix-user-1', blockchain: 'ARC-TESTNET', walletId: 'wallet-1' }
    expect(validateCircleChallengeInput(base).errors.join(' ')).toMatch(/contractAddress/)
    const withFn = validateCircleChallengeInput({
      ...base,
      contractAddress: '0x7777777777777777777777777777777777777777',
      function: 'lock(uint256,uint256)',
      args: ['1000000', '1790000000'],
    })
    expect(withFn.errors).toEqual([])
    expect(withFn.value?.abiFunctionSignature).toBe('lock(uint256,uint256)')
    expect(withFn.value?.abiParameters).toEqual(['1000000', '1790000000'])
  })

  it('maps each challenge type to the exact Circle endpoint, EOA, with an idempotency key', () => {
    const key = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
    const wallet = buildCircleChallengeRequest(
      { type: 'createWallet', userId: 'stelix-user-1', blockchain: 'ARC-TESTNET', feeLevel: 'MEDIUM' }, key,
    )
    expect(wallet.path).toBe('/v1/w3s/user/wallets')
    expect(wallet.body).toEqual({ idempotencyKey: key, accountType: 'EOA', blockchains: ['ARC-TESTNET'], metadata: [{ name: 'Stelix' }] })
    const transfer = buildCircleChallengeRequest(
      { type: 'transfer', userId: 'stelix-user-1', blockchain: 'ARC', walletId: 'w1', destinationAddress: '0x1111111111111111111111111111111111111111', amounts: ['2'], tokenAddress: '0x3600000000000000000000000000000000000000', feeLevel: 'MEDIUM' }, key,
    )
    expect(transfer.path).toBe('/v1/w3s/user/transactions/transfer')
    const exec = buildCircleChallengeRequest(
      { type: 'executeContract', userId: 'stelix-user-1', blockchain: 'ARC-TESTNET', walletId: 'w1', contractAddress: '0x7777777777777777777777777777777777777777', abiFunctionSignature: 'lock(uint256,uint256)', abiParameters: ['1000000'], feeLevel: 'HIGH' }, key,
    )
    expect(exec.path).toBe('/v1/w3s/user/transactions/contractExecution')
    expect(exec.body.abiFunctionSignature).toBe('lock(uint256,uint256)')
  })

  it('masks the App ID and validates its UUID shape', () => {
    expect(maskAppId(null)).toBeNull()
    expect(maskAppId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe('aaaaaaaa…')
    expect(isValidCircleAppId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(true)
    expect(isValidCircleAppId('not-a-uuid')).toBe(false)
    expect(isValidCircleAppId('')).toBe(false)
  })

  it('default App ID is the one the user supplied on 2026-11-27 (public identifier)', () => {
    expect(DEFAULT_CIRCLE_APP_ID).toBe('d15deb9f-8d3c-5c06-be01-de05897d30ea')
    expect(isValidCircleAppId(DEFAULT_CIRCLE_APP_ID)).toBe(true)
    expect(maskAppId(DEFAULT_CIRCLE_APP_ID)).toBe('d15deb9f…')
  })

  it('surfaces Circle error code/message honestly, with an HTTP fallback', () => {
    expect(parseCircleError({ code: 155106, message: 'User already exists.' }, 400)).toEqual({ code: 155106, message: 'User already exists.' })
    expect(parseCircleError(null, 502)).toEqual({ code: 502, message: 'Circle API returned HTTP 502.' })
    expect(parseCircleError({ message: '' }, 401)).toEqual({ code: 401, message: 'Circle API returned HTTP 401.' })
  })
})
