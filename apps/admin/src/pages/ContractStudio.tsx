import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, Code2, FileCode2, Hammer, Rocket, ShieldAlert } from 'lucide-react'
import source from '../contracts/StelixVault.sol?raw'
import { SOLC_PINNED } from '../lib/types'
import { ARC_TESTNET, arcNetworkFor } from '../lib/arcNetworks'
import { mainnetConfirmPhrase, testnetChainIdFor, validateDeployParams } from '../lib/deployParams'
import { api, type AuditGate, type CompileResult, type MultisigRow } from '../lib/api'
import type { Chain } from '../lib/types'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'

type Deployment = { id: number; chain_id: string; address: string; tx_hash: string | null; compiler_version: string; verification_status: string; env: string; created_at: string }

const EMPTY_PARAMS = {
  owner: '', keeper: '', router: '', priceFeed: '',
  penaltyRecipient: '', feeRecipient: '', autoSellFeeBps: '0',
}

// Chain families in the picker. Every chain is in scope (user decision
// 2026-11-27 03:03 WAT) — nothing is hidden or disabled here, and new
// chains can be added later from Chain Manager. Arc appears once; its
// testnet/mainnet choice is the switch below it, not a second row.
const FAMILY_NAMES: Record<string, string> = {
  arc: 'Arc', bnb: 'BNB Smart Chain', base: 'Base',
  ethereum: 'Ethereum', polygon: 'Polygon', solana: 'Solana',
}
const FAMILY_ORDER = ['arc', 'bnb', 'base', 'ethereum', 'polygon', 'solana']

export default function ContractStudio() {
  const [src, setSrc] = useState(source)
  const [compileOut, setCompileOut] = useState('')
  const [compileRes, setCompileRes] = useState<CompileResult | null>(null)
  const [chains, setChains] = useState<Chain[]>([])
  const [chainFamily, setChainFamily] = useState('arc')
  const [arcEnv, setArcEnv] = useState<'testnet' | 'mainnet'>('testnet')
  const [params, setParams] = useState(EMPTY_PARAMS)
  const [address, setAddress] = useState('')
  const [txHash, setTxHash] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [testnetPassed, setTestnetPassed] = useState(false)
  const [smokeAttested, setSmokeAttested] = useState(false)
  const [smokeNote, setSmokeNote] = useState('')
  const [deploys, setDeploys] = useState<Deployment[]>([])
  const [multisigs, setMultisigs] = useState<MultisigRow[]>([])
  const [gate, setGate] = useState<AuditGate | null>(null)
  const [prepareCmd, setPrepareCmd] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const sizeKb = useMemo(() => (new TextEncoder().encode(src).length / 1024).toFixed(1), [src])

  const isArc = chainFamily === 'arc'
  // The D1 chain slug this network deploys to: "arc" for Arc testnet,
  // "arc-mainnet" for Arc mainnet, the family slug for every other chain.
  const effectiveChainId = isArc ? arcNetworkFor(arcEnv).id : chainFamily
  // Non-Arc chains are mainnet-only: the registry holds no verified
  // testnet for them, so no testnet is invented for them.
  const env: 'testnet' | 'mainnet' = isArc && arcEnv === 'testnet' ? 'testnet' : 'mainnet'
  const chain = chains.find((c) => c.id === effectiveChainId)
  const arcNet = arcNetworkFor(arcEnv)
  const networkName = isArc ? arcNet.name : (chain?.name ?? FAMILY_NAMES[chainFamily] ?? chainFamily)
  // Arc mainnet display falls back to the verified constants when the
  // "arc-mainnet" row is absent from D1 (fallback only; migration 0006
  // has been applied to live D1, so the row is normally present).
  const arcMainnetRowMissing = isArc && arcEnv === 'mainnet' && !chain
  const net = isArc
    ? {
      chainId: chain?.chainId ?? arcNet.chainId,
      rpcUrl: chain?.rpcUrls[0] ?? arcNet.rpcUrl,
      explorerUrl: chain?.explorerUrl ?? arcNet.explorerUrl,
      stablecoinAddress: chain?.stablecoinAddress || arcNet.stablecoinAddress,
      dexRouter: chain?.dexRouter || arcNet.dexRouter,
      routerKind: arcNet.dexRouterKind,
      vaultAddress: chain?.vaultAddress ?? null,
    }
    : {
      chainId: chain?.chainId ?? 0,
      rpcUrl: chain?.rpcUrls[0] ?? '',
      explorerUrl: chain?.explorerUrl ?? '',
      stablecoinAddress: chain?.stablecoinAddress ?? '',
      dexRouter: chain?.dexRouter ?? '',
      routerKind: 'DEX router',
      vaultAddress: chain?.vaultAddress ?? null,
    }

  const families = useMemo(() => {
    const fromApi = new Map<string, string>()
    for (const c of chains) {
      const fam = c.id === 'arc-mainnet' ? 'arc' : c.id
      if (!fromApi.has(fam)) fromApi.set(fam, fam === 'arc' ? 'Arc' : c.name)
    }
    // Guarantee all six families show even if the API returns fewer rows.
    const ids = [...new Set([...FAMILY_ORDER, ...fromApi.keys()])]
    return ids.map((id) => ({ id, name: fromApi.get(id) ?? FAMILY_NAMES[id] ?? id }))
  }, [chains])

  const load = () => {
    api.getChains().then((c) => {
      setChains(c)
      const fams = new Set(c.map((x) => (x.id === 'arc-mainnet' ? 'arc' : x.id)))
      if (c.length > 0 && !fams.has(chainFamily)) setChainFamily('arc')
    }).catch(() => undefined)
    api.getDeployments().then((d) => setDeploys(d.deployments)).catch(() => undefined)
    api.getMultisigs().then(setMultisigs).catch(() => undefined)
    api.getAuditGate().then(setGate).catch(() => undefined)
  }
  useEffect(load, [])

  // Deployed (on-chain verified) multisigs on the selected network only:
  // only these may be picked as Owner. A merely prepared multisig has no
  // Safe address yet and never appears here.
  const deployedMultisigs = multisigs.filter((m) => m.status === 'deployed' && m.chainId === effectiveChainId)

  const auditGatePass = gate?.gatePass ?? false
  // The verified testnet deployment that gates a mainnet deploy lives
  // under the testnet counterpart row ("arc" for "arc-mainnet").
  const verifiedTestnet = deploys.some((d) => d.chain_id === testnetChainIdFor(effectiveChainId) && d.env === 'testnet' && d.verification_status === 'verified')
  const mainnetReady = auditGatePass && (verifiedTestnet || testnetPassed) && smokeAttested

  /** Switching chain or Arc network clears the 7 constructor fields and
   *  every confirmation: testnet values are never silently carried to
   *  mainnet, and each network must be re-confirmed on its own. */
  const selectNetwork = (family: string, nextArcEnv?: 'testnet' | 'mainnet') => {
    const nextEnv = family === 'arc' ? (nextArcEnv ?? arcEnv) : 'testnet'
    const changed = family !== chainFamily || (family === 'arc' && nextEnv !== arcEnv)
    setChainFamily(family)
    if (family === 'arc' && nextArcEnv) setArcEnv(nextArcEnv)
    if (changed) {
      setParams(EMPTY_PARAMS)
      setConfirmText('')
      setTestnetPassed(false)
      setSmokeAttested(false)
      setPrepareCmd('')
      setAddress('')
      setTxHash('')
      setError('')
      const label = family === 'arc' ? arcNetworkFor(nextEnv).name : (FAMILY_NAMES[family] ?? family)
      setNotice(`Switched to ${label}. Constructor parameters cleared — re-enter and confirm all 7 for this network; testnet values are never carried to mainnet.`)
    }
  }

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
    chainId: effectiveChainId, env,
    owner: params.owner.trim(), keeper: params.keeper.trim(), router: params.router.trim(),
    priceFeed: params.priceFeed.trim(), penaltyRecipient: params.penaltyRecipient.trim(),
    feeRecipient: params.feeRecipient.trim(), autoSellFeeBps: Number(params.autoSellFeeBps),
  })

  const prepare = async (prepareEnv: 'testnet' | 'mainnet') => {
    setError(''); setNotice('')
    const { errors } = validateDeployParams({ ...buildParams(), env: prepareEnv })
    if (errors.length > 0) { setError(errors.join(' ')); return }
    if (compileRes && !compileRes.matchesArtifact) {
      setError('Source differs from the compiled artifact. Recompile with `npm run compile:contract` before deploying.')
      return
    }
    setBusy(true)
    try {
      const r = await api.deployPrepare({
        ...buildParams(), env: prepareEnv,
        sourceHash: compileRes?.sourceHash,
        confirmation: prepareEnv === 'mainnet' ? confirmText : undefined,
      })
      setPrepareCmd(`${r.deployCommand}\n\n${r.note}`)
      setNotice(`Deploy prepared for ${r.chain} (${prepareEnv}). RPC: ${r.rpcUrl}. Run the command above with a ${prepareEnv === 'mainnet' ? 'mainnet' : 'testnet-only'} deployer key, then register the confirmed address below.`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Prepare failed.') }
    setBusy(false)
  }

  const verify = async () => {
    setError(''); setNotice('')
    if (!address.trim()) { setError('Enter the deployed contract address first.'); return }
    setBusy(true)
    try {
      const r = await api.deployVerify(effectiveChainId, address.trim())
      setNotice(`Verify on ${r.chain}: code present: ${r.codePresent ? 'yes' : 'NO'} · source verified on explorer: ${r.sourceVerified ? 'yes' : 'not yet'} · ${r.note} Explorer: ${r.explorerUrl}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'Verify failed.') }
    setBusy(false)
  }

  const register = async (registerEnv: 'testnet' | 'mainnet') => {
    setError(''); setNotice('')
    if (!address.trim()) { setError('Enter the deployed contract address first.'); return }
    const { errors } = validateDeployParams({ ...buildParams(), env: registerEnv, address: address.trim(), txHash: txHash.trim() || undefined, sourceHash: compileRes?.sourceHash })
    if (errors.length > 0) { setError(errors.join(' ')); return }
    if (!compileRes) { setError('Compile first — registration requires the source hash of the exact compiled source.'); return }
    if (!compileRes.matchesArtifact) { setError('Source differs from the compiled artifact. Recompile with `npm run compile:contract` first.'); return }
    if (registerEnv === 'mainnet') {
      if (!mainnetReady) { setError('Mainnet is gated: passing audit, verified testnet deployment on this chain, and a recorded smoke-test attestation are all required.'); return }
      if (confirmText.trim() !== mainnetConfirmPhrase(networkName)) { setError(`Typed confirmation must read exactly: ${mainnetConfirmPhrase(networkName)}`); return }
    }
    setBusy(true)
    try {
      const r = await api.deployRegister({
        ...buildParams(), env: registerEnv, address: address.trim(), txHash: txHash.trim() || undefined,
        sourceHash: compileRes.sourceHash, confirmation: registerEnv === 'mainnet' ? confirmText : undefined,
      })
      setNotice(`Registered: StelixVault on ${r.chain} at ${r.address} (${r.verificationStatus}). Vault address written to Chain Manager. ${r.note}`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Registration failed.') }
    setBusy(false)
  }

  const attestSmoke = async () => {
    setError(''); setNotice('')
    try {
      await api.attestSmoke(effectiveChainId, smokeNote.trim() || 'Small-value mainnet smoke test completed.')
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
        <span><b>Mainnet deploy is gated:</b> audit status, testnet flow passed, small-value smoke test, typed confirmation naming the network. Arc was testnet-first because no mainnet vault is deployed yet and no independent audit exists yet. Existing locks stay under their original contract — improvements ship as a new deployment for new locks only.</span>
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
            <select value={chainFamily} onChange={(e) => selectNetwork(e.target.value)}>
              {families.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            {isArc && (
              <div style={{ marginTop: 10 }}>
                <label style={{ marginTop: 0 }}>Arc network</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className={arcEnv === 'testnet' ? 'btn mint' : 'btn ghost'} onClick={() => selectNetwork('arc', 'testnet')}>Testnet · 5042002</button>
                  <button className={arcEnv === 'mainnet' ? 'btn mint' : 'btn ghost'} onClick={() => selectNetwork('arc', 'mainnet')}>Mainnet · 5042</button>
                </div>
              </div>
            )}
            <p className="field-hint">All chains are in scope: Arc, BNB, Base, Ethereum, Polygon, Solana. New chains can be added later from Chain Manager.</p>
            <div className="notice info" style={{ marginTop: 12 }}>
              <ShieldAlert />
              <span>
                <b>{networkName}</b> — Chain ID {net.chainId || '—'} · RPC {net.rpcUrl || '—'} · Explorer{' '}
                {net.explorerUrl ? <a href={net.explorerUrl} target="_blank" rel="noreferrer">{net.explorerUrl}</a> : '—'}
                <br />Stablecoin: USDC {net.stablecoinAddress || 'not confirmed yet'}
                <br />{net.routerKind}: {net.dexRouter || 'not confirmed yet — never guess one'}
                <br />Vault: {net.vaultAddress ? net.vaultAddress : 'Not deployed yet — deploy from Contract Studio'}
              </span>
            </div>
            {arcMainnetRowMissing && (
              <div className="notice alert">
                <ShieldAlert />
                <span><b>Arc Mainnet is not in the chain registry yet.</b> The values above are the verified Arc mainnet constants, but prepare / verify / register will fail until migration 0006_arc_mainnet.sql is applied to D1. Apply it, then reload this page.</span>
              </div>
            )}
            {isArc && arcEnv === 'testnet' && (
              <p className="field-hint">Arc was testnet-first: no mainnet vault is deployed and no independent audit exists yet, so prove the full lock → target → auto-sell flow here first. On Arc, native-value swaps revert (the router&apos;s WETH9 is a stub) — swaps must use ERC-20 USDC 0x3600000000000000000000000000000000000000, never native value.</p>
            )}
            {isArc && arcEnv === 'mainnet' && (
              <p className="field-hint"><b>Mainnet is real money.</b> No StelixVault is deployed on Arc Mainnet yet and no independent audit exists yet — the automated audit is not a substitute. Mainnet deploy stays gated below, and switching back to testnet clears these fields again.</p>
            )}
            {!isArc && (
              <p className="field-hint">Mainnet only — the registry holds no verified testnet for {networkName}, so no testnet is offered here. Add a testnet chain in Chain Manager to enable a testnet flow for it.</p>
            )}
            <label>Constructor parameters — StelixVault(owner, keeper, router, priceFeed, penaltyRecipient, feeRecipient, autoSellFeeBps)</label>
            <input placeholder="Owner (multisig recommended)" value={params.owner} onChange={(e) => setParams({ ...params, owner: e.target.value })} />
            {deployedMultisigs.length > 0 ? (
              <>
                <label style={{ marginTop: 8 }}>Or use a deployed multisig as Owner (one tap — verified on-chain)</label>
                <select
                  value={deployedMultisigs.some((m) => m.safeAddress === params.owner) ? params.owner : ''}
                  onChange={(e) => { if (e.target.value) setParams({ ...params, owner: e.target.value }) }}
                >
                  <option value="">Choose a deployed multisig…</option>
                  {deployedMultisigs.map((m) => (
                    <option key={m.id} value={m.safeAddress ?? ''}>
                      {m.threshold}-of-{m.owners.length} · {m.safeAddress}{m.label ? ` — ${m.label}` : ''}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <p className="field-hint">No deployed multisig on {networkName} yet — <a href="/multisig">create one in the Multisig Creator</a>. Only a Safe verified on-chain can be picked here.</p>
            )}
            <input placeholder="Keeper address" style={{ marginTop: 8 }} value={params.keeper} onChange={(e) => setParams({ ...params, keeper: e.target.value })} />
            <input placeholder="DEX router address (confirmed on explorer — never guess)" style={{ marginTop: 8 }} value={params.router} onChange={(e) => setParams({ ...params, router: e.target.value })} />
            <input placeholder="Price feed address (TWAP / Chainlink adapter)" style={{ marginTop: 8 }} value={params.priceFeed} onChange={(e) => setParams({ ...params, priceFeed: e.target.value })} />
            <input placeholder="Penalty recipient address" style={{ marginTop: 8 }} value={params.penaltyRecipient} onChange={(e) => setParams({ ...params, penaltyRecipient: e.target.value })} />
            <input placeholder="Fee recipient address" style={{ marginTop: 8 }} value={params.feeRecipient} onChange={(e) => setParams({ ...params, feeRecipient: e.target.value })} />
            <input placeholder="Auto-sell fee bps (0–1000, max 10%)" style={{ marginTop: 8 }} inputMode="numeric" value={params.autoSellFeeBps} onChange={(e) => setParams({ ...params, autoSellFeeBps: e.target.value })} />
            <p className="field-hint">
              {isArc
                ? `${networkName}: exit stablecoin USDC ${ARC_TESTNET.stablecoinAddress} (6 decimals, also the gas token). Router and price feed must be confirmed on ${net.explorerUrl || 'the explorer'} before deploying — the form accepts no guessed address.`
                : `${networkName}: router and price feed must be confirmed on ${net.explorerUrl || 'the explorer'} before deploying — the form accepts no guessed address.`}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn mint" onClick={() => prepare(env)} disabled={busy}><Rocket />{env === 'mainnet' ? 'Prepare mainnet deploy' : 'Prepare testnet deploy'}</button>
            </div>
            {prepareCmd && <pre>{prepareCmd}</pre>}
            <label style={{ marginTop: 16 }}>Deployed contract address (after the Foundry broadcast confirms)</label>
            <input placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} />
            <label>Deploy transaction hash (optional)</label>
            <input placeholder="0x…" value={txHash} onChange={(e) => setTxHash(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn ghost" onClick={verify} disabled={busy}>Verify on explorer</button>
              {env === 'testnet' && <button className="btn ghost" onClick={() => register('testnet')} disabled={busy}>Register in Chain Manager</button>}
            </div>
            {env === 'mainnet' && <p className="field-hint">Mainnet registration is in the Mainnet gate card below — it stays gated and needs the typed confirmation naming {networkName}.</p>}
          </div>
          <div className="card">
            <SectionTitle icon={<ShieldAlert />}>Mainnet gate — {networkName}</SectionTitle>
            <p className="muted">
              Audit gate: {gate === null ? 'loading…' : auditGatePass ? 'passed (passing automated audit with zero open critical/high findings, or a recorded passing independent audit)' : 'NOT passed — see Contract Audit.'}
              {verifiedTestnet ? ' Verified testnet deployment on this chain: yes.' : ' Verified testnet deployment on this chain: not yet.'}
            </p>
            {env === 'mainnet' && (
              <p className="field-hint"><b>Mainnet is real money.</b> No vault is deployed on {networkName} yet and no independent audit exists yet. This deploy is not one-click: it needs a passing audit, a verified testnet deployment, a recorded small-value smoke test, and the typed confirmation below.</p>
            )}
            <label className="check-row"><input type="checkbox" checked={auditGatePass} disabled />Audit passed (automated with zero open critical/high, or independent audit recorded)</label>
            <label className="check-row"><input type="checkbox" checked={verifiedTestnet || testnetPassed} onChange={(e) => setTestnetPassed(e.target.checked)} />Testnet lock → target → auto-sell → USDT received flow passed</label>
            <label className="check-row"><input type="checkbox" checked={smokeAttested} disabled />Small-value mainnet smoke test attested (recorded in D1 below)</label>
            <label>Smoke-test note</label>
            <input value={smokeNote} onChange={(e) => setSmokeNote(e.target.value)} placeholder="e.g. 0.01 ETH lock, target hit, payout received, tx 0x…" />
            <button className="btn ghost block" style={{ marginTop: 8 }} onClick={attestSmoke} disabled={smokeAttested}>Record smoke-test attestation</button>
            <label>Type to confirm: <span className="kbd">{mainnetConfirmPhrase(networkName)}</span></label>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={mainnetConfirmPhrase(networkName)} />
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
