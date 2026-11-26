import { useEffect, useState } from 'react'
import { BadgeCheck, Coins, Hourglass, Rocket, Users, Wallet, X } from 'lucide-react'
import { api, type LaunchesFeed } from '../lib/api'
import type { LaunchContributionRow, LaunchRow } from '../lib/types'
import { LiveNote, PageHeader, SectionTitle, StatCard } from '../components/ui'

const microToUsd = (micro: string): number => Number(micro) / 1_000_000
const fmtUsd = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtTs = (epochSeconds: number): string =>
  new Date(epochSeconds * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const short = (addr: string): string => (addr.length > 13 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr)

function liquidityLabel(l: LaunchRow): string {
  if (l.liquidityLockBps === 0) return 'No liquidity lock — 0% reserved.'
  if (l.liquidityReleased) return 'Liquidity released to the liquidity manager.'
  if (!l.liquidityManager) return `Liquidity lock ${l.liquidityLockBps / 100}% — pending Arc DEX confirmation. Reserves stay locked in the launchpad.`
  return l.finalized
    ? 'Liquidity reserve earmarked — ready to release to the liquidity manager.'
    : `Liquidity lock ${l.liquidityLockBps / 100}% — reserved at finalize.`
}

export default function Launchpad() {
  const [feed, setFeed] = useState<LaunchesFeed | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [contribs, setContribs] = useState<Record<number, LaunchContributionRow[]>>({})
  const [contribForm, setContribForm] = useState({ contributor: '', amountUsd: '', txHash: '' })
  const [form, setForm] = useState({
    seller: '', tokenAddress: '', tokenSymbol: '', tokenName: '', tokenDecimals: '18', logoUrl: '',
    priceUsd: '0.10', softCapUsd: '1000', hardCapUsd: '10000', tokensForSale: '100000',
    start: '', end: '', liquidityPct: '20', saleId: '', txHash: '',
  })

  const load = () => {
    api.getLaunches().then(setFeed).catch((e: Error) => setError(e.message))
  }
  useEffect(load, [])

  const launches = feed?.launches ?? []
  const live = launches.filter((l) => l.status === 'Active' && l.approvalStatus === 'approved')
  const pending = launches.filter((l) => l.approvalStatus === 'pending')
  const totalRaised = launches.reduce((s, l) => s + microToUsd(l.raised), 0)

  const approve = async (l: LaunchRow, approval: 'approved' | 'rejected') => {
    setError('')
    try {
      await api.setLaunchApproval(l.id, approval)
      setNotice(`Launch ${l.tokenSymbol} ${approval}.`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update approval.') }
  }

  const markStatus = async (l: LaunchRow, status: 'Success' | 'Failed') => {
    setError('')
    try {
      await api.updateLaunch(l.id, { status, finalized: true })
      setNotice(`Launch ${l.tokenSymbol} marked ${status}.`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update status.') }
  }

  const toggleContribs = async (l: LaunchRow) => {
    if (expanded === l.id) { setExpanded(null); return }
    setExpanded(l.id)
    try {
      const rows = await api.getLaunchContributions(l.id)
      setContribs((c) => ({ ...c, [l.id]: rows }))
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load contributions.') }
  }

  const recordContrib = async (l: LaunchRow) => {
    setError('')
    const amountMicro = String(Math.round((parseFloat(contribForm.amountUsd) || 0) * 1_000_000))
    if (!/^0x[0-9a-fA-F]{40}$/.test(contribForm.contributor.trim())) { setError('Contributor must be a valid 0x address.'); return }
    if (Number(amountMicro) <= 0) { setError('Contribution amount must be greater than $0.'); return }
    try {
      await api.recordLaunchContribution(l.id, { contributor: contribForm.contributor.trim(), amount: amountMicro, txHash: contribForm.txHash || undefined })
      setNotice(`Contribution recorded for ${l.tokenSymbol}.`)
      setContribForm({ contributor: '', amountUsd: '', txHash: '' })
      const rows = await api.getLaunchContributions(l.id)
      setContribs((c) => ({ ...c, [l.id]: rows }))
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not record contribution.') }
  }

  const register = async () => {
    setError('')
    const startTime = form.start ? Math.floor(new Date(form.start).getTime() / 1000) : NaN
    const endTime = form.end ? Math.floor(new Date(form.end).getTime() / 1000) : NaN
    const decimals = Number(form.tokenDecimals)
    const data = {
      chainId: 'arc',
      saleId: form.saleId ? Number(form.saleId) : null,
      seller: form.seller.trim(),
      tokenAddress: form.tokenAddress.trim(),
      tokenSymbol: form.tokenSymbol.trim(),
      tokenName: form.tokenName.trim(),
      tokenDecimals: decimals,
      logoUrl: form.logoUrl.trim() || null,
      pricePerToken: String(Math.round((parseFloat(form.priceUsd) || 0) * 1_000_000)),
      softCap: String(Math.round((parseFloat(form.softCapUsd) || 0) * 1_000_000)),
      hardCap: String(Math.round((parseFloat(form.hardCapUsd) || 0) * 1_000_000)),
      tokensForSale: String(Math.round(parseFloat(form.tokensForSale) || 0) * 10 ** decimals),
      startTime,
      endTime,
      liquidityLockBps: Math.round((parseFloat(form.liquidityPct) || 0) * 100),
      txHash: form.txHash.trim() || null,
    }
    try {
      await api.registerLaunch(data)
      setNotice(`${data.tokenSymbol || 'Launch'} recorded — pending approval. It appears in the mobile app only after approval.`)
      setForm({
        seller: '', tokenAddress: '', tokenSymbol: '', tokenName: '', tokenDecimals: '18', logoUrl: '',
        priceUsd: '0.10', softCapUsd: '1000', hardCapUsd: '10000', tokensForSale: '100000',
        start: '', end: '', liquidityPct: '20', saleId: '', txHash: '',
      })
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not register launch.') }
  }

  return (
    <div>
      <PageHeader
        icon={<Rocket />}
        title="Launchpad Manager"
        sub="Free fixed-price token sales on Arc testnet — no Stelix launch fee, gas only. Launches are recorded here only after they exist on-chain; approval lists them in the mobile app. Liquidity lock is pending Arc DEX confirmation until a liquidity manager is set."
        pill={<LiveNote />}
      />
      {error && <div className="notice alert"><X /><span>{error}</span></div>}
      {notice && <div className="notice ok"><BadgeCheck /><span>{notice}</span></div>}

      <div className="grid stats">
        <StatCard icon={<Rocket />} label="Launches recorded" value={String(launches.length)} />
        <StatCard icon={<Hourglass />} label="Pending approval" value={String(pending.length)} tone={pending.length > 0 ? 'amber' : 'mint'} />
        <StatCard icon={<Users />} label="Live launches" value={String(live.length)} />
        <StatCard icon={<Wallet />} label="Total raised" value={fmtUsd(totalRaised)} />
      </div>

      <div className="card">
        <SectionTitle icon={<Rocket />}>Contracts — Arc testnet</SectionTitle>
        <p className="muted" style={{ marginTop: 0 }}>
          Launchpad: <span className="mono">{feed?.launchpadAddress ?? 'Not deployed yet'}</span>
        </p>
        <p className="muted">
          Token factory: <span className="mono">{feed?.factoryAddress ?? 'Not deployed yet'}</span>
        </p>
        <p className="muted">
          Liquidity manager: <span className="mono">{feed?.liquidityManager ?? 'None set — pending Arc DEX confirmation'}</span>
        </p>
        {feed?.note && <p className="muted">{feed.note}</p>}
      </div>

      <div className="card">
        <SectionTitle icon={<Coins />}>Register a launch (after it exists on-chain)</SectionTitle>
        <label>Seller wallet (0x)</label>
        <input value={form.seller} onChange={(e) => setForm({ ...form, seller: e.target.value })} placeholder="0x…" />
        <label>Token contract address (0x)</label>
        <input value={form.tokenAddress} onChange={(e) => setForm({ ...form, tokenAddress: e.target.value })} placeholder="0x…" />
        <label>Token symbol</label>
        <input value={form.tokenSymbol} onChange={(e) => setForm({ ...form, tokenSymbol: e.target.value })} placeholder="GLOW" />
        <label>Token name</label>
        <input value={form.tokenName} onChange={(e) => setForm({ ...form, tokenName: e.target.value })} placeholder="Glow Token" />
        <label>Token decimals</label>
        <input value={form.tokenDecimals} inputMode="numeric" onChange={(e) => setForm({ ...form, tokenDecimals: e.target.value })} placeholder="18" />
        <label>Logo image URL (optional)</label>
        <input value={form.logoUrl} onChange={(e) => setForm({ ...form, logoUrl: e.target.value })} placeholder="https://…/logo.png" />
        <label>Sale price per token (USDC)</label>
        <input value={form.priceUsd} inputMode="decimal" onChange={(e) => setForm({ ...form, priceUsd: e.target.value })} placeholder="0.10" />
        <label>Soft cap (USDC)</label>
        <input value={form.softCapUsd} inputMode="decimal" onChange={(e) => setForm({ ...form, softCapUsd: e.target.value })} placeholder="1000" />
        <label>Hard cap (USDC)</label>
        <input value={form.hardCapUsd} inputMode="decimal" onChange={(e) => setForm({ ...form, hardCapUsd: e.target.value })} placeholder="10000" />
        <label>Tokens for sale (whole tokens)</label>
        <input value={form.tokensForSale} inputMode="numeric" onChange={(e) => setForm({ ...form, tokensForSale: e.target.value })} placeholder="100000" />
        <label>Sale starts</label>
        <input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        <label>Sale ends</label>
        <input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        <label>Liquidity lock % (max 50)</label>
        <input value={form.liquidityPct} inputMode="decimal" onChange={(e) => setForm({ ...form, liquidityPct: e.target.value })} placeholder="20" />
        <label>On-chain sale ID (optional)</label>
        <input value={form.saleId} inputMode="numeric" onChange={(e) => setForm({ ...form, saleId: e.target.value })} placeholder="0" />
        <label>Creation tx hash (optional)</label>
        <input value={form.txHash} onChange={(e) => setForm({ ...form, txHash: e.target.value })} placeholder="0x…" />
        <button className="btn mint block" style={{ marginTop: 12 }} onClick={register} disabled={!form.seller || !form.tokenAddress || !form.tokenSymbol}>
          Register launch
        </button>
      </div>

      <div className="card">
        <SectionTitle icon={<Rocket />}>Launches</SectionTitle>
        {launches.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            No launches yet — launches go live once the launchpad contracts are deployed on Arc testnet.
          </p>
        ) : (
          launches.map((l) => (
            <div className="row-item" key={l.id}>
              <div className="row-icon"><Rocket /></div>
              <div className="row-body">
                <b>{l.tokenSymbol} — {l.tokenName || short(l.tokenAddress)}</b>
                <p className="muted">
                  Sale {l.saleId ?? '—'} · {l.status}{l.finalized ? ' (finalized)' : ''} · {l.approvalStatus} · Price {fmtUsd(microToUsd(l.pricePerToken))} · Raised {fmtUsd(microToUsd(l.raised))} / {fmtUsd(microToUsd(l.hardCap))} · {l.contributors} backers
                </p>
                <p className="muted">{fmtTs(l.startTime)} → {fmtTs(l.endTime)}</p>
                <p className="muted mono">{l.tokenAddress} · seller {short(l.seller)}</p>
                <p className="muted">{liquidityLabel(l)}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                  {l.approvalStatus === 'pending' && (
                    <>
                      <button className="btn mint" onClick={() => approve(l, 'approved')}>Approve</button>
                      <button className="btn" onClick={() => approve(l, 'rejected')}>Reject</button>
                    </>
                  )}
                  {l.approvalStatus === 'approved' && l.status === 'Active' && (
                    <>
                      <button className="btn" onClick={() => markStatus(l, 'Success')}>Mark successful</button>
                      <button className="btn" onClick={() => markStatus(l, 'Failed')}>Mark failed</button>
                    </>
                  )}
                  <button className="btn" onClick={() => toggleContribs(l)}>
                    {expanded === l.id ? 'Hide contributions' : 'Contributions'}
                  </button>
                </div>
                {expanded === l.id && (
                  <div style={{ marginTop: 12 }}>
                    {(contribs[l.id] ?? []).length === 0 ? (
                      <p className="muted">No contributions recorded for this launch yet.</p>
                    ) : (
                      contribs[l.id].map((c) => (
                        <p className="muted" key={c.id}>
                          {short(c.contributor)} · {fmtUsd(microToUsd(c.amount))}{c.txHash ? ` · ${short(c.txHash)}` : ''}
                        </p>
                      ))
                    )}
                    <label>Contributor wallet (0x)</label>
                    <input value={contribForm.contributor} onChange={(e) => setContribForm({ ...contribForm, contributor: e.target.value })} placeholder="0x…" />
                    <label>Amount (USDC)</label>
                    <input value={contribForm.amountUsd} inputMode="decimal" onChange={(e) => setContribForm({ ...contribForm, amountUsd: e.target.value })} placeholder="25" />
                    <label>Tx hash (optional)</label>
                    <input value={contribForm.txHash} onChange={(e) => setContribForm({ ...contribForm, txHash: e.target.value })} placeholder="0x…" />
                    <button className="btn block" style={{ marginTop: 8 }} onClick={() => recordContrib(l)}>Record contribution</button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
