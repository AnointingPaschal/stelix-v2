import { CheckCircle2, Percent, Save, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { DemoPill, PageHeader, SectionTitle } from '../components/ui'

export default function Fees() {
  return (
    <div>
      <PageHeader
        icon={<Percent />}
        title="Fees and Limits"
        sub="Stelix fee settings, min / max lock amounts, penalty defaults, TWAP window, trailing-stop options. Changes are versioned and shown in the app review screen. Fees are snapshotted per lock at creation — changing them never affects existing locks."
        pill={<DemoPill />}
      />
      <div className="grid grid2">
        <div className="card">
          <SectionTitle icon={<Percent />}>Auto-sell fee</SectionTitle>
          <label>Fee on successful auto-sell only (%)</label>
          <input defaultValue="1.0" inputMode="decimal" />
          <p className="field-hint">No sale, no fee. Set before mainnet; shown in Create Lock review.</p>
        </div>
        <div className="card">
          <SectionTitle icon={<SlidersHorizontal />}>Limits</SectionTitle>
          <label>Minimum lock (USD)</label><input defaultValue="10" inputMode="decimal" />
          <label>Maximum lock (USD)</label><input defaultValue="100000" inputMode="decimal" />
          <label>Default penalty break (%)</label><input defaultValue="5" inputMode="decimal" />
        </div>
        <div className="card">
          <SectionTitle icon={<ShieldCheck />}>Exit guards</SectionTitle>
          <label>TWAP window (minutes)</label><input defaultValue="30" inputMode="numeric" />
          <label>Trailing-stop options offered</label><input defaultValue="Off, 10%, 15%, 20%" />
          <label>Default slippage (%)</label><input defaultValue="1.5" inputMode="decimal" />
        </div>
        <div className="card">
          <SectionTitle icon={<CheckCircle2 />}>Penalty destination</SectionTitle>
          <label>Where break penalties go</label>
          <select defaultValue="treasury">
            <option value="burn">Burn</option>
            <option value="treasury">Treasury</option>
            <option value="relock">Re-lock</option>
          </select>
          <p className="field-hint">Shown in the app before locking. No penalty is ever charged on a price-target or maturity exit.</p>
          <button className="btn" style={{ marginTop: 14 }} onClick={() => alert('Demo: fee changes are versioned to D1 in production.')}>
            <Save />Save versioned change
          </button>
        </div>
      </div>
    </div>
  )
}
