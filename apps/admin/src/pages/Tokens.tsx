import { useEffect, useState } from 'react'
import { BadgeCheck, ChevronDown, ChevronUp, Coins, Gauge, ImagePlus, Percent, Pencil, Search, Star, Timer, Trash2, X } from 'lucide-react'
import { api } from '../lib/api'
import type { Chain } from '../lib/types'
import { isValidLogoUrl, normalizeDisplayName, normalizeDisplaySymbol, parseSortOrder } from '../lib/tokenEdit'
import { LiveNote, PageHeader, SectionTitle, StatCard } from '../components/ui'
import { AlertModal } from '../components/AlertModal'

type RegistryToken = { id: number; symbol: string; chain: string; address: string; decimals: number; verified: boolean; featured: boolean; sortOrder: number; name: string | null; logoUrl: string | null }
type SearchHit = { symbol: string; name: string; chain: string; address: string; priceUsd: number | null; dex: string; pairUrl: string | null; source: string }

const short = (addr: string): string => (addr.length > 13 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr)

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const LOGO_MAX_BYTES = 256 * 1024

/** Edit a token's registry display — centred modal (never an inline
 *  banner). Only the display changes here: display name, display
 *  symbol, verified, featured, sort order and logo. Address, chain and
 *  decimals are on-chain truth — shown read-only, never editable, and
 *  the server rejects them if sent. Sort order is a plain non-negative
 *  integer (scientific notation rejected). The logo is either uploaded
 *  as a file (same 256 KB PNG/JPG/WebP/GIF rule as the Launchpad) or
 *  pasted as an https URL. */
function EditTokenModal({ token, onClose, onSaved, onError }: {
  token: RegistryToken
  onClose: () => void
  onSaved: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [displayName, setDisplayName] = useState(token.name ?? '')
  const [displaySymbol, setDisplaySymbol] = useState(token.symbol)
  const [sortOrder, setSortOrder] = useState(String(token.sortOrder))
  const [logoUrl, setLogoUrl] = useState(token.logoUrl ?? '')
  const [verified, setVerified] = useState(token.verified)
  const [featured, setFeatured] = useState(token.featured)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  const pickLogo = async (file: File | undefined) => {
    if (!file) return
    if (!LOGO_TYPES.includes(file.type)) { onError(`Logo must be PNG, JPG, WebP or GIF — "${file.type || 'unknown type'}" is not accepted.`); return }
    if (file.size <= 0 || file.size > LOGO_MAX_BYTES) { onError('Logo must be between 1 byte and 256 KB.'); return }
    setUploading(true)
    try {
      const { url } = await api.uploadLaunchLogo(file)
      setLogoUrl(url)
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not upload the logo.') }
    setUploading(false)
  }

  const save = async () => {
    const name = normalizeDisplayName(displayName)
    if (name === null) { onError('Display name must be at most 64 characters.'); return }
    const symbol = normalizeDisplaySymbol(displaySymbol)
    if (symbol === null) { onError('Display symbol must be 1–32 characters.'); return }
    const order = parseSortOrder(sortOrder)
    if (order === null) { onError('Sort order must be a plain non-negative integer, e.g. 0 — no scientific notation.'); return }
    const logo = logoUrl.trim()
    if (!isValidLogoUrl(logo)) { onError('Logo must be empty (no logo) or a valid https URL.'); return }
    setSaving(true)
    try {
      await api.updateToken(token.id, {
        displayName: name === '' ? null : name, displaySymbol: symbol,
        verified, featured, sortOrder: order, logoUrl: logo === '' ? null : logo,
      })
      onSaved(`${symbol} updated.`)
      onClose()
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not update token.') }
    setSaving(false)
  }

  return (
    <div className="alert-overlay" role="dialog" aria-modal="true" aria-label={`Edit ${token.symbol} token`} onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="alert-close" onClick={onClose} aria-label="Close"><X /></button>
        <h3>Edit token — {token.symbol}</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {token.chain} · {token.decimals} decimals · {short(token.address)}
        </p>
        <p className="muted">
          Address, chain and decimals are on-chain truth and cannot be changed here. Name and symbol only change what the app shows for this token — the on-chain token is untouched.
        </p>
        <label>Display name</label>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={token.symbol} />
        <label>Display symbol</label>
        <input value={displaySymbol} onChange={(e) => setDisplaySymbol(e.target.value)} placeholder="STX" />
        <label>Sort order</label>
        <input value={sortOrder} inputMode="numeric" onChange={(e) => setSortOrder(e.target.value)} placeholder="0" />
        <label>Logo</label>
        {logoUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <img src={logoUrl} alt="Token logo" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border, #E5E7EB)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="muted" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{logoUrl}</p>
            </div>
            <button className="btn" onClick={() => setLogoUrl('')}>Remove</button>
          </div>
        ) : (
          <p className="muted" style={{ margin: '0 0 8px' }}>No logo yet.</p>
        )}
        <label className="btn" style={{ cursor: uploading ? 'wait' : 'pointer', marginBottom: 8 }}>
          <ImagePlus /> {uploading ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            style={{ display: 'none' }}
            disabled={uploading}
            onChange={(e) => { void pickLogo(e.target.files?.[0]); e.target.value = '' }}
          />
        </label>
        <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="…or paste an https logo URL" />
        <p className="field-hint">PNG, JPG, WebP or GIF, max 256 KB. The file is uploaded — never a link — and served from the admin.</p>
        <label>Contract address (on-chain, read-only)</label>
        <input value={token.address} disabled readOnly />
        <label>Chain (on-chain, read-only)</label>
        <input value={token.chain} disabled readOnly />
        <label>Decimals (on-chain, read-only)</label>
        <input value={String(token.decimals)} disabled readOnly />
        <label className="check-row"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />Verified</label>
        <label className="check-row"><input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />Featured</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn mint" onClick={save} disabled={saving || uploading}>
            {saving ? 'Saving…' : 'Save token'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Tokens() {
  const [tokens, setTokens] = useState<RegistryToken[]>([])
  const [chains, setChains] = useState<Chain[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<RegistryToken | null>(null)
  const [editToken, setEditToken] = useState<RegistryToken | null>(null)
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
      {editToken && (
        <EditTokenModal
          token={editToken}
          onClose={() => setEditToken(null)}
          onSaved={(msg) => { setNotice(msg); load() }}
          onError={setError}
        />
      )}
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
          tokens.map((t) => {
            const sameChain = tokens.filter((x) => x.chain === t.chain)
            const idx = sameChain.findIndex((x) => x.id === t.id)
            return (
              <div className="launch-card" key={t.id}>
                <div className="launch-head">
                  <div className="launch-logo">
                    {t.logoUrl ? <img src={t.logoUrl} alt={`${t.symbol} logo`} /> : <Coins />}
                  </div>
                  <div className="launch-title">
                    <b>{t.name || t.symbol}</b>
                    <span className="muted">{t.symbol} · {t.chain}</span>
                    <span className="muted mono">{short(t.address)}</span>
                  </div>
                </div>
                <div className="launch-meta">
                  <p>{t.decimals} decimals · Sort order {t.sortOrder}</p>
                  <p>
                    {t.verified ? <span className="badge b-green">Verified</span> : <span className="badge b-grey">Not verified</span>}
                    {' '}
                    {t.featured ? <span className="badge b-mint"><Star />Featured</span> : <span className="badge b-grey">Not featured</span>}
                  </p>
                </div>
                <div className="launch-actions">
                  <button className="btn" onClick={() => setEditToken(t)}><Pencil />Edit</button>
                  <button className="btn ghost" aria-label={`Move ${t.symbol} up`} disabled={idx <= 0} onClick={() => moveToken(t, -1)}><ChevronUp /></button>
                  <button className="btn ghost" aria-label={`Move ${t.symbol} down`} disabled={idx < 0 || idx >= sameChain.length - 1} onClick={() => moveToken(t, 1)}><ChevronDown /></button>
                  <button className="btn ghost" aria-label={`Remove ${t.symbol}`} onClick={() => setConfirmRemove(t)}><Trash2 />Remove</button>
                </div>
              </div>
            )
          })
        )}
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          <X /> Token prices in the app are always live (DexScreener / GeckoTerminal); this registry only controls which tokens are featured or verified.
          Every token here appears in the app's My Assets for its chain, in the order above (up / down), with a verified badge when marked Verified.
        </p>
      </div>
    </div>
  )
}
