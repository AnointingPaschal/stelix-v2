import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { TokenEntry } from '../lib/types'
export default function Tokens() {
  const [tokens, setTokens] = useState<TokenEntry[]>([])
  useEffect(() => { api.getTokens().then(setTokens) }, [])
  return <div>
    <h1>Token / DEX Registry</h1><p className="muted">Featured / verified token lists per chain, default slippage and impact limits, router addresses, token safety overrides. User-imported tokens are unaffected.</p>
    <div className="grid grid3">
      <div className="card stat"><span>Default slippage (DEMO)</span><b>1.5%</b></div>
      <div className="card stat"><span>Max price impact (DEMO)</span><b>5%</b></div>
      <div className="card stat"><span>TWAP window (DEMO)</span><b>30 min</b></div>
    </div>
    <div className="card"><table><thead><tr><th>Token</th><th>Chain</th><th>Address</th><th>Decimals</th><th>Verified</th><th>Featured</th></tr></thead>
    <tbody>{tokens.map((t) => <tr key={t.symbol + t.chain}><td><b>{t.symbol}</b></td><td>{t.chain}</td><td className="kbd">{t.address}</td><td>{t.decimals}</td><td>{t.verified ? 'Yes' : 'No'}</td><td>{t.featured ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div>
  </div>
}
