import { KeyRound, Rocket, Settings, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { DemoPill, PageHeader, SectionTitle } from '../components/ui'

export default function Config() {
  return (
    <div>
      <PageHeader
        icon={<Settings />}
        title="App Config and Releases"
        sub="Minimum app version, force-upgrade switch, feature flags, signed config publishing. The app fetches signed config on launch — chain, contract and fee changes take effect without an app-store release."
        pill={<DemoPill />}
      />
      <div className="grid grid2">
        <div className="card">
          <SectionTitle icon={<Rocket />}>Releases</SectionTitle>
          <label>Minimum app version</label><input defaultValue="2.0.0" />
          <label>Force upgrade</label>
          <select defaultValue="off">
            <option value="off">Off</option>
            <option value="on">On — block older versions</option>
          </select>
          <label>Config version</label><input defaultValue="v1" readOnly />
        </div>
        <div className="card">
          <SectionTitle icon={<SlidersHorizontal />}>Feature flags</SectionTitle>
          <label className="check-row"><input type="checkbox" />Yield while locked (Phase 2)</label>
          <label className="check-row"><input type="checkbox" />Group locks (Phase 2)</label>
          <label className="check-row"><input type="checkbox" defaultChecked />Bull Lock auto-sell</label>
          <label className="check-row"><input type="checkbox" defaultChecked />Trailing stop</label>
          <button className="btn mint block" style={{ marginTop: 14 }} onClick={() => alert('Demo: signed config publish happens in production via Workers (HMAC/Ed25519 key in Cloudflare secrets).')}>
            <KeyRound />Publish signed config (demo)
          </button>
        </div>
      </div>
      <div className="notice alert">
        <ShieldCheck />
        <span>Signing keys live in Cloudflare secrets only — never in this repo or in the app binary. A spoofed server cannot point the app at a fake contract because config is signed.</span>
      </div>
    </div>
  )
}
