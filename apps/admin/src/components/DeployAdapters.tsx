// Deploy Adapters from the admin — Arc only, Testnet first.
// The admin itself never holds a private key and never broadcasts.
// This component deploys UniswapV3TwapFeed + StelixV3RouterAdapter with
// the wallet connected in THIS browser (MetaMask / any injected wallet):
// the user signs two deployment transactions, pays testnet USDC gas,
// and the admin then saves the two addresses into the Deploy Preset for
// that network, so Contract Studio fills Router / Price Feed from them.
// Mainnet is deliberately NOT offered here yet: prove the adapters +
// vault on testnet first, then deploy mainnet adapters with Foundry.
// If no injected wallet is present, the Foundry command below is the
// fallback — same contracts, same constructor args.
import { useState } from 'react'
import { BrowserProvider, ContractFactory, type InterfaceAbi } from 'ethers'
import { BadgeCheck, ShieldAlert, Wallet } from 'lucide-react'
import adaptersArtifact from '../contracts/adapters.artifact.json'
import type { ArcNetwork } from '../lib/arcNetworks'

declare global {
  interface Window { ethereum?: unknown }
}

type Props = {
  network: ArcNetwork
  explorerUrl: string
  onDeployed: (feed: string, adapter: string, deployer: string) => void
}

export default function DeployAdapters({ network, explorerUrl, onDeployed }: Props) {
  const [wallet, setWallet] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [feedAddress, setFeedAddress] = useState('')
  const [adapterAddress, setAdapterAddress] = useState('')
  const [feedTx, setFeedTx] = useState('')
  const [adapterTx, setAdapterTx] = useState('')

  const isMainnet = network.env === 'mainnet'
  const hasWallet = typeof window !== 'undefined' && Boolean(window.ethereum)

  const connect = async () => {
    setError('')
    if (!hasWallet) { setError('No wallet found in this browser. Install MetaMask (or another injected wallet) and try again, or use the Foundry command below.'); return }
    setBusy(true)
    try {
      const provider = new BrowserProvider(window.ethereum as never)
      await provider.send('eth_requestAccounts', [])
      const signer = await provider.getSigner()
      const address = await signer.getAddress()
      const net = await provider.getNetwork()
      if (Number(net.chainId) !== network.chainId) {
        try {
          await provider.send('wallet_switchEthereumChain', [{ chainId: `0x${network.chainId.toString(16)}` }])
        } catch {
          await provider.send('wallet_addEthereumChain', [{
            chainId: `0x${network.chainId.toString(16)}`,
            chainName: network.name,
            nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
            rpcUrls: [network.rpcUrl],
            blockExplorerUrls: [network.explorerUrl],
          }])
        }
      }
      setWallet(address)
      setLog([`Connected ${address} on ${network.name} (chain ${network.chainId}). Fund it with test USDC from https://faucet.circle.com (Arc Testnet) before deploying.`])
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not connect wallet.') }
    setBusy(false)
  }

  const deploy = async () => {
    setError(''); setLog([])
    if (!wallet) { setError('Connect your wallet first.'); return }
    setBusy(true)
    try {
      const provider = new BrowserProvider(window.ethereum as never)
      const signer = await provider.getSigner()
      const deployer = await signer.getAddress()
      const feedArt = (adaptersArtifact as { contracts: Record<string, { abi: InterfaceAbi; bytecode: string }> }).contracts.UniswapV3TwapFeed
      const adapterArt = (adaptersArtifact as { contracts: Record<string, { abi: InterfaceAbi; bytecode: string }> }).contracts.StelixV3RouterAdapter
      setLog((l) => [...l, `Deploying UniswapV3TwapFeed (USDC ${network.stablecoinAddress}, owner ${deployer})… — sign the transaction in your wallet.`])
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
    } catch (e) { setError(e instanceof Error ? e.message : 'Adapter deploy failed.') }
    setBusy(false)
  }

  const foundryCmd = [
    'cd contracts',
    `RPC_URL=${network.rpcUrl} PRIVATE_KEY=$TESTNET_DEPLOYER_KEY \\`,
    `USDC=${network.stablecoinAddress} V3_ROUTER=${network.dexRouter} \\`,
    'forge script script/DeployAdapters.s.sol --rpc-url $RPC_URL --broadcast --verify',
  ].join('\n')

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Deploy Adapters — from this admin</h3>
      <p className="muted">
        The vault needs two adapter contracts on {network.name}: <b>UniswapV3TwapFeed</b> (price feed) and <b>StelixV3RouterAdapter</b> (router).
        Deploy them here with your own wallet — the admin never sees your private key, your wallet signs both transactions and pays the gas.
        After they confirm, the addresses are saved into your Deploy Preset automatically, so Contract Studio fills Router and Price Feed in.
      </p>
      {isMainnet && (
        <div className="notice alert"><ShieldAlert /><span><b>Mainnet adapters are not deployed from the admin yet.</b> Prove the adapters and the vault on Arc Testnet first, then deploy mainnet adapters with the Foundry command below. Mainnet is real money.</span></div>
      )}
      {error && <div className="notice alert"><ShieldAlert /><span>{error}</span></div>}
      <p className="field-hint">
        USDC: <span className="kbd">{network.stablecoinAddress}</span><br />
        Uniswap V3 router: <span className="kbd">{network.dexRouter}</span> ({network.dexRouterKind})<br />
        Deployer / adapter owner: {wallet || 'your connected wallet — it becomes the owner of both adapters, transfer ownership to the vault owner later if you want'}
      </p>
      {!hasWallet && <p className="field-hint">No injected wallet in this browser. Use MetaMask on a computer, or the Foundry command below.</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={connect} disabled={busy || isMainnet}><Wallet />{wallet ? `Connected: ${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Connect wallet'}</button>
        <button className="btn mint" onClick={deploy} disabled={busy || isMainnet || !wallet}>{busy ? 'Deploying…' : 'Deploy adapters from admin'}</button>
      </div>
      {log.length > 0 && <pre>{log.join('\n')}</pre>}
      {feedAddress && (
        <p className="field-hint">
          Price feed: <a href={`${explorerUrl.replace(/\/$/, '')}/address/${feedAddress}`} target="_blank" rel="noreferrer">{feedAddress}</a>{feedTx ? ` (tx ${feedTx})` : ''}<br />
          Router adapter: <a href={`${explorerUrl.replace(/\/$/, '')}/address/${adapterAddress}`} target="_blank" rel="noreferrer">{adapterAddress}</a>{adapterTx ? ` (tx ${adapterTx})` : ''}
        </p>
      )}
      <label style={{ marginTop: 12 }}>Or deploy with Foundry (same contracts, same args)</label>
      <pre>{foundryCmd}</pre>
      <p className="field-hint">After the adapters are deployed, register a pool on the price feed for each token you want to lock (feed.setPool, owner only) — a token with no token/USDC pool has no price, and its auto-sell will revert. Then deploy the vault in Contract Studio below.</p>
    </div>
  )
}
