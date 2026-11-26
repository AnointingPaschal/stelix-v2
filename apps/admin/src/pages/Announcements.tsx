import { useState } from 'react'
export default function Announcements() {
  const [saved, setSaved] = useState(false)
  return <div><h1>Announcements</h1><p className="muted">In-app banners and push campaigns: maintenance, new chain live, contract deployment notices. Schedule, audience, expiry.</p>
  {saved && <div className="ok">Demo: announcement saved locally only. Production publishes via Workers + D1 and push.</div>}
  <div className="card"><label>Title</label><input placeholder="e.g. Arc is now live on Stelix" /><label>Message</label><textarea rows={3} placeholder="Short, plain message for the app banner." /><label>Audience</label><select><option>All users</option><option>Arc only</option><option>BNB Chain only</option></select><label>Expiry</label><input type="date" /><button className="btn mint" style={{ marginTop: 14 }} onClick={() => setSaved(true)}>Publish announcement (demo)</button></div>
  <div className="card"><h2>Published (DEMO)</h2><p className="muted">No announcements yet.</p></div></div>
}
