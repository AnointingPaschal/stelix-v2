import { useState } from 'react'
import { CheckCircle2, Inbox, Megaphone, Send } from 'lucide-react'
import { DemoPill, PageHeader, SectionTitle } from '../components/ui'

export default function Announcements() {
  const [saved, setSaved] = useState(false)
  return (
    <div>
      <PageHeader
        icon={<Megaphone />}
        title="Announcements"
        sub="In-app banners and push campaigns: maintenance, new chain live, contract deployment notices. Schedule, audience, expiry."
        pill={<DemoPill />}
      />
      {saved && (
        <div className="notice ok">
          <CheckCircle2 />
          <span>Demo: announcement saved locally only. Production publishes via Workers + D1 and push.</span>
        </div>
      )}
      <div className="card">
        <SectionTitle icon={<Megaphone />}>New announcement</SectionTitle>
        <label>Title</label><input placeholder="e.g. Arc is now live on Stelix" />
        <label>Message</label><textarea rows={3} placeholder="Short, plain message for the app banner." />
        <label>Audience</label>
        <select><option>All users</option><option>Arc only</option><option>BNB Chain only</option></select>
        <label>Expiry</label><input type="date" />
        <button className="btn mint block" style={{ marginTop: 16 }} onClick={() => setSaved(true)}>
          <Send />Publish announcement (demo)
        </button>
      </div>
      <div className="card">
        <SectionTitle icon={<Inbox />}>Published</SectionTitle>
        <p className="empty"><Inbox /><br />No announcements yet.</p>
      </div>
    </div>
  )
}
