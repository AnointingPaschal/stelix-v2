import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../index'

describe('admin password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash.startsWith('pbkdf2-sha256$600000$')).toBe(true)
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
    expect(await verifyPassword('wrong password', hash)).toBe(false)
  })

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', '')).toBe(false)
    expect(await verifyPassword('x', 'pbkdf2-sha256$100$abc')).toBe(false)
    expect(await verifyPassword('x', 'pbkdf2-sha256$999$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(false)
  })

  it('produces a different hash each time (random salt) and both verify', async () => {
    const a = await hashPassword('same password here')
    const b = await hashPassword('same password here')
    expect(a).not.toBe(b)
    expect(await verifyPassword('same password here', a)).toBe(true)
    expect(await verifyPassword('same password here', b)).toBe(true)
  })
})
