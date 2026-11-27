import { useCallback, useEffect, useState } from 'react'
import { Ban, Eye, Pause, Play, Radar, RefreshCw, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import { api } from '../lib/api'
import { LiveNote, PageHeader, SectionTitle, StatCard } from '../components/ui'
import { AlertModal } from '../components/AlertModal'

type SecurityEvent = { id: number; category: string; status: string; ip: string; country: string; user_agent: string; method: string; path: string; detail: string; created_at: string }
type SecurityBlock = { id: number; ip: string; reason: string; blocked_by: string; expires_at: string | null; created_at: string }
type AuditCheck = { id: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }
type WatchedContract = { chainId: string; address: string; kind: string; env: string; hasCode: boolean | null; codeNote: string; recentTxCount: number | null; lastTxAt: string | null; txNote: string; checkedAt: string }

const statusBadge = (status: string) => {
  if (status === 'blocked') return <span className="badge b-red">Blocked</span>
  if (status === 'intercepted') return <span className="badge b-amber">Intercepted</span>
  if (status === 'failed') return <span className="badge b-amber">Failed</span>
  if (status === 'success') return <span className="badge b-green">Success</span>
  return <span className="badge b-grey">{status}</span>
}

const fmtTime = (iso: string) => {
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

export default function Cyber() {
  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [blocks, setBlocks] = useState<SecurityBlock[]>([])
  const [checks, setChecks] = useState<AuditCheck[]>([])
  const [contracts, setContracts] = useState<WatchedContract[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [live, setLive] = useState(true)
  const [watching, setWatching] = useState(false)
  const [blockIp, setBlockIp] = useState('')
  const [blockReason, setBlockReason] = useState('')
  const [blockMinutes, setBlockMinutes] = useState('60')
  const [confirmBlock, setConfirmBlock] = useState<SecurityEvent | null>(null)
  const [confirmUnblock, setConfirmUnblock] = useState<SecurityBlock | null>(null)

  const loadFeed = useCallback(async () => {
    try {
      const [e, b] = await Promise.all([api.getSecurityEvents(200), api.getSecurityBlocks()])
      setEvents(e.events)
      setBlocks(b.blocks)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load the security feed.') }
  }, [])

  const loadSlow = useCallback(async () => {
    try {
      const [a, w] = await Promise.all([api.getSecurityAudit(), api.getContractWatch()])
      setChecks(a.checks)
      setContracts(w.contracts)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load the security audit.') }
  }, [])

  useEffect(() => { void loadFeed(); void loadSlow() }, [loadFeed, loadSlow])
  useEffect(() => {
    if (!live) return
    const fast = setInterval(() => { void loadFeed() }, 5000)
    const slow = setInterval(() => { void loadSlow() }, 30000)
    return () => { clearInterval(fast); clearInterval(slow) }
  }, [live, loadFeed, loadSlow])

  const doBlock = async (ip: string, reason: string, minutes: number | null) => {
    setError('')
    try {
      await api.blockIp(ip, reason, minutes)
      setNotice(`${ip} is now blocked${minutes ? ` for ${minutes} minutes` : ' permanently'}.`)
      setBlockIp(''); setBlockReason('')
      await loadFeed()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not block this IP.') }
  }

  const doUnblock = async (b: SecurityBlock) => {
    setError('')
    try {
      await api.unblockIp(b.id)
      setNotice(`${b.ip} unblocked.`)
      await loadFeed()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not unblock this IP.') }
  }

  const blockedIps = new Set(blocks.map((b) => b.ip))
  const failedCount = events.filter((e) => e.status === 'failed').length
  const blockedCount = events.filter((e) => e.status === 'blocked').length
  const interceptedCount = events.filter((e) => e.status === 'intercepted').length

  return (
    <div>
      <PageHeader
        icon={<Radar />}
        title="Cyber Defense"
        sub="Every attack on the whole system, watched live: the admin, the wallet APIs and the contracts. Failed sign-ins, blocked IPs, unauthorized probes and successful sign-ins are recorded here the moment they happen."
        pill={<LiveNote />}
      />
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <AlertModal kind="success" message={notice} onClose={() => setNotice('')} />
      <AlertModal
        kind="confirm"
        message={confirmBlock ? `Block ${confirmBlock.ip} (${confirmBlock.country || 'unknown country'}) for 60 minutes? It will be refused on every route — admin, APIs and wallet sync.` : null}
        confirmLabel="Block IP"
        onConfirm={() => { if (confirmBlock) void doBlock(confirmBlock.ip, confirmBlock.detail || 'blocked from the live feed', 60) }}
        onClose={() => setConfirmBlock(null)}
      />
      <AlertModal
        kind="confirm"
        message={confirmUnblock ? `Unblock ${confirmUnblock.ip}? It will be able to reach the admin and APIs again.` : null}
        confirmLabel="Unblock"
        onConfirm={() => { if (confirmUnblock) void doUnblock(confirmUnblock) }}
        onClose={() => setConfirmUnblock(null)}
      />

      <div className="grid stats">
        <StatCard icon={<ShieldAlert />} label="Active blocks" value={String(blocks.length)} />
        <StatCard icon={<ShieldX />} label="Failed sign-ins (feed)" value={String(failedCount)} />
        <StatCard icon={<Ban />} label="Blocked hits (feed)" value={String(blockedCount)} />
        <StatCard icon={<Eye />} label="Intercepted probes (feed)" value={String(interceptedCount)} />
      </div>

      <div className="card">
        <SectionTitle
          icon={<Radar />}
          right={<>
            <button className="btn ghost" onClick={() => { void loadFeed(); void loadSlow() }}><RefreshCw />Refresh</button>
            <button className="btn ghost" onClick={() => setLive(!live)}>{live ? <><Pause />Pause live</> : <><Play />Resume live</>}</button>
          </>}
        >
          Live attack feed {live ? '— updating every 5 seconds' : '— paused'}
        </SectionTitle>
        {events.length === 0 ? (
          <p className="empty">No security events recorded yet. The feed starts recording from now — failed sign-ins, blocked IPs and unauthorized probes appear here.</p>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="rtable">
              <thead><tr><th>Time</th><th>Status</th><th>Attack</th><th>From</th><th>Detail</th><th></th></tr></thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Time" style={{ whiteSpace: 'nowrap' }}>{fmtTime(e.created_at)}</td>
                    <td data-label="Status">{statusBadge(e.status)}</td>
                    <td data-label="Attack"><b>{e.category}</b><br /><span className="muted mono">{e.method} {e.path}</span></td>
                    <td data-label="From"><span className="kbd">{e.ip}</span>{e.country ? <><br /><span className="muted">{e.country}</span></> : null}</td>
                    <td data-label="Detail">{e.detail}</td>
                    <td data-label="Block">
                      {e.ip && e.ip !== 'unknown' && !blockedIps.has(e.ip) ? (
                        <button className="btn ghost" aria-label={`Block ${e.ip}`} onClick={() => setConfirmBlock(e)}><Ban />Block</button>
                      ) : e.ip && e.ip !== 'unknown' ? (
                        <span className="badge b-red">Blocked</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Blocked = refused at the Worker. Intercepted = stopped by a guard (login lockout, no session). Failed = wrong credentials. Success = a sign-in that went through — a success from a new IP or country is the first sign of a penetration.
        </p>
      </div>

      <div className="card">
        <SectionTitle icon={<Ban />}>Block an attacker</SectionTitle>
        <label>IP address</label>
        <input value={blockIp} onChange={(e) => setBlockIp(e.target.value)} placeholder="e.g. 203.0.113.42" />
        <label>Reason</label>
        <input value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="e.g. brute-force on admin login" />
        <label>Duration</label>
        <select value={blockMinutes} onChange={(e) => setBlockMinutes(e.target.value)}>
          <option value="60">1 hour</option>
          <option value="1440">24 hours</option>
          <option value="permanent">Permanent (until unblocked)</option>
        </select>
        <button className="btn block" style={{ marginTop: 12 }} onClick={() => blockIp.trim() && void doBlock(blockIp.trim(), blockReason.trim() || 'blocked from Cyber Defense', blockMinutes === 'permanent' ? null : Number(blockMinutes))} disabled={!blockIp.trim()}>
          <Ban />Block this IP
        </button>
        {blocks.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="table-wrap">
              <table className="rtable">
                <thead><tr><th>IP</th><th>Reason</th><th>Blocked by</th><th>Expires</th><th></th></tr></thead>
                <tbody>
                  {blocks.map((b) => (
                    <tr key={b.id}>
                      <td data-label="IP"><span className="kbd">{b.ip}</span></td>
                      <td data-label="Reason">{b.reason}</td>
                      <td data-label="Blocked by">{b.blocked_by}</td>
                      <td data-label="Expires">{b.expires_at ? fmtTime(b.expires_at) : 'Permanent'}</td>
                      <td data-label="Unblock"><button className="btn ghost" onClick={() => setConfirmUnblock(b)}>Unblock</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          A blocked IP gets a 403 on every route — admin, public APIs and wallet sync. Five failed admin sign-ins from one IP also auto-blocks it for 60 minutes, on top of the 15-minute login lockout. A Worker block does not stop anyone calling the vault contracts directly on-chain; those are guarded by the contracts' own owner / keeper rules.
        </p>
      </div>

      <div className="card">
        <SectionTitle icon={<ShieldCheck />}>Full security check</SectionTitle>
        {checks.length === 0 ? (
          <p className="empty">Running the check…</p>
        ) : (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>Check</th><th>Result</th><th>Detail</th></tr></thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Check"><b>{c.label}</b></td>
                    <td data-label="Result">{c.status === 'pass' ? <span className="badge b-green">Pass</span> : c.status === 'warn' ? <span className="badge b-amber">Warning</span> : <span className="badge b-red">Fail</span>}</td>
                    <td data-label="Detail">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <SectionTitle icon={<ShieldAlert />} right={<button className="btn ghost" onClick={() => { setWatching(true); void loadSlow().finally(() => setWatching(false)) }} disabled={watching}><RefreshCw />{watching ? 'Checking…' : 'Check now'}</button>}>
          Contract watch
        </SectionTitle>
        {contracts.length === 0 ? (
          <p className="empty">No deployed contracts registered yet. Vaults, adapters and feeds appear here once they are deployed and registered in Contract Studio.</p>
        ) : (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>Contract</th><th>Chain</th><th>Code on-chain</th><th>Recent transactions</th><th>Last activity</th></tr></thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={`${c.chainId}:${c.address}`}>
                    <td data-label="Contract"><span className="kbd">{c.address}</span><br /><span className="muted">{c.kind}{c.env ? ` · ${c.env}` : ''}</span></td>
                    <td data-label="Chain">{c.chainId}</td>
                    <td data-label="Code on-chain">{c.hasCode === true ? <span className="badge b-green">Code present</span> : c.hasCode === false ? <span className="badge b-red">No code</span> : <span className="badge b-grey">Unavailable</span>}{c.codeNote ? <><br /><span className="muted">{c.codeNote}</span></> : null}</td>
                    <td data-label="Recent transactions">{c.recentTxCount === null ? <span className="muted">Unavailable</span> : `${c.recentTxCount} latest`}{c.txNote ? <><br /><span className="muted">{c.txNote}</span></> : null}</td>
                    <td data-label="Last activity">{c.lastTxAt ? fmtTime(c.lastTxAt) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Code is checked live over each chain's RPC. If a vault ever shows "No code", treat it as critical — the contract may have been removed or the address is wrong. Recent transactions come from the chain explorer and are best-effort.
        </p>
      </div>
    </div>
  )
}
