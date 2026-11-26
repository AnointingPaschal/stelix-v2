import { useEffect, useState } from 'react'
import { Link2, Plus, ShieldCheck } from 'lucide-react'
import { api } from '../lib/api'
import type { Chain } from '../lib/types'
import { LiveNote, PageHeader } from '../components/ui'

const badge = (s: Chain['status']) => s === 'live' ? 'b-green' : s === 'testnet' ? 'b-blue' : s === 'paused' ? 'b-amber' : 'b-grey'
const CHAIN_COLORS: Record<string, string> = {
  arc: '#2FD6A3', bnb: '#F0B90B', base: '#0052FF',
  ethereum: '#627EEA', polygon: '#8247E5', solana: '#9945FF',
}

export default function Chains() {
  const [chains, setChains] = useState<Chain[]>([])
  useEffect(() => { api.getChains().then(setChains) }, [])
  return (
    <div>
      <PageHeader
        icon={<Link2 />}
        title="Chain Manager"
        sub="Add / edit chains: RPCs, explorer, native token, stablecoin, DEX router, status. Pausing stops new locks in the app within one config refresh. Arc is the default chain."
        pill={<LiveNote />}
        actions={
          <button className="btn mint" onClick={() => alert('Demo: chain creation writes to D1 in production (POST /api/admin/chains).')}>
            <Plus />Add chain
          </button>
        }
      />
      <div className="card">
        <div className="table-wrap">
          <table className="rtable">
            <thead><tr><th>Chain</th><th>Chain ID</th><th>Native / Stablecoin</th><th>DEX router</th><th>Vault</th><th>Status</th></tr></thead>
            <tbody>
              {chains.map((c) => (
                <tr key={c.id}>
                  <td data-label="Chain">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span className="chain-dot" style={{ background: CHAIN_COLORS[c.id] ?? '#8A99AF' }} />
                      <b>{c.name}</b>
                      {c.isDefault && <span className="badge b-mint">Default</span>}
                    </span>
                    <br /><span className="muted small">{c.explorerUrl}</span>
                  </td>
                  <td data-label="Chain ID">{c.chainId}</td>
                  <td data-label="Native / Stablecoin">
                    {c.nativeToken} / {c.stablecoin}<br />
                    <span className="muted kbd">{c.stablecoinAddress.slice(0, 18)}…</span>
                  </td>
                  <td data-label="DEX router">{c.dexRouter}</td>
                  <td data-label="Vault">{c.vaultAddress ?? <span className="muted">Not deployed yet — deploy from Contract Studio</span>}</td>
                  <td data-label="Status"><span className={'badge ' + badge(c.status)}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="notice info">
        <ShieldCheck />
        <span><b>Testnet-first rule (spec Part C):</b> every chain goes testnet → full lock → target → auto-sell test → verify → mainnet. The app shows a Testnet badge whenever a testnet chain is selected.</span>
      </div>
    </div>
  )
}
