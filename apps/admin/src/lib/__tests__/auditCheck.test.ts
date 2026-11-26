import { describe, expect, it } from 'vitest'
import { runStaticAudit, sha256Hex } from '../auditCheck'
import source from '../../contracts/StelixVault.sol?raw'

describe('runStaticAudit on the exact StelixVault source', () => {
  const result = runStaticAudit(source)

  it('passes with zero open critical/high findings', () => {
    expect(result.counts.critical).toBe(0)
    expect(result.counts.high).toBe(0)
    expect(result.openCriticalHigh).toBe(0)
    expect(result.verdict).toBe('pass')
  })

  it('flags the single price feed as a medium finding', () => {
    const f = result.findings.find((x) => x.rule === 'PRICE_FEED_TRUST')
    expect(f).toBeDefined()
    expect(f?.severity).toBe('medium')
    expect(f?.file).toBe('StelixVault.sol')
    expect(f?.line).toBeGreaterThan(0)
    expect(f?.status).toBe('open')
  })

  it('flags missing zero-address checks and the uncapped ladder as low findings', () => {
    expect(result.findings.some((x) => x.rule === 'ZERO_ADDRESS_CTOR' && x.severity === 'low')).toBe(true)
    expect(result.findings.some((x) => x.rule === 'UNBOUNDED_LADDER' && x.severity === 'low')).toBe(true)
  })

  it('records the owner-powers inventory as accepted info, not an open issue', () => {
    const f = result.findings.find((x) => x.rule === 'OWNER_POWERS')
    expect(f?.severity).toBe('info')
    expect(f?.status).toBe('accepted')
  })

  it('produces the same sha256 as the compiled artifact source hash', async () => {
    const hash = await sha256Hex(source)
    expect(hash).toBe('0b5e90fcf6bc5d0592ccecd1aa41e83fbc880ef844c3ad4eaee9adcecc6f0646')
  })
})

describe('runStaticAudit catches injected vulnerabilities', () => {
  it('fails on tx.origin', () => {
    const bad = source.replace('require(msg.sender == owner', 'require(tx.origin == owner')
    const r = runStaticAudit(bad)
    expect(r.findings.some((x) => x.rule === 'TX_ORIGIN' && x.severity === 'critical')).toBe(true)
    expect(r.verdict).toBe('fail')
  })

  it('fails on selfdestruct', () => {
    const bad = source + '\n    function destroy() external onlyOwner { selfdestruct(payable(owner)); }\n'
    const r = runStaticAudit(bad)
    expect(r.findings.some((x) => x.rule === 'SELFDESTRUCT' && x.severity === 'critical')).toBe(true)
    expect(r.verdict).toBe('fail')
  })

  it('fails on delegatecall', () => {
    const bad = source.replace('contract StelixVault {', 'contract StelixVault {\n    function evil(address t, bytes memory d) external { (bool ok,) = t.delegatecall(d); require(ok); }')
    const r = runStaticAudit(bad)
    expect(r.findings.some((x) => x.rule === 'DELEGATECALL' && x.severity === 'critical')).toBe(true)
    expect(r.verdict).toBe('fail')
  })

  it('fails when the fee cap is removed', () => {
    const bad = source.replace('require(_autoSellFeeBps <= 1000, "fee too high"); // <= 10%', '')
    const r = runStaticAudit(bad)
    // The constructor cap is gone but setAutoSellFee still caps; the checker
    // looks for any cap, so removing only one must not fail the check.
    expect(r.findings.some((x) => x.rule === 'FEE_CAP')).toBe(false)
    const worse = bad.replace('require(_feeBps <= 1000, "fee too high");', '')
    const r2 = runStaticAudit(worse)
    expect(r2.findings.some((x) => x.rule === 'FEE_CAP' && x.severity === 'high')).toBe(true)
    expect(r2.verdict).toBe('fail')
  })

  it('still catches a genuinely unchecked transfer', () => {
    const bad = source.replace(
      'require(IERC20(l.token).transfer(l.owner, amount), "StelixVault: payout failed");',
      'IERC20(l.token).transfer(l.owner, amount);',
    )
    const r = runStaticAudit(bad)
    expect(r.findings.some((x) => x.rule === 'UNCHECKED_TRANSFER' && x.severity === 'medium')).toBe(true)
    expect(r.verdict).toBe('pass') // medium findings do not fail the verdict
  })

  it('fails when a fund-moving function loses its reentrancy guard', () => {
    const bad = source.replace(
      'function claimMatured(uint256 lockId) external nonReentrant {',
      'function claimMatured(uint256 lockId) external {',
    )
    const r = runStaticAudit(bad)
    expect(r.findings.some((x) => x.rule === 'REENTRANCY_GUARD' && x.title.includes('claimMatured'))).toBe(true)
    expect(r.verdict).toBe('fail')
  })
})
