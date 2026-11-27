import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'
import { AlertModal } from '../components/AlertModal'

export default function Security() {
  const nav = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [changed, setChanged] = useState(false)
  const [busy, setBusy] = useState(false)

  const change = async () => {
    setError(''); setNotice('')
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Fill in all three password fields.')
      return
    }
    if (newPassword.length < 12) {
      setError('New password must be at least 12 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }
    if (newPassword === currentPassword) {
      setError('New password must be different from the current one.')
      return
    }
    setBusy(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      setChanged(true)
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
      setNotice('Password changed. Every session — including this browser — has been signed out. Sign in again with your new password.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not change the password.') }
    setBusy(false)
  }

  // After a successful change, closing the success popup signs this browser
  // out and sends it to the login page (the old session is already dead
  // server-side — the version bump invalidated it).
  const closeNotice = async () => {
    setNotice('')
    if (changed) {
      await api.logout()
      nav('/', { replace: true })
    }
  }

  return (
    <div>
      <PageHeader
        icon={<ShieldCheck />}
        title="Security"
        sub="Change the admin password from here. You must know the current password, and changing it signs out every session — including this browser — so nothing stays logged in with the old password."
        pill={<LiveNote />}
      />
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <AlertModal kind="success" message={notice} onClose={closeNotice} />
      <div className="card">
        <SectionTitle icon={<KeyRound />}>Change admin password</SectionTitle>
        <p className="muted">
          Signed in as <b>ozoemenapaschal09@gmail.com</b>. The password is stored only as a
          PBKDF2 hash — never in plain text — and the old password stops working the moment you change it.
        </p>
        <label>Current password</label>
        <input
          type="password"
          value={currentPassword}
          autoComplete="current-password"
          placeholder="Your current admin password"
          onChange={(e) => setCurrentPassword(e.target.value)}
        />
        <label>New password</label>
        <input
          type="password"
          value={newPassword}
          autoComplete="new-password"
          placeholder="At least 12 characters"
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <label>Confirm new password</label>
        <input
          type="password"
          value={confirmPassword}
          autoComplete="new-password"
          placeholder="Repeat the new password"
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        <p className="field-hint">
          Use a password you do not use anywhere else. If you forget it, there is no reset link in the
          admin — the hash has to be replaced from Cloudflare (Pages secret ADMIN_PASSWORD_HASH).
        </p>
        <button className="btn mint block" style={{ marginTop: 12 }} onClick={change} disabled={busy}>
          <KeyRound /> Change password
        </button>
      </div>
    </div>
  )
}
