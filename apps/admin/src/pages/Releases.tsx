import { useEffect, useState } from 'react'
import { CheckCircle2, Inbox, Package, Send } from 'lucide-react'
import { api } from '../lib/api'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'
import { AlertModal } from '../components/AlertModal'

type Release = { id: number; version: string; notes: string | null; url: string | null; force: number; created_at: string }

export default function Releases() {
  const [rows, setRows] = useState<Release[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [version, setVersion] = useState('')
  const [notes, setNotes] = useState('')
  const [url, setUrl] = useState('')
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = () => { api.getReleases().then((d) => setRows(d.releases)).catch((e: Error) => setError(e.message)) }
  useEffect(() => { load() }, [])

  const publish = async () => {
    setError(''); setNotice('')
    const v = version.trim()
    const u = url.trim()
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)) { setError('Version must look like X.Y.Z (e.g. 2.1.0).'); return }
    if (!/^https?:\/\/.+/.test(u)) { setError('URL must be an http(s) link to the new build.'); return }
    setBusy(true)
    try {
      await api.publishRelease({ version: v, notes: notes.trim() || null, url: u, force })
      setNotice(`Release ${v} published. The mobile app shows it as an update prompt on its next sync.`)
      setVersion(''); setNotes(''); setUrl(''); setForce(false)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not publish release.') }
    setBusy(false)
  }

  return (
    <div>
      <PageHeader
        icon={<Package />}
        title="Releases"
        sub="Publish a new version of the Stelix app. The latest release is served to the wallet in the next sync and shown as an update prompt when it is newer than the version on the phone."
        pill={<LiveNote />}
      />
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <AlertModal kind="success" message={notice} onClose={() => setNotice('')} />
      <div className="card">
        <SectionTitle icon={<Package />}>Publish a release</SectionTitle>
        <label>Version</label><input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="e.g. 2.1.0" />
        <label>What&apos;s new (optional)</label><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Short notes shown in the update prompt, e.g. Faster locks and a new chart." />
        <label>Download URL</label><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… link to the new build" />
        <label className="check-row">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          Force update — users cannot dismiss this prompt
        </label>
        <button className="btn mint block" style={{ marginTop: 16 }} onClick={publish} disabled={busy}>
          <Send />{busy ? 'Publishing…' : 'Publish release'}
        </button>
      </div>
      <div className="card">
        <SectionTitle icon={<Inbox />}>Published</SectionTitle>
        {rows.length === 0 ? (
          <p className="empty"><Inbox /><br />No releases yet.</p>
        ) : (
          rows.map((r) => (
            <div className="row-item" key={r.id}>
              <div className="row-icon"><Package /></div>
              <div className="row-body">
                <b>v{r.version}{r.force === 1 ? ' · Forced' : ''}</b>
                {r.notes ? <p className="muted">{r.notes}</p> : null}
                <p className="muted small">{r.url ?? ''} · {r.created_at}</p>
              </div>
              <div className="row-end">
                {r.id === rows[0].id ? <span className="pill pill-live"><span className="dot" />Live</span> : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
