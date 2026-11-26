export default function Fees() {
  return <div><h1>Fees and Limits</h1><p className="muted">Stelix fee settings, min / max lock amounts, penalty defaults, TWAP window, trailing-stop options. Changes are versioned and shown in the app review screen. Fees are snapshotted per lock at creation — changing them never affects existing locks.</p>
  <div className="grid grid2">
    <div className="card"><h2>Auto-sell fee (DEMO)</h2><label>Fee on successful auto-sell only (%)</label><input defaultValue="1.0" /><p className="muted">No sale, no fee. Set before mainnet; shown in Create Lock review.</p></div>
    <div className="card"><h2>Limits (DEMO)</h2><label>Minimum lock (USD)</label><input defaultValue="10" /><label>Maximum lock (USD)</label><input defaultValue="100000" /><label>Default penalty break (%)</label><input defaultValue="5" /></div>
    <div className="card"><h2>Exit guards (DEMO)</h2><label>TWAP window (minutes)</label><input defaultValue="30" /><label>Trailing-stop options offered</label><input defaultValue="Off, 10%, 15%, 20%" /><label>Default slippage (%)</label><input defaultValue="1.5" /></div>
    <div className="card"><h2>Penalty destination (DEMO)</h2><label>Where break penalties go</label><select defaultValue="treasury"><option value="burn">Burn</option><option value="treasury">Treasury</option><option value="relock">Re-lock</option></select><p className="muted">Shown in the app before locking. No penalty is ever charged on a price-target or maturity exit.</p><button className="btn" style={{ marginTop: 12 }} onClick={() => alert('Demo: fee changes are versioned to D1 in production.')}>Save versioned change</button></div>
  </div></div>
}
