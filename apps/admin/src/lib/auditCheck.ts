// Stelix Admin — automated static audit of StelixVault source.
// Pure TypeScript: runs identically in the Worker (POST /api/admin/audit/run),
// in the browser, and under vitest. It is a thorough pattern checker, NOT a
// substitute for an independent human audit — the Contract Audit page says so
// next to every result. Slither is not installed in this VM, so this checker
// is the automated audit until a Slither/CI run or an external audit exists.
//
// Every finding carries severity, file/line, description, recommendation and
// a fix status ('open' | 'mitigated' | 'accepted'). The overall verdict is
// 'pass' only when there are zero open critical or high findings.
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type FindingStatus = 'open' | 'mitigated' | 'accepted'
export interface AuditFinding {
  id: string
  rule: string
  severity: Severity
  file: string
  line: number
  title: string
  description: string
  recommendation: string
  status: FindingStatus
}
export interface AuditResult {
  sourceHash: string
  compiler: string
  findings: AuditFinding[]
  counts: Record<Severity, number>
  openCriticalHigh: number
  verdict: 'pass' | 'fail'
}

export const AUDIT_COMPILER = 'solc 0.8.24'

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function lineOf(lines: string[], re: RegExp): number {
  const i = lines.findIndex((l) => re.test(l))
  return i === -1 ? 0 : i + 1
}

export function runStaticAudit(source: string, file = 'StelixVault.sol'): AuditResult {
  const lines = source.split('\n')
  const findings: AuditFinding[] = []
  const add = (
    rule: string,
    severity: Severity,
    line: number,
    title: string,
    description: string,
    recommendation: string,
    status: FindingStatus = 'open',
  ) => {
    findings.push({
      id: `${rule}-${findings.length + 1}`,
      rule,
      severity,
      file,
      line,
      title,
      description,
      recommendation,
      status,
    })
  }
  const has = (re: RegExp) => lines.some((l) => re.test(l))

  // 1. tx.origin — never acceptable for authorisation.
  lines.forEach((l, i) => {
    if (/tx\.origin/.test(l)) {
      add('TX_ORIGIN', 'critical', i + 1, 'tx.origin used for authorisation',
        'tx.origin can be spoofed by a malicious contract in the call chain and must never gate access.',
        'Replace with msg.sender checks (onlyOwner / onlyKeeper / lock-owner checks).')
    }
  })
  // 2. selfdestruct / delegatecall / callcode — destructive or code-injection primitives.
  lines.forEach((l, i) => {
    if (/selfdestruct\s*\(/.test(l)) add('SELFDESTRUCT', 'critical', i + 1, 'selfdestruct present', 'selfdestruct can destroy the vault and strand locked funds.', 'Remove it. There is no legitimate use in a non-upgradeable vault.')
    if (/delegatecall\s*\(/.test(l)) add('DELEGATECALL', 'critical', i + 1, 'delegatecall present', 'delegatecall runs foreign code in the vault storage context.', 'Remove it; the vault must never execute untrusted code.')
    if (/callcode\s*\(/.test(l)) add('CALLCODE', 'critical', i + 1, 'callcode present', 'callcode is deprecated and unsafe.', 'Remove it.')
  })
  // 3. No admin drain / rescue / withdraw function may exist.
  lines.forEach((l, i) => {
    if (/function\s+(withdraw|drain|rescue|emergencyWithdraw|sweep)\s*\(/.test(l)) {
      add('ADMIN_DRAIN', 'critical', i + 1, 'Admin withdrawal function present',
        'A drain/rescue function lets the owner move user-locked funds, breaking the non-custodial promise.',
        'Remove the function. Locked funds may only leave via lock-owner or keeper-triggered exits to the lock owner.')
    }
  })
  // 4. Reentrancy guard on every fund-moving function.
  const fundFns = ['createLock', 'claimMatured', 'executeTrigger', 'claimTriggeredStage', 'executeBreak']
  for (const fn of fundFns) {
    const defIdx = lines.findIndex((l) => new RegExp(`function\\s+${fn}\\s*\\(`).test(l))
    if (defIdx === -1) continue
    const sig = lines.slice(defIdx, Math.min(defIdx + 4, lines.length)).join(' ')
    if (!/nonReentrant/.test(sig)) {
      add('REENTRANCY_GUARD', 'high', defIdx + 1, `${fn} is missing the reentrancy guard`,
        `${fn} moves funds but does not carry the nonReentrant modifier.`,
        'Add nonReentrant and keep checks-effects-interactions ordering (state updates before external calls).')
    }
  }
  // 5. Low-level .call without a checked return value.
  lines.forEach((l, i) => {
    if (/\.call\s*(\{|\()/.test(l) && !/require\s*\(.*\.call/.test(l) && !/\(bool/.test(l)) {
      add('UNCHECKED_CALL', 'high', i + 1, 'Low-level call without a checked return value',
        'A failed low-level call that is not checked can silently leave state inconsistent.',
        'Check the returned success flag with require, or avoid low-level calls entirely.')
    }
  })
  // 6. ERC-20 transfer / transferFrom return values must be checked.
  // A transfer counts as checked when it sits inside a require(...) span,
  // including the multi-line form:
  //   require(
  //     IERC20(token).transferFrom(...),
  //     "reason"
  //   );
  const requireSpans: [number, number][] = []
  {
    let searchFrom = 0
    for (;;) {
      const idx = source.indexOf('require(', searchFrom)
      if (idx === -1) break
      let depth = 0
      let end = idx
      for (let i = idx; i < source.length; i++) {
        if (source[i] === '(') depth++
        else if (source[i] === ')') {
          depth--
          if (depth === 0) { end = i; break }
        }
      }
      requireSpans.push([idx, end])
      searchFrom = end + 1
    }
  }
  let offset = 0
  lines.forEach((l, i) => {
    const m = /\.(transfer|transferFrom)\s*\(/.exec(l)
    if (m) {
      const absIndex = offset + m.index
      const checked = requireSpans.some(([s, e]) => absIndex >= s && absIndex <= e)
      if (!checked) {
        add('UNCHECKED_TRANSFER', 'medium', i + 1, 'ERC-20 transfer return value not checked',
          'Some tokens return false instead of reverting; an unchecked transfer can silently fail.',
          'Wrap the call in require(...) as the rest of the vault does.')
      }
    }
    offset += l.length + 1
  })
  // 7. Fee cap: auto-sell fee must be capped at 1000 bps (10%).
  if (!/autoSellFeeBps\s*<=\s*1000|_feeBps\s*<=\s*1000|feeBps\s*<=\s*1000/.test(source)) {
    add('FEE_CAP', 'high', lineOf(lines, /autoSellFeeBps|setAutoSellFee/), 'Auto-sell fee has no 10% cap',
      'Without a cap, a future owner could set a fee that takes most of an auto-sell payout.',
      'Enforce require(_feeBps <= 1000) in the constructor and in setAutoSellFee.')
  }
  // 8. Slippage cap enforced at lock creation.
  if (!/slippageBps\s*>\s*MAX_SLIPPAGE_BPS/.test(source)) {
    add('SLIPPAGE_CAP', 'medium', lineOf(lines, /slippageBps/), 'Slippage is not capped at lock creation',
      'An unbounded slippage setting lets a lock be created that can be sold at any price.',
      'Enforce slippageBps <= MAX_SLIPPAGE_BPS (5000) in createLock.')
  }
  // 9. Single price feed, no fallback oracle.
  if (/priceFeed/.test(source) && !/fallback|secondaryFeed|backupFeed/i.test(source)) {
    add('PRICE_FEED_TRUST', 'medium', lineOf(lines, /address public priceFeed/), 'Single price feed with no fallback oracle',
      'All triggers depend on one IPriceFeed. A stale, paused or compromised feed can delay or mis-fire auto-sells (fail-safe: a revert leaves locks untouched, but a wrong-but-plausible TWAP would still execute).',
      'Add a fallback feed / staleness check (latestPrice age, TWAP sanity band) or a Chainlink feed where one exists for the token, before mainnet.')
  }
  // 10. Pragma must pin solc 0.8.24.
  if (!/pragma solidity \^?0\.8\.24;/.test(source)) {
    add('PRAGMA', 'medium', lineOf(lines, /pragma solidity/), 'Compiler version is not pinned to solc 0.8.24',
      'A floating pragma can compile with a different compiler than the audited artifact.',
      'Use `pragma solidity 0.8.24;` and compile with the pinned solc 0.8.24 build.')
  }
  // 11. Zero-address checks in the constructor.
  const ctorIdx = lines.findIndex((l) => /constructor\s*\(/.test(l))
  if (ctorIdx !== -1) {
    const ctor = lines.slice(ctorIdx, ctorIdx + 30).join('\n')
    const missing: string[] = []
    if (!/keeper\s*!=\s*address\(0\)/.test(ctor)) missing.push('keeper')
    if (!/penaltyRecipient\s*!=\s*address\(0\)/.test(ctor)) missing.push('penaltyRecipient')
    if (!/feeRecipient\s*!=\s*address\(0\)/.test(ctor)) missing.push('feeRecipient')
    if (missing.length > 0) {
      add('ZERO_ADDRESS_CTOR', 'low', ctorIdx + 1, `Constructor does not reject zero address for: ${missing.join(', ')}`,
        'A zero keeper disables keeper triggers until setKeeper is called; a zero penalty/fee recipient silently redirects those payments to the owner fallback or burns them.',
        'Add require(_keeper != address(0)) (and for penalty/fee recipients, or document explicitly that zero means "disabled / falls back to owner").')
    }
  }
  // 12. Allowance pattern: approve before swap must be reset to zero afterwards.
  if (/\.approve\s*\(/.test(source) && !/approve\s*\([^,]+,\s*0\s*\)/.test(source)) {
    add('APPROVE_RESET', 'medium', lineOf(lines, /\.approve\s*\(/), 'Token allowance is not reset to zero after the swap',
      'Leaving an allowance open lets a compromised or upgraded router spend vault funds later.',
      'Reset the allowance to 0 after each swap, as _exitStage already does — keep that pattern on every new approve.')
  }
  // 13. Ladder stage count is not capped — unbounded loop in executeTrigger.
  if (!/ladderStages\.length\s*(<=|<)\s*\d/.test(source)) {
    add('UNBOUNDED_LADDER', 'low', lineOf(lines, /function createLock/), 'Ladder stage count is not capped in createLock',
      'executeTrigger loops over every ladder stage; a lock created with very many stages could exceed the block gas limit and become un-triggerable.',
      'Cap ladder stages (e.g. require(p.ladderStages.length <= 8)) in createLock.')
  }
  // 14. Access control: admin setters must be onlyOwner, keeper functions onlyKeeper.
  const adminSetters = ['setKeeper', 'setRouter', 'setPriceFeed', 'setPenaltyRecipient', 'setAutoSellFee', 'pauseNewLocks', 'transferOwnership']
  for (const fn of adminSetters) {
    const defIdx = lines.findIndex((l) => new RegExp(`function\\s+${fn}\\s*\\(`).test(l))
    if (defIdx === -1) continue
    const sig = lines.slice(defIdx, Math.min(defIdx + 4, lines.length)).join(' ')
    if (!/onlyOwner/.test(sig)) {
      add('ACCESS_CONTROL', 'high', defIdx + 1, `${fn} is missing onlyOwner`,
        `${fn} changes vault configuration but is not restricted to the owner.`,
        'Add the onlyOwner modifier.')
    }
  }
  for (const fn of ['executeTrigger', 'pokePrice']) {
    const defIdx = lines.findIndex((l) => new RegExp(`function\\s+${fn}\\s*\\(`).test(l))
    if (defIdx === -1) continue
    const sig = lines.slice(defIdx, Math.min(defIdx + 4, lines.length)).join(' ')
    if (!/onlyKeeper/.test(sig)) {
      add('ACCESS_CONTROL', 'high', defIdx + 1, `${fn} is missing onlyKeeper`,
        `${fn} must only be callable by the keeper.`,
        'Add the onlyKeeper modifier.')
    }
  }
  // 15. Checks-effects-interactions: stage must be marked sold before the swap.
  const soldLine = lineOf(lines, /ladderStages\[i\]\.sold = true/)
  const swapLine = lineOf(lines, /swapExactTokensForTokens/)
  if (soldLine > 0 && swapLine > 0 && soldLine > swapLine) {
    add('CEI_ORDER', 'high', swapLine, 'Swap happens before the stage is marked sold',
      'External calls before state updates open a reentrancy window.',
      'Mark the stage sold and reduce amountRemaining before calling the router.')
  }
  // 16. Owner powers — informational inventory (not a vulnerability by itself).
  const ownerFns = adminSetters.filter((fn) => lines.some((l) => new RegExp(`function\\s+${fn}\\s*\\(`).test(l)))
  if (ownerFns.length > 0) {
    add('OWNER_POWERS', 'info', lineOf(lines, /address public owner/), 'Owner powers inventory',
      `onlyOwner functions: ${ownerFns.join(', ')}. None of these can move locked funds (there is no drain function), but a compromised owner could pause new locks, change the keeper/router/price feed, or raise the fee for new locks (capped at 10%).`,
      'Use a multisig owner in production and keep the fee cap; consider timelocking config changes before mainnet.',
      'accepted')
  }
  // 17. Guardian break is Phase 2 — informational, so users are not misled.
  if (/GuardianBreakNotEnabled/.test(source)) {
    add('GUARDIAN_PHASE2', 'info', lineOf(lines, /GuardianBreakNotEnabled/), 'Guardian break is not enabled yet',
      'Guardian break requests are recorded but execution always reverts until Phase 2 ships. The app must not offer it as a working break mode.',
      'Keep Guardian hidden in the app until the Phase 2 implementation and audit land.',
      'accepted')
  }

  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  for (const f of findings) counts[f.severity]++
  const openCriticalHigh = findings.filter(
    (f) => (f.severity === 'critical' || f.severity === 'high') && f.status === 'open',
  ).length
  return {
    sourceHash: '',
    compiler: AUDIT_COMPILER,
    findings,
    counts,
    openCriticalHigh,
    verdict: openCriticalHigh === 0 ? 'pass' : 'fail',
  }
}
