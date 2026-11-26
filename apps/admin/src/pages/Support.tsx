import { useState } from 'react'
import { Eye, Search, ShieldAlert } from 'lucide-react'
import { api } from '../lib/api'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'

export default function Support() {
  const [q, setQ] = useState('')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const lookup = async () => {
    setError(''); setResult(null)
    if (!q.trim()) { setError('Enter a wallet address, lock ID or transaction hash.'); return }
    setBusy(true)
    try {
      const r = await api.supportLookup(q.trim())
      setResult(r)
    } catch (e) { setError(e instanceof Error ? e.message : 'Lookup failed.') }
    setBusy(false)
  }

  const renderResult = () => {
    if (!result) return null
    if (result.found === false) {
      return <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>{String(result.note ?? 'Nothing found for this query.')}</p>
    }
    return (
      <div style={{ marginTop: 14 }}>
        <p className="muted">Type: <b>{String(result.type ?? '')}</b>{result.chain ? ` · Chain: ${String(result.chain)}` : ''}</p>
        <pre>{JSON.stringify(result.result ?? result, null, 2)}</pre>
        <p className="field-hint">Public on-chain state only. Funds only ever go to the lock owner.</p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        icon={<Search />}
        title="Support Lookup"
        sub="Look up a lock by wallet address, lock ID or transaction hash and see its public on-chain state to help a user. Reads D1 and live chain RPC — never sample data."
        pill={<LiveNote />}
      />
      <div className="notice alert">
        <ShieldAlert />
        <span><b>Support can never ask for a seed phrase or private key.</b> This tool has no field for them — never request them, and never enter them here. The lookup rejects anything that looks like a seed phrase.</span>
      </div>
      {error && <div className="notice alert"><ShieldAlert /><span>{error}</span></div>}
      <div className="card">
        <SectionTitle icon={<Search />}>Look up a lock</SectionTitle>
        <label>Wallet address, lock ID or transaction hash</label>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="0x… / 123 / 0x tx hash…"
          autoCapitalize="off"
          autoCorrect="off"
          onKeyDown={(e) => { if (e.key === 'Enter') lookup() }}
        />
        <button className="btn block" style={{ marginTop: 14 }} onClick={lookup} disabled={busy}>
          <Search />{busy ? 'Looking up…' : 'Look up'}
        </button>
        {renderResult()}
      </div>
      <div className="card">
        <SectionTitle icon={<Eye />}>What support can see</SectionTitle>
        <p className="muted" style={{ marginBottom: 0 }}>
          Lock owner, chain, token, amount, unlock date, target, status, contract address, transaction hash. Nothing else. Funds only ever go to the lock owner.
        </p>
      </div>
    </div>
  )
}
