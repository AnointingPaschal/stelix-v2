import { useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Rocket, Settings, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { api } from '../lib/api'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'

export default function Config() {
  const [minVersion, setMinVersion] = useState('2.0.0')
  const [forceUpgrade, setForceUpgrade] = useState(false)
  const [flags, setFlags] = useState({ bullLockAutoSell: true, trailingStop: true, yieldWhileLocked: false, groupLocks: false })
  const [current, setCurrent] = useState<{ version: string; payload: Record<string, unknown> | null; signature: string | null; publishedBy: string; publishedAt: string } | null>(null)
  const [signatureValid, setSignatureValid] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    api.getConfig().then((d) => {
      setCurrent(d.config)
      if (d.config?.payload && typeof d.config.payload === 'object') {
        const p = d.config.payload as { minAppVersion?: string; forceUpgrade?: boolean; flags?: Record<string, boolean> }
        if (p.minAppVersion) setMinVersion(p.minAppVersion)
        if (typeof p.forceUpgrade === 'boolean') setForceUpgrade(p.forceUpgrade)
        if (p.flags) setFlags({
          bullLockAutoSell: p.flags.bullLockAutoSell !== false,
          trailingStop: p.flags.trailingStop !== false,
          yieldWhileLocked: p.flags.yieldWhileLocked === true,
          groupLocks: p.flags.groupLocks === true,
        })
      }
    }).catch((e: Error) => setError(e.message))
    api.getPublicConfig().then((d) => setSignatureValid(d.config?.signatureValid ?? null)).catch(() => undefined)
  }
  useEffect(load, [])

  const publish = async () => {
    setError(''); setNotice('')
    if (!/^\d+\.\d+\.\d+$/.test(minVersion)) { setError('Minimum app version must look like 2.0.0.'); return }
    setBusy(true)
    try {
      const r = await api.publishConfig({ minAppVersion: minVersion, forceUpgrade, flags })
      setNotice(`Signed config ${r.version} published (HMAC signature stored in D1). The app verifies the signature before trusting chain/contract data.`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not publish config.') }
    setBusy(false)
  }

  return (
    <div>
      <PageHeader
        icon={<Settings />}
        title="App Config and Releases"
        sub="Minimum app version, force-upgrade switch, feature flags, signed config publishing. The app fetches signed config on launch — chain, contract and fee changes take effect without an app-store release."
        pill={<LiveNote />}
      />
      {error && <div className="notice alert"><ShieldCheck /><span>{error}</span></div>}
      {notice && <div className="notice ok"><CheckCircle2 /><span>{notice}</span></div>}
      <div className="grid grid2">
        <div className="card">
          <SectionTitle icon={<Rocket />}>Releases</SectionTitle>
          <label>Minimum app version</label>
          <input value={minVersion} onChange={(e) => setMinVersion(e.target.value)} />
          <label>Force upgrade</label>
          <select value={forceUpgrade ? 'on' : 'off'} onChange={(e) => setForceUpgrade(e.target.value === 'on')}>
            <option value="off">Off</option>
            <option value="on">On — block older versions</option>
          </select>
          <label>Config version</label>
          <input value={current?.version ?? 'not published yet'} readOnly />
          <p className="field-hint">
            {current
              ? `Published ${current.publishedAt} by ${current.publishedBy}. Public signature check: ${signatureValid === null ? 'not checked' : signatureValid ? 'valid' : 'INVALID — do not trust this config'}.`
              : 'No signed config published yet. Publish once to activate the signed feed.'}
          </p>
        </div>
        <div className="card">
          <SectionTitle icon={<SlidersHorizontal />}>Feature flags</SectionTitle>
          <label className="check-row"><input type="checkbox" checked={flags.yieldWhileLocked} onChange={(e) => setFlags({ ...flags, yieldWhileLocked: e.target.checked })} />Yield while locked (Phase 2)</label>
          <label className="check-row"><input type="checkbox" checked={flags.groupLocks} onChange={(e) => setFlags({ ...flags, groupLocks: e.target.checked })} />Group locks (Phase 2)</label>
          <label className="check-row"><input type="checkbox" checked={flags.bullLockAutoSell} onChange={(e) => setFlags({ ...flags, bullLockAutoSell: e.target.checked })} />Bull Lock auto-sell</label>
          <label className="check-row"><input type="checkbox" checked={flags.trailingStop} onChange={(e) => setFlags({ ...flags, trailingStop: e.target.checked })} />Trailing stop</label>
          <button className="btn mint block" style={{ marginTop: 14 }} onClick={publish} disabled={busy}>
            <KeyRound />{busy ? 'Publishing…' : 'Publish signed config'}
          </button>
        </div>
      </div>
      <div className="notice alert">
        <ShieldCheck />
        <span>Signing keys live in Cloudflare secrets only — never in this repo or in the app binary. A spoofed server cannot point the app at a fake contract because config is signed. If publishing fails with a missing-secret error, set CONFIG_SIGNING_SECRET with: wrangler pages secret put CONFIG_SIGNING_SECRET --project-name stelix-admin.</span>
      </div>
    </div>
  )
}
