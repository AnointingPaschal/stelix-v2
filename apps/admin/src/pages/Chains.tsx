import { useEffect, useState } from 'react'
import { Link2, Pencil, Plus, ShieldCheck, X } from 'lucide-react'
import { api } from '../lib/api'
import type { Chain } from '../lib/types'
import { LiveNote, PageHeader } from '../components/ui'

const badge = (s: Chain['status']) => s === 'live' ? 'b-green' : s === 'testnet' ? 'b-blue' : s === 'paused' ? 'b-amber' : 'b-grey'
const CHAIN_COLORS: Record<string, string> = {
  arc: '#2FD6A3', bnb: '#F0B90B', base: '#0052FF',
  ethereum: '#627EEA', polygon: '#8247E5', solana: '#9945FF',
}

const emptyForm = {
  id: '', name: '', chainId: '', rpcUrls: '', explorerUrl: '',
  nativeToken: '', stablecoin: '', stablecoinAddress: '', dexRouter: '', status: 'hidden' as Chain['status'],
}

export default function Chains() {
  const [chains, setChains] = useState<Chain[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<Chain | null>(null)
  const [edit, setEdit] = useState({ status: 'hidden' as Chain['status'], vaultAddress: '', dexRouter: '', stablecoinAddress: '' })

  const load = () => { api.getChains().then(setChains).catch((e: Error) => setError(e.message)) }
  useEffect(() => { load() }, [])

  const addChain = async () => {
    setError('')
    try {
      await api.createChain({
        id: form.id.trim().toLowerCase(), name: form.name.trim(), chainId: Number(form.chainId),
        rpcUrls: form.rpcUrls.trim(), explorerUrl: form.explorerUrl.trim(), nativeToken: form.nativeToken.trim(),
        stablecoin: form.stablecoin.trim(), stablecoinAddress: form.stablecoinAddress.trim(),
        dexRouter: form.dexRouter.trim(), status: form.status,
      })
      setNotice(`Chain ${form.name.trim()} added.`)
      setShowAdd(false)
      setForm(emptyForm)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add chain.') }
  }

  const saveEdit = async () => {
    if (!editing) return
    setError('')
    try {
      await api.updateChain(editing.id, {
        status: edit.status,
        vaultAddress: edit.vaultAddress.trim() === '' ? null : edit.vaultAddress.trim(),
        dexRouter: edit.dexRouter, stablecoinAddress: edit.stablecoinAddress,
      })
      setNotice(`Chain ${editing.name} updated.`)
      setEditing(null)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update chain.') }
  }

  return (
    <div>
      <PageHeader
        icon={<Link2 />}
        title="Chain Manager"
        sub="Add / edit chains: RPCs, explorer, native token, stablecoin, DEX router, status. Pausing stops new locks in the app within one config refresh. Arc is the default chain."
        pill={<LiveNote />}
        actions={
          <button className="btn mint" onClick={() => { setShowAdd((v) => !v); setNotice('') }}>
            <Plus />Add chain
          </button>
        }
      />
      {error && <div className="notice alert"><ShieldCheck /><span>{error}</span></div>}
      {notice && <div className="notice ok"><ShieldCheck /><span>{notice}</span></div>}

      {showAdd && (
        <div className="card">
          <h2>Add chain</h2>
          <label>Chain slug (id, e.g. arc)</label>
          <input value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="arc" />
          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Arc" />
          <label>Chain ID (number)</label>
          <input value={form.chainId} inputMode="numeric" onChange={(e) => setForm({ ...form, chainId: e.target.value })} placeholder="5042002" />
          <label>RPC URLs (comma-separated)</label>
          <input value={form.rpcUrls} onChange={(e) => setForm({ ...form, rpcUrls: e.target.value })} placeholder="https://rpc.testnet.arc.network" />
          <label>Explorer URL</label>
          <input value={form.explorerUrl} onChange={(e) => setForm({ ...form, explorerUrl: e.target.value })} placeholder="https://testnet.arcscan.app" />
          <label>Native token</label>
          <input value={form.nativeToken} onChange={(e) => setForm({ ...form, nativeToken: e.target.value })} placeholder="USDC" />
          <label>Stablecoin symbol</label>
          <input value={form.stablecoin} onChange={(e) => setForm({ ...form, stablecoin: e.target.value })} placeholder="USDC" />
          <label>Stablecoin address (0x, leave blank until confirmed on the explorer)</label>
          <input value={form.stablecoinAddress} onChange={(e) => setForm({ ...form, stablecoinAddress: e.target.value })} placeholder="0x…" />
          <label>DEX router address (0x, leave blank until confirmed — never guess one)</label>
          <input value={form.dexRouter} onChange={(e) => setForm({ ...form, dexRouter: e.target.value })} placeholder="0x…" />
          <label>Status</label>
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Chain['status'] })}>
            <option value="testnet">testnet</option>
            <option value="live">live</option>
            <option value="paused">paused</option>
            <option value="hidden">hidden</option>
          </select>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn mint" onClick={addChain}><Plus />Save chain to D1</button>
            <button className="btn ghost" onClick={() => setShowAdd(false)}><X />Cancel</button>
          </div>
        </div>
      )}

      {editing && (
        <div className="card">
          <h2>Edit {editing.name}</h2>
          <label>Status</label>
          <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as Chain['status'] })}>
            <option value="testnet">testnet</option>
            <option value="live">live</option>
            <option value="paused">paused</option>
            <option value="hidden">hidden</option>
          </select>
          <label>Vault address (0x — set by Contract Studio registration, or paste a verified address)</label>
          <input value={edit.vaultAddress} onChange={(e) => setEdit({ ...edit, vaultAddress: e.target.value })} placeholder="0x… (blank = not deployed)" />
          <label>DEX router address (0x)</label>
          <input value={edit.dexRouter} onChange={(e) => setEdit({ ...edit, dexRouter: e.target.value })} placeholder="0x…" />
          <label>Stablecoin address (0x)</label>
          <input value={edit.stablecoinAddress} onChange={(e) => setEdit({ ...edit, stablecoinAddress: e.target.value })} placeholder="0x…" />
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn mint" onClick={saveEdit}>Save changes</button>
            <button className="btn ghost" onClick={() => setEditing(null)}><X />Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="rtable">
            <thead><tr><th>Chain</th><th>Chain ID</th><th>Native / Stablecoin</th><th>DEX router</th><th>Vault</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {chains.length === 0 && (
                <tr><td colSpan={7}><p className="empty">No chains configured yet.</p></td></tr>
              )}
              {chains.map((c) => (
                <tr key={c.id}>
                  <td data-label="Chain">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span className="chain-dot" style={{ background: CHAIN_COLORS[c.id] ?? '#8A99AF' }} />
                      <b>{c.name}</b>
                      {c.isDefault && <span className="badge b-mint">Default</span>}
                    </span>
                    <br /><span className="muted small">{c.explorerUrl}</span>
                  </td>
                  <td data-label="Chain ID">{c.chainId}</td>
                  <td data-label="Native / Stablecoin">
                    {c.nativeToken} / {c.stablecoin}<br />
                    <span className="muted kbd">{c.stablecoinAddress ? c.stablecoinAddress.slice(0, 18) + '…' : 'not confirmed yet'}</span>
                  </td>
                  <td data-label="DEX router">{c.dexRouter ? <span className="kbd">{c.dexRouter.slice(0, 18)}…</span> : <span className="muted">Not confirmed yet</span>}</td>
                  <td data-label="Vault">{c.vaultAddress ? <span className="kbd">{c.vaultAddress.slice(0, 18)}…</span> : <span className="muted">Not deployed yet — deploy from Contract Studio</span>}</td>
                  <td data-label="Status"><span className={'badge ' + badge(c.status)}>{c.status}</span></td>
                  <td data-label="Edit">
                    <button className="btn ghost" onClick={() => { setEditing(c); setEdit({ status: c.status, vaultAddress: c.vaultAddress ?? '', dexRouter: c.dexRouter, stablecoinAddress: c.stablecoinAddress }) }}>
                      <Pencil />Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="notice info">
        <ShieldCheck />
        <span><b>Testnet-first rule:</b> every chain goes testnet → full lock → target → auto-sell test → verify → mainnet. The app shows a Testnet badge whenever a testnet chain is selected.</span>
      </div>
    </div>
  )
}
