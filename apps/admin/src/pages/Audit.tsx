import { useEffect, useState } from 'react'
import { Download, KeyRound, ShieldCheck, Users } from 'lucide-react'
import { api } from '../lib/api'
import type { AuditEntry } from '../lib/types'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'

export default function Audit() {
  const [rows, setRows] = useState<AuditEntry[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => { api.getAudit().then(setRows).catch((e: Error) => setError(e.message)) }, [])

  const exportBackup = async () => {
    setError(''); setNotice('')
    try {
      const data = await api.getBackup()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `stelix-admin-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setNotice('Backup exported (config + deployments + fees + audit runs — secrets are never included).')
    } catch (e) { setError(e instanceof Error ? e.message : 'Backup export failed.') }
  }

  return (
    <div>
      <PageHeader
        icon={<ShieldCheck />}
        title="Audit Log and Settings"
        sub="Immutable record of every admin login, config change and deployment (who, what, when, before / after)."
        pill={<LiveNote />}
      />
      {error && <p className="muted">{error}</p>}
      {notice && <div className="notice ok"><ShieldCheck /><span>{notice}</span></div>}
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
        </div>
        <div className="card">
          <SectionTitle icon={<KeyRound />}>Secrets &amp; backup</SectionTitle>
          <p className="muted">Secrets rotation and backup export of config and deployment records live here. Secrets are stored in Cloudflare, never in this repo.</p>
          <button className="btn ghost" onClick={exportBackup}>
            <Download />Export backup
          </button>
        </div>
      </div>
    </div>
  )
}
