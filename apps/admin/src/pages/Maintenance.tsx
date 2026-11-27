import { useEffect, useState } from 'react'
import { CheckCircle2, ShieldCheck, Wrench } from 'lucide-react'
import { api } from '../lib/api'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'
import { AlertModal } from '../components/AlertModal'

export default function Maintenance() {
  const [enabled, setEnabled] = useState(false)
  const [message, setMessage] = useState('')
  const [scope, setScope] = useState<'all' | 'wallet'>('wallet')
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    api.getMaintenance().then((d) => {
      setEnabled(d.maintenance.enabled)
      setMessage(d.maintenance.message)
      setScope(d.maintenance.scope)
      setUpdatedAt(d.maintenance.updatedAt)
    }).catch((e: Error) => setError(e.message))
  }
  useEffect(load, [])

  const save = async () => {
    setError(''); setNotice('')
    if (enabled && message.trim() === '') {
      setError('A message is required while maintenance is on — the wallet shows it to users.')
      return
    }
    setBusy(true)
    try {
      const r = await api.setMaintenance({ enabled, message: message.trim(), scope })
      setUpdatedAt(r.maintenance.updatedAt)
      setNotice(
        r.maintenance.enabled
          ? `Maintenance is ON (${r.maintenance.scope === 'all' ? 'whole app' : 'wallet actions only'}) — the wallet picks it up on its next sync, within ~45s. Signing is blocked while it is on.`
          : 'Maintenance is OFF — the wallet resumes normal use on its next sync, within ~45s.',
      )
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save maintenance mode.') }
    setBusy(false)
  }

  return (
    <div>
      <PageHeader
        icon={<Wrench />}
        title="Maintenance Mode"
        sub="Pause the wallet from here. The wallet polls the admin every ~45s, so a change lands within one poll interval. This page itself is never blocked by maintenance, so it can always be switched off."
        pill={<LiveNote />}
      />
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <AlertModal kind="success" message={notice} onClose={() => setNotice('')} />
      <div className="card">
        <SectionTitle icon={<Wrench />}>Maintenance</SectionTitle>
        <p className="muted">
          Current state: <b>{enabled ? `ON (${scope === 'all' ? 'whole app' : 'wallet actions only'})` : 'OFF'}</b>
          {updatedAt ? ` · last changed ${updatedAt}` : ''}
        </p>
        <label className="check-row">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Maintenance on
        </label>
        <label>Message shown to users (required while on)</label>
        <textarea
          value={message}
          rows={3}
          maxLength={500}
          placeholder="e.g. Stelix is down for scheduled maintenance — back in about an hour. No funds are at risk."
          onChange={(e) => setMessage(e.target.value)}
        />
        <label>Scope</label>
        <select value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'wallet')}>
          <option value="wallet">Wallet actions only — banner + signing blocked, browsing still works</option>
          <option value="all">Whole app — full maintenance screen, nothing else reachable</option>
        </select>
        <p className="field-hint">
          Either scope blocks signing: no user can sign a transaction while maintenance is on. A mode switch
          never happens mid-transaction either — if a signing sheet is open, the wallet waits until that flow
          finishes or is cancelled.
        </p>
        <button className="btn mint block" style={{ marginTop: 14 }} onClick={save} disabled={busy}>
          <Wrench />{busy ? 'Saving…' : enabled ? 'Turn maintenance on' : 'Save (maintenance off)'}
        </button>
      </div>
    </div>
  )
}
