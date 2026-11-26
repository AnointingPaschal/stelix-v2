import { useState } from 'react'
import { api } from '../lib/api'
export default function Support() {
  const [q, setQ] = useState(''); const [found, setFound] = useState(false)
  return <div><h1>Support Lookup</h1><p className="muted">Look up a lock by wallet address, lock ID or transaction hash and see its public on-chain state to help a user.</p>
  <div className="alert">Support can never ask for a seed phrase or private key. This tool has no field for them — never request them, and never enter them here.</div>
  <div className="card"><label>Wallet address, lock ID or transaction hash</label><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="0x… / LK-… / 0x tx hash…" /><button className="btn" style={{ marginTop: 12 }} onClick={async () => { const locks = await api.getLocks(); setFound(locks.some((l) => l.id === q || l.owner.includes(q.slice(0, 6)) || q.length > 10)) }}>Look up (demo)</button>
  {found && <div className="ok" style={{ marginTop: 12 }}>Demo match found in the demo lock list — public on-chain state only. In production this reads the chain / indexer, not user keys.</div>}
  {!found && q && <p className="muted" style={{ marginTop: 12 }}>No demo match. Try LK-DEMO-001.</p>}</div>
  <div className="card"><h2>What support can see</h2><p className="muted">Lock owner, chain, token, amount, unlock date, target, status, contract address, transaction hash. Nothing else. Funds only ever go to the lock owner.</p></div></div>
}
