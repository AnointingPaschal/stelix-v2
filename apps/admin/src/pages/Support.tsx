import { useState } from 'react'
import { CheckCircle2, Eye, Search, ShieldAlert } from 'lucide-react'
import { api } from '../lib/api'
import { DemoPill, PageHeader, SectionTitle } from '../components/ui'

export default function Support() {
  const [q, setQ] = useState('')
  const [found, setFound] = useState(false)
  const [searched, setSearched] = useState(false)
  return (
    <div>
      <PageHeader
        icon={<Search />}
        title="Support Lookup"
        sub="Look up a lock by wallet address, lock ID or transaction hash and see its public on-chain state to help a user."
        pill={<DemoPill />}
      />
      <div className="notice alert">
        <ShieldAlert />
        <span><b>Support can never ask for a seed phrase or private key.</b> This tool has no field for them — never request them, and never enter them here.</span>
      </div>
      <div className="card">
        <SectionTitle icon={<Search />}>Look up a lock</SectionTitle>
        <label>Wallet address, lock ID or transaction hash</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="0x… / LK-… / 0x tx hash…" autoCapitalize="off" autoCorrect="off" />
        <button
          className="btn block"
          style={{ marginTop: 14 }}
          onClick={async () => {
            const locks = await api.getLocks()
            setFound(locks.some((l) => l.id === q || l.owner.includes(q.slice(0, 6)) || q.length > 10))
            setSearched(true)
          }}
        >
          <Search />Look up (demo)
        </button>
        {found && (
          <div className="notice ok" style={{ marginTop: 14, marginBottom: 0 }}>
            <CheckCircle2 />
            <span>Demo match found in the demo lock list — public on-chain state only. In production this reads the chain / indexer, not user keys.</span>
          </div>
        )}
        {searched && !found && q && <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>No demo match. Try LK-DEMO-001.</p>}
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
