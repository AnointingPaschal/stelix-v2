import { useEffect, useState } from 'react'
import { BadgeCheck, ChevronDown, ChevronUp, Coins, Gauge, Percent, Search, Star, Timer, Trash2, X } from 'lucide-react'
import { api } from '../lib/api'
import type { Chain } from '../lib/types'
import { LiveNote, PageHeader, SectionTitle, StatCard } from '../components/ui'
import { AlertModal } from '../components/AlertModal'

type RegistryToken = { id: number; symbol: string; chain: string; address: string; decimals: number; verified: boolean; featured: boolean; sortOrder: number }
type SearchHit = { symbol: string; name: string; chain: string; address: string; priceUsd: number | null; dex: string; pairUrl: string | null; source: string }

export default function Tokens() {
  const [tokens, setTokens] = useState<RegistryToken[]>([])
  const [chains, setChains] = useState<Chain[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<RegistryToken | null>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchNote, setSearchNote] = useState('')
  const [add, setAdd] = useState({ symbol: '', chainId: '', address: '', decimals: '18', verified: false, featured: false })

  const load = () => {
    api.getTokens().then(setTokens).catch((e: Error) => setError(e.message))
    api.getChains().then(setChains).catch(() => undefined)
  }
  useEffect(load, [])

  const search = async () => {
    setError(''); setSearchNote(''); setSearching(true)
    try {
      const d = await api.searchTokens(q)
      setHits(d.tokens)
      setSearchNote(d.tokens.length === 0 ? 'No live matches on DexScreener.' : `Live results from ${d.source}.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Search failed.') }
    setSearching(false)
  }

  const addToken = async (preset?: SearchHit) => {
    const data = preset
      ? { symbol: preset.symbol, chainId: preset.chain, address: preset.address, decimals: 18, verified: true, featured: false }
      : { symbol: add.symbol.trim().toUpperCase(), chainId: add.chainId, address: add.address.trim(), decimals: Number(add.decimals), verified: add.verified, featured: add.featured }
    setError('')
    try {
      await api.addToken(data)
      setNotice(`${data.symbol} registered on ${data.chainId}.`)
      setAdd({ symbol: '', chainId: '', address: '', decimals: '18', verified: false, featured: false })
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add token.') }
  }

  const removeToken = async (t: RegistryToken) => {
    setError('')
    try {
      await api.removeToken(t.id)
      setNotice(`${t.symbol} removed.`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not remove token.') }
  }

  // Order is per chain: the list the server returns is already ordered
  // by (chain, sort_order), so a move swaps the token with its
  // same-chain neighbour and saves the full chain order. The wallet
  // shows My Assets in this order, registry tokens first.
  const moveToken = async (t: RegistryToken, dir: -1 | 1) => {
    const sameChain = tokens.filter((x) => x.chain === t.chain)
    const idx = sameChain.findIndex((x) => x.id === t.id)
    const swapIdx = idx + dir
    if (idx < 0 || swapIdx < 0 || swapIdx >= sameChain.length) return
    const next = [...sameChain]
    const [moved] = next.splice(idx, 1)
    next.splice(swapIdx, 0, moved)
    setError('')
    try {
      await api.reorderTokens(t.chain, next.map((x) => x.id))
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not reorder tokens.') }
  }

  return (
    <div>
      <PageHeader
        icon={<Coins />}
        title="Token / DEX Registry"
        sub="Featured / verified token lists per chain, default slippage and impact limits, router addresses, token safety overrides. User-imported tokens are unaffected. Live prices come from DexScreener."
        pill={<LiveNote />}
      />
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <AlertModal kind="success" message={notice} onClose={() => setNotice('')} />
      <AlertModal
        kind="confirm"
        message={confirmRemove ? `Remove ${confirmRemove.symbol} (${confirmRemove.chain}) from the registry?` : null}
        confirmLabel="Remove"
        onConfirm={() => { if (confirmRemove) void removeToken(confirmRemove) }}
        onClose={() => setConfirmRemove(null)}
      />
      <div className="grid stats">
        <StatCard icon={<Percent />} label="Default slippage" value="1.5%" />
        <StatCard icon={<Gauge />} label="Max price impact" value="5%" />
        <StatCard icon={<Timer />} label="TWAP window" value="30 min" />
      </div>

      <div className="card">
        <SectionTitle icon={<Search />}>Live token search (DexScreener)</SectionTitle>
        <label>Token name, symbol or contract address</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. USDC or 0x…" onKeyDown={(e) => { if (e.key === 'Enter') search() }} />
        <button className="btn block" style={{ marginTop: 12 }} onClick={search} disabled={searching || q.trim().length < 2}>
          <Search />{searching ? 'Searching…' : 'Search live'}
        </button>
        {searchNote && <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>{searchNote}</p>}
        {hits.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {hits.map((h) => (
              <div className="row-item" key={h.chain + h.address}>
                <div className="row-icon"><Coins /></div>
                <div className="row-body">
                  <b>{h.symbol} — {h.name}</b>
                  <p className="muted">{h.chain} · {h.dex}{h.priceUsd !== null ? ` · $${h.priceUsd}` : ''}</p>
                  <p className="muted mono">{h.address}</p>
                </div>
                <div className="row-end"><button className="btn mint" onClick={() => addToken(h)}>Add</button></div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <SectionTitle icon={<BadgeCheck />}>Register a token manually</SectionTitle>
        <label>Symbol</label>
        <input value={add.symbol} onChange={(e) => setAdd({ ...add, symbol: e.target.value })} placeholder="USDC" />
        <label>Chain</label>
        <select value={add.chainId} onChange={(e) => setAdd({ ...add, chainId: e.target.value })}>
          <option value="">Select a chain…</option>
          {chains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label>Contract address (0x)</label>
        <input value={add.address} onChange={(e) => setAdd({ ...add, address: e.target.value })} placeholder="0x…" />
        <label>Decimals</label>
        <input value={add.decimals} inputMode="numeric" onChange={(e) => setAdd({ ...add, decimals: e.target.value })} />
        <label className="check-row"><input type="checkbox" checked={add.verified} onChange={(e) => setAdd({ ...add, verified: e.target.checked })} />Verified</label>
        <label className="check-row"><input type="checkbox" checked={add.featured} onChange={(e) => setAdd({ ...add, featured: e.target.checked })} />Featured</label>
        <button className="btn mint block" style={{ marginTop: 12 }} onClick={() => addToken()} disabled={!add.symbol || !add.chainId || !add.address}>
          Add to registry
        </button>
      </div>

      <div className="card">
        <SectionTitle icon={<BadgeCheck />}>Registered tokens</SectionTitle>
        {tokens.length === 0 ? (
          <p className="empty">No tokens registered yet. Search live above or register one manually.</p>
        ) : (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>Order</th><th>Token</th><th>Chain</th><th>Address</th><th>Decimals</th><th>Verified</th><th>Featured</th><th></th></tr></thead>
              <tbody>
                {tokens.map((t) => {
                  const sameChain = tokens.filter((x) => x.chain === t.chain)
                  const idx = sameChain.findIndex((x) => x.id === t.id)
                  return (
                  <tr key={t.id}>
                    <td data-label="Order">
                      <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
                        <button className="btn ghost" aria-label={`Move ${t.symbol} up`} disabled={idx <= 0} onClick={() => moveToken(t, -1)}><ChevronUp /></button>
                        <button className="btn ghost" aria-label={`Move ${t.symbol} down`} disabled={idx < 0 || idx >= sameChain.length - 1} onClick={() => moveToken(t, 1)}><ChevronDown /></button>
                      </span>
                    </td>
                    <td data-label="Token"><b>{t.symbol}</b></td>
                    <td data-label="Chain">{t.chain}</td>
                    <td data-label="Address"><span className="kbd">{t.address}</span></td>
                    <td data-label="Decimals">{t.decimals}</td>
                    <td data-label="Verified">{t.verified ? <span className="badge b-green">Yes</span> : <span className="badge b-grey">No</span>}</td>
                    <td data-label="Featured">{t.featured ? <span className="badge b-mint"><Star />Yes</span> : <span className="badge b-grey">No</span>}</td>
                    <td data-label="Remove"><button className="btn ghost" aria-label={`Remove ${t.symbol}`} onClick={() => setConfirmRemove(t)}><Trash2 /></button></td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          <X /> Token prices in the app are always live (DexScreener / GeckoTerminal); this registry only controls which tokens are featured or verified.
          Every token here appears in the app's My Assets for its chain, in the order above (up / down), with a verified badge when marked Verified.
        </p>
      </div>
    </div>
  )
}
