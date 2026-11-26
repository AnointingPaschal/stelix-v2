import { useEffect, useState } from 'react'
import { BadgeCheck, Coins, Gauge, Percent, Star, Timer } from 'lucide-react'
import { api } from '../lib/api'
import type { TokenEntry } from '../lib/types'
import { DemoPill, PageHeader, SectionTitle, StatCard } from '../components/ui'

export default function Tokens() {
  const [tokens, setTokens] = useState<TokenEntry[]>([])
  useEffect(() => { api.getTokens().then(setTokens) }, [])
  return (
    <div>
      <PageHeader
        icon={<Coins />}
        title="Token / DEX Registry"
        sub="Featured / verified token lists per chain, default slippage and impact limits, router addresses, token safety overrides. User-imported tokens are unaffected."
        pill={<DemoPill />}
      />
      <div className="grid stats">
        <StatCard icon={<Percent />} label="Default slippage" value="1.5%" />
        <StatCard icon={<Gauge />} label="Max price impact" value="5%" />
        <StatCard icon={<Timer />} label="TWAP window" value="30 min" />
      </div>
      <div className="card">
        <SectionTitle icon={<BadgeCheck />}>Registered tokens</SectionTitle>
        <div className="table-wrap">
          <table className="rtable">
            <thead><tr><th>Token</th><th>Chain</th><th>Address</th><th>Decimals</th><th>Verified</th><th>Featured</th></tr></thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.symbol + t.chain}>
                  <td data-label="Token"><b>{t.symbol}</b></td>
                  <td data-label="Chain">{t.chain}</td>
                  <td data-label="Address"><span className="kbd">{t.address}</span></td>
                  <td data-label="Decimals">{t.decimals}</td>
                  <td data-label="Verified">{t.verified ? <span className="badge b-green">Yes</span> : <span className="badge b-grey">No</span>}</td>
                  <td data-label="Featured">{t.featured ? <span className="badge b-mint"><Star />Yes</span> : <span className="badge b-grey">No</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
