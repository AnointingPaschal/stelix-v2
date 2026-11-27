import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, Pause, Play, Wallet } from 'lucide-react'
import { api, type KeeperStatus } from '../lib/api'
import type { KeeperRun } from '../lib/types'
import { LiveNote, PageHeader, SectionTitle, StatCard } from '../components/ui'
import { AlertModal } from '../components/AlertModal'

export default function Keeper() {
  const [runs, setRuns] = useState<KeeperRun[]>([])
  const [status, setStatus] = useState<KeeperStatus | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    api.getKeeperRuns().then(setRuns).catch((e: Error) => setError(e.message))
    api.getKeeperStatus().then(setStatus).catch((e: Error) => setError(e.message))
  }
  useEffect(load, [])

  const runNow = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await api.keeperRunNow()
      if (r.live) setNotice('Keeper run triggered. Check the runs list for the new entry.')
      else setNotice(r.message ?? 'Keeper is not live yet.')
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Run Now failed.') }
    setBusy(false)
  }

  const togglePause = async () => {
    if (!status) return
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await api.keeperPause(!status.paused)
      setNotice(r.paused ? 'Keeper paused. No triggers will run until you resume it.' : 'Keeper resumed.')
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Pause failed.') }
    setBusy(false)
  }

  const lastRun = status?.lastRun

  return (
    <div>
      <PageHeader
        icon={<Activity />}
        title="Keeper Monitor"
        sub="Runs, triggers, swaps executed / retried / failed, keeper balances, run-now / pause. Keeper can only call executeTrigger for pre-authorised exits."
        pill={<LiveNote />}
        actions={
          <>
            <button className="btn mint" onClick={runNow} disabled={busy || status?.paused}>
              <Play />Run now
            </button>
            <button className="btn ghost" onClick={togglePause} disabled={busy}>
              <Pause />{status?.paused ? 'Resume keeper' : 'Pause keeper'}
            </button>
          </>
        }
      />
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <AlertModal kind="success" message={notice} onClose={() => setNotice('')} />
      {status && !status.keeperLive && (
        <div className="notice info">
          <Activity />
          <span><b>Keeper worker is not live yet.</b> Run Now will say so honestly and record nothing until the keeper Worker is deployed and KEEPER_WORKER_URL is set. Runs below are the real recorded runs (none yet if the list is empty).</span>
        </div>
      )}
      {status?.paused && (
        <div className="notice alert">
          <Pause />
          <span><b>Keeper is paused.</b> Price targets will not trigger until you resume it. Locks stay locked; owners can still claim matured locks themselves.</span>
        </div>
      )}
      <div className="grid grid3">
        <StatCard
          icon={<Wallet />}
          label="Keeper wallet"
          value={status?.keeperAddress ? `${status.keeperAddress.slice(0, 10)}…${status.keeperAddress.slice(-6)}` : 'Not set'}
          smallValue
          pill={<LiveNote />}
        />
        <StatCard
          icon={<Wallet />}
          label="Keeper balances"
          value={status && status.balances.length > 0 ? status.balances.map((b) => `${b.chain}: ${b.balance}`).join(' · ') : 'No balances yet'}
          smallValue
          tone="navy"
          pill={<LiveNote />}
        />
        <StatCard icon={<AlertTriangle />} label="Failed runs (24h)" value={String(status?.failedRuns24h ?? 0)} tone="amber" pill={<LiveNote />} />
      </div>
      <div className="card">
        <SectionTitle icon={<Activity />}>Recent runs</SectionTitle>
        {lastRun && (
          <p className="muted">Last run: {lastRun.started_at} on {lastRun.chain_id} — {lastRun.locks_checked} locks checked, {lastRun.executed} executed, {lastRun.failed} failed.</p>
        )}
        {runs.length === 0 ? (
          <p className="empty">No keeper runs yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>Run</th><th>Started</th><th>Chain</th><th>Checked</th><th>Triggers</th><th>Executed</th><th>Retried</th><th>Failed</th><th>Status</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Run"><span className="kbd">{r.id}</span></td>
                    <td data-label="Started">{r.startedAt}</td>
                    <td data-label="Chain">{r.chain}</td>
                    <td data-label="Checked">{r.locksChecked}</td>
                    <td data-label="Triggers">{r.triggers}</td>
                    <td data-label="Executed">{r.executed}</td>
                    <td data-label="Retried">{r.retried}</td>
                    <td data-label="Failed">{r.failed}</td>
                    <td data-label="Status"><span className={'badge ' + (r.status === 'ok' ? 'b-green' : r.status === 'partial' ? 'b-amber' : 'b-red')}>{r.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
