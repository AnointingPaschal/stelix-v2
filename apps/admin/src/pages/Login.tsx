import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
export default function Login() {
  const nav = useNavigate(); const [err, setErr] = useState('')
  return <div style={{ minHeight: '100vh', background: '#0B1220', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
    <div className="card" style={{ width: 420, maxWidth: '100%' }}>
      <div style={{ textAlign: 'center' }}><img src="/logo.png" alt="Stelix logo" width={72} height={72} style={{ borderRadius: '50%' }} /><h1 style={{ marginTop: 10 }}>Stelix Admin</h1><p className="muted">Your Financial Discipline — owner only</p></div>
      <div className="alert">Cloudflare Access gate + admin credentials / passkey. No public registration. Every session and action is written to the audit log.</div>
      {err && <div className="alert">{err}</div>}
      <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); if (!f.get('email') || !f.get('password')) { setErr('Enter admin email and password (demo: any values sign in locally).'); return } nav('/dashboard') }}>
        <label>Admin email</label><input name="email" type="email" placeholder="owner@example.com" autoComplete="username" />
        <label>Password</label><input name="password" type="password" placeholder="••••••••" autoComplete="current-password" />
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}><button className="btn" type="submit" style={{ flex: 1 }}>Sign in</button><button className="btn ghost" type="button" onClick={() => nav('/dashboard')}>Use passkey (demo)</button></div>
      </form>
      <p className="muted" style={{ marginTop: 14 }}>Demo build: sign-in is local only and grants no live access. Production enforces Cloudflare Access + passkey before this page is reachable.</p>
    </div>
  </div>
}
