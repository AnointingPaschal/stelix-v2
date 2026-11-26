import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, LogIn, Mail, ShieldCheck } from 'lucide-react'

export default function Login() {
  const nav = useNavigate()
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="logo-wrap">
          <img src="/logo.png" alt="Stelix logo" />
          <h1>Stelix Admin</h1>
          <p className="tagline">Your Financial Discipline — owner only</p>
        </div>
        <div className="notice alert">
          <ShieldCheck />
          <span><b>Owner-only sign-in.</b> Only ozoemenapaschal09@gmail.com can sign in — there is no public registration. Every session and action is written to the audit log.</span>
        </div>
        {err && <div className="notice alert"><ShieldCheck /><span>{err}</span></div>}
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            setErr('')
            setBusy(true)
            const f = new FormData(e.currentTarget)
            const email = String(f.get('email') ?? '')
            const password = String(f.get('password') ?? '')
            if (!email || !password) { setErr('Enter admin email and password.'); setBusy(false); return }
            try {
              const r = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email, password }),
              })
              const d = await r.json().catch(() => ({}))
              if (!r.ok) { setErr(d.error ?? 'Sign-in failed.'); setBusy(false); return }
              nav('/dashboard')
            } catch {
              setErr('Could not reach the server. Check your connection and try again.')
              setBusy(false)
            }
          }}
        >
          <label><Mail style={{ width: 14, height: 14, verticalAlign: -2, marginRight: 5 }} />Admin email</label>
          <input name="email" type="email" placeholder="ozoemenapaschal09@gmail.com" autoComplete="username" />
          <label><Lock style={{ width: 14, height: 14, verticalAlign: -2, marginRight: 5 }} />Password</label>
          <input name="password" type="password" placeholder="••••••••" autoComplete="current-password" />
          <div style={{ marginTop: 18 }}>
            <button className="btn mint block" type="submit" disabled={busy}>
              <LogIn />{busy ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
        <p className="muted login-foot">
          Production sign-in: credentials are checked server-side against the owner&apos;s account. After 5 failed attempts this browser is locked out for 15 minutes.
        </p>
      </div>
    </div>
  )
}
