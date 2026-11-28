// Deploy Adapters from the admin — every EVM chain, testnet AND mainnet.
// The admin itself never holds a private key and never broadcasts.
// This component deploys the price-feed (and, for V3 chains, the router
// adapter) with the wallet connected in THIS browser (MetaMask / any
// injected wallet): the user signs the deployment transactions, pays
// the gas, and the admin then saves the addresses into the Deploy
// Preset for that network, so Contract Studio fills Router / Price Feed.
//   V3 chains (Arc, Base): UniswapV3TwapFeed + StelixV3RouterAdapter.
//   V2 chains (BNB, Ethereum): the vault speaks V2 natively, so the
//     router needs NO adapter — only PancakeV2TwapFeed (works for any
//     V2 pair) is deployed, and the Router field is the V2 router itself.
//   No-router chains: this card is not rendered; the page shows the
//     blocker instead.
// Mainnet deploys are real money: the wallet pays real gas in the
// chain's native token, and the deployed feed/adapter are permanent
// contracts. The adapters themselves hold no user funds — the vault is
// the gated part (DeployVault), not the adapters. Every mainnet router
// and stablecoin address in evmNetworks.ts was verified 2026-11-27
// against an official source before mainnet was enabled here.
// If no injected wallet is present, the Foundry command below is the
// fallback — same contracts, same constructor args.
import { useEffect, useState } from 'react'
import { BrowserProvider, Contract, ContractFactory, isAddress, type InterfaceAbi } from 'ethers'
import { BadgeCheck, ShieldAlert, Wallet } from 'lucide-react'
import adaptersArtifact from '../contracts/adapters.artifact.json'
import type { DeployNetwork } from '../lib/evmNetworks'
import { AlertModal } from './AlertModal'

declare global {
  interface Window { ethereum?: unknown }
}

type Props = {
  network: DeployNetwork
  explorerUrl: string
  onDeployed: (feed: string, router: string, deployer: string) => void
  /** Price-feed address already saved in the Deploy Preset for this
   *  network (Contract Studio fills it) — pre-fills the Register Pool
   *  card so a feed deployed in an earlier session can be used. */
  feedAddressFromPreset?: string
}

export default function DeployAdapters({ network, explorerUrl, onDeployed, feedAddressFromPreset }: Props) {
  const [wallet, setWallet] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [feedAddress, setFeedAddress] = useState('')
  const [adapterAddress, setAdapterAddress] = useState('')
  const [feedTx, setFeedTx] = useState('')
  const [adapterTx, setAdapterTx] = useState('')

  // ---- Register a token pool/pair on the price feed (owner only) ----
  // A token with no pool has no price: its lock's target can never be
  // read and its auto-sell reverts. The feed owner (the connected
  // wallet) signs feed.setPool / setPair; after it confirms, the TWAP
  // needs ~30 minutes of observations before it reads correctly.
  // Arc Testnet defaults are prefilled — verified 2026-11-28: the
  // USDC/EURC pool 0x6b15920Aec9700dFe3Ca2C25343059fbF91769A0 exists
  // (22,142 bytes of code) and the owner holds 131 EURC, so EURC is the
  // token the first testnet lock can use. Other networks start blank.
  const isArcTestnet = network.id === 'arc' && network.env === 'testnet'
  const [poolFeed, setPoolFeed] = useState('')
  const [poolToken, setPoolToken] = useState(isArcTestnet ? '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a' : '')
  const [poolAddress, setPoolAddress] = useState(isArcTestnet ? '0x6b15920Aec9700dFe3Ca2C25343059fbF91769A0' : '')
  const [poolDecimals, setPoolDecimals] = useState('6')
  const [poolBusy, setPoolBusy] = useState(false)
  const [poolTx, setPoolTx] = useState('')
  const [poolDone, setPoolDone] = useState('')
  useEffect(() => {
    // Fill the feed field from the preset (or a deploy in this session)
    // until the user types their own value.
    if (!poolFeed) setPoolFeed(feedAddressFromPreset ?? feedAddress ?? '')
  }, [feedAddressFromPreset, feedAddress, poolFeed])

  const registerPool = async () => {
    setError(''); setPoolDone(''); setPoolTx('')
    if (!wallet) { setError('Connect your wallet first.'); return }
    if (!isAddress(poolFeed)) { setError('Price feed address is not a valid 0x address — it comes from the Deploy Preset, or paste it from the explorer.'); return }
    if (!isAddress(poolToken)) { setError('Token address is not a valid 0x address.'); return }
    if (!isAddress(poolAddress)) { setError('Pool/pair address is not a valid 0x address.'); return }
    const decimals = Number(poolDecimals)
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) { setError('Token decimals must be a whole number from 0 to 18.'); return }
    setPoolBusy(true)
    try {
      const provider = new BrowserProvider(window.ethereum as never)
      await provider.send('eth_requestAccounts', [])
      await ensureNetwork(provider)
      const signer = await provider.getSigner()
      const signerAddress = await signer.getAddress()
      if (signerAddress.toLowerCase() !== wallet.toLowerCase()) {
        setError(`MetaMask is now on a different account (${signerAddress.slice(0, 6)}…${signerAddress.slice(-4)}) than the one you connected (${wallet.slice(0, 6)}…${wallet.slice(-4)}). Switch back to the connected account in MetaMask, then try again.`)
        setPoolBusy(false)
        return
      }
      const v2 = network.routerKind === 'v2'
      const feed = new Contract(poolFeed, [v2 ? 'function setPair(address token, address pair, uint8 tokenDecimals)' : 'function setPool(address token, address pool, uint8 tokenDecimals)'], signer)
      setPoolDone(`Registering ${poolToken.slice(0, 10)}… on the feed — sign the transaction in your wallet (feed owner only).`)
      const tx = await (v2 ? feed.setPair(poolToken, poolAddress, decimals) : feed.setPool(poolToken, poolAddress, decimals))
      setPoolTx(tx.hash as string)
      setPoolDone(`Transaction sent: ${tx.hash as string} — waiting for confirmation…`)
      await tx.wait()
      setPoolDone(`Pool registered: token ${poolToken} → ${v2 ? 'pair' : 'pool'} ${poolAddress} (${decimals} decimals) on feed ${poolFeed}. Wait ~30 minutes before the TWAP reads work — the feed needs observations first. The token can now be locked with a price target.`)
    } catch (e) { setError(friendlyError(e)) }
    setPoolBusy(false)
  }

  const isMainnet = network.env === 'mainnet'
  const hasWallet = typeof window !== 'undefined' && Boolean(window.ethereum)

  // MetaMask (EIP-3085) requires nativeCurrency.decimals to be 18 when
  // adding a chain, even though Arc's gas token is USDC with 6 decimals
  // on-chain. The 18 here is only what MetaMask accepts for the chain
  // record; it does not change the on-chain USDC (6 decimals) gas.
  // Fixed 2026-11-27 after the user's screenshot: wallet_addEthereumChain
  // failed with "Expected the number 18 for 'nativeCurrency.decimals'…
  // Received: 6". Also: if MetaMask is already on Arc Testnet, do not
  // switch or add at all — just connect.
  const ensureNetwork = async (provider: BrowserProvider) => {
    const net = await provider.getNetwork()
    if (Number(net.chainId) === network.chainId) return
    try {
      await provider.send('wallet_switchEthereumChain', [{ chainId: `0x${network.chainId.toString(16)}` }])
    } catch (e) {
      // ethers v6 wraps the wallet's error: the 4902 lives in
      // e.error.code / e.info.error.code, while e.code is just
      // UNKNOWN_ERROR — the previous check read only e.code, so a
      // 4902 "Unrecognized chain ID" never reached the add-chain
      // fallback and was thrown instead. Fixed 2026-11-27.
      const walk = (o: unknown, depth = 0): number | undefined => {
        if (o == null || depth > 4) return undefined
        if (typeof o === 'number') return o
        if (typeof o === 'object') {
          const rec = o as Record<string, unknown>
          if (typeof rec.code === 'number') return rec.code
          for (const v of Object.values(rec)) { const c = walk(v, depth + 1); if (c !== undefined) return c }
        }
        return undefined
      }
      const code = walk(e)
      if (code === 4001) throw e // user rejected the switch — do not retry
      // Any other switch failure (4902 unrecognised chain, -32602,
      // stale chain list in this browser) → try adding the chain.
      // If the chain is in fact already added, MetaMask returns to
      // the switch path on the re-check below instead of erroring.
      try {
        await provider.send('wallet_addEthereumChain', [{
          chainId: `0x${network.chainId.toString(16)}`,
          chainName: network.name,
          nativeCurrency: { name: network.nativeSymbol, symbol: network.nativeSymbol, decimals: 18 },
          rpcUrls: [network.rpcUrl],
          blockExplorerUrls: [network.explorerUrl],
        }])
      } catch (addErr) {
        const after = await provider.getNetwork()
        if (Number(after.chainId) === network.chainId) return
        throw addErr
      }
      const after = await provider.getNetwork()
      if (Number(after.chainId) !== network.chainId) {
        // Add succeeded but MetaMask did not switch (some wallets
        // add without switching) — switch once more, now it exists.
        await provider.send('wallet_switchEthereumChain', [{ chainId: `0x${network.chainId.toString(16)}` }])
      }
    }
  }

  // MetaMask/ethers errors arrive as one huge JSON blob. Show the user
  // the one line that matters instead of the whole payload.
  const friendlyError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : 'Could not connect wallet.'
    if (msg.includes('Unrecognized chain ID') || msg.includes('4902')) return `MetaMask does not know ${network.name} yet. Tap Connect wallet again — the admin will now add ${network.name} (chain ${network.chainId}, RPC ${network.rpcUrl}) and switch to it. If MetaMask asks you to approve adding the network, approve it.`
    if (msg.includes('nativeCurrency.decimals')) return 'MetaMask refused the chain details. Please hard-refresh this page — the fixed version uses decimals 18 for the chain record — then tap Connect wallet again.'
    if (msg.includes('User denied') || msg.includes('rejected')) return 'You rejected the request in MetaMask. Tap Connect wallet again and approve it in MetaMask.'
    if (msg.includes('4100') || msg.includes('not been authorized')) return `MetaMask has not authorised this site to send transactions yet (code 4100). In MetaMask, check that stelix-admin.pages.dev is connected to this account on ${network.name}, then tap Connect wallet again in the admin, then Deploy — and approve the transaction when MetaMask pops it up. If it still fails, disconnect the site in MetaMask (Settings → Connected sites) and reconnect it fresh.`
    return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg
  }

  const connect = async () => {
    setError('')
    if (!hasWallet) { setError('No wallet found in this browser. Install MetaMask (or another injected wallet) and try again, or use the Foundry command below.'); return }
    setBusy(true)
    try {
      const provider = new BrowserProvider(window.ethereum as never)
      await provider.send('eth_requestAccounts', [])
      const signer = await provider.getSigner()
      const address = await signer.getAddress()
      await ensureNetwork(provider)
      setWallet(address)
      setLog([`Connected ${address} on ${network.name} (chain ${network.chainId}). ${isMainnet ? `Fund it with real ${network.nativeSymbol} before deploying — mainnet gas is real money.` : `Fund it with test ${network.nativeSymbol}${network.faucetUrl ? ` from ${network.faucetUrl}` : ''} before deploying.`}`])
    } catch (e) { setError(friendlyError(e)) }
    setBusy(false)
  }

  const deploy = async () => {
    setError(''); setLog([])
    if (!wallet) { setError('Connect your wallet first.'); return }
    setBusy(true)
    try {
      const provider = new BrowserProvider(window.ethereum as never)
      // Re-request accounts right before sending a transaction.
      // MetaMask mobile can authorise the site for reading (connect)
      // but still return 4100 "not been authorized" on eth_sendTransaction
      // after a chain switch/add, until accounts are requested again.
      await provider.send('eth_requestAccounts', [])
      await ensureNetwork(provider)
      const signer = await provider.getSigner()
      const deployer = await signer.getAddress()
      if (deployer.toLowerCase() !== wallet.toLowerCase()) {
        setError(`MetaMask is now on a different account (${deployer.slice(0, 6)}…${deployer.slice(-4)}) than the one you connected (${wallet.slice(0, 6)}…${wallet.slice(-4)}). Switch back to the connected account in MetaMask, then tap Deploy again.`)
        setBusy(false)
        return
      }
      const arts = adaptersArtifact as { contracts: Record<string, { abi: InterfaceAbi; bytecode: string }> }
      if (network.routerKind === 'v2') {
        // V2 chain: the vault speaks V2 natively, so only the TWAP feed
        // is deployed. The Router field stays the V2 router itself.
        const v2FeedArt = arts.contracts.PancakeV2TwapFeed
        setLog((l) => [...l, `Deploying PancakeV2TwapFeed (${network.stablecoin} ${network.stablecoinAddress}, ${network.stablecoinDecimals} decimals, owner ${deployer})… — sign the transaction in your wallet.`])
        const feedFactory = new ContractFactory(v2FeedArt.abi, v2FeedArt.bytecode, signer)
        const feed = await feedFactory.deploy(network.stablecoinAddress, network.stablecoinDecimals, deployer)
        const feedTxHash = feed.deploymentTransaction()?.hash ?? ''
        setFeedTx(feedTxHash)
        setLog((l) => [...l, `Feed transaction sent: ${feedTxHash} — waiting for confirmation…`])
        await feed.waitForDeployment()
        const feedAddr = await feed.getAddress()
        setFeedAddress(feedAddr)
        setAdapterAddress(network.dexRouter)
        setLog((l) => [...l, `PancakeV2TwapFeed deployed at ${feedAddr}`])
        setLog((l) => [...l, `Router needs no adapter on a V2 chain — it is the ${network.dexRouterKind} at ${network.dexRouter}. Saving the feed into your Deploy Preset — Contract Studio will fill Price Feed from it, and Router from the V2 router.`])
        onDeployed(feedAddr, network.dexRouter, deployer)
        setBusy(false)
        return
      }
      const feedArt = arts.contracts.UniswapV3TwapFeed
      const adapterArt = arts.contracts.StelixV3RouterAdapter
      setLog((l) => [...l, `Deploying UniswapV3TwapFeed (${network.stablecoin} ${network.stablecoinAddress}, owner ${deployer})… — sign the transaction in your wallet.`])
      const feedFactory = new ContractFactory(feedArt.abi, feedArt.bytecode, signer)
      const feed = await feedFactory.deploy(network.stablecoinAddress, deployer)
      const feedTxHash = feed.deploymentTransaction()?.hash ?? ''
      setFeedTx(feedTxHash)
      setLog((l) => [...l, `Feed transaction sent: ${feedTxHash} — waiting for confirmation…`])
      await feed.waitForDeployment()
      const feedAddr = await feed.getAddress()
      setFeedAddress(feedAddr)
      setLog((l) => [...l, `UniswapV3TwapFeed deployed at ${feedAddr}`])
      setLog((l) => [...l, `Deploying StelixV3RouterAdapter (V3 router ${network.dexRouter}, owner ${deployer})… — sign the second transaction in your wallet.`])
      const adapterFactory = new ContractFactory(adapterArt.abi, adapterArt.bytecode, signer)
      const adapter = await adapterFactory.deploy(network.dexRouter, deployer)
      const adapterTxHash = adapter.deploymentTransaction()?.hash ?? ''
      setAdapterTx(adapterTxHash)
      setLog((l) => [...l, `Adapter transaction sent: ${adapterTxHash} — waiting for confirmation…`])
      await adapter.waitForDeployment()
      const adapterAddr = await adapter.getAddress()
      setAdapterAddress(adapterAddr)
      setLog((l) => [...l, `StelixV3RouterAdapter deployed at ${adapterAddr}`])
      setLog((l) => [...l, 'Both adapters deployed. Saving them into your Deploy Preset for this network — Contract Studio will fill Router and Price Feed from it.'])
      onDeployed(feedAddr, adapterAddr, deployer)
    } catch (e) { setError(friendlyError(e)) }
    setBusy(false)
  }

  const foundryCmd = network.routerKind === 'v2'
    ? [
      'cd contracts',
      `RPC_URL=${network.rpcUrl} PRIVATE_KEY=$${isMainnet ? 'MAINNET' : 'TESTNET'}_DEPLOYER_KEY \\`,
      `STABLE=${network.stablecoinAddress} STABLE_DECIMALS=${network.stablecoinDecimals} \\`,
      'forge script script/DeployV2Feed.s.sol --rpc-url $RPC_URL --broadcast --verify',
    ].join('\n')
    : [
      'cd contracts',
      `RPC_URL=${network.rpcUrl} PRIVATE_KEY=$${isMainnet ? 'MAINNET' : 'TESTNET'}_DEPLOYER_KEY \\`,
      `USDC=${network.stablecoinAddress} V3_ROUTER=${network.dexRouter} \\`,
      'forge script script/DeployAdapters.s.sol --rpc-url $RPC_URL --broadcast --verify',
    ].join('\n')

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Deploy Adapters — from this admin</h3>
      <p className="muted">
        {network.routerKind === 'v2' ? (
          <>The vault needs a price feed on {network.name}: <b>PancakeV2TwapFeed</b> (V2 TWAP feed). The router needs no adapter here — the vault speaks V2 natively, so Router is the {network.dexRouterKind} itself. Deploy the feed here with your own wallet — the admin never sees your private key, your wallet signs the transaction and pays the gas. After it confirms, the address is saved into your Deploy Preset automatically, so Contract Studio fills Price Feed in.</>
        ) : (
          <>The vault needs two adapter contracts on {network.name}: <b>UniswapV3TwapFeed</b> (price feed) and <b>StelixV3RouterAdapter</b> (router). Deploy them here with your own wallet — the admin never sees your private key, your wallet signs both transactions and pays the gas. After they confirm, the addresses are saved into your Deploy Preset automatically, so Contract Studio fills Router and Price Feed in.</>
        )}
      </p>
      {isMainnet && (
        <div className="notice alert"><ShieldAlert /><span><b>Mainnet is real money.</b> Your wallet pays real {network.nativeSymbol} gas for these deploys, and the feed and adapter are permanent contracts on {network.name}. The adapters hold no user funds — the vault itself is the gated part — but check the addresses above before you sign: {network.stablecoin} {network.stablecoinAddress} · router {network.dexRouter}.</span></div>
      )}
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <p className="field-hint">
        {network.stablecoin}: <span className="kbd">{network.stablecoinAddress}</span> ({network.stablecoinDecimals} decimals)<br />
        {network.routerKind === 'v2' ? 'V2 router (no adapter needed)' : 'Uniswap V3 router'}: <span className="kbd">{network.dexRouter}</span> ({network.dexRouterKind})<br />
        Deployer / adapter owner: {wallet || 'your connected wallet — it becomes the owner of the feed (and adapter, on V3 chains), transfer ownership to the vault owner later if you want'}<br />
        If MetaMask is already on {network.name}, just tap Connect wallet again — it will not try to add the chain a second time.
      </p>
      {!hasWallet && <p className="field-hint">No injected wallet in this browser. Use MetaMask on a computer, or the Foundry command below.</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={connect} disabled={busy}><Wallet />{wallet ? `Connected: ${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Connect wallet'}</button>
        <button className="btn mint" onClick={deploy} disabled={busy || !wallet}>{busy ? 'Deploying…' : 'Deploy adapters from admin'}</button>
      </div>
      {log.length > 0 && <pre>{log.join('\n')}</pre>}
      {feedAddress && (
        <p className="field-hint">
          Price feed: <a href={`${explorerUrl.replace(/\/$/, '')}/address/${feedAddress}`} target="_blank" rel="noreferrer">{feedAddress}</a>{feedTx ? ` (tx ${feedTx})` : ''}<br />
          {network.routerKind === 'v3' ? <>Router adapter: <a href={`${explorerUrl.replace(/\/$/, '')}/address/${adapterAddress}`} target="_blank" rel="noreferrer">{adapterAddress}</a>{adapterTx ? ` (tx ${adapterTx})` : ''}</> : <>Router (V2, no adapter): <span className="kbd">{network.dexRouter}</span></>}
        </p>
      )}
      <div style={{ marginTop: 16, borderTop: '1px solid #E5E7EB', paddingTop: 12 }}>
        <h4 style={{ margin: '0 0 6px' }}>Register a pool on the price feed — feed.setPool / setPair (owner only)</h4>
        <p className="muted">
          A token with no token/{network.stablecoin} {network.routerKind === 'v2' ? 'pair' : 'pool'} has no price: it cannot be locked with a target and its auto-sell will revert. Register the {network.routerKind === 'v2' ? 'pair' : 'pool'} here with your wallet — you must be the feed owner. After it confirms, wait ~30 minutes before the TWAP reads work.
        </p>
        <label>Price feed address</label>
        <input value={poolFeed} onChange={(e) => setPoolFeed(e.target.value)} placeholder="0x… (from the Deploy Preset, or paste from the explorer)" />
        <label>Token address</label>
        <input value={poolToken} onChange={(e) => setPoolToken(e.target.value)} placeholder="0x… token to lock (e.g. EURC on Arc Testnet)" />
        <label>{network.routerKind === 'v2' ? 'Pair' : 'Pool'} address (token/{network.stablecoin})</label>
        <input value={poolAddress} onChange={(e) => setPoolAddress(e.target.value)} placeholder="0x… the Uniswap pool / Pancake pair" />
        <label>Token decimals</label>
        <input value={poolDecimals} inputMode="numeric" onChange={(e) => setPoolDecimals(e.target.value)} placeholder="6" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button className="btn mint" onClick={registerPool} disabled={poolBusy || !wallet}>{poolBusy ? 'Registering…' : 'Register pool on feed'}</button>
        </div>
        {poolDone && <p className="field-hint">{poolDone}{poolTx ? <> — tx <a href={`${explorerUrl.replace(/\/$/, '')}/tx/${poolTx}`} target="_blank" rel="noreferrer">{poolTx.slice(0, 18)}…</a></> : ''}</p>}
      </div>
      <label style={{ marginTop: 12 }}>Or deploy with Foundry (same contracts, same args)</label>
      <pre>{foundryCmd}</pre>
      <p className="field-hint">After the feed is deployed, register a {network.routerKind === 'v2' ? 'pair on the feed for each token you want to lock (feed.setPair, owner only), then call update(token) and wait 30 minutes before the TWAP reads work' : 'pool on the price feed for each token you want to lock (feed.setPool, owner only)'} — a token with no token/{network.stablecoin} {network.routerKind === 'v2' ? 'pair' : 'pool'} has no price, and its auto-sell will revert. Then deploy the vault in Contract Studio below.</p>
    </div>
  )
}
