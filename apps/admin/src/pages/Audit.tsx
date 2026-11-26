import { useEffect, useState } from 'react'
import { Download, KeyRound, ShieldCheck, Users } from 'lucide-react'
import { api } from '../lib/api'
import type { AuditEntry } from '../lib/types'
import { DemoPill, LiveNote, PageHeader, SectionTitle } from '../components/ui'

export default function Audit() {
  const [rows, setRows] = useState<AuditEntry[]>([])
  useEffect(() => { api.getAudit().then(setRows) }, [])
  return (
    <div>
      <PageHeader
        icon={<ShieldCheck />}
        title="Audit Log and Settings"
        sub="Immutable record of every admin login, config change and deployment (who, what, when, before / after)."
        pill={<LiveNote />}
      />
      <div className="card">
        <SectionTitle icon={<ShieldCheck />}>Audit log</SectionTitle>
        {rows.length === 0 ? (
          <p className="empty">No audit entries yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="When">{r.at}</td>
                    <td data-label="Actor">{r.actor}</td>
                    <td data-label="Action"><span className="kbd">{r.action}</span></td>
                    <td data-label="Detail">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="grid grid2">
        <div className="card">
          <SectionTitle icon={<Users />}>Admin users</SectionTitle>
          <p className="muted">Owner only. Additional admins are added here in production; every login is audited.</p>
          <DemoPill />
        </div>
        <div className="card">
          <SectionTitle icon={<KeyRound />}>Secrets &amp; backup</SectionTitle>
          <p className="muted">Secrets rotation and backup export of config and deployment records live here. Secrets are stored in Cloudflare, never in this repo.</p>
          <button className="btn ghost" onClick={() => alert('Demo: backup export downloads config + deployment records as JSON in production.')}>
            <Download />Export backup (demo)
          </button>
        </div>
      </div>
    </div>
  )
}
