import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, Copy, ExternalLink, KeyRound, ShieldAlert, ShieldCheck, Trash2, Users } from 'lucide-react'
import { api, type MultisigRow } from '../lib/api'
import type { Chain } from '../lib/types'
import {
  MAX_OWNERS, MIN_OWNERS, SAFE_CHAINS, SAFE_FALLBACK_HANDLER, SAFE_PROXY_FACTORY, SAFE_SINGLETON,
  SAFE_VERSION, SAFE_WEB_APP, safeChainFor, thresholdLabel, validateMultisigInput,
} from '../lib/multisig'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

export default function Multisig() {
  const [chains, setChains] = useState<Chain[]>([])
  const [rows, setRows] = useState<MultisigRow[]>([])
  const [label, setLabel] = useState('')
  const [chainId, setChainId] = useState('bnb')
  const [ownerInputs, setOwnerInputs] = useState<string[]>(['', '', ''])
  const [threshold, setThreshold] = useState(2)
  const [saltNonce, setSaltNonce] = useState('0')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [justPrepared, setJustPrepared] = useState<MultisigRow | null>(null)
  const [predicted, setPredicted] = useState('')
  const [confirmAddr, setConfirmAddr] = useState('')
  const [confirmTx, setConfirmTx] = useState('')
  const [confirmFor, setConfirmFor] = useState<number | null>(null)

  const load = () => {
    api.getChains().then(setChains).catch(() => undefined)
    api.getMultisigs().then(setRows).catch((e: Error) => setError(e.message))
  }
  useEffect(load, [])

  const chainInfo = safeChainFor(chainId)
  const ownerCount = ownerInputs.filter((o) => o.trim() !== '').length
  const deployed = useMemo(() => rows.filter((r) => r.status === 'deployed'), [rows])
  const prepared = useMemo(() => rows.filter((r) => r.status === 'prepared'), [rows])

  const setOwner = (i: number, v: string) => {
    const next = [...ownerInputs]
    next[i] = v
    setOwnerInputs(next)
    if (threshold > next.filter((o) => o.trim() !== '').length) {
      setThreshold(Math.max(1, next.filter((o) => o.trim() !== '').length))
    }
  }

  const prepare = async () => {
    setError(''); setNotice(''); setJustPrepared(null)
    const owners = ownerInputs.map((o) => o.trim()).filter(Boolean)
    const { multisig, errors } = validateMultisigInput({ chainId, label, owners, threshold, saltNonce })
    if (!multisig) { setError(errors.join(' ')); return }
    setBusy(true)
    try {
      const r = await api.createMultisig({ chainId, label: multisig.label, owners, threshold, saltNonce })
      setNotice(`Multisig prepared on ${chainInfo?.name ?? chainId}: ${thresholdLabel(threshold, owners.length)}. It is NOT deployed yet — create the Safe in your wallet next, then confirm it below. No Safe address has been recorded.`)
      setOwnerInputs(['', '', ''])
      setThreshold(2)
      setLabel('')
      load()
      const created = (await api.getMultisigs()).find((m) => m.id === r.id) ?? null
      setJustPrepared(created)
      if (created) { setConfirmFor(created.id); setPredicted(''); setConfirmAddr(''); setConfirmTx('') }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not prepare the multisig.') }
    setBusy(false)
  }

  const savePredicted = async (row: MultisigRow) => {
    setError(''); setNotice('')
    if (!predicted.trim()) { setError('Paste the predicted Safe address the Safe app shows before you deploy.'); return }
    setBusy(true)
    try {
      await api.setMultisigPredicted(row.id, predicted.trim())
      setNotice(`Predicted Safe address saved for multisig #${row.id}. It is still a prediction — it becomes usable as vault Owner only after the Safe is deployed and confirmed on-chain.`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the predicted address.') }
    setBusy(false)
  }

  const confirm = async (row: MultisigRow) => {
    setError(''); setNotice('')
    if (!confirmAddr.trim()) { setError('Enter the deployed Safe address.'); return }
    setBusy(true)
    try {
      const r = await api.confirmMultisig(row.id, confirmAddr.trim(), confirmTx.trim() || null)
      setNotice(`Verified on-chain: Safe ${r.safeAddress} on ${r.chain} is ${thresholdLabel(r.threshold, r.owners.length)}. It is now available as the vault Owner in Contract Studio.`)
      setConfirmFor(null); setConfirmAddr(''); setConfirmTx(''); setJustPrepared(null)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Confirmation failed.') }
    setBusy(false)
  }

  const remove = async (row: MultisigRow) => {
    if (!window.confirm(`Discard the prepared (not deployed) multisig #${row.id} on ${row.chainId}?`)) return
    setError('')
    try {
      await api.deleteMultisig(row.id)
      setNotice(`Prepared multisig #${row.id} discarded. Nothing was deployed.`)
      if (justPrepared?.id === row.id) setJustPrepared(null)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete the multisig.') }
  }

  const copySummary = async (row: MultisigRow) => {
    const info = safeChainFor(row.chainId)
    const text = [
      `Stelix multisig #${row.id}${row.label ? ` — ${row.label}` : ''}`,
      `Chain: ${info?.name ?? row.chainId} (chain id ${info?.chainId ?? '?'})`,
      `Safe version: ${row.safeVersion} (canonical)`,
      `SafeProxyFactory: ${row.factoryAddress}`,
      `Safe singleton: ${row.singletonAddress}`,
      `Fallback handler: ${SAFE_FALLBACK_HANDLER}`,
      `Owners (${row.threshold}-of-${row.owners.length}):`,
      ...row.owners.map((o, i) => `  ${i + 1}. ${o}`),
      `Threshold: ${row.threshold}`,
      `Salt nonce (reference only): ${row.saltNonce}`,
      row.predictedAddress ? `Predicted Safe address (from the Safe app, not yet deployed): ${row.predictedAddress}` : '',
      row.safeAddress ? `Deployed Safe address (verified on-chain): ${row.safeAddress}` : '',
      'Create it in your wallet — the admin never deploys a Safe and never holds a private key.',
    ].filter(Boolean).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setNotice('Creation summary copied — paste it into the Safe app / CLI where you create the Safe.')
    } catch {
      setError('Could not copy automatically — select the summary text manually.')
    }
  }

  const castCommand = (row: MultisigRow) => {
    const rpc = chains.find((c) => c.id === row.chainId)?.rpcUrls[0] ?? ''
    return `cast safe create ${row.owners.join(' ')} --threshold ${row.threshold} --salt-nonce ${row.saltNonce} --factory ${row.factoryAddress} --singleton ${row.singletonAddress} --fallback-handler ${SAFE_FALLBACK_HANDLER}${rpc ? ` --rpc-url ${rpc}` : ''}`
  }

  return (
    <div>
      <PageHeader
        icon={<Users />}
        title="Multisig Creator"
        sub="Create a Safe multisig to own the StelixVault. The admin only prepares the plan — the Safe itself is created and signed in the owners' own wallets, and its address is recorded only after the admin verifies it on-chain. No private key is ever stored here."
        pill={<LiveNote />}
      />
      {error && <div className="notice alert"><ShieldAlert /><span>{error}</span></div>}
      {notice && <div className="notice ok"><BadgeCheck /><span>{notice}</span></div>}
      <div className="notice info">
        <ShieldAlert />
        <span>
          <b>How it works:</b> 1) Prepare the owners + threshold below. 2) Create the Safe in your wallet
          (Safe web app on Ethereum / BNB / Base / Polygon; Safe CLI or <span className="kbd">cast safe create</span> on
          Arc, where the Safe web app does not list the chain). 3) Paste the deployed Safe address below and
          confirm — the admin checks contract code, threshold and owners on-chain before recording it.
          Only a confirmed Safe can be picked as the vault Owner in Contract Studio.
        </span>
      </div>

      <div className="grid grid2">
        <div className="card">
          <SectionTitle icon={<KeyRound />}>Step 1 — Prepare a multisig</SectionTitle>
          <label>Label (optional, e.g. “Stelix treasury owners”)</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Stelix vault owners" maxLength={80} />
          <label>Chain</label>
          <select value={chainId} onChange={(e) => setChainId(e.target.value)}>
            {SAFE_CHAINS.map((c) => <option key={c.slug} value={c.slug}>{c.name} · {c.chainId}</option>)}
          </select>
          {chainInfo && (
            <p className="field-hint">
              {chainInfo.support === 'supported' && <>Safe is fully supported here — create the Safe at <a href={SAFE_WEB_APP} target="_blank" rel="noreferrer">app.safe.global</a>.</>}
              {chainInfo.support === 'contracts-only' && <>Safe v1.4.1 contracts are on-chain here (verified via eth_getCode), but the Safe web app does not list this chain — create with the Safe CLI / <span className="kbd">cast safe create</span> (command is shown after you prepare).</>}
              {chainInfo.support === 'unsupported' && <><b>Safe is not available on {chainInfo.name}.</b> {chainInfo.note}</>}
            </p>
          )}
          <label>Owners — wallet addresses ({MIN_OWNERS}–{MAX_OWNERS}, no duplicates, no zero address)</label>
          {ownerInputs.map((o, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                value={o}
                onChange={(e) => setOwner(i, e.target.value)}
                placeholder={`Owner ${i + 1} — 0x…`}
                style={{ marginTop: 0, flex: 1 }}
              />
              {ownerInputs.length > 2 && (
                <button className="btn ghost" onClick={() => setOwnerInputs(ownerInputs.filter((_, j) => j !== i))} aria-label={`Remove owner ${i + 1}`}>✕</button>
              )}
            </div>
          ))}
          {ownerInputs.length < MAX_OWNERS && (
            <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setOwnerInputs([...ownerInputs, ''])}>+ Add owner</button>
          )}
          <label style={{ marginTop: 12 }}>Threshold — signatures required</label>
          <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
            {Array.from({ length: Math.max(1, ownerCount) }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{thresholdLabel(n, Math.max(ownerCount, 1))}{n === 1 ? ' — any single owner can act alone' : ''}</option>
            ))}
          </select>
          <p className="field-hint">Recommended: 2-of-3. A threshold of 1 means any one owner can move funds alone; a threshold equal to all owners means one lost key locks the vault.</p>
          <label>Salt nonce (reference only — the Safe app chooses its own; what matters is the deployed Safe&apos;s owners + threshold)</label>
          <input value={saltNonce} onChange={(e) => setSaltNonce(e.target.value)} inputMode="numeric" placeholder="0" />
          <button className="btn mint block" style={{ marginTop: 14 }} onClick={prepare} disabled={busy || chainInfo?.support === 'unsupported'}>
            <Users />{busy ? 'Preparing…' : 'Prepare multisig (no deployment yet)'}
          </button>
          <p className="field-hint">Preparing only saves the plan in D1. Nothing is deployed and no Safe address is recorded until step 3.</p>
        </div>

        <div>
          <div className="card">
            <SectionTitle icon={<ShieldCheck />}>Safe contracts — v{SAFE_VERSION} canonical</SectionTitle>
            <p className="muted" style={{ marginTop: 0 }}>
              Factory <span className="kbd">{SAFE_PROXY_FACTORY}</span><br />
              Singleton <span className="kbd">{SAFE_SINGLETON}</span><br />
              Fallback handler <span className="kbd">{SAFE_FALLBACK_HANDLER}</span>
            </p>
            <p className="field-hint">These are the Safe v1.4.1 canonical addresses from safe-global/safe-deployments. The admin never invents a multisig contract and never deploys one itself.</p>
            <table className="rtable">
              <thead><tr><th>Chain</th><th>Safe</th></tr></thead>
              <tbody>
                {SAFE_CHAINS.map((c) => (
                  <tr key={c.slug}>
                    <td data-label="Chain">{c.name} · {c.chainId}</td>
                    <td data-label="Safe">
                      {c.support === 'supported' && <span className="badge b-green">Supported</span>}
                      {c.support === 'contracts-only' && <span className="badge b-amber">Contracts on-chain only</span>}
                      {c.support === 'unsupported' && <span className="badge b-red">Not available</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="field-hint">Solana has no Safe contracts (Safe is EVM-only). Arc has the contracts on-chain but is not listed in the Safe web app — use the CLI / cast command shown after preparing.</p>
          </div>

          {justPrepared && (
            <div className="card">
              <SectionTitle icon={<ShieldCheck />}>Step 2 — Create the Safe in your wallet</SectionTitle>
              <p className="muted">
                Prepared #{justPrepared.id} on {safeChainFor(justPrepared.chainId)?.name ?? justPrepared.chainId}:{' '}
                <b>{thresholdLabel(justPrepared.threshold, justPrepared.owners.length)}</b> — owners{' '}
                {justPrepared.owners.map(short).join(', ')}.
              </p>
              {safeChainFor(justPrepared.chainId)?.support === 'supported' ? (
                <a className="btn mint block" href={`${SAFE_WEB_APP}/new-safe/create`} target="_blank" rel="noreferrer">
                  Open Safe web app <ExternalLink />
                </a>
              ) : (
                <p className="field-hint">The Safe web app does not list this chain. Create the Safe with the command below (owners sign in their own wallets), or with the Safe Protocol Kit using the same factory + singleton.</p>
              )}
              <label style={{ marginTop: 12 }}>Command (Safe CLI / cast) — owners sign in their own wallets</label>
              <pre>{castCommand(justPrepared)}</pre>
              <button className="btn ghost block" onClick={() => copySummary(justPrepared)}><Copy /> Copy creation summary</button>
              <p className="field-hint">The Safe app shows a predicted Safe address before you deploy — paste it below so it is recorded as a prediction (it is NOT usable as vault Owner until the Safe is deployed and confirmed).</p>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <SectionTitle icon={<Users />}>Multisigs — {deployed.length} deployed · {prepared.length} prepared</SectionTitle>
        {rows.length === 0 ? (
          <p className="empty">No multisig prepared yet. Prepare one above — nothing is deployed until the owners create the Safe in their wallets.</p>
        ) : (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>#</th><th>Chain</th><th>Owners</th><th>Safe address</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="#">{r.id}{r.label ? <><br /><span className="muted">{r.label}</span></> : ''}</td>
                    <td data-label="Chain">{safeChainFor(r.chainId)?.name ?? r.chainId}</td>
                    <td data-label="Owners">{thresholdLabel(r.threshold, r.owners.length)}<br /><span className="muted">{r.owners.map(short).join(', ')}</span></td>
                    <td data-label="Safe address">
                      {r.safeAddress
                        ? <span className="kbd">{r.safeAddress}</span>
                        : r.predictedAddress
                          ? <><span className="kbd">{r.predictedAddress}</span><br /><span className="muted">predicted — not deployed</span></>
                          : <span className="muted">not created yet</span>}
                    </td>
                    <td data-label="Status">
                      {r.status === 'deployed'
                        ? <span className="badge b-green">Deployed · verified</span>
                        : <span className="badge b-amber">Prepared</span>}
                    </td>
                    <td data-label="">
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn ghost" onClick={() => copySummary(r)}><Copy /> Summary</button>
                        {r.status === 'prepared' && (
                          <button className="btn ghost" onClick={() => { setConfirmFor(confirmFor === r.id ? null : r.id); setPredicted(''); setConfirmAddr(r.predictedAddress ?? ''); setConfirmTx('') }}>
                            {confirmFor === r.id ? 'Close' : 'Create / Confirm'}
                          </button>
                        )}
                        {r.status === 'prepared' && (
                          <button className="btn ghost" onClick={() => remove(r)}><Trash2 /> Discard</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {confirmFor !== null && rows.find((r) => r.id === confirmFor && r.status === 'prepared') && (
          <div style={{ marginTop: 16 }}>
            <SectionTitle icon={<ShieldCheck />}>Step 3 — Record the deployed Safe (multisig #{confirmFor})</SectionTitle>
            <label>Predicted Safe address (optional — paste what the Safe app showed before deploying)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={predicted} onChange={(e) => setPredicted(e.target.value)} placeholder="0x… (predicted)" style={{ flex: 1, marginTop: 0 }} />
              <button className="btn ghost" onClick={() => savePredicted(rows.find((r) => r.id === confirmFor)!)} disabled={busy}>Save prediction</button>
            </div>
            <label style={{ marginTop: 12 }}>Deployed Safe address (after the owners deploy it in their wallets)</label>
            <input value={confirmAddr} onChange={(e) => setConfirmAddr(e.target.value)} placeholder="0x… (deployed Safe)" />
            <label>Deploy transaction hash (optional, for reference)</label>
            <input value={confirmTx} onChange={(e) => setConfirmTx(e.target.value)} placeholder="0x… (optional)" />
            <button
              className="btn mint block"
              style={{ marginTop: 12 }}
              onClick={() => confirm(rows.find((r) => r.id === confirmFor)!)}
              disabled={busy}
            >
              <ShieldCheck />{busy ? 'Verifying on-chain…' : 'Verify on-chain & record Safe'}
            </button>
            <p className="field-hint">The admin reads the chain&apos;s RPC and checks contract code, threshold and owners against the prepared plan. If anything does not match, nothing is recorded. A verified Safe then appears as the Owner choice in Contract Studio.</p>
          </div>
        )}
      </div>
    </div>
  )
}
