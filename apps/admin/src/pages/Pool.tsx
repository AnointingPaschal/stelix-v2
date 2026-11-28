import { useEffect, useState } from 'react'
import { Droplets, RefreshCw } from 'lucide-react'
import { api, type PoolStatus } from '../lib/api'
import { LiveNote, PageHeader, SectionTitle, StatCard } from '../components/ui'
import { AlertModal } from '../components/AlertModal'

export default function Pool() {
  const [pool, setPool] = useState<PoolStatus | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setError('')
    setLoading(true)
    try {
      setPool(await api.getPool())
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read the pool.') }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  return (
    <div>
      <PageHeader
        icon={<Droplets />}
        title="Stelix Pool"
        sub="The STX/USDC pool on Arc Mainnet, read live from the Uniswap V3 factory and pool contracts — no price feed, no guess. The pool address comes from Factory.getPool at fee tier 0.3%."
        pill={<LiveNote />}
        actions={<button className="btn" onClick={load} disabled={loading}><RefreshCw />{loading ? 'Refreshing…' : 'Refresh'}</button>}
      />
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      {pool === null ? (
        <p className="muted">Loading pool state…</p>
      ) : pool.stx.address === null ? (
        <div className="card">
          <SectionTitle icon={<Droplets />}>No STX token configured yet</SectionTitle>
          <p className="muted">
            The new STX token has not been deployed and registered yet — the old STX cannot have its supply
            increased, so there is no pool to show until the new token exists. Deploy it from the Launchpad
            and register it in the Token Registry; the pool view will pick it up with no code change.
          </p>
          <p className="muted small">USDC <span className="kbd">{pool.usdc.address}</span> ({pool.usdc.decimals} decimals) · Checked {pool.checkedAt}</p>
          {pool.note && <p className="field-hint">{pool.note}</p>}
        </div>
      ) : !pool.exists ? (
        <div className="card">
          <SectionTitle icon={<Droplets />}>No pool yet</SectionTitle>
          <p className="muted">
            There is no STX/USDC pool on Arc Mainnet at fee tier 0.3% — Factory.getPool returned the zero
            address. STX has no DEX pool today; it lives only in the token registry until liquidity is added.
          </p>
          <p className="muted">
            Factory <span className="kbd">{pool.factory}</span>{pool.factoryVerified ? ' — code verified on-chain.' : ' — code NOT verified on-chain; the factory address or the Arc RPC needs checking.'}
          </p>
          <p className="muted small">STX <span className="kbd">{pool.stx.address}</span> ({pool.stx.decimals} decimals, from the {pool.stx.source === 'registry' ? 'token registry' : 'latest STX launch record'}) · USDC <span className="kbd">{pool.usdc.address}</span> ({pool.usdc.decimals} decimals) · Checked {pool.checkedAt}</p>
          {pool.note && <p className="field-hint">{pool.note}</p>}
        </div>
      ) : (
        <>
          <div className="grid grid2">
            <StatCard icon={<Droplets />} label="Price — USDC per STX" value={pool.priceUsdcPerStx ? `$${pool.priceUsdcPerStx}` : '—'} tone="mint" />
            <StatCard icon={<Droplets />} label="Price — STX per USDC" value={pool.priceStxPerUsdc ?? '—'} tone="navy" />
            <StatCard icon={<Droplets />} label="Active V3 liquidity (raw)" value={pool.liquidityRaw ?? '—'} tone="navy" smallValue />
            <StatCard icon={<Droplets />} label="Current tick" value={pool.tick !== null ? String(pool.tick) : '—'} tone="navy" />
          </div>
          <div className="card">
            <SectionTitle icon={<Droplets />}>Pool details</SectionTitle>
            <p className="muted" style={{ overflowWrap: 'anywhere' }}>
              Pool: <span className="kbd">{pool.poolAddress}</span><br />
              token0: <span className="kbd">{pool.token0}</span><br />
              token1: <span className="kbd">{pool.token1}</span><br />
              STX: <span className="kbd">{pool.stx.address}</span> ({pool.stx.decimals} decimals, from the {pool.stx.source === 'registry' ? 'token registry' : 'latest STX launch record'})<br />
              USDC: <span className="kbd">{pool.usdc.address}</span> ({pool.usdc.decimals} decimals)<br />
              Factory: <span className="kbd">{pool.factory}</span> {pool.factoryVerified ? '(code verified on-chain)' : '(code NOT verified on-chain)'}
            </p>
            {pool.explorerUrl && <p><a href={pool.explorerUrl} target="_blank" rel="noreferrer">Open the pool on the explorer</a></p>}
            <p className="muted small">Checked {pool.checkedAt}</p>
            {pool.note && <p className="field-hint">{pool.note}</p>}
          </div>
        </>
      )}
    </div>
  )
}
