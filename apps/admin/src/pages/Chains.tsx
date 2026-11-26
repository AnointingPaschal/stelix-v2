import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Chain } from '../lib/types'
const badge = (s: Chain['status']) => s === 'live' ? 'b-green' : s === 'testnet' ? 'b-blue' : s === 'paused' ? 'b-amber' : 'b-grey'
export default function Chains() {
  const [chains, setChains] = useState<Chain[]>([])
  useEffect(() => { api.getChains().then(setChains) }, [])
  return <div>
    <div className="topbar"><div><h1>Chain Manager</h1><p className="muted">Add / edit chains: RPCs, explorer, native token, stablecoin, DEX router, status. Pausing stops new locks in the app within one config refresh. Arc is the default chain.</p></div><button className="btn mint" onClick={() => alert('Demo: chain creation writes to D1 in production (POST /api/admin/chains).')}>Add chain</button></div>
    <div className="card"><table><thead><tr><th>Chain</th><th>Chain ID</th><th>Native / Stablecoin</th><th>DEX router</th><th>Vault</th><th>Status</th></tr></thead>
    <tbody>{chains.map((c) => <tr key={c.id}><td><b>{c.name}</b>{c.isDefault && <span className="badge b-mint" style={{ marginLeft: 6 }}>Default</span>}<br /><span className="muted">{c.explorerUrl}</span></td><td>{c.chainId}</td><td>{c.nativeToken} / {c.stablecoin}<br /><span className="muted kbd">{c.stablecoinAddress.slice(0, 18)}…</span></td><td>{c.dexRouter}</td><td>{c.vaultAddress ?? <span className="muted">Not deployed yet — deploy from Contract Studio</span>}</td><td><span className={'badge ' + badge(c.status)}>{c.status}</span></td></tr>)}</tbody></table></div>
    <p className="muted">Testnet-first rule (spec Part C): every chain goes testnet → full lock → target → auto-sell test → verify → mainnet. The app shows a Testnet badge whenever a testnet chain is selected.</p>
  </div>
}
