export default function Config() {
  return <div><h1>App Config and Releases</h1><p className="muted">Minimum app version, force-upgrade switch, feature flags, signed config publishing. The app fetches signed config on launch — chain, contract and fee changes take effect without an app-store release.</p>
  <div className="grid grid2">
    <div className="card"><h2>Releases (DEMO)</h2><label>Minimum app version</label><input defaultValue="2.0.0" /><label>Force upgrade</label><select defaultValue="off"><option value="off">Off</option><option value="on">On — block older versions</option></select><label>Config version</label><input defaultValue="v1" readOnly /></div>
    <div className="card"><h2>Feature flags (DEMO)</h2><label><input type="checkbox" style={{ width: 'auto' }} /> Yield while locked (Phase 2)</label><label><input type="checkbox" style={{ width: 'auto' }} /> Group locks (Phase 2)</label><label><input type="checkbox" style={{ width: 'auto' }} defaultChecked /> Bull Lock auto-sell</label><label><input type="checkbox" style={{ width: 'auto' }} defaultChecked /> Trailing stop</label><button className="btn mint" style={{ marginTop: 14 }} onClick={() => alert('Demo: signed config publish happens in production via Workers (HMAC/Ed25519 key in Cloudflare secrets).')}>Publish signed config (demo)</button></div>
  </div>
  <div className="alert">Signing keys live in Cloudflare secrets only — never in this repo or in the app binary. A spoofed server cannot point the app at a fake contract because config is signed.</div></div>
}
