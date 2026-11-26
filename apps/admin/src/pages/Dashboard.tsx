import { useEffect, useState } from 'react'
import { api } from '../lib/api'
export default function Dashboard() {
  const [s, setS] = useState<Awaited<ReturnType<typeof api.getDashboard>> | null>(null)
  useEffect(() => { api.getDashboard().then(setS) }, [])
  if (!s) return <p className="muted">Loading…</p>
  return <div>
    <div className="topbar"><div><h1>Dashboard</h1><p className="muted">Total locked value, locks, auto-sells and keeper health — per spec Part E.</p></div><span className="badge b-mint">Config {s.configVersion}</span></div>
    <div className="grid grid4">
      <div className="card stat"><span>Active locks (DEMO)</span><b>{s.activeLocks}</b></div>
      <div className="card stat"><span>Auto-sells executed (DEMO)</span><b>{s.autoSells}</b></div>
      <div className="card stat"><span>Auto-sell volume (DEMO)</span><b>{s.autoSellVolume}</b></div>
      <div className="card stat"><span>Keeper health (DEMO)</span><b style={{ fontSize: 17 }}>{s.keeperHealth}</b></div>
    </div>
    <div className="grid grid2">
      <div className="card"><h2>TVL per chain (DEMO)</h2><table><thead><tr><th>Chain</th><th>TVL</th></tr></thead><tbody>{s.tvlByChain.map((r) => <tr key={r.chain}><td>{r.chain}</td><td>{r.tvl}</td></tr>)}</tbody></table></div>
      <div className="card"><h2>Alerts (DEMO)</h2><p className="muted">No live alerts. Production alerts: failed swaps, low keeper gas, RPC errors, missed keeper runs.</p><div className="ok">Keeper last run: on schedule (demo). No failed swaps.</div></div>
    </div>
  </div>
}
