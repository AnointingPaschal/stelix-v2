import { useEffect, useState } from 'react'
import { CheckCircle2, Percent, Save, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { api } from '../lib/api'
import { DEFAULT_FEES, validateFeePayload, type FeeConfig } from '../lib/fees'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'
import { AlertModal } from '../components/AlertModal'

export default function Fees() {
  const [fees, setFees] = useState<FeeConfig>(DEFAULT_FEES)
  const [version, setVersion] = useState<number | null>(null)
  const [meta, setMeta] = useState('')
  const [history, setHistory] = useState<{ id: number; version: number; payload_json: string; published_by: string; created_at: string }[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    api.getFees().then((d) => {
      if (d.fees) {
        // Older published configs predate the break / impact fields —
        // merge over the defaults so the form never shows undefined.
        setFees({ ...DEFAULT_FEES, ...d.fees })
        setVersion(d.version ?? null)
        setMeta(d.publishedAt ? `Version ${d.version} · published ${d.publishedAt} by ${d.publishedBy ?? 'admin'}` : '')
      } else {
        setMeta('No fee config published yet — showing the app defaults. Save to publish version 1.')
      }
    }).catch((e: Error) => setError(e.message))
    api.getFeeHistory().then((d) => setHistory(d.history)).catch(() => undefined)
  }
  useEffect(load, [])

  const save = async () => {
    setError(''); setNotice('')
    const { errors } = validateFeePayload(fees)
    if (errors.length > 0) { setError(errors.join(' ')); return }
    setBusy(true)
    try {
      const r = await api.saveFees(fees)
      setNotice(`Fee config v${r.version} saved and versioned in D1. Existing locks keep their snapshot.`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save fees.') }
    setBusy(false)
  }

  return (
    <div>
      <PageHeader
        icon={<Percent />}
        title="Fees and Limits"
        sub="Stelix vault settings: min / max lock amounts, penalty defaults, cooling-off and guardian delays, TWAP window, trailing-stop options, slippage and max price impact. Changes are versioned and reach the app in real time. Fees are snapshotted per lock at creation — changing them never affects existing locks."
        pill={<LiveNote />}
      />
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <AlertModal kind="success" message={notice} onClose={() => setNotice('')} />
      {meta && <p className="muted">{meta}</p>}
      <div className="grid grid2">
        <div className="card">
          <SectionTitle icon={<Percent />}>Auto-sell fee</SectionTitle>
          <label>Fee on successful auto-sell only (%) — max 10</label>
          <input
            value={fees.autoSellFeePct}
            inputMode="decimal"
            onChange={(e) => setFees({ ...fees, autoSellFeePct: Number(e.target.value) })}
          />
          <p className="field-hint">No sale, no fee. Set before mainnet; shown in Create Lock review.</p>
        </div>
        <div className="card">
          <SectionTitle icon={<SlidersHorizontal />}>Limits</SectionTitle>
          <label>Minimum lock (USD)</label>
          <input value={fees.minLockUsd} inputMode="decimal" onChange={(e) => setFees({ ...fees, minLockUsd: Number(e.target.value) })} />
          <label>Maximum lock (USD)</label>
          <input value={fees.maxLockUsd} inputMode="decimal" onChange={(e) => setFees({ ...fees, maxLockUsd: Number(e.target.value) })} />
          <label>Default penalty break (%) — 5 to 10</label>
          <input value={fees.defaultPenaltyPct} inputMode="decimal" onChange={(e) => setFees({ ...fees, defaultPenaltyPct: Number(e.target.value) })} />
        </div>
        <div className="card">
          <SectionTitle icon={<ShieldCheck />}>Exit guards</SectionTitle>
          <label>TWAP window (minutes) — 5 to 120</label>
          <input value={fees.twapMinutes} inputMode="numeric" onChange={(e) => setFees({ ...fees, twapMinutes: Number(e.target.value) })} />
          <label>Trailing-stop options offered</label>
          <input value={fees.trailingStopOptions} onChange={(e) => setFees({ ...fees, trailingStopOptions: e.target.value })} />
          <label>Default slippage (%) — max 50</label>
          <input value={fees.defaultSlippagePct} inputMode="decimal" onChange={(e) => setFees({ ...fees, defaultSlippagePct: Number(e.target.value) })} />
          <label>Penalty break cooling-off (hours) — 0 to 72</label>
          <input value={fees.breakCoolingOffHours} inputMode="numeric" onChange={(e) => setFees({ ...fees, breakCoolingOffHours: Number(e.target.value) })} />
          <p className="field-hint">Shown in Create Lock as “Penalty break (5%, 24h cooling-off)”. Hours after locking before a penalty break is allowed.</p>
          <label>Guardian break delay (hours) — 0 to 168</label>
          <input value={fees.guardianBreakDelayHours} inputMode="numeric" onChange={(e) => setFees({ ...fees, guardianBreakDelayHours: Number(e.target.value) })} />
          <p className="field-hint">Shown in Create Lock as “Guardian break — approval + 48h delay”.</p>
          <label>Max price impact on swaps (%) — max 50</label>
          <input value={fees.maxPriceImpactPct} inputMode="decimal" onChange={(e) => setFees({ ...fees, maxPriceImpactPct: Number(e.target.value) })} />
          <p className="field-hint">Swaps above this impact are split or blocked in the app Swap screen.</p>
        </div>
        <div className="card">
          <SectionTitle icon={<CheckCircle2 />}>Penalty destination</SectionTitle>
          <label>Where break penalties go</label>
          <select value={fees.penaltyDestination} onChange={(e) => setFees({ ...fees, penaltyDestination: e.target.value as FeeConfig['penaltyDestination'] })}>
            <option value="burn">Burn</option>
            <option value="treasury">Treasury</option>
            <option value="relock">Re-lock</option>
          </select>
          <p className="field-hint">Shown in the app before locking. No penalty is ever charged on a price-target or maturity exit.</p>
          <button className="btn" style={{ marginTop: 14 }} onClick={save} disabled={busy}>
            <Save />{busy ? 'Saving…' : `Save versioned change${version !== null ? ` (becomes v${version + 1})` : ' (v1)'}`}
          </button>
        </div>
      </div>
      <div className="card">
        <SectionTitle icon={<Percent />}>Version history</SectionTitle>
        {history.length === 0 ? (
          <p className="empty">No fee versions published yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>Version</th><th>Auto-sell fee</th><th>Min / Max lock</th><th>Penalty</th><th>Published by</th><th>Published at</th></tr></thead>
              <tbody>
                {history.map((h) => {
                  let p: FeeConfig | null = null
                  try { p = JSON.parse(h.payload_json) as FeeConfig } catch { p = null }
                  return (
                    <tr key={h.id}>
                      <td data-label="Version"><b>v{h.version}</b></td>
                      <td data-label="Auto-sell fee">{p ? `${p.autoSellFeePct}%` : '—'}</td>
                      <td data-label="Min / Max lock">{p ? `$${p.minLockUsd} / $${p.maxLockUsd}` : '—'}</td>
                      <td data-label="Penalty">{p ? `${p.defaultPenaltyPct}%` : '—'}</td>
                      <td data-label="Published by">{h.published_by}</td>
                      <td data-label="Published at">{h.created_at}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
