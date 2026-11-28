import { useEffect, useState } from 'react'
import { BadgeCheck, Coins, Hourglass, ImagePlus, Rocket, Users, Wallet, X } from 'lucide-react'
import { Contract, type InterfaceAbi } from 'ethers'
import launchpadArtifact from '../contracts/launchpad.artifact.json'
import { api, type LaunchesFeed } from '../lib/api'
import type { Chain, LaunchContributionRow, LaunchRow } from '../lib/types'
import { connectWallet, friendlyWalletError, hasInjectedWallet, signerForTx } from '../lib/walletDeploy'
import { LiveNote, PageHeader, SectionTitle, StatCard } from '../components/ui'
import { AlertModal } from '../components/AlertModal'
import DeployLaunchpad from '../components/DeployLaunchpad'

const microToUsd = (micro: string): number => Number(micro) / 1_000_000
const fmtUsd = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtTs = (epochSeconds: number): string =>
  new Date(epochSeconds * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const short = (addr: string): string => (addr.length > 13 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr)

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const LOGO_MAX_BYTES = 256 * 1024

function liquidityLabel(l: LaunchRow): string {
  if (l.liquidityLockBps === 0) return 'No liquidity lock — 0% reserved.'
  if (l.liquidityReleased) return 'Liquidity released to the liquidity manager.'
  if (!l.liquidityManager) return `Liquidity lock ${l.liquidityLockBps / 100}% — pending Arc DEX confirmation. Reserves stay locked in the launchpad.`
  return l.finalized
    ? 'Liquidity reserve earmarked — ready to release to the liquidity manager.'
    : `Liquidity lock ${l.liquidityLockBps / 100}% — reserved at finalize.`
}

/** Logo upload — a file, never a link. The file is stored by the admin
 *  and served back at a short https URL; that URL is what goes on-chain
 *  as the token's logoURI, so the logo shows wherever the contract
 *  address is imported. Max 256 KB, PNG/JPG/WebP/GIF (no SVG). */
function LogoUpload({ logoUrl, onUploaded, onRemove, onError }: {
  logoUrl: string | null
  onUploaded: (url: string) => void
  onRemove: () => void
  onError: (msg: string) => void
}) {
  const [uploading, setUploading] = useState(false)
  const pick = async (file: File | undefined) => {
    if (!file) return
    if (!LOGO_TYPES.includes(file.type)) { onError(`Logo must be PNG, JPG, WebP or GIF — "${file.type || 'unknown type'}" is not accepted.`); return }
    if (file.size <= 0 || file.size > LOGO_MAX_BYTES) { onError('Logo must be between 1 byte and 256 KB.'); return }
    setUploading(true)
    try {
      const { url } = await api.uploadLaunchLogo(file)
      onUploaded(url)
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not upload the logo.') }
    setUploading(false)
  }
  return (
    <div>
      {logoUrl ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <img src={logoUrl} alt="Token logo" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border, #E5E7EB)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="muted" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{logoUrl}</p>
            <p className="muted" style={{ margin: 0 }}>This URL is stored on-chain as the token&apos;s logo — it shows wherever the address is imported.</p>
          </div>
          <button className="btn" onClick={onRemove}>Remove</button>
        </div>
      ) : (
        <p className="muted" style={{ margin: '0 0 8px' }}>No logo yet — upload one and it is registered on-chain with the token.</p>
      )}
      <label className="btn" style={{ cursor: uploading ? 'wait' : 'pointer' }}>
        <ImagePlus /> {uploading ? 'Uploading…' : logoUrl ? 'Change logo' : 'Upload logo'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: 'none' }}
          disabled={uploading}
          onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }}
        />
      </label>
      <p className="field-hint">PNG, JPG, WebP or GIF, max 256 KB. The file is uploaded — never a link — and served from the admin.</p>
    </div>
  )
}

export default function Launchpad() {
  const [feed, setFeed] = useState<LaunchesFeed | null>(null)
  const [chains, setChains] = useState<Chain[]>([])
  const [selectedChainId, setSelectedChainId] = useState('arc')
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
  const [tokenForm, setTokenForm] = useState({ name: '', symbol: '', supply: '1000000', decimals: '18' })
  const [wallet, setWallet] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdToken, setCreatedToken] = useState<{ address: string; txHash: string } | null>(null)

  const load = () => {
    api.getLaunches().then(setFeed).catch((e: Error) => setError(e.message))
    api.getChains().then((list) => {
      setChains(list)
      // Keep the selected chain valid; default to Arc testnet.
      setSelectedChainId((cur) => (list.some((c) => c.id === cur && c.active && c.id !== 'solana') ? cur : list.find((c) => c.id === 'arc')?.id ?? list.find((c) => c.id !== 'solana' && c.active)?.id ?? cur))
    }).catch((e: Error) => setError(e.message))
  }
  useEffect(load, [])

  const launches = feed?.launches ?? []
  const live = launches.filter((l) => l.status === 'Active' && l.approvalStatus === 'approved')
  const pending = launches.filter((l) => l.approvalStatus === 'pending')
  const totalRaised = launches.reduce((s, l) => s + microToUsd(l.raised), 0)
  const evmChains = chains.filter((c) => c.id !== 'solana' && c.active)
  const selectedChain = chains.find((c) => c.id === selectedChainId) ?? evmChains[0]
  const isMainnet = selectedChain ? !selectedChain.isTestnet : false
  const factoryAddress = selectedChain?.tokenFactoryAddress ?? null

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

  const onContractsDeployed = async (kind: 'factory' | 'launchpad', address: string) => {
    if (!selectedChain) return
    try {
      await api.updateChain(selectedChain.id, kind === 'factory' ? { tokenFactoryAddress: address } : { launchpadAddress: address })
      setNotice(`${kind === 'factory' ? 'Token factory' : 'Launchpad'} deployed at ${address} on ${selectedChain.name} and saved to the chain.`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Deployed, but the address could not be saved to the chain — copy it from the log above and paste it in Chain Manager.') }
  }

  const connect = async () => {
    setError('')
    if (!selectedChain) return
    if (!hasInjectedWallet()) { setError('No wallet found in this browser. Install MetaMask (or another injected wallet) and try again.'); return }
    setCreating(true)
    try {
      const address = await connectWallet(selectedChain)
      setWallet(address)
      setNotice(`Connected ${address} on ${selectedChain.name}.`)
    } catch (e) { setError(friendlyWalletError(e, selectedChain)) }
    setCreating(false)
  }

  /** Create the token on-chain with the factory — free, gas only, no
   *  Stelix fee. The logo URL (uploaded above) is recorded on-chain
   *  with the token, so the logo shows wherever the address is
   *  imported. The full supply is minted to the connected wallet. */
  const createToken = async () => {
    setError('')
    if (!selectedChain || !factoryAddress) { setError('Deploy the token factory on this chain first (Contracts card above).'); return }
    if (!wallet) { setError('Connect your wallet first.'); return }
    const name = tokenForm.name.trim()
    const symbol = tokenForm.symbol.trim().toUpperCase()
    const decimals = Number(tokenForm.decimals)
    if (!name) { setError('Token name is required.'); return }
    if (!symbol) { setError('Token symbol is required.'); return }
    if (!/^\d+$/.test(tokenForm.supply.trim()) || BigInt(tokenForm.supply.trim()) <= 0n) { setError('Total supply must be a whole number greater than 0.'); return }
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) { setError('Decimals must be 0–18.'); return }
    setCreating(true)
    try {
      const { signer, deployer } = await signerForTx(selectedChain)
      if (deployer.toLowerCase() !== wallet.toLowerCase()) {
        setError(`MetaMask is now on a different account (${deployer.slice(0, 6)}…${deployer.slice(-4)}) than the one you connected (${wallet.slice(0, 6)}…${wallet.slice(-4)}). Switch back to the connected account in MetaMask, then try again.`)
        setCreating(false)
        return
      }
      const arts = launchpadArtifact as unknown as { factory: { abi: InterfaceAbi; bytecode: string } }
      const totalSupply = BigInt(tokenForm.supply.trim()) * 10n ** BigInt(decimals)
      const logoURI = form.logoUrl.trim()
      // createToken on the already-deployed factory (no new deployment).
      const factoryContract = new Contract(factoryAddress, arts.factory.abi, signer)
      const tx = await factoryContract.createToken(name, symbol, totalSupply, decimals, logoURI)
      const receipt = await tx.wait()
      // The TokenCreated event carries the new token address.
      const iface = factoryContract.interface
      const created = receipt.logs.map((l: { topics: string[]; data: string }) => { try { return iface.parseLog(l) } catch { return null } }).find((p: { name?: string } | null) => p?.name === 'TokenCreated')
      const tokenAddress = (created?.args?.[0] as string | undefined) ?? ''
      if (!tokenAddress) throw new Error('Token created but the address could not be read from the transaction — find it in the TokenCreated event on the explorer.')
      setCreatedToken({ address: tokenAddress, txHash: tx.hash as string })
      // Prefill the register form with the new token — the seller is you.
      setForm((f) => ({
        ...f,
        seller: deployer,
        tokenAddress,
        tokenSymbol: symbol,
        tokenName: name,
        tokenDecimals: String(decimals),
        txHash: tx.hash as string,
      }))
      setNotice(`${symbol} created at ${tokenAddress} on ${selectedChain.name} — free, gas only. The register form below is filled in; set the sale terms and register the launch.`)
    } catch (e) { setError(friendlyWalletError(e, selectedChain)) }
    setCreating(false)
  }

  const register = async () => {
    setError('')
    if (!selectedChain) { setError('Pick a chain first.'); return }
    const startTime = form.start ? Math.floor(new Date(form.start).getTime() / 1000) : NaN
    const endTime = form.end ? Math.floor(new Date(form.end).getTime() / 1000) : NaN
    const decimals = Number(form.tokenDecimals)
    const data = {
      chainId: selectedChain.id,
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
      tokensForSale: (BigInt(Math.round(parseFloat(form.tokensForSale) || 0)) * 10n ** BigInt(decimals)).toString(),
      startTime,
      endTime,
      liquidityLockBps: Math.round((parseFloat(form.liquidityPct) || 0) * 100),
      txHash: form.txHash.trim() || null,
    }
    try {
      await api.registerLaunch(data)
      setNotice(`${data.tokenSymbol || 'Launch'} recorded on ${selectedChain.name} — pending approval. It appears in the mobile app only after approval, and its logo is registered with the token.`)
      setForm({
        seller: '', tokenAddress: '', tokenSymbol: '', tokenName: '', tokenDecimals: '18', logoUrl: '',
        priceUsd: '0.10', softCapUsd: '1000', hardCapUsd: '10000', tokensForSale: '100000',
        start: '', end: '', liquidityPct: '20', saleId: '', txHash: '',
      })
      setCreatedToken(null)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not register launch.') }
  }

  return (
    <div>
      <PageHeader
        icon={<Rocket />}
        title="Launchpad Manager"
        sub="Launch the Stelix wallet native token — or any token — on any chain in the wallet, for free: no Stelix launch fee, gas only. Create the token with the factory, register its sale, approve it to list in the mobile app. The logo is uploaded as a file and recorded on-chain with the token, so it shows wherever the contract address is imported. Liquidity lock is pending Arc DEX confirmation until a liquidity manager is set."
        pill={<LiveNote />}
      />
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <AlertModal kind="success" message={notice} onClose={() => setNotice('')} />

      <div className="grid stats">
        <StatCard icon={<Rocket />} label="Launches recorded" value={String(launches.length)} />
        <StatCard icon={<Hourglass />} label="Pending approval" value={String(pending.length)} tone={pending.length > 0 ? 'amber' : 'mint'} />
        <StatCard icon={<Users />} label="Live launches" value={String(live.length)} />
        <StatCard icon={<Wallet />} label="Total raised" value={fmtUsd(totalRaised)} />
      </div>

      <div className="card">
        <SectionTitle icon={<Rocket />}>Chain for this launch</SectionTitle>
        <label>Chain</label>
        <select value={selectedChainId} onChange={(e) => setSelectedChainId(e.target.value)}>
          {evmChains.map((c) => (
            <option key={c.id} value={c.id}>{c.name} — {c.isTestnet ? 'testnet' : 'mainnet'}{c.isDefault ? ' (default)' : ''}</option>
          ))}
        </select>
        <p className="field-hint">
          The token is created, the contracts are deployed, and the sale is registered on this chain.
          {chains.some((c) => c.id === 'solana') && ' Solana is not listed here — it needs its own program (separate build), not an EVM factory.'}
          {isMainnet && selectedChain && <><br /><b>{selectedChain.name} is mainnet — real money.</b> Gas is paid in real {selectedChain.nativeToken}, and a token created here is a real on-chain asset with a fixed supply that cannot be undone.</>}
        </p>
      </div>

      <div className="card">
        <SectionTitle icon={<Coins />}>Contracts — {selectedChain?.name ?? '…'}</SectionTitle>
        {selectedChain ? (
          <DeployLaunchpad chain={selectedChain} onDeployed={(kind, address) => { void onContractsDeployed(kind, address) }} />
        ) : (
          <p className="muted">No EVM chain is active yet — add one in Chain Manager.</p>
        )}
        {chains.length > 0 && (
          <>
            <label style={{ marginTop: 12 }}>All chains</label>
            {chains.map((c) => (
              <p className="muted" key={c.id} style={{ margin: '4px 0' }}>
                <b>{c.name}</b> ({c.isTestnet ? 'testnet' : 'mainnet'}) — factory{' '}
                <span className="mono">{c.tokenFactoryAddress ? short(c.tokenFactoryAddress) : '—'}</span> · launchpad{' '}
                <span className="mono">{c.launchpadAddress ? short(c.launchpadAddress) : '—'}</span>
                {c.id === 'solana' && ' · Solana needs its own program — separate build'}
              </p>
            ))}
          </>
        )}
      </div>

      <div className="card">
        <SectionTitle icon={<Coins />}>Create a token — free, gas only</SectionTitle>
        <p className="muted" style={{ marginTop: 0 }}>
          Create the token on {selectedChain?.name ?? '…'} with the factory. No Stelix fee — your wallet pays only the gas, and the full supply is minted to you. The logo is recorded on-chain with the token.
        </p>
        {!factoryAddress && (
          <p className="muted">The token factory is not deployed on {selectedChain?.name ?? 'this chain'} yet — deploy it in the Contracts card above first.</p>
        )}
        <label>Token name</label>
        <input value={tokenForm.name} onChange={(e) => setTokenForm({ ...tokenForm, name: e.target.value })} placeholder="Stelix" />
        <label>Token symbol</label>
        <input value={tokenForm.symbol} onChange={(e) => setTokenForm({ ...tokenForm, symbol: e.target.value })} placeholder="STELIX" />
        <label>Total supply (whole tokens)</label>
        <input value={tokenForm.supply} inputMode="numeric" onChange={(e) => setTokenForm({ ...tokenForm, supply: e.target.value })} placeholder="1000000" />
        <label>Decimals</label>
        <input value={tokenForm.decimals} inputMode="numeric" onChange={(e) => setTokenForm({ ...tokenForm, decimals: e.target.value })} placeholder="18" />
        <label>Logo (upload — recorded on-chain with the token)</label>
        <LogoUpload
          logoUrl={form.logoUrl || null}
          onUploaded={(url) => setForm((f) => ({ ...f, logoUrl: url }))}
          onRemove={() => setForm((f) => ({ ...f, logoUrl: '' }))}
          onError={(m) => setError(m)}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="btn ghost" onClick={connect} disabled={creating}><Wallet />{wallet ? `Connected: ${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Connect wallet'}</button>
          <button className="btn mint" onClick={createToken} disabled={creating || !wallet || !factoryAddress}>{creating ? 'Creating…' : 'Create token — free, gas only'}</button>
        </div>
        {createdToken && selectedChain && (
          <p className="field-hint">
            <BadgeCheck /> Token created: <a href={`${selectedChain.explorerUrl.replace(/\/$/, '')}/address/${createdToken.address}`} target="_blank" rel="noreferrer">{createdToken.address}</a>
            {createdToken.txHash ? ` (tx ${createdToken.txHash})` : ''} — the register form below is filled in.
          </p>
        )}
        <p className="field-hint">Fixed supply, no mint, burn, pause or tax — what is created is what exists. The token address above is also the address to import anywhere; its logo travels with it on-chain.</p>
      </div>

      <div className="card">
        <SectionTitle icon={<Coins />}>Register a launch on {selectedChain?.name ?? '…'} (after it exists on-chain)</SectionTitle>
        <p className="muted" style={{ marginTop: 0 }}>
          Chain: <b>{selectedChain?.name ?? '—'}</b> — change it in the chain picker above. Registering also puts the token in the Token/DEX registry (verified) with its logo, so the wallet shows the logo wherever the address is imported.
        </p>
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
        <label>Logo (upload — same logo as the token creation above)</label>
        <LogoUpload
          logoUrl={form.logoUrl || null}
          onUploaded={(url) => setForm((f) => ({ ...f, logoUrl: url }))}
          onRemove={() => setForm((f) => ({ ...f, logoUrl: '' }))}
          onError={(m) => setError(m)}
        />
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
            No launches yet — launches go live once the launchpad contracts are deployed on a chain.
          </p>
        ) : (
          launches.map((l) => (
            <div className="row-item" key={l.id}>
              <div className="row-icon">{l.logoUrl ? <img src={l.logoUrl} alt="" style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover' }} /> : <Rocket />}</div>
              <div className="row-body">
                <b>{l.tokenSymbol} — {l.tokenName || short(l.tokenAddress)}</b>
                <p className="muted">
                  Sale {l.saleId ?? '—'} · {l.chain} · {l.status}{l.finalized ? ' (finalized)' : ''} · {l.approvalStatus} · Price {fmtUsd(microToUsd(l.pricePerToken))} · Raised {fmtUsd(microToUsd(l.raised))} / {fmtUsd(microToUsd(l.hardCap))} · {l.contributors} backers
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
