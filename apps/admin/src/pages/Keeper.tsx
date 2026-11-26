import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { KeeperRun } from '../lib/types'
export default function Keeper() {
  const [runs, setRuns] = useState<KeeperRun[]>([])
  useEffect(() => { api.getKeeperRuns().then(setRuns) }, [])
  return <div>
    <div className="topbar"><div><h1>Keeper Monitor</h1><p className="muted">Runs, triggers, swaps executed / retried / failed, keeper balances, run-now / pause. Keeper can only call executeTrigger for pre-authorised exits.</p></div>
    <div style={{ display: 'flex', gap: 8 }}><button className="btn mint" onClick={() => alert('Demo: POST /api/admin/keeper/run-now in production.')}>Run now</button><button className="btn ghost" onClick={() => alert('Demo: keeper pause writes to D1 in production.')}>Pause keeper</button></div></div>
    <div className="grid grid3">
      <div className="card stat"><span>Keeper balance — Arc (DEMO)</span><b>$0.00</b></div>
      <div className="card stat"><span>Keeper balance — BNB (DEMO)</span><b>$0.00</b></div>
      <div className="card stat"><span>Missed runs (DEMO)</span><b>0</b></div>
    </div>
    <div className="card"><table><thead><tr><th>Run</th><th>Started</th><th>Chain</th><th>Checked</th><th>Triggers</th><th>Executed</th><th>Retried</th><th>Failed</th><th>Status</th></tr></thead>
    <tbody>{runs.map((r) => <tr key={r.id}><td className="kbd">{r.id}</td><td>{r.startedAt}</td><td>{r.chain}</td><td>{r.locksChecked}</td><td>{r.triggers}</td><td>{r.executed}</td><td>{r.retried}</td><td>{r.failed}</td><td><span className={'badge ' + (r.status === 'ok' ? 'b-green' : r.status === 'partial' ? 'b-amber' : 'b-red')}>{r.status}</span></td></tr>)}</tbody></table></div>
  </div>
}
