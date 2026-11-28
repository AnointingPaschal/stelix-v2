import { useEffect, useState } from 'react'
import { KeyRound, Save, ShieldCheck, Trash2 } from 'lucide-react'
import { api, type ApiKeyRow } from '../lib/api'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'
import { AlertModal } from '../components/AlertModal'

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<ApiKeyRow | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    api.getApiKeys().then(setKeys).catch((e: Error) => setError(e.message))
  }
  useEffect(load, [])

  const save = async () => {
    setError(''); setNotice('')
    if (!name.trim()) { setError('Give the key a name first — e.g. circle, explorer.'); return }
    if (!value) { setError('Paste the key value first. It is encrypted on save and never shown again.'); return }
    setBusy(true)
    try {
      const r = await api.saveApiKey(name.trim(), value)
      setNotice(`Key "${r.name}" saved (${r.hint}). The full value is never shown again — to change it, save the same name with the new value.`)
      setName(''); setValue('')
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the key.') }
    setBusy(false)
  }

  const remove = async (k: ApiKeyRow) => {
    setError(''); setNotice('')
    try {
      await api.deleteApiKey(k.id)
      setNotice(`Key "${k.name}" deleted.`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the key.') }
  }

  return (
    <div>
      <PageHeader
        icon={<KeyRound />}
        title="API Keys"
        sub="Named API keys the Worker uses server-side — the Circle API key, explorer keys, anything the backend needs. Values are encrypted at rest and never returned: this page shows only names and masked hints, never a full value after saving."
        pill={<LiveNote />}
      />
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <AlertModal kind="success" message={notice} onClose={() => setNotice('')} />
      <AlertModal
        kind="confirm"
        message={confirmRemove ? `Delete the key "${confirmRemove.name}"? Anything using it stops working until a new value is saved under the same name.` : null}
        confirmLabel="Delete"
        onConfirm={() => { if (confirmRemove) void remove(confirmRemove) }}
        onClose={() => setConfirmRemove(null)}
      />
      <div className="notice info">
        <ShieldCheck />
        <span>
          <b>Name a key <span className="kbd">circle</span> to override the Circle API key</b> — a stored
          <span className="kbd"> circle </span> key takes precedence over the CIRCLE_API_KEY Pages secret for every
          Circle call, and the secret is used again if the stored key is deleted. Keys are encrypted with
          AES-GCM, keyed from CONFIG_SIGNING_SECRET: if that secret is ever rotated, stored keys become
          unreadable until they are re-saved. Never paste a seed phrase or private key here — API keys only.
        </span>
      </div>
      <div className="grid grid2">
        <div className="card">
          <SectionTitle icon={<Save />}>Add / replace a key</SectionTitle>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. circle" autoComplete="off" />
          <p className="field-hint">Letters, digits, spaces, hyphens and underscores, up to 64 characters. Saving the same name again replaces the value.</p>
          <label>Value</label>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste the key — encrypted on save, never shown again"
            autoComplete="off"
          />
          <button className="btn mint block" style={{ marginTop: 14 }} onClick={save} disabled={busy}>
            <Save />{busy ? 'Saving…' : 'Save key'}
          </button>
        </div>
        <div className="card">
          <SectionTitle icon={<KeyRound />}>Saved keys</SectionTitle>
          {keys.length === 0 ? (
            <p className="empty">No API keys saved yet. The Circle API key still comes from the CIRCLE_API_KEY Pages secret until you save a key named “circle” here.</p>
          ) : (
            keys.map((k) => (
              <div key={k.id} className="row-item">
                <div className="row-icon"><KeyRound /></div>
                <div className="row-body">
                  <b>{k.name}</b>
                  <p className="muted">Hint: <span className="kbd">{k.hint}</span></p>
                  <p className="muted small">Updated {k.updatedAt}{k.updatedBy ? ` by ${k.updatedBy}` : ''}</p>
                </div>
                <div className="row-end">
                  <button className="btn ghost" onClick={() => setConfirmRemove(k)}><Trash2 />Delete</button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
