import { describe, expect, it } from 'vitest'
import { validateDeployPreset } from '../deployPresets'

const OWNER = '0xCca907AE079DB7638A4d2D3e82defaea5FBDF383'

describe('validateDeployPreset', () => {
  it('accepts a partial preset with blank router / priceFeed (adapters not deployed yet)', () => {
    const { preset, errors } = validateDeployPreset({
      chainId: 'arc', env: 'testnet', owner: OWNER,
      penaltyRecipient: OWNER, feeRecipient: OWNER, autoSellFeeBps: 0,
    })
    expect(errors).toEqual([])
    expect(preset?.owner).toBe(OWNER)
    expect(preset?.router).toBe('')
    expect(preset?.priceFeed).toBe('')
  })
  it('rejects a non-blank address that is not a valid 0x address', () => {
    const { preset, errors } = validateDeployPreset({
      chainId: 'arc', env: 'testnet', owner: OWNER, router: '0xfA845',
    })
    expect(preset).toBeNull()
    expect(errors.join(' ')).toContain('router')
  })
  it('rejects fee above 1000 bps', () => {
    const { preset, errors } = validateDeployPreset({
      chainId: 'arc', env: 'testnet', autoSellFeeBps: 1001,
    })
    expect(preset).toBeNull()
    expect(errors.join(' ')).toContain('autoSellFeeBps')
  })
  it('requires chainId and env', () => {
    const { preset } = validateDeployPreset({})
    expect(preset).toBeNull()
  })
})
