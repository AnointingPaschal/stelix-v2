import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, Code2, FileCode2, Hammer, Rocket, ShieldAlert } from 'lucide-react'
import source from '../contracts/StelixVault.sol?raw'
import { SOLC_PINNED } from '../lib/types'
import { mainnetConfirmPhrase, validateDeployParams } from '../lib/deployParams'
import { api, type AuditGate, type CompileResult } from '../lib/api'
import type { Chain } from '../lib/types'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'

type Deployment = { id: number; chain_id: string; address: string; tx_hash: string | null; compiler_version: string; verification_status: string; env: string; created_at: string }

export default function ContractStudio() {
  const [src, setSrc] = useState(source)
  const [compileOut, setCompileOut] = useState('')
  const [compileRes, setCompileRes] = useState<CompileResult | null>(null)
  const [chains, setChains] = useState<Chain[]>([])
  const [chainId, setChainId] = useState('arc')
  const [params, setParams] = useState({
    owner: '', keeper: '', router: '', priceFeed: '',
    penaltyRecipient: '', feeRecipient: '', autoSellFeeBps: '0',
  })
  const [address, setAddress] = useState('')
  const [txHash, setTxHash] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [testnetPassed, setTestnetPassed] = useState(false)
  const [smokeAttested, setSmokeAttested] = useState(false)
  const [smokeNote, setSmokeNote] = useState('')
  const [deploys, setDeploys] = useState<Deployment[]>([])
  const [gate, setGate] = useState<AuditGate | null>(null)
  const [prepareCmd, setPrepareCmd] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const sizeKb = useMemo(() => (new TextEncoder().encode(src).length / 1024).toFixed(1), [src])
  const chain = chains.find((c) => c.id === chainId)
  const chainName = chain?.name ?? chainId

  const load = () => {
    api.getChains().then((c) => { setChains(c); if (c.length > 0 && !c.some((x) => x.id === chainId)) setChainId(c[0].id) }).catch(() => undefined)
    api.getDeployments().then((d) => setDeploys(d.deployments)).catch(() => undefined)
    api.getAuditGate().then(setGate).catch(() => undefined)
  }
  useEffect(load, [])

  const auditGatePass = gate?.gatePass ?? false
  const verifiedTestnet = deploys.some((d) => d.chain_id === chainId && d.env === 'testnet' && d.verification_status === 'verified')
  const mainnetReady = auditGatePass && (verifiedTestnet || testnetPassed) && smokeAttested

  const compile = async () => {
    setError(''); setNotice(''); setBusy(true)
    try {
      const r = await api.compile(src)
      setCompileRes(r)
      setCompileOut(
        `Compiled with ${r.compiler} (pinned).\n` +
        `Source sha256: ${r.sourceHash}\n` +
        `Matches compiled artifact: ${r.matchesArtifact ? 'yes' : 'NO — run \`npm run compile:contract\` in apps/admin to rebuild the artifact'}\n` +
        (r.bytecodeHash ? `Bytecode sha256: ${r.bytecodeHash}\nDeployed size: ${r.deployedBytes} bytes (limit 24576)\n` : '') +
        (r.warnings.length > 0 ? `Warnings:\n${r.warnings.join('\n')}` : 'Warnings: none.'),
      )
    } catch (e) { setError(e instanceof Error ? e.message : 'Compile failed.') }
    setBusy(false)
  }

  const buildParams = () => ({
    chainId, env: 'testnet' as const,
    owner: params.owner.trim(), keeper: params.keeper.trim(), router: params.router.trim(),
    priceFeed: params.priceFeed.trim(), penaltyRecipient: params.penaltyRecipient.trim(),
    feeRecipient: params.feeRecipient.trim(), autoSellFeeBps: Number(params.autoSellFeeBps),
  })

  const prepare = async (env: 'testnet' | 'mainnet') => {
    setError(''); setNotice('')
    const { errors } = validateDeployParams({ ...buildParams(), env })
    if (errors.length > 0) { setError(errors.join(' ')); return }
    if (compileRes && !compileRes.matchesArtifact) {
      setError('Source differs from the compiled artifact. Recompile with `npm run compile:contract` before deploying.')
      return
    }
    setBusy(true)
    try {
      const r = await api.deployPrepare({
        ...buildParams(), env,
        sourceHash: compileRes?.sourceHash,
        confirmation: env === 'mainnet' ? confirmText : undefined,
      })
      setPrepareCmd(`${r.deployCommand}\n\n${r.note}`)
      setNotice(`Deploy prepared for ${r.chain} (${env}). Run the command above with a testnet-only deployer key, then register the confirmed address below.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Prepare failed.') }
    setBusy(false)
  }

  const verify = async () => {
    setError(''); setNotice('')
    if (!address.trim()) { setError('Enter the deployed contract address first.'); return }
    setBusy(true)
    try {
      const r = await api.deployVerify(chainId, address.trim())
      setNotice(`Verify on ${r.chain}: code present: ${r.codePresent ? 'yes' : 'NO'} · source verified on explorer: ${r.sourceVerified ? 'yes' : 'not yet'} · ${r.note} Explorer: ${r.explorerUrl}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Verify failed.') }
    setBusy(false)
  }

  const register = async (env: 'testnet' | 'mainnet') => {
    setError(''); setNotice('')
    if (!address.trim()) { setError('Enter the deployed contract address first.'); return }
    const { errors } = validateDeployParams({ ...buildParams(), env, address: address.trim(), txHash: txHash.trim() || undefined, sourceHash: compileRes?.sourceHash })
    if (errors.length > 0) { setError(errors.join(' ')); return }
    if (!compileRes) { setError('Compile first — registration requires the source hash of the exact compiled source.'); return }
    if (!compileRes.matchesArtifact) { setError('Source differs from the compiled artifact. Recompile with `npm run compile:contract` first.'); return }
    if (env === 'mainnet') {
      if (!mainnetReady) { setError('Mainnet is gated: passing audit, verified testnet deployment on this chain, and a recorded smoke-test attestation are all required.'); return }
      if (confirmText.trim() !== mainnetConfirmPhrase(chainName)) { setError(`Typed confirmation must read exactly: ${mainnetConfirmPhrase(chainName)}`); return }
    }
    setBusy(true)
    try {
      const r = await api.deployRegister({
        ...buildParams(), env, address: address.trim(), txHash: txHash.trim() || undefined,
        sourceHash: compileRes.sourceHash, confirmation: env === 'mainnet' ? confirmText : undefined,
      })
      setNotice(`Registered: StelixVault on ${r.chain} at ${r.address} (${r.verificationStatus}). Vault address written to Chain Manager. ${r.note}`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Registration failed.') }
    setBusy(false)
  }

  const attestSmoke = async () => {
    setError(''); setNotice('')
    try {
      await api.attestSmoke(chainId, smokeNote.trim() || 'Small-value mainnet smoke test completed.')
      setSmokeAttested(true)
      setNotice('Smoke-test attestation recorded in D1.')
      api.getAuditGate().then(setGate).catch(() => undefined)
    } catch (e) { setError(e instanceof Error ? e.message : 'Attestation failed.') }
  }

  return (
    <div>
      <PageHeader
        icon={<Code2 />}
        title="Contract Studio"
        sub={`Write / edit, compile, test-deploy and mainnet-deploy StelixVault. Pinned compiler: solc ${SOLC_PINNED}. The admin never holds a deployer key: deploys are broadcast by the Foundry flow, and the Worker only registers an address after verifying on-chain code and explorer source status.`}
        pill={<LiveNote />}
      />
      {error && <div className="notice alert"><ShieldAlert /><span>{error}</span></div>}
      {notice && <div className="notice ok"><BadgeCheck /><span>{notice}</span></div>}
      <div className="notice alert">
        <ShieldAlert />
        <span><b>Mainnet deploy is gated:</b> audit status, testnet flow passed, small-value smoke test, typed confirmation naming the chain. Existing locks stay under their original contract — improvements ship as a new deployment for new locks only.</span>
      </div>
      <div className="grid grid2">
        <div className="card">
          <SectionTitle icon={<FileCode2 />}>Source — StelixVault.sol</SectionTitle>
          <textarea value={src} onChange={(e) => setSrc(e.target.value)} rows={22} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} spellCheck={false} />
          <p className="field-hint">Source size: {sizeKb} KB · Compiled artifact: solc {SOLC_PINNED} via scripts/compile.mjs (optimizer on, 200 runs, via IR).</p>
          <button className="btn block" onClick={compile} disabled={busy}><Hammer />{busy ? 'Compiling…' : `Compile (solc ${SOLC_PINNED})`}</button>
          {compileOut && <pre>{compileOut}</pre>}
        </div>
        <div>
          <div className="card">
            <SectionTitle icon={<Rocket />}>Deploy</SectionTitle>
            <label>Chain</label>
            <select value={chainId} onChange={(e) => setChainId(e.target.value)}>
              {chains.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
            </select>
            <label>Constructor parameters — StelixVault(owner, keeper, router, priceFeed, penaltyRecipient, feeRecipient, autoSellFeeBps)</label>
            <input placeholder="Owner (multisig recommended)" value={params.owner} onChange={(e) => setParams({ ...params, owner: e.target.value })} />
            <input placeholder="Keeper address" style={{ marginTop: 8 }} value={params.keeper} onChange={(e) => setParams({ ...params, keeper: e.target.value })} />
            <input placeholder="DEX router address (confirmed on explorer — never guess)" style={{ marginTop: 8 }} value={params.router} onChange={(e) => setParams({ ...params, router: e.target.value })} />
            <input placeholder="Price feed address (TWAP / Chainlink adapter)" style={{ marginTop: 8 }} value={params.priceFeed} onChange={(e) => setParams({ ...params, priceFeed: e.target.value })} />
            <input placeholder="Penalty recipient address" style={{ marginTop: 8 }} value={params.penaltyRecipient} onChange={(e) => setParams({ ...params, penaltyRecipient: e.target.value })} />
            <input placeholder="Fee recipient address" style={{ marginTop: 8 }} value={params.feeRecipient} onChange={(e) => setParams({ ...params, feeRecipient: e.target.value })} />
            <input placeholder="Auto-sell fee bps (0–1000, max 10%)" style={{ marginTop: 8 }} inputMode="numeric" value={params.autoSellFeeBps} onChange={(e) => setParams({ ...params, autoSellFeeBps: e.target.value })} />
            <p className="field-hint">Arc testnet: exit stablecoin USDC 0x3600000000000000000000000000000000000000 (confirmed on DexScreener/ArcScan). Router and price feed must be confirmed on testnet.arcscan.app before deploying — the form accepts no guessed address.</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn mint" onClick={() => prepare('testnet')} disabled={busy}><Rocket />Prepare testnet deploy</button>
            </div>
            {prepareCmd && <pre>{prepareCmd}</pre>}
            <label style={{ marginTop: 16 }}>Deployed contract address (after the Foundry broadcast confirms)</label>
            <input placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} />
            <label>Deploy transaction hash (optional)</label>
            <input placeholder="0x…" value={txHash} onChange={(e) => setTxHash(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn ghost" onClick={verify} disabled={busy}>Verify on explorer</button>
              <button className="btn ghost" onClick={() => register('testnet')} disabled={busy}>Register in Chain Manager</button>
            </div>
          </div>
          <div className="card">
            <SectionTitle icon={<ShieldAlert />}>Mainnet gate</SectionTitle>
            <p className="muted">
              Audit gate: {gate === null ? 'loading…' : auditGatePass ? 'passed (passing automated audit with zero open critical/high findings, or a recorded passing independent audit)' : 'NOT passed — see Contract Audit.'}
              {verifiedTestnet ? ' Verified testnet deployment on this chain: yes.' : ' Verified testnet deployment on this chain: not yet.'}
            </p>
            <label className="check-row"><input type="checkbox" checked={auditGatePass} disabled />Audit passed (automated with zero open critical/high, or independent audit recorded)</label>
            <label className="check-row"><input type="checkbox" checked={verifiedTestnet || testnetPassed} onChange={(e) => setTestnetPassed(e.target.checked)} />Testnet lock → target → auto-sell → USDT received flow passed</label>
            <label className="check-row"><input type="checkbox" checked={smokeAttested} disabled />Small-value mainnet smoke test attested (recorded in D1 below)</label>
            <label>Smoke-test note</label>
            <input value={smokeNote} onChange={(e) => setSmokeNote(e.target.value)} placeholder="e.g. 0.01 ETH lock, target hit, payout received, tx 0x…" />
            <button className="btn ghost block" style={{ marginTop: 8 }} onClick={attestSmoke} disabled={smokeAttested}>Record smoke-test attestation</button>
            <label>Type to confirm: <span className="kbd">{mainnetConfirmPhrase(chainName)}</span></label>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={mainnetConfirmPhrase(chainName)} />
            <button className="btn danger block" style={{ marginTop: 14 }} onClick={() => register('mainnet')} disabled={busy || !mainnetReady}><Rocket />Deploy to mainnet (gated)</button>
            <p className="field-hint">Solana note: the Solana program is built with Anchor and deployed with the Solana CLI; its program ID is then registered in Chain Manager the same way.</p>
          </div>
          <div className="card">
            <SectionTitle icon={<BadgeCheck />}>Deployment history</SectionTitle>
            {deploys.length === 0 ? (
              <p className="empty">No deployments registered yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="rtable">
                  <thead><tr><th>Chain</th><th>Env</th><th>Address</th><th>Verification</th><th>Compiler</th></tr></thead>
                  <tbody>
                    {deploys.map((d) => (
                      <tr key={d.id}>
                        <td data-label="Chain">{d.chain_id}</td>
                        <td data-label="Env"><span className={'badge ' + (d.env === 'mainnet' ? 'b-red' : 'b-blue')}>{d.env}</span></td>
                        <td data-label="Address"><span className="kbd">{d.address}</span></td>
                        <td data-label="Verification"><span className={'badge ' + (d.verification_status === 'verified' ? 'b-green' : 'b-amber')}>{d.verification_status}</span></td>
                        <td data-label="Compiler">{d.compiler_version}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
