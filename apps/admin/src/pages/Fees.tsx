import { useEffect, useState } from 'react'
import { CheckCircle2, Percent, Save, ShieldCheck, SlidersHorizontal, Wallet } from 'lucide-react'
import { api } from '../lib/api'
import { DEFAULT_FEES, validateFeePayload, type FeeConfig } from '../lib/fees'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'
import { AlertModal } from '../components/AlertModal'

export default function Fees() {
  // The form keeps every numeric field as a STRING while it is being
  // typed. A controlled number state eats the decimal point: typing
  // "0.1" sets Number("0.") = 0, so the input snaps back to "0" and
  // the user can never reach "0.1". Strings preserve every keystroke;
  // the numbers are parsed once, on save, and validated by the same
  // validateFeePayload the Worker runs.
  const [draft, setDraft] = useState<Record<string, string>>({
    autoSellFeePct: String(DEFAULT_FEES.autoSellFeePct),
    minLockUsd: String(DEFAULT_FEES.minLockUsd),
    maxLockUsd: String(DEFAULT_FEES.maxLockUsd),
    defaultPenaltyPct: String(DEFAULT_FEES.defaultPenaltyPct),
    twapMinutes: String(DEFAULT_FEES.twapMinutes),
    trailingStopOptions: DEFAULT_FEES.trailingStopOptions,
    defaultSlippagePct: String(DEFAULT_FEES.defaultSlippagePct),
    breakCoolingOffHours: String(DEFAULT_FEES.breakCoolingOffHours),
    guardianBreakDelayHours: String(DEFAULT_FEES.guardianBreakDelayHours),
    maxPriceImpactPct: String(DEFAULT_FEES.maxPriceImpactPct),
    feeRecipient: DEFAULT_FEES.feeRecipient ?? '',
  })
  const [destination, setDestination] = useState<FeeConfig['penaltyDestination']>(DEFAULT_FEES.penaltyDestination)
  const [version, setVersion] = useState<number | null>(null)
  const [meta, setMeta] = useState('')
  const [history, setHistory] = useState<{ id: number; version: number; payload_json: string; published_by: string; created_at: string }[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }))

  const load = () => {
    api.getFees().then((d) => {
      if (d.fees) {
        // Older published configs predate the break / impact fields —
        // merge over the defaults so the form never shows undefined.
        const fees = { ...DEFAULT_FEES, ...d.fees }
        setDraft({
          autoSellFeePct: String(fees.autoSellFeePct),
          minLockUsd: String(fees.minLockUsd),
          maxLockUsd: String(fees.maxLockUsd),
          defaultPenaltyPct: String(fees.defaultPenaltyPct),
          twapMinutes: String(fees.twapMinutes),
          trailingStopOptions: fees.trailingStopOptions,
          defaultSlippagePct: String(fees.defaultSlippagePct),
          breakCoolingOffHours: String(fees.breakCoolingOffHours),
          guardianBreakDelayHours: String(fees.guardianBreakDelayHours),
          maxPriceImpactPct: String(fees.maxPriceImpactPct),
          feeRecipient: fees.feeRecipient ?? '',
        })
        setDestination(fees.penaltyDestination)
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
    const payload = {
      autoSellFeePct: Number(draft.autoSellFeePct),
      minLockUsd: Number(draft.minLockUsd),
      maxLockUsd: Number(draft.maxLockUsd),
      defaultPenaltyPct: Number(draft.defaultPenaltyPct),
      twapMinutes: Number(draft.twapMinutes),
      trailingStopOptions: draft.trailingStopOptions,
      defaultSlippagePct: Number(draft.defaultSlippagePct),
      penaltyDestination: destination,
      breakCoolingOffHours: Number(draft.breakCoolingOffHours),
      guardianBreakDelayHours: Number(draft.guardianBreakDelayHours),
      maxPriceImpactPct: Number(draft.maxPriceImpactPct),
      feeRecipient: draft.feeRecipient.trim() || null,
    }
    const { config, errors } = validateFeePayload(payload)
    if (errors.length > 0) { setError(errors.join(' ')); return }
    if (!config) { setError('Could not build a valid fee config.'); return }
    setBusy(true)
    try {
      const r = await api.saveFees(config)
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
          <label>Fee on successful auto-sell only (%) — max 10, decimals allowed (e.g. 0.1)</label>
          <input
            value={draft.autoSellFeePct}
            inputMode="decimal"
            onChange={(e) => set('autoSellFeePct', e.target.value)}
          />
          <p className="field-hint">No sale, no fee. Set before mainnet; shown in Create Lock review.</p>
        </div>
        <div className="card">
          <SectionTitle icon={<SlidersHorizontal />}>Limits</SectionTitle>
          <label>Minimum lock (USD) — decimals allowed (e.g. 0.1)</label>
          <input value={draft.minLockUsd} inputMode="decimal" onChange={(e) => set('minLockUsd', e.target.value)} />
          <label>Maximum lock (USD) — decimals allowed</label>
          <input value={draft.maxLockUsd} inputMode="decimal" onChange={(e) => set('maxLockUsd', e.target.value)} />
          <label>Default penalty break (%) — 5 to 10, decimals allowed</label>
          <input value={draft.defaultPenaltyPct} inputMode="decimal" onChange={(e) => set('defaultPenaltyPct', e.target.value)} />
        </div>
        <div className="card">
          <SectionTitle icon={<ShieldCheck />}>Exit guards</SectionTitle>
          <label>TWAP window (minutes) — 5 to 120</label>
          <input value={draft.twapMinutes} inputMode="numeric" onChange={(e) => set('twapMinutes', e.target.value)} />
          <label>Trailing-stop options offered</label>
          <input value={draft.trailingStopOptions} onChange={(e) => set('trailingStopOptions', e.target.value)} />
          <label>Default slippage (%) — max 50, decimals allowed (e.g. 0.1)</label>
          <input value={draft.defaultSlippagePct} inputMode="decimal" onChange={(e) => set('defaultSlippagePct', e.target.value)} />
          <label>Penalty break cooling-off (hours) — 0 to 72</label>
          <input value={draft.breakCoolingOffHours} inputMode="numeric" onChange={(e) => set('breakCoolingOffHours', e.target.value)} />
          <p className="field-hint">Shown in Create Lock as “Penalty break (5%, 24h cooling-off)”. Hours after locking before a penalty break is allowed.</p>
          <label>Guardian break delay (hours) — 0 to 168</label>
          <input value={draft.guardianBreakDelayHours} inputMode="numeric" onChange={(e) => set('guardianBreakDelayHours', e.target.value)} />
          <p className="field-hint">Shown in Create Lock as “Guardian break — approval + 48h delay”.</p>
          <label>Max price impact on swaps (%) — max 50, decimals allowed (e.g. 0.1)</label>
          <input value={draft.maxPriceImpactPct} inputMode="decimal" onChange={(e) => set('maxPriceImpactPct', e.target.value)} />
          <p className="field-hint">Swaps above this impact are split or blocked in the app Swap screen.</p>
        </div>
        <div className="card">
          <SectionTitle icon={<CheckCircle2 />}>Penalty destination</SectionTitle>
          <label>Where break penalties go</label>
          <select value={destination} onChange={(e) => setDestination(e.target.value as FeeConfig['penaltyDestination'])}>
            <option value="burn">Burn</option>
            <option value="treasury">Treasury</option>
            <option value="relock">Re-lock</option>
          </select>
          <p className="field-hint">Shown in the app before locking. No penalty is ever charged on a price-target or maturity exit.</p>
          <button className="btn" style={{ marginTop: 14 }} onClick={save} disabled={busy}>
            <Save />{busy ? 'Saving…' : `Save versioned change${version !== null ? ` (becomes v${version + 1})` : ' (v1)'}`}
          </button>
        </div>
        <div className="card">
          <SectionTitle icon={<Wallet />}>Fee recipient (global default)</SectionTitle>
          <label>Where auto-sell fees go by default — a 0x address, or blank for not set</label>
          <input
            value={draft.feeRecipient}
            onChange={(e) => set('feeRecipient', e.target.value)}
            placeholder="0x… — blank = not set"
            autoComplete="off"
          />
          <p className="field-hint">
            This is the default for FUTURE vaults: a Deploy Preset saved with a blank fee recipient takes this
            address, and it is served to the app in /api/sync as fees.feeRecipient. Vaults already deployed keep
            the recipient set in their constructor — an on-chain recipient cannot be changed from here.
          </p>
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
