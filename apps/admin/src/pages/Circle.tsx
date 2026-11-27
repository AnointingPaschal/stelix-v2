import { useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, RefreshCw, ShieldCheck, Wallet, Wrench } from 'lucide-react'
import { api, type CircleConfigStatus } from '../lib/api'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'
import { AlertModal } from '../components/AlertModal'

function StatusRow({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  const text = ok === null ? 'Not checked' : ok ? 'Yes' : 'No'
  const pill = ok === true ? 'pill-live' : 'pill-grey'
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ minWidth: 180 }}>{label}</span>
      <span className={`pill ${pill}`}>{text}</span>
      <span className="muted" style={{ flex: '1 1 200px' }}>{detail}</span>
    </div>
  )
}

export default function Circle() {
  const [status, setStatus] = useState<CircleConfigStatus | null>(null)
  const [appId, setAppId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)

  const load = async (showTesting = false) => {
    setError('')
    if (showTesting) setTesting(true)
    try {
      const s = await api.getCircleConfig()
      setStatus(s)
      if (s.appIdMasked) setAppId('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load Circle status.') }
    setTesting(false)
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    setError(''); setNotice('')
    if (!appId.trim()) { setError('Paste your Circle App ID first — find it in the Circle Console under Web3 Services.'); return }
    setBusy(true)
    try {
      const r = await api.saveCircleAppId(appId.trim())
      setNotice(`Circle App ID saved (${r.appIdMasked ?? 'masked'}). The App ID is public, not a secret — the API key stays a Wrangler secret and is never shown here.`)
      setAppId('')
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the App ID.') }
    setBusy(false)
  }

  return (
    <div>
      <PageHeader
        icon={<Wallet />}
        title="Circle Wallets"
        sub="Circle User-Controlled Wallets on Arc — the optional Arc wallet next to self-custody. Non-custodial MPC: the backend creates a challenge, the mobile SDK executes it, and the user approves with their PIN. The backend never holds a user key share and never signs for a user."
        pill={<LiveNote />}
      />
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <AlertModal kind="success" message={notice} onClose={() => setNotice('')} />

      <div className="grid grid2">
        <div className="card">
          <SectionTitle icon={<KeyRound />}>Setup status</SectionTitle>
          {status === null ? (
            <p className="muted">Loading Circle status…</p>
          ) : (
            <>
              <StatusRow label="API key configured" ok={status.apiKeyConfigured} detail={status.apiKeyConfigured ? 'Set as the CIRCLE_API_KEY Wrangler secret.' : 'Not set — see the command below.'} />
              <StatusRow label="App ID saved" ok={status.appIdConfigured} detail={status.appIdMasked ? `Saved as ${status.appIdMasked} (masked — the full ID is never shown).` : 'Not saved yet.'} />
              <StatusRow label="Circle reachable" ok={status.circleReachable} detail={status.circleReachable ? 'The harmless entity-config read succeeded.' : status.circleError ?? 'Not checked — set the API key first.'} />
              <StatusRow label="Saved App ID matches Circle" ok={status.circleAppIdMatches} detail={status.circleAppIdMatches === null ? 'Circle reports an App ID only once the key is set.' : status.circleAppIdMatches ? 'Matches the App ID Circle reports for this key.' : 'MISMATCH — the saved App ID is not the one Circle reports for this key. Re-check the Console value.'} />
              <StatusRow label="Vault deployed" ok={status.vaultDeployed} detail={status.vaultDeployed ? 'A StelixVault is registered — lock challenges can target it.' : 'No vault deployed anywhere yet — lock (executeContract) challenges are refused until one is deployed and registered.'} />
              <p className="field-hint">{status.note}</p>
              <button className="btn block" onClick={() => load(true)} disabled={testing}>
                <RefreshCw />{testing ? 'Testing…' : 'Test connection (harmless read)'}
              </button>
            </>
          )}
        </div>

        <div className="card">
          <SectionTitle icon={<Wallet />}>Circle App ID</SectionTitle>
          <label>App ID (public — not a secret)</label>
          <input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="d15deb9f-8d3c-5c06-be01-de05897d30ea"
            autoComplete="off"
          />
          <p className="field-hint">
            Find it in the Circle Console under Web3 Services. It is a public identifier the mobile SDK needs to initialise — paste it here, never the API key. The App ID the user supplied on 2026-11-27 (shown above) is already the default for fresh databases — migration 0010 seeds it into D1 — so on a fresh database this field is only needed to change it. The API key is set only as a Wrangler secret:
          </p>
          <p className="field-hint"><code>wrangler pages secret put CIRCLE_API_KEY --project-name stelix-admin</code></p>
          <button className="btn mint block" onClick={save} disabled={busy}>
            <KeyRound />{busy ? 'Saving…' : 'Save App ID'}
          </button>
        </div>
      </div>

      <div className="card">
        <SectionTitle icon={<ShieldCheck />}>How it works — and what is not built yet</SectionTitle>
        <p className="muted">
          EOA first: Circle wallets are created as Externally Owned Accounts on Arc Testnet (chain 5042002) or Arc Mainnet (5042), USDC is the gas token. Flow: the backend creates a challenge (POST /api/circle/challenges) → the mobile app runs sdk.execute(challengeId) → the user approves with their PIN → Circle&apos;s MPC signs on the device. The backend never sees a key share.
        </p>
        <p className="muted">
          Not built: Smart Contract Accounts (SCA) and Gas Station come later — they are not wired in this backend. Expo Go is NOT supported for the Circle React Native SDK; it needs a dev build or EAS build.
        </p>
        <p className="muted">
          A Circle wallet cannot auto-sell. Auto-sell on a price target is done by the StelixVault contract plus the keeper — never by the wallet. Until a vault is deployed and registered in Chain Manager, every lock attempt is refused honestly by the backend.
        </p>
      </div>

      <div className="notice alert">
        <Wrench />
        <span>Setup checklist: 1) create a Circle account and App ID in the Console, 2) set CIRCLE_API_KEY as a Wrangler secret (command above — testnet and mainnet use separate keys), 3) save the App ID here, 4) press Test connection. Nothing here deploys a vault or moves funds.</span>
      </div>
    </div>
  )
}
