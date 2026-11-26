import { useEffect, useState } from 'react'
import { CheckCircle2, Inbox, Megaphone, Send, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'

type Announcement = { id: number; title: string; message: string; audience: string; expires_at: string | null; created_at: string }

export default function Announcements() {
  const [rows, setRows] = useState<Announcement[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [audience, setAudience] = useState('all')
  const [expiry, setExpiry] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => { api.getAnnouncements().then((d) => setRows(d.announcements)).catch((e: Error) => setError(e.message)) }
  useEffect(() => { load() }, [])

  const publish = async () => {
    setError(''); setNotice('')
    if (!title.trim() || !message.trim()) { setError('Title and message are required.'); return }
    setBusy(true)
    try {
      await api.publishAnnouncement({ title: title.trim(), message: message.trim(), audience, expiresAt: expiry || null })
      setNotice('Announcement published to D1. The mobile app banner feed (/api/announcements) serves it immediately.')
      setTitle(''); setMessage(''); setAudience('all'); setExpiry('')
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not publish announcement.') }
    setBusy(false)
  }

  const remove = async (id: number) => {
    if (!window.confirm('Delete this announcement?')) return
    try {
      await api.deleteAnnouncement(id)
      setNotice('Announcement deleted.')
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete announcement.') }
  }

  return (
    <div>
      <PageHeader
        icon={<Megaphone />}
        title="Announcements"
        sub="In-app banners and push campaigns: maintenance, new chain live, contract deployment notices. Schedule, audience, expiry. Published announcements are served live to the mobile app banner feed."
        pill={<LiveNote />}
      />
      {error && <div className="notice alert"><Megaphone /><span>{error}</span></div>}
      {notice && <div className="notice ok"><CheckCircle2 /><span>{notice}</span></div>}
      <div className="card">
        <SectionTitle icon={<Megaphone />}>New announcement</SectionTitle>
        <label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Arc is now live on Stelix" />
        <label>Message</label><textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Short, plain message for the app banner." />
        <label>Audience</label>
        <select value={audience} onChange={(e) => setAudience(e.target.value)}>
          <option value="all">All users</option>
          <option value="arc">Arc only</option>
          <option value="bnb">BNB Chain only</option>
          <option value="base">Base only</option>
          <option value="ethereum">Ethereum only</option>
          <option value="polygon">Polygon only</option>
          <option value="solana">Solana only</option>
        </select>
        <label>Expiry (optional)</label><input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        <button className="btn mint block" style={{ marginTop: 16 }} onClick={publish} disabled={busy}>
          <Send />{busy ? 'Publishing…' : 'Publish announcement'}
        </button>
      </div>
      <div className="card">
        <SectionTitle icon={<Inbox />}>Published</SectionTitle>
        {rows.length === 0 ? (
          <p className="empty"><Inbox /><br />No announcements yet.</p>
        ) : (
          rows.map((a) => (
            <div className="row-item" key={a.id}>
              <div className="row-icon"><Megaphone /></div>
              <div className="row-body">
                <b>{a.title}</b>
                <p className="muted">{a.message}</p>
                <p className="muted small">Audience: {a.audience} · {a.created_at}{a.expires_at ? ` · expires ${a.expires_at}` : ''}</p>
              </div>
              <div className="row-end">
                <button className="btn ghost" aria-label={`Delete ${a.title}`} onClick={() => remove(a.id)}><Trash2 /></button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
