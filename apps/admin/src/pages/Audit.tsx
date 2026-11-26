import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { AuditEntry } from '../lib/types'
export default function Audit() {
  const [rows, setRows] = useState<AuditEntry[]>([])
  useEffect(() => { api.getAudit().then(setRows) }, [])
  return <div><h1>Audit Log and Settings</h1><p className="muted">Immutable record of every admin login, config change and deployment (who, what, when, before / after).</p>
  <div className="card"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
  <tbody>{rows.map((r) => <tr key={r.id}><td>{r.at}</td><td>{r.actor}</td><td className="kbd">{r.action}</td><td>{r.detail}</td></tr>)}</tbody></table></div>
  <div className="grid grid2">
    <div className="card"><h2>Admin users (DEMO)</h2><p className="muted">Owner only. Additional admins are added here in production; every login is audited.</p></div>
    <div className="card"><h2>Secrets &amp; backup (DEMO)</h2><p className="muted">Secrets rotation and backup export of config and deployment records live here. Secrets are stored in Cloudflare, never in this repo.</p><button className="btn ghost" onClick={() => alert('Demo: backup export downloads config + deployment records as JSON in production.')}>Export backup (demo)</button></div>
  </div></div>
}
