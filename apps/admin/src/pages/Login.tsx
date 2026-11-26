import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
export default function Login() {
  const nav = useNavigate(); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  return <div style={{ minHeight: '100vh', background: '#0B1220', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <div className="card" style={{ width: 420, maxWidth: '100%' }}>
      <div style={{ textAlign: 'center' }}><img src="/logo.png" alt="Stelix logo" width={72} height={72} style={{ borderRadius: '50%' }} /><h1 style={{ marginTop: 10 }}>Stelix Admin</h1><p className="muted">Your Financial Discipline — owner only</p></div>
      <div className="alert">Owner-only sign-in. Only ozoemenapaschal09@gmail.com can sign in — there is no public registration. Every session and action is written to the audit log.</div>
      {err && <div className="alert">{err}</div>}
      <form onSubmit={async (e) => { e.preventDefault(); setErr(''); setBusy(true); const f = new FormData(e.currentTarget); const email = String(f.get('email') ?? ''); const password = String(f.get('password') ?? ''); if (!email || !password) { setErr('Enter admin email and password.'); setBusy(false); return } try { const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }); const d = await r.json().catch(() => ({})); if (!r.ok) { setErr(d.error ?? 'Sign-in failed.'); setBusy(false); return } nav('/dashboard') } catch { setErr('Could not reach the server. Check your connection and try again.'); setBusy(false) } }}>
        <label>Admin email</label><input name="email" type="email" placeholder="ozoemenapaschal09@gmail.com" autoComplete="username" />
        <label>Password</label><input name="password" type="password" placeholder="••••••••" autoComplete="current-password" />
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}><button className="btn" type="submit" style={{ flex: 1 }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></div>
      </form>
      <p className="muted" style={{ marginTop: 14 }}>Production sign-in: credentials are checked server-side against the owner's account. After 5 failed attempts this browser is locked out for 15 minutes.</p>
    </div>
  </div>
}
