import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, Pause, Play, Wallet } from 'lucide-react'
import { api } from '../lib/api'
import type { KeeperRun } from '../lib/types'
import { DemoPill, LiveNote, PageHeader, SectionTitle, StatCard } from '../components/ui'

export default function Keeper() {
  const [runs, setRuns] = useState<KeeperRun[]>([])
  useEffect(() => { api.getKeeperRuns().then(setRuns) }, [])
  return (
    <div>
      <PageHeader
        icon={<Activity />}
        title="Keeper Monitor"
        sub="Runs, triggers, swaps executed / retried / failed, keeper balances, run-now / pause. Keeper can only call executeTrigger for pre-authorised exits."
        pill={<LiveNote />}
        actions={
          <>
            <button className="btn mint" onClick={() => alert('Demo: POST /api/admin/keeper/run-now in production.')}>
              <Play />Run now
            </button>
            <button className="btn ghost" onClick={() => alert('Demo: keeper pause writes to D1 in production.')}>
              <Pause />Pause keeper
            </button>
          </>
        }
      />
      <div className="grid grid3">
        <StatCard icon={<Wallet />} label="Keeper balance — Arc" value="$0.00" pill={<DemoPill />} />
        <StatCard icon={<Wallet />} label="Keeper balance — BNB" value="$0.00" tone="navy" pill={<DemoPill />} />
        <StatCard icon={<AlertTriangle />} label="Missed runs" value="0" tone="amber" pill={<DemoPill />} />
      </div>
      <div className="card">
        <SectionTitle icon={<Activity />}>Recent runs</SectionTitle>
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
