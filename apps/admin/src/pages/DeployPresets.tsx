import { useEffect, useState } from 'react'
import { BadgeCheck, Save, Settings2, ShieldAlert, Trash2 } from 'lucide-react'
import { api, type DeployPresetRow } from '../lib/api'
import { validateDeployPreset } from '../lib/deployPresets'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'
import { AlertModal } from '../components/AlertModal'

const CHAIN_OPTIONS = [
  { id: 'arc', name: 'Arc' },
  { id: 'bnb', name: 'BNB Smart Chain' },
  { id: 'base', name: 'Base' },
  { id: 'ethereum', name: 'Ethereum' },
  { id: 'polygon', name: 'Polygon' },
  { id: 'solana', name: 'Solana' },
]

const EMPTY = {
  chainId: 'arc', env: 'testnet' as 'testnet' | 'mainnet', label: '',
  owner: '', keeper: '', router: '', priceFeed: '',
  penaltyRecipient: '', feeRecipient: '', autoSellFeeBps: '0',
}

export default function DeployPresets() {
  const [presets, setPresets] = useState<DeployPresetRow[]>([])
  const [form, setForm] = useState(EMPTY)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<DeployPresetRow | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    api.getDeployPresets().then(setPresets).catch((e: Error) => setError(e.message))
  }
  useEffect(load, [])

  const edit = (p: DeployPresetRow) => {
    setForm({
      chainId: p.chain_id, env: p.env, label: p.label,
      owner: p.owner, keeper: p.keeper, router: p.router, priceFeed: p.price_feed,
      penaltyRecipient: p.penalty_recipient, feeRecipient: p.fee_recipient,
      autoSellFeeBps: String(p.auto_sell_fee_bps),
    })
    setNotice(`Editing the saved preset for ${p.chain_id} (${p.env}) — change what you need, then Save.`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const save = async () => {
    setError(''); setNotice('')
    const { preset, errors } = validateDeployPreset({
      ...form, autoSellFeeBps: Number(form.autoSellFeeBps),
    })
    if (!preset) { setError(errors.join(' ')); return }
    setBusy(true)
    try {
      await api.saveDeployPreset(preset)
      setNotice(`Preset saved for ${preset.chainId} (${preset.env}). Contract Studio will fill its 7 fields from it when you pick that network — no re-typing.`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save preset.') }
    setBusy(false)
  }

  const remove = async (p: DeployPresetRow) => {
    setError(''); setNotice('')
    try {
      await api.deleteDeployPreset(p.chain_id, p.env)
      setNotice(`Preset for ${p.chain_id} (${p.env}) deleted.`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete preset.') }
  }

  return (
    <div>
      <PageHeader
        icon={<Settings2 />}
        title="Deploy Presets"
        sub="Save the 7 StelixVault constructor values once, per chain and per network, and Contract Studio fills them in for you when you pick that network. You never have to re-type Owner, Keeper, Router, Price Feed, Penalty, Fee or the fee again."
        pill={<LiveNote />}
      />
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <AlertModal kind="success" message={notice} onClose={() => setNotice('')} />
      <AlertModal
        kind="confirm"
        message={confirmRemove ? `Delete the saved preset for ${confirmRemove.chain_id} (${confirmRemove.env})? Contract Studio will stop auto-filling it.` : null}
        confirmLabel="Delete"
        onConfirm={() => { if (confirmRemove) void remove(confirmRemove) }}
        onClose={() => setConfirmRemove(null)}
      />
      <div className="notice info">
        <ShieldAlert />
        <span>
          <b>Router and Price Feed are NOT the DEX addresses.</b> The vault speaks V2-style, Arc has only a Uniswap V3 SwapRouter — testnet <span className="kbd">0xfA845604F52843a7b5cfA4030120c6238741F420</span>, mainnet <span className="kbd">0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77</span> — so Router must be the <b>StelixV3RouterAdapter</b> address and Price Feed the <b>UniswapV3TwapFeed</b> address, both deployed first. Leave those two blank in a preset until the adapters are deployed; do not paste the V3 router in, a deploy would revert. Owner can be any address — a single wallet for testing, the Safe multisig later, changed via transferOwnership with no redeploy.
        </span>
      </div>
      <div className="grid grid2">
        <div className="card">
          <SectionTitle icon={<Save />}>Save / edit a preset</SectionTitle>
          <label>Chain</label>
          <select value={form.chainId} onChange={(e) => setForm({ ...form, chainId: e.target.value })}>
            {CHAIN_OPTIONS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label>Network</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className={form.env === 'testnet' ? 'btn mint' : 'btn ghost'} onClick={() => setForm({ ...form, env: 'testnet' })}>Testnet</button>
            <button className={form.env === 'mainnet' ? 'btn mint' : 'btn ghost'} onClick={() => setForm({ ...form, env: 'mainnet' })}>Mainnet</button>
          </div>
          <p className="field-hint">One preset per chain + network. Testnet and Mainnet are separate presets — a Testnet preset is never carried to Mainnet.</p>
          <label>Label (optional)</label>
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Arc Testnet — single owner test" />
          <label>Owner</label>
          <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} placeholder="0x…" />
          <label>Keeper address</label>
          <input value={form.keeper} onChange={(e) => setForm({ ...form, keeper: e.target.value })} placeholder="0x… — a different wallet from Owner" />
          <label>DEX router address — StelixV3RouterAdapter, after it is deployed</label>
          <input value={form.router} onChange={(e) => setForm({ ...form, router: e.target.value })} placeholder="0x… — blank until the adapter is deployed" />
          <label>Price feed address — UniswapV3TwapFeed, after it is deployed</label>
          <input value={form.priceFeed} onChange={(e) => setForm({ ...form, priceFeed: e.target.value })} placeholder="0x… — blank until the adapter is deployed" />
          <label>Penalty recipient address</label>
          <input value={form.penaltyRecipient} onChange={(e) => setForm({ ...form, penaltyRecipient: e.target.value })} placeholder="0x…" />
          <label>Fee recipient address</label>
          <input value={form.feeRecipient} onChange={(e) => setForm({ ...form, feeRecipient: e.target.value })} placeholder="0x…" />
          <label>Auto-sell fee bps (0–1000, max 10%)</label>
          <input value={form.autoSellFeeBps} inputMode="numeric" onChange={(e) => setForm({ ...form, autoSellFeeBps: e.target.value })} placeholder="0" />
          <button className="btn mint block" style={{ marginTop: 14 }} onClick={save} disabled={busy}><Save />{busy ? 'Saving…' : 'Save preset'}</button>
        </div>
        <div>
          <div className="card">
            <SectionTitle icon={<Settings2 />}>Saved presets</SectionTitle>
            {presets.length === 0 ? (
              <p className="empty">No presets saved yet. Fill the form and Save — Contract Studio will pull it in next time you pick that chain and network.</p>
            ) : (
              presets.map((p) => (
                <div key={p.id} className="card" style={{ marginBottom: 12 }}>
                  <b>{p.chain_id} · {p.env}</b>{p.label ? ` — ${p.label}` : ''}
                  <p className="muted" style={{ overflowWrap: 'anywhere' }}>
                    Owner: {p.owner || '—'}<br />
                    Keeper: {p.keeper || '—'}<br />
                    Router: {p.router || '— not set yet'}<br />
                    Price feed: {p.price_feed || '— not set yet'}<br />
                    Penalty: {p.penalty_recipient || '—'} · Fee: {p.fee_recipient || '—'} · Fee bps: {p.auto_sell_fee_bps}
                  </p>
                  <p className="field-hint">Updated {p.updated_at}{p.updated_by ? ` by ${p.updated_by}` : ''}</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn ghost" onClick={() => edit(p)}>Edit</button>
                    <button className="btn ghost" onClick={() => setConfirmRemove(p)}><Trash2 />Delete</button>
                    <a className="btn ghost" href="/studio">Open Contract Studio</a>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
