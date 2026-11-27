import { useEffect, useMemo, useState } from 'react'
import { BadgeCheck, Code2, FileCode2, Hammer, Rocket, ShieldAlert } from 'lucide-react'
import source from '../contracts/StelixVault.sol?raw'
import { SOLC_PINNED } from '../lib/types'
import { ARC_TESTNET, arcNetworkFor } from '../lib/arcNetworks'
import { evmMainnetFor, evmTestnetFor, testnetIdForFamily, type DeployNetwork } from '../lib/evmNetworks'
import { mainnetConfirmPhrase, testnetChainIdFor, validateDeployParams } from '../lib/deployParams'
import { api, type AuditGate, type CompileResult, type DeployPresetRow, type MultisigRow } from '../lib/api'
import DeployAdapters from '../components/DeployAdapters'
import DeployVault, { type VaultParams } from '../components/DeployVault'
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
  // Testnet / mainnet for the selected family. Every EVM family now
  // has a testnet row (migration 0013); Solana is mainnet-only here.
  const [netEnv, setNetEnv] = useState<'testnet' | 'mainnet'>('testnet')
  const [params, setParams] = useState(EMPTY_PARAMS)
  const [address, setAddress] = useState('')
  const [txHash, setTxHash] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [testnetPassed, setTestnetPassed] = useState(false)
  const [smokeAttested, setSmokeAttested] = useState(false)
  const [smokeNote, setSmokeNote] = useState('')
  const [deploys, setDeploys] = useState<Deployment[]>([])
  const [presets, setPresets] = useState<DeployPresetRow[]>([])
  const [presetsLoaded, setPresetsLoaded] = useState(false)
  const [multisigs, setMultisigs] = useState<MultisigRow[]>([])
  const [gate, setGate] = useState<AuditGate | null>(null)
  const [prepareCmd, setPrepareCmd] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const sizeKb = useMemo(() => (new TextEncoder().encode(src).length / 1024).toFixed(1), [src])

  const isArc = chainFamily === 'arc'
  // The D1 chain slug this network deploys to: "arc" for Arc testnet,
  // "arc-mainnet" for Arc mainnet, "<family>-testnet" for other testnets
  // (bnb-testnet, base-sepolia, ethereum-sepolia, polygon-amoy), the
  // family slug for mainnets. Solana has no testnet row.
  const testnetId = testnetIdForFamily(chainFamily)
  const hasTestnet = testnetId !== null
  const env: 'testnet' | 'mainnet' = chainFamily === 'solana' ? 'mainnet' : netEnv
  const effectiveChainId = env === 'testnet' && testnetId ? testnetId : (isArc && env === 'mainnet' ? 'arc-mainnet' : chainFamily)
  const chain = chains.find((c) => c.id === effectiveChainId)
  const arcNet = arcNetworkFor(env)
  const evmTestnet = env === 'testnet' && !isArc ? evmTestnetFor(effectiveChainId) : undefined
  const evmMainnet = env === 'mainnet' && !isArc ? evmMainnetFor(effectiveChainId) : undefined
  const networkName = isArc ? arcNet.name : (chain?.name ?? evmTestnet?.name ?? evmMainnet?.name ?? FAMILY_NAMES[chainFamily] ?? chainFamily)
  // Arc mainnet display falls back to the verified constants when the
  // "arc-mainnet" row is absent from D1 (fallback only; migration 0006
  // has been applied to live D1, so the row is normally present).
  const arcMainnetRowMissing = isArc && env === 'mainnet' && !chain
  // The network object the browser-deploy cards need. Arc is V3 (same
  // as before); other testnets and mainnets come from the verified EVM
  // registry (evmNetworks.ts) — mainnet routers and stablecoins were
  // verified 2026-11-27 against official sources before mainnet deploy
  // was enabled here. The vault card on mainnet is additionally locked
  // behind the mainnet gate (see vaultLocked below); the adapters card
  // is not gated — adapters hold no user funds.
  const deployNet: DeployNetwork | null = isArc ? {
      id: arcNet.id, name: arcNet.name, env, chainId: arcNet.chainId,
      rpcUrl: arcNet.rpcUrl, explorerUrl: arcNet.explorerUrl,
      nativeSymbol: 'USDC', nativeDecimals: 6,
      stablecoin: 'USDC', stablecoinAddress: arcNet.stablecoinAddress, stablecoinDecimals: 6,
      routerKind: 'v3', dexRouter: arcNet.dexRouter, dexRouterKind: arcNet.dexRouterKind,
      feedKind: 'v3-twap', faucetUrl: 'https://faucet.circle.com',
    }
    : (env === 'testnet' ? evmTestnet : evmMainnet) ?? null
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
      chainId: chain?.chainId ?? deployNet?.chainId ?? 0,
      rpcUrl: chain?.rpcUrls[0] ?? deployNet?.rpcUrl ?? '',
      explorerUrl: chain?.explorerUrl ?? deployNet?.explorerUrl ?? '',
      stablecoinAddress: chain?.stablecoinAddress ?? deployNet?.stablecoinAddress ?? '',
      dexRouter: chain?.dexRouter ?? deployNet?.dexRouter ?? '',
      routerKind: deployNet?.dexRouterKind ?? 'DEX router',
      vaultAddress: chain?.vaultAddress ?? null,
    }

  const families = useMemo(() => {
    const fromApi = new Map<string, string>()
    for (const c of chains) {
      // Map every D1 row back to its family: arc-mainnet -> arc,
      // bnb-testnet -> bnb, base-sepolia -> base, and so on.
      const fam = c.id === 'arc-mainnet' ? 'arc'
        : c.id === 'bnb-testnet' ? 'bnb'
        : c.id === 'base-sepolia' ? 'base'
        : c.id === 'ethereum-sepolia' ? 'ethereum'
        : c.id === 'polygon-amoy' ? 'polygon'
        : c.id
      if (!fromApi.has(fam)) fromApi.set(fam, fam === 'arc' ? 'Arc' : (FAMILY_NAMES[fam] ?? c.name))
    }
    // Guarantee all six families show even if the API returns fewer rows.
    const ids = [...new Set([...FAMILY_ORDER, ...fromApi.keys()])]
    return ids.map((id) => ({ id, name: fromApi.get(id) ?? FAMILY_NAMES[id] ?? id }))
  }, [chains])

  const presetFor = (chainId: string, e: 'testnet' | 'mainnet') =>
    presets.find((p) => p.chain_id === chainId && p.env === e) ?? null
  const paramsFromPreset = (p: DeployPresetRow) => ({
    owner: p.owner, keeper: p.keeper, router: p.router, priceFeed: p.price_feed,
    penaltyRecipient: p.penalty_recipient, feeRecipient: p.fee_recipient,
    autoSellFeeBps: String(p.auto_sell_fee_bps),
  })

  const load = () => {
    api.getChains().then((c) => {
      setChains(c)
      const fams = new Set(c.map((x) => (x.id === 'arc-mainnet' ? 'arc' : x.id)))
      if (c.length > 0 && !fams.has(chainFamily)) setChainFamily('arc')
    }).catch(() => undefined)
    api.getDeployments().then((d) => setDeploys(d.deployments)).catch(() => undefined)
    api.getDeployPresets().then((p) => { setPresets(p); setPresetsLoaded(true) }).catch(() => setPresetsLoaded(true))
    api.getMultisigs().then(setMultisigs).catch(() => undefined)
    api.getAuditGate().then(setGate).catch(() => undefined)
  }
  useEffect(load, [])

  // Fill the 7 fields from the saved preset for the selected network,
  // once presets have loaded. A preset is per (chain, env), so testnet
  // values are never carried to mainnet.
  useEffect(() => {
    if (!presetsLoaded) return
    const p = presetFor(effectiveChainId, env)
    if (p) setParams(paramsFromPreset(p))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetsLoaded])

  // One universal multisig for all EVM chains (2026-11-27): a deployed
  // (on-chain verified) Safe is the vault Owner on EVERY EVM chain, so
  // the dropdown is NOT filtered by the selected network. Only a merely
  // prepared multisig has no Safe address yet and never appears here.
  // Solana is the exception — Safe is EVM-only, so no multisig Owner
  // is offered there at all.
  const deployedMultisigs = chainFamily === 'solana'
    ? []
    : multisigs.filter((m) => m.status === 'deployed')

  const auditGatePass = gate?.gatePass ?? false
  // The verified testnet deployment that gates a mainnet deploy lives
  // under the testnet counterpart row ("arc" for "arc-mainnet").
  const verifiedTestnet = deploys.some((d) => d.chain_id === testnetChainIdFor(effectiveChainId) && d.env === 'testnet' && d.verification_status === 'verified')
  const mainnetReady = auditGatePass && (verifiedTestnet || testnetPassed) && smokeAttested
  // Mainnet vault lock: the gate must pass AND the typed confirmation
  // naming this network must match. The Worker enforces the same gate
  // server-side at registration, so this lock is the UI half of it.
  const vaultLocked = env === 'mainnet' && (!mainnetReady || confirmText.trim() !== mainnetConfirmPhrase(networkName))
  const vaultLockReason = env !== 'mainnet' ? ''
    : !auditGatePass ? 'Audit gate has not passed — run the automated audit with zero open critical/high findings, or record a passing independent audit.'
    : !(verifiedTestnet || testnetPassed) ? 'No verified testnet deployment (or ticked testnet flow) on this chain yet — prove the full lock → target → auto-sell flow on testnet first.'
    : !smokeAttested ? 'No small-value mainnet smoke-test attestation recorded for this chain yet — record one in the Mainnet gate card below.'
    : 'Typed confirmation does not match — type the exact phrase from the Mainnet gate card below.'

  /** Switching chain or testnet/mainnet clears the 7 constructor fields and
   *  every confirmation, then fills them from the saved preset for that
   *  network if one exists: testnet values are never silently carried to
   *  mainnet, and each network must be re-confirmed on its own. */
  const selectNetwork = (family: string, nextEnv?: 'testnet' | 'mainnet') => {
    const testnetRow = testnetIdForFamily(family)
    const resolvedEnv: 'testnet' | 'mainnet' = family === 'solana' ? 'mainnet'
      : (nextEnv ?? (testnetRow ? netEnv : 'mainnet'))
    const changed = family !== chainFamily || resolvedEnv !== env
    setChainFamily(family)
    setNetEnv(resolvedEnv)
    if (changed) {
      const nextChainId = resolvedEnv === 'testnet' && testnetRow ? testnetRow
        : (family === 'arc' && resolvedEnv === 'mainnet' ? 'arc-mainnet' : family)
      const p = presetFor(nextChainId, resolvedEnv)
      setParams(p ? paramsFromPreset(p) : EMPTY_PARAMS)
      setConfirmText('')
      setTestnetPassed(false)
      setSmokeAttested(false)
      setPrepareCmd('')
      setAddress('')
      setTxHash('')
      setError('')
      const label = resolvedEnv === 'testnet' && testnetRow
        ? (evmTestnetFor(nextChainId)?.name ?? (family === 'arc' ? 'Arc Testnet' : nextChainId))
        : (family === 'arc' && resolvedEnv === 'mainnet' ? 'Arc Mainnet' : (FAMILY_NAMES[family] ?? family))
      setNotice(p
        ? `Switched to ${label}. Constructor parameters filled from your saved preset for ${nextChainId} (${resolvedEnv}).`
        : `Switched to ${label}. Constructor parameters cleared — re-enter and confirm all 7 for this network; testnet values are never carried to mainnet.`)
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

  // Vault deployed from the admin with a connected wallet: fill the
  // deployed address + tx hash into the form so it can be verified on
  // the explorer and registered in Chain Manager below.
  const onVaultDeployed = (deployedAddress: string, deployedTxHash: string) => {
    setAddress(deployedAddress)
    setTxHash(deployedTxHash)
    setNotice(`StelixVault deployed at ${deployedAddress}. Tap "Verify on explorer", then "Register in Chain Manager" below — registration checks on-chain code and the source hash before writing anything to D1.`)
    load()
  }

  // Adapters deployed from the admin with a connected wallet: save
  // their addresses into the Deploy Preset for this network and fill
  // the form from them, so the vault deploy below can proceed.
  const onAdaptersDeployed = async (feed: string, adapter: string, deployer: string) => {
    const existing = presetFor(effectiveChainId, env)
    const saved = {
      chainId: effectiveChainId, env,
      label: existing?.label ?? '',
      owner: existing?.owner || deployer,
      keeper: existing?.keeper ?? '',
      router: adapter, priceFeed: feed,
      penaltyRecipient: existing?.penalty_recipient || deployer,
      feeRecipient: existing?.fee_recipient || deployer,
      autoSellFeeBps: existing?.auto_sell_fee_bps ?? 0,
    }
    try {
      await api.saveDeployPreset(saved)
      setPresets((prev) => {
        const row = { id: existing?.id ?? 0, chain_id: saved.chainId, env: saved.env, label: saved.label, owner: saved.owner, keeper: saved.keeper, router: saved.router, price_feed: saved.priceFeed, penalty_recipient: saved.penaltyRecipient, fee_recipient: saved.feeRecipient, auto_sell_fee_bps: saved.autoSellFeeBps, updated_by: '', updated_at: new Date().toISOString() }
        return existing ? prev.map((p) => (p.chain_id === saved.chainId && p.env === saved.env ? row : p)) : [...prev, row]
      })
      setParams((prev) => ({ ...prev, router: adapter, priceFeed: feed, owner: prev.owner || deployer, penaltyRecipient: prev.penaltyRecipient || deployer, feeRecipient: prev.feeRecipient || deployer }))
      setNotice(`Adapters deployed and saved to your preset for ${effectiveChainId} (${env}): price feed ${feed}, router ${adapter}. Router and Price Feed are now filled in below — deploy the vault next.`)
    } catch (e) {
      setParams((prev) => ({ ...prev, router: adapter, priceFeed: feed }))
      setError(`Adapters deployed (${feed} / ${adapter}) but the preset could not be saved: ${e instanceof Error ? e.message : 'save failed'} — paste the two addresses into Router and Price Feed below.`)
    }
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
        sub={`Write / edit, compile, test-deploy and mainnet-deploy StelixVault. Pinned compiler: solc ${SOLC_PINNED}. The admin never holds a deployer key: testnet deploys are signed by your connected wallet in the browser (or broadcast by the Foundry flow), and the Worker only registers an address after verifying on-chain code and explorer source status.`}
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
            {hasTestnet && (
              <div style={{ marginTop: 10 }}>
                <label style={{ marginTop: 0 }}>{isArc ? 'Arc network' : `${FAMILY_NAMES[chainFamily] ?? chainFamily} network`}</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className={env === 'testnet' ? 'btn mint' : 'btn ghost'} onClick={() => selectNetwork(chainFamily, 'testnet')}>Testnet · {deployNet?.chainId ?? evmTestnetFor(testnetId!)?.chainId ?? (isArc ? 5042002 : '')}</button>
                  <button className={env === 'mainnet' ? 'btn mint' : 'btn ghost'} onClick={() => selectNetwork(chainFamily, 'mainnet')}>Mainnet</button>
                </div>
              </div>
            )}
            <p className="field-hint">All chains are in scope: Arc, BNB, Base, Ethereum, Polygon, Solana. New chains can be added later from Chain Manager.</p>
            <div className="notice info" style={{ marginTop: 12 }}>
              <ShieldAlert />
              <span>
                <b>{networkName}</b> — Chain ID {net.chainId || '—'} · RPC {net.rpcUrl || '—'} · Explorer{' '}
                {net.explorerUrl ? <a href={net.explorerUrl} target="_blank" rel="noreferrer">{net.explorerUrl}</a> : '—'}
                <br />Stablecoin: {deployNet?.stablecoin ?? chain?.stablecoin ?? 'USDC'} {net.stablecoinAddress || 'not confirmed yet'}
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
            {isArc && env === 'testnet' && (
              <p className="field-hint">Arc was testnet-first: no mainnet vault is deployed and no independent audit exists yet, so prove the full lock → target → auto-sell flow here first. On Arc, native-value swaps revert (the router&apos;s WETH9 is a stub) — swaps must use ERC-20 USDC 0x3600000000000000000000000000000000000000, never native value.</p>
            )}
            {env === 'mainnet' && (
              <p className="field-hint"><b>Mainnet is real money.</b> No StelixVault is deployed on {networkName} yet and no independent audit exists yet — the automated audit is not a substitute. Mainnet deploy stays gated below, and switching back to testnet clears these fields again.</p>
            )}
            {chainFamily === 'solana' && (
              <p className="field-hint">Solana deploys with the Solana CLI, not from this page — the Solana program is an Anchor program, not an EVM contract. Its program ID is registered in Chain Manager the same way after deployment.</p>
            )}
            {deployNet && deployNet.routerKind === 'none' && (
              <div className="notice alert">
                <ShieldAlert />
                <span><b>Cannot deploy on {networkName} yet.</b> {deployNet.blocker ?? 'No verified router on this network yet.'}</span>
              </div>
            )}
            {deployNet && deployNet.routerKind !== 'none' && (
              <DeployAdapters network={deployNet} explorerUrl={net.explorerUrl} onDeployed={onAdaptersDeployed} />
            )}
            <label>Constructor parameters — StelixVault(owner, keeper, router, priceFeed, penaltyRecipient, feeRecipient, autoSellFeeBps)</label>
            {presetFor(effectiveChainId, env) ? (
              <p className="field-hint">Filled from your saved preset for {effectiveChainId} ({env}){presetFor(effectiveChainId, env)?.label ? ` — ${presetFor(effectiveChainId, env)?.label}` : ''}. <a href="/deploy-presets">Edit the preset</a> instead of re-typing here.</p>
            ) : (
              <p className="field-hint">No saved preset for {effectiveChainId} ({env}) yet — <a href="/deploy-presets">save one in Deploy Presets</a> and it will fill in here next time.</p>
            )}
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
              <>
                {chainFamily === 'solana' ? (
                  <p className="field-hint">No multisig Owner on Solana — Safe is EVM-only, so no Safe can be created or recorded for Solana.</p>
                ) : (
                  <p className="field-hint">No deployed multisig yet — <a href="/multisig">create one in the Multisig Creator</a>. Only a Safe verified on-chain can be picked here.</p>
                )}
              </>
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
            {deployNet && deployNet.routerKind !== 'none' && (
              <DeployVault
                chainId={effectiveChainId}
                network={deployNet}
                explorerUrl={net.explorerUrl}
                params={params as VaultParams}
                locked={vaultLocked}
                lockReason={vaultLockReason}
                onDeployed={onVaultDeployed}
              />
            )}
            <label style={{ marginTop: 16 }}>Deployed contract address (after the deploy confirms — filled in automatically when you deploy from the admin)</label>
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
            <SectionTitle icon={<ShieldAlert />}>Mainnet gate</SectionTitle>
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
