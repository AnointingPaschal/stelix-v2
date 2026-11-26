import { useEffect, useState } from 'react'
import {
  Activity, Bell, CheckCircle2, Database, FlaskConical, HeartPulse, LayoutDashboard,
  Lock, TrendingUp, Zap,
} from 'lucide-react'
import { api } from '../lib/api'
import { DemoPill, LivePill, PageHeader, SectionTitle, StatCard } from '../components/ui'

const CHAIN_COLORS: Record<string, string> = {
  Arc: '#2FD6A3', 'BNB Chain': '#F0B90B', Base: '#0052FF',
  Ethereum: '#627EEA', Polygon: '#8247E5', Solana: '#9945FF',
}

function parseUsd(v: string): number {
  const n = Number(v.replace(/[^0-9.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export default function Dashboard() {
  const [s, setS] = useState<Awaited<ReturnType<typeof api.getDashboard>> | null>(null)
  useEffect(() => { api.getDashboard().then(setS) }, [])
  if (!s) return <p className="loading">Loading dashboard…</p>

  const maxTvl = Math.max(1, ...s.tvlByChain.map((r) => parseUsd(r.tvl)))

  return (
    <div>
      <PageHeader
        icon={<LayoutDashboard />}
        title="Dashboard"
        sub="Total locked value, locks, auto-sells and keeper health at a glance."
        pill={<span className="pill pill-grey"><Database />Config {s.configVersion}</span>}
      />

      <div className="grid stats">
        <StatCard icon={<Lock />} label="Active locks" value={String(s.activeLocks)} pill={<DemoPill />} />
        <StatCard icon={<Zap />} label="Auto-sells executed" value={String(s.autoSells)} pill={<DemoPill />} />
        <StatCard icon={<TrendingUp />} label="Auto-sell volume" value={s.autoSellVolume} pill={<DemoPill />} />
        <StatCard
          icon={<HeartPulse />}
          label="Keeper health"
          value={s.keeperHealth.replace(' (demo)', '')}
          smallValue
          tone="navy"
          pill={<DemoPill />}
        />
      </div>

      <div className="grid grid2">
        <div className="card">
          <SectionTitle icon={<TrendingUp />} right={<DemoPill />}>TVL per chain</SectionTitle>
          {s.tvlByChain.map((r) => {
            const v = parseUsd(r.tvl)
            const pct = Math.round((v / maxTvl) * 100)
            return (
              <div className="tvl-row" key={r.chain}>
                <span className="chain-dot" style={{ background: CHAIN_COLORS[r.chain] ?? '#8A99AF' }} />
                <div className="tvl-info">
                  <b>{r.chain}</b>
                  <div className="tvl-bar"><i style={{ width: `${pct}%` }} /></div>
                </div>
                <span className="tvl-value">{r.tvl}</span>
              </div>
            )
          })}
          <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
            Demo figures until TVL is wired to on-chain balances.
          </p>
        </div>

        <div>
          <div className="card">
            <SectionTitle icon={<Bell />}>Alerts</SectionTitle>
            <p className="muted">No live alerts. Production alerts: failed swaps, low keeper gas, RPC errors, missed keeper runs.</p>
            <div className="notice ok" style={{ marginBottom: 0 }}>
              <CheckCircle2 />
              <span><b>Keeper last run: on schedule (demo).</b><br />No failed swaps.</span>
            </div>
          </div>

          <div className="card">
            <SectionTitle icon={<Activity />}>Data sources</SectionTitle>
            <div className="row-item">
              <div className="row-icon"><Database /></div>
              <div className="row-body">
                <b>Chain Manager · Keeper Monitor · Audit Log</b>
                <p className="muted">Read live from D1.</p>
              </div>
              <div className="row-end"><LivePill /></div>
            </div>
            <div className="row-item">
              <div className="row-icon"><FlaskConical /></div>
              <div className="row-body">
                <b>Dashboard stats · Tokens · Fees · Announcements · Config</b>
                <p className="muted">Demo placeholders until wired.</p>
              </div>
              <div className="row-end"><DemoPill /></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
