import { useEffect, useState } from 'react'
import { Globe, Link2, Pencil, Plus, ShieldCheck, Trash2, X } from 'lucide-react'
import { api } from '../lib/api'
import { validateChainInput, type ChainFieldErrors, type ChainInput, type ChainStatus } from '../lib/chainValidation'
import type { Chain } from '../lib/types'
import { LiveNote, PageHeader } from '../components/ui'

const badge = (s: Chain['status']) => s === 'live' ? 'b-green' : s === 'testnet' ? 'b-blue' : s === 'paused' ? 'b-amber' : 'b-grey'
const CHAIN_COLORS: Record<string, string> = {
  arc: '#2FD6A3', bnb: '#F0B90B', base: '#0052FF',
  ethereum: '#627EEA', polygon: '#8247E5', solana: '#9945FF',
}

interface ChainFormState {
  id: string; name: string; chainId: string; rpcUrls: string; explorerUrl: string
  nativeToken: string; nativeDecimals: string
  stablecoin: string; stablecoinAddress: string; stablecoinDecimals: string
  gasToken: string; dexRouter: string; vaultAddress: string
  status: ChainStatus; isTestnet: boolean; active: boolean
  pairedChainId: string; isDefault: boolean
}

const emptyForm: ChainFormState = {
  id: '', name: '', chainId: '', rpcUrls: '', explorerUrl: '',
  nativeToken: '', nativeDecimals: '18',
  stablecoin: '', stablecoinAddress: '', stablecoinDecimals: '6',
  gasToken: '', dexRouter: '', vaultAddress: '',
  status: 'testnet', isTestnet: true, active: true,
  pairedChainId: '', isDefault: false,
}

const fromChain = (c: Chain): ChainFormState => ({
  id: c.id, name: c.name, chainId: String(c.chainId), rpcUrls: c.rpcUrls.join(', '),
  explorerUrl: c.explorerUrl, nativeToken: c.nativeToken, nativeDecimals: String(c.nativeDecimals),
  stablecoin: c.stablecoin, stablecoinAddress: c.stablecoinAddress,
  stablecoinDecimals: String(c.stablecoinDecimals),
  gasToken: c.gasToken, dexRouter: c.dexRouter, vaultAddress: c.vaultAddress ?? '',
  status: c.status, isTestnet: c.isTestnet, active: c.active,
  pairedChainId: c.pairedChainId ?? '', isDefault: c.isDefault ?? false,
})

const toInput = (f: ChainFormState) => ({
  id: f.id.trim().toLowerCase(),
  name: f.name.trim(),
  chainId: f.chainId.trim(),
  rpcUrls: f.rpcUrls.trim(),
  explorerUrl: f.explorerUrl.trim(),
  nativeToken: f.nativeToken.trim(),
  nativeDecimals: f.nativeDecimals.trim(),
  stablecoin: f.stablecoin.trim(),
  stablecoinAddress: f.stablecoinAddress.trim(),
  stablecoinDecimals: f.stablecoinDecimals.trim(),
  gasToken: f.gasToken.trim(),
  dexRouter: f.dexRouter.trim(),
  vaultAddress: f.vaultAddress.trim(),
  status: f.status,
  isTestnet: f.isTestnet,
  active: f.active,
  pairedChainId: f.pairedChainId.trim(),
  isDefault: f.isDefault,
})

const errStyle = { color: '#e5484d', fontSize: 12, margin: '4px 0 0' } as const

function FieldError({ errors, field }: { errors: ChainFieldErrors; field: string }) {
  const msg = errors[field]
  return msg ? <p style={errStyle}>{msg}</p> : null
}

export default function Chains() {
  const [chains, setChains] = useState<Chain[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<ChainFormState>(emptyForm)
  const [addErrors, setAddErrors] = useState<ChainFieldErrors>({})
  const [editing, setEditing] = useState<Chain | null>(null)
  const [edit, setEdit] = useState<ChainFormState>(emptyForm)
  const [editErrors, setEditErrors] = useState<ChainFieldErrors>({})
  const [toggling, setToggling] = useState('')
  const [networkMode, setNetworkMode] = useState<'testnet' | 'mainnet' | null>(null)
  const [modeBusy, setModeBusy] = useState(false)

  const load = () => {
    api.getChains().then(setChains).catch((e: Error) => setError(e.message))
    api.getNetworkMode().then((d) => setNetworkMode(d.networkMode)).catch(() => undefined)
  }
  useEffect(() => { load() }, [])

  const set = (patch: Partial<ChainFormState>, which: 'add' | 'edit') => {
    if (which === 'add') setForm((f) => ({ ...f, ...patch }))
    else setEdit((f) => ({ ...f, ...patch }))
  }

  const addChain = async () => {
    setError('')
    const { value, errors } = validateChainInput(toInput(form))
    const local: ChainFieldErrors = { ...errors }
    if (value && chains.some((c) => c.id === value.id)) local.id = `A chain with the slug "${value.id}" already exists`
    if (value && chains.some((c) => c.chainId === value.chainId)) local.chainId = `Chain id ${value.chainId} is already used by "${chains.find((c) => c.chainId === value.chainId)?.id}"`
    if (value === null || Object.keys(local).length > 0) { setAddErrors(local); return }
    setAddErrors({})
    // Validation passed, so every required field is present.
    const chain = value as ChainInput
    try {
      await api.createChain({
        id: chain.id, name: chain.name, chainId: chain.chainId, rpcUrls: chain.rpcUrls,
        explorerUrl: chain.explorerUrl, nativeToken: chain.nativeToken,
        nativeDecimals: chain.nativeDecimals, stablecoin: chain.stablecoin,
        stablecoinAddress: chain.stablecoinAddress, stablecoinDecimals: chain.stablecoinDecimals,
        gasToken: chain.gasToken, dexRouter: chain.dexRouter,
        vaultAddress: chain.vaultAddress, status: chain.status,
        isTestnet: chain.isTestnet, active: chain.active,
        pairedChainId: chain.pairedChainId, isDefault: chain.isDefault,
      })
      setNotice(`Chain ${chain.name} added. It appears in the wallet picker on the next registry refresh — locks/swaps stay unavailable until its vault and DEX router are verified on the explorer.`)
      setShowAdd(false)
      setForm(emptyForm)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add chain.') }
  }

  const saveEdit = async () => {
    if (!editing) return
    setError('')
    const { value, errors } = validateChainInput(toInput(edit))
    const local: ChainFieldErrors = { ...errors }
    if (value && chains.some((c) => c.id !== editing.id && c.chainId === value.chainId)) {
      local.chainId = `Chain id ${value.chainId} is already used by "${chains.find((c) => c.id !== editing.id && c.chainId === value.chainId)?.id}"`
    }
    if (value === null || Object.keys(local).length > 0) { setEditErrors(local); return }
    setEditErrors({})
    try {
      // The slug never changes; every other field is sent as edited.
      // Verified values are prefilled from the row, never from defaults,
      // so saving without touching a field leaves it exactly as it was.
      const { id: _slug, ...rest } = value
      void _slug
      await api.updateChain(editing.id, rest)
      setNotice(`Chain ${editing.name} updated.`)
      setEditing(null)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update chain.') }
  }

  const toggleActive = async (c: Chain) => {
    setError('')
    setToggling(c.id)
    try {
      await api.setChainActive(c.id, !c.active)
      setNotice(`Chain ${c.name} ${c.active ? 'disabled — it will disappear from the wallet picker on the next registry refresh.' : 'enabled — it will reappear in the wallet picker on the next registry refresh.'}`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not change chain status.') }
    finally { setToggling('') }
  }

  const deleteChain = async (c: Chain) => {
    if (!window.confirm(`Delete ${c.name} (${c.id}) from the registry? The wallet will remove it on its next sync and can never bring it back from its built-in list. This cannot be undone except by adding the chain again.`)) return
    setError('')
    try {
      await api.deleteChain(c.id)
      setNotice(`Chain ${c.name} deleted and tombstoned — the wallet removes it on its next sync.`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete chain.') }
  }

  const setMode = async (mode: 'testnet' | 'mainnet' | null) => {
    setError('')
    setModeBusy(true)
    try {
      const r = await api.setNetworkMode(mode)
      setNetworkMode(r.networkMode)
      setNotice(
        mode === 'mainnet'
          ? 'Network mode is now Mainnet — the wallet switches to mainnet networks (Arc Mainnet, BNB, Base, Ethereum, Polygon, Solana) on its next sync, within ~45s. This does NOT deploy a vault or bypass the mainnet gate: mainnet chains with no vault still refuse locks and swaps.'
          : mode === 'testnet'
            ? 'Network mode is now Testnet — the wallet switches to testnet networks on its next sync, within ~45s.'
            : 'Network mode cleared — the wallet shows all networks again, as before.',
      )
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not set network mode.') }
    setModeBusy(false)
  }

  const renderForm = (f: ChainFormState, errors: ChainFieldErrors, which: 'add' | 'edit') => (
    <>
      {which === 'add' && (
        <>
          <label>Chain slug (id, e.g. arbitrum)</label>
          <input value={f.id} onChange={(e) => set({ id: e.target.value }, 'add')} placeholder="arbitrum" />
          <FieldError errors={errors} field="id" />
        </>
      )}
      {which === 'edit' && (
        <p className="muted small">Slug: <span className="kbd">{f.id}</span> (the slug never changes — it is the chain&apos;s id in D1 and in the wallet)</p>
      )}
      <label>Name</label>
      <input value={f.name} onChange={(e) => set({ name: e.target.value }, which)} placeholder="Arbitrum One" />
      <FieldError errors={errors} field="name" />
      <label>Chain ID (number)</label>
      <input value={f.chainId} inputMode="numeric" onChange={(e) => set({ chainId: e.target.value }, which)} placeholder="42161" />
      <FieldError errors={errors} field="chainId" />
      <label>RPC URLs (comma-separated, https only)</label>
      <input value={f.rpcUrls} onChange={(e) => set({ rpcUrls: e.target.value }, which)} placeholder="https://arb1.arbitrum.io/rpc" />
      <FieldError errors={errors} field="rpcUrls" />
      <label>Explorer URL (https)</label>
      <input value={f.explorerUrl} onChange={(e) => set({ explorerUrl: e.target.value }, which)} placeholder="https://arbiscan.io" />
      <FieldError errors={errors} field="explorerUrl" />
      <label>Native currency symbol</label>
      <input value={f.nativeToken} onChange={(e) => set({ nativeToken: e.target.value }, which)} placeholder="ETH" />
      <FieldError errors={errors} field="nativeToken" />
      <label>Native currency decimals</label>
      <input value={f.nativeDecimals} inputMode="numeric" onChange={(e) => set({ nativeDecimals: e.target.value }, which)} placeholder="18 (Arc USDC gas is 6)" />
      <FieldError errors={errors} field="nativeDecimals" />
      <label>Gas token symbol (blank = same as native currency)</label>
      <input value={f.gasToken} onChange={(e) => set({ gasToken: e.target.value }, which)} placeholder="ETH" />
      <FieldError errors={errors} field="gasToken" />
      <label>Stablecoin symbol</label>
      <input value={f.stablecoin} onChange={(e) => set({ stablecoin: e.target.value }, which)} placeholder="USDC" />
      <FieldError errors={errors} field="stablecoin" />
      <label>Stablecoin address (0x — verified on explorer only, leave blank if unknown)</label>
      <input value={f.stablecoinAddress} onChange={(e) => set({ stablecoinAddress: e.target.value }, which)} placeholder="0x… (blank = not confirmed yet)" />
      <FieldError errors={errors} field="stablecoinAddress" />
      <label>Stablecoin decimals</label>
      <input value={f.stablecoinDecimals} inputMode="numeric" onChange={(e) => set({ stablecoinDecimals: e.target.value }, which)} placeholder="6" />
      <FieldError errors={errors} field="stablecoinDecimals" />
      <label>DEX router address (0x — verified on explorer only, leave blank if unknown; never guess one)</label>
      <input value={f.dexRouter} onChange={(e) => set({ dexRouter: e.target.value }, which)} placeholder="0x… (blank = not confirmed yet)" />
      <FieldError errors={errors} field="dexRouter" />
      <label>Vault address (0x — verified on explorer only, leave blank if unknown; normally set by Contract Studio registration)</label>
      <input value={f.vaultAddress} onChange={(e) => set({ vaultAddress: e.target.value }, which)} placeholder="0x… (blank = not deployed)" />
      <FieldError errors={errors} field="vaultAddress" />
      <label>Status</label>
      <select value={f.status} onChange={(e) => set({ status: e.target.value as ChainStatus, isTestnet: e.target.value === 'testnet' }, which)}>
        <option value="testnet">testnet</option>
        <option value="live">live</option>
        <option value="paused">paused</option>
        <option value="hidden">hidden</option>
      </select>
      <FieldError errors={errors} field="status" />
      <label>Paired chain slug (testnet ↔ mainnet pair, e.g. arc — blank if unpaired)</label>
      <input value={f.pairedChainId} onChange={(e) => set({ pairedChainId: e.target.value }, which)} placeholder="arc" />
      <FieldError errors={errors} field="pairedChainId" />
      <label className="check-row">
        <input type="checkbox" checked={f.isTestnet} onChange={(e) => set({ isTestnet: e.target.checked }, which)} />
        Testnet chain
      </label>
      <label className="check-row">
        <input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked }, which)} />
        Enabled — listed in the wallet (uncheck to hide it without deleting it)
      </label>
      <label className="check-row">
        <input type="checkbox" checked={f.isDefault} onChange={(e) => set({ isDefault: e.target.checked }, which)} />
        Default chain in the wallet
      </label>
    </>
  )

  return (
    <div>
      <PageHeader
        icon={<Link2 />}
        title="Chain Manager"
        sub="Add / edit chains: RPCs, explorer, native token, stablecoin, DEX router, status. A chain added here appears in the wallet picker on the next registry refresh — no app rebuild. Disabling hides it again. Locks/swaps stay unavailable on a chain until its vault and router are verified on the explorer. Arc is the default chain."
        pill={<LiveNote />}
        actions={
          <button className="btn mint" onClick={() => { setShowAdd((v) => !v); setNotice(''); setAddErrors({}) }}>
            <Plus />Add chain
          </button>
        }
      />
      {error && <div className="notice alert"><ShieldCheck /><span>{error}</span></div>}
      {notice && <div className="notice ok"><ShieldCheck /><span>{notice}</span></div>}

      <div className="card">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Globe />Network mode — Testnet / Mainnet</h2>
        <p className="muted">
          The wallet follows this mode in real time (within ~45s): <b>Testnet</b> shows testnet chains only,
          <b> Mainnet</b> shows mainnet chains only (Arc Mainnet 5042, BNB, Base, Ethereum, Polygon, Solana),
          <b> All networks</b> shows everything, as before. The wallet switches to the paired chain when one
          exists (Arc ↔ Arc Mainnet); a switch never happens mid-transaction — it waits until the user&apos;s
          signing flow finishes. Flipping the mode does <b>not</b> deploy a vault, does <b>not</b> bypass the
          mainnet gate, and does <b>not</b> make locks or swaps go live on mainnet: a mainnet chain with no
          vault still refuses honestly in the wallet.
        </p>
        <p className="muted">Current mode: <b>{networkMode === 'mainnet' ? 'Mainnet' : networkMode === 'testnet' ? 'Testnet' : 'All networks (not set)'}</b></p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn mint" disabled={modeBusy || networkMode === 'testnet'} onClick={() => void setMode('testnet')}>Testnet</button>
          <button className="btn" disabled={modeBusy || networkMode === 'mainnet'} onClick={() => void setMode('mainnet')}>Mainnet</button>
          <button className="btn ghost" disabled={modeBusy || networkMode === null} onClick={() => void setMode(null)}>All networks</button>
        </div>
      </div>

      {showAdd && (
        <div className="card">
          <h2>Add chain</h2>
          {renderForm(form, addErrors, 'add')}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn mint" onClick={addChain}><Plus />Save chain to D1</button>
            <button className="btn ghost" onClick={() => { setShowAdd(false); setAddErrors({}) }}><X />Cancel</button>
          </div>
        </div>
      )}

      {editing && (
        <div className="card">
          <h2>Edit {editing.name}</h2>
          {renderForm(edit, editErrors, 'edit')}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn mint" onClick={saveEdit}>Save changes</button>
            <button className="btn ghost" onClick={() => { setEditing(null); setEditErrors({}) }}><X />Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="rtable">
            <thead><tr><th>Chain</th><th>Chain ID</th><th>Native / Stablecoin</th><th>DEX router</th><th>Vault</th><th>Status</th><th>Listed</th><th></th></tr></thead>
            <tbody>
              {chains.length === 0 && (
                <tr><td colSpan={8}><p className="empty">No chains configured yet.</p></td></tr>
              )}
              {chains.map((c) => (
                <tr key={c.id}>
                  <td data-label="Chain">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', maxWidth: '100%' }}>
                      <span className="chain-dot" style={{ background: CHAIN_COLORS[c.id] ?? '#8A99AF' }} />
                      <b className="chain-name">{c.name}</b>
                      {c.isDefault && <span className="badge b-mint">Default</span>}
                      {c.isTestnet && <span className="badge b-blue">Testnet</span>}
                      {c.pairedChainId && <span className="muted small">↔ {c.pairedChainId}</span>}
                    </span>
                    <span className="muted small chain-url">{c.explorerUrl}</span>
                  </td>
                  <td data-label="Chain ID">{c.chainId}</td>
                  <td data-label="Native / Stablecoin">
                    {c.nativeToken} ({c.nativeDecimals} dec) / {c.stablecoin} ({c.stablecoinDecimals} dec)<br />
                    <span className="muted kbd">{c.stablecoinAddress ? c.stablecoinAddress.slice(0, 18) + '…' : 'not confirmed yet'}</span>
                  </td>
                  <td data-label="DEX router">{c.dexRouter ? <span className="kbd">{c.dexRouter.slice(0, 18)}…</span> : <span className="muted">Not confirmed yet</span>}</td>
                  <td data-label="Vault">{c.vaultAddress ? <span className="kbd">{c.vaultAddress.slice(0, 18)}…</span> : <span className="muted">Not deployed yet — deploy from Contract Studio</span>}</td>
                  <td data-label="Status"><span className={'badge ' + badge(c.status)}>{c.status}</span></td>
                  <td data-label="Listed">
                    <span className={'badge ' + (c.active ? 'b-green' : 'b-grey')}>{c.active ? 'Enabled' : 'Disabled'}</span>
                  </td>
                  <td data-label="Edit">
                    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn ghost" onClick={() => { setEditing(c); setEdit(fromChain(c)); setEditErrors({}); setNotice('') }}>
                        <Pencil />Edit
                      </button>
                      <button className="btn ghost" disabled={toggling === c.id} onClick={() => toggleActive(c)}>
                        {c.active ? 'Disable' : 'Enable'}
                      </button>
                      <button className="btn ghost" onClick={() => void deleteChain(c)} title="Delete chain (refused when it is the default, has a vault, has a deployment, or still has registered tokens)">
                        <Trash2 />Delete
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="notice info">
        <ShieldCheck />
        <span><b>Testnet-first rule:</b> every chain goes testnet → full lock → target → auto-sell test → verify → mainnet. The app shows a Testnet badge whenever a testnet chain is selected. Router and vault addresses are only ever pasted from the explorer — a chain with no verified router/vault is listed for viewing only, and the wallet says so.</span>
      </div>
    </div>
  )
}
