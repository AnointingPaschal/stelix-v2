import { useEffect, useState } from 'react'
import {
  Activity, Bell, CheckCircle2, Database, HeartPulse, LayoutDashboard,
  Lock, TrendingUp, Zap,
} from 'lucide-react'
import { api, type DashboardData } from '../lib/api'
import { LivePill, PageHeader, SectionTitle, StatCard } from '../components/ui'

const CHAIN_COLORS: Record<string, string> = {
  Arc: '#2FD6A3', 'BNB Chain': '#F0B90B', 'BNB Smart Chain': '#F0B90B', Base: '#0052FF',
  Ethereum: '#627EEA', Polygon: '#8247E5', Solana: '#9945FF',
}

const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function Dashboard() {
  const [s, setS] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api.getDashboard().then(setS).catch((e: Error) => setError(e.message)) }, [])
  if (error) return <p className="loading">Could not load the dashboard: {error}</p>
  if (!s) return <p className="loading">Loading dashboard…</p>

  const maxTvl = Math.max(1, ...s.tvlByChain.map((r) => r.tvlUsd ?? 0))
  const keeperTone = s.keeperHealth === 'Healthy' ? 'mint' : s.keeperHealth === 'Stale' ? 'amber' : s.keeperHealth === 'No runs yet' ? 'navy' : 'red'

  return (
    <div>
      <PageHeader
        icon={<LayoutDashboard />}
        title="Dashboard"
        sub="Total locked value, locks, auto-sells and keeper health at a glance. TVL is read live from on-chain vault balances; counts come from D1."
        pill={<span className="pill pill-grey"><Database />Config {s.configVersion}</span>}
      />

      <div className="grid stats">
        <StatCard icon={<Lock />} label="Active locks" value={String(s.activeLocks)} pill={<LivePill />} />
        <StatCard icon={<Zap />} label="Auto-sells executed" value={String(s.autoSells)} pill={<LivePill />} />
        <StatCard icon={<TrendingUp />} label="Auto-sell volume" value={usd(s.autoSellVolumeUsd)} pill={<LivePill />} />
        <StatCard
          icon={<HeartPulse />}
          label="Keeper health"
          value={s.keeperHealth}
          smallValue
          tone={keeperTone}
          pill={<LivePill />}
        />
      </div>

      <div className="grid grid2">
        <div className="card">
          <SectionTitle icon={<TrendingUp />} right={<LivePill />}>TVL per chain — {usd(s.totalTvlUsd)} total</SectionTitle>
          {s.tvlByChain.map((r) => {
            const v = r.tvlUsd ?? 0
            const pct = Math.round((v / maxTvl) * 100)
            return (
              <div className="tvl-row" key={r.chainId}>
                <span className="chain-dot" style={{ background: CHAIN_COLORS[r.chain] ?? '#8A99AF' }} />
                <div className="tvl-info">
                  <b>{r.chain}</b>
                  <div className="tvl-bar"><i style={{ width: `${pct}%` }} /></div>
                  <span>{r.note}</span>
                </div>
                <span className="tvl-value">{r.tvlUsd === null ? 'Unavailable' : usd(v)}</span>
              </div>
            )
          })}
          <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
            Chains with no vault deployed yet show $0.00 until a vault is registered in Chain Manager.
          </p>
        </div>

        <div>
          <div className="card">
            <SectionTitle icon={<Bell />}>Alerts</SectionTitle>
            {s.keeperFailedRuns24h > 0 || s.keeperHealth === 'Down' ? (
              <div className="notice alert" style={{ marginBottom: 0 }}>
                <Bell />
                <span><b>Keeper needs attention.</b><br />{s.keeperFailedRuns24h} failed run(s) in the last 24h. Last run: {s.keeperLastRunAt ?? 'never'}.</span>
              </div>
            ) : (
              <div className="notice ok" style={{ marginBottom: 0 }}>
                <CheckCircle2 />
                <span><b>Keeper last run: {s.keeperLastRunAt ?? 'no runs yet'}.</b><br />
                  {s.keeperMinutesSinceLastRun === null ? 'No keeper runs recorded yet.' : `${s.keeperMinutesSinceLastRun} minute(s) ago · ${s.keeperFailedRuns24h} failed run(s) in the last 24h.`}
                </span>
              </div>
            )}
          </div>

          <div className="card">
            <SectionTitle icon={<Activity />}>Data sources</SectionTitle>
            <div className="row-item">
              <div className="row-icon"><Database /></div>
              <div className="row-body">
                <b>Dashboard · Chain Manager · Keeper Monitor · Audit Log</b>
                <p className="muted">Read live from D1 and on-chain RPC.</p>
              </div>
              <div className="row-end"><LivePill /></div>
            </div>
            <div className="row-item">
              <div className="row-icon"><TrendingUp /></div>
              <div className="row-body">
                <b>TVL · Tokens · Fees · Announcements · Config</b>
                <p className="muted">Live from D1, DexScreener prices and signed config.</p>
              </div>
              <div className="row-end"><LivePill /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
