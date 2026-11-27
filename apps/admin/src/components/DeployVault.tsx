// Deploy StelixVault from the admin — every EVM chain, testnet AND
// mainnet. Same pattern as DeployAdapters: the admin never holds a
// private key and never broadcasts. The user connects their wallet in
// THIS browser, signs one deployment transaction with the 7 constructor
// args from the Deploy Preset, pays the gas, and the admin fills the
// deployed address + tx hash into Contract Studio so it can be verified
// on the explorer and registered in Chain Manager. The bytecode comes
// from the pinned solc 0.8.24 artifact (scripts/compile.mjs), so the
// deployed vault is exactly the reviewed source — the Worker refuses to
// register an address whose source hash does not match that artifact.
//
// Mainnet is GATED, not open: Contract Studio passes locked=true until
// the mainnet gate passes (passing audit, verified testnet deployment
// on this chain, recorded small-value smoke test) AND the typed
// confirmation naming the network matches. Registration in Chain
// Manager enforces the same gate server-side, so even a deployed vault
// cannot be registered until the gate passes. On mainnet the keeper
// MUST be a different wallet from the owner — deploy refuses
// otherwise, because the keeper key goes into the keeper service.
import { useState } from 'react'
import { BrowserProvider, ContractFactory, type InterfaceAbi } from 'ethers'
import { BadgeCheck, ShieldAlert, Wallet } from 'lucide-react'
import vaultArtifact from '../contracts/StelixVault.artifact.json'
import { validateDeployParams } from '../lib/deployParams'
import type { DeployNetwork } from '../lib/evmNetworks'
import { AlertModal } from './AlertModal'

declare global {
  interface Window { ethereum?: unknown }
}

export type VaultParams = {
  owner: string
  keeper: string
  router: string
  priceFeed: string
  penaltyRecipient: string
  feeRecipient: string
  autoSellFeeBps: string
}

type Props = {
  chainId: string
  network: DeployNetwork
  explorerUrl: string
  params: VaultParams
  /** Mainnet gate lock, set by Contract Studio: true until the gate
   *  passes AND the typed confirmation matches. Always false on testnet. */
  locked: boolean
  lockReason?: string
  onDeployed: (address: string, txHash: string) => void
}

export default function DeployVault({ chainId, network, explorerUrl, params, locked, lockReason, onDeployed }: Props) {
  const [wallet, setWallet] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [vaultAddress, setVaultAddress] = useState('')
  const [vaultTx, setVaultTx] = useState('')

  const hasWallet = typeof window !== 'undefined' && Boolean(window.ethereum)

  const friendlyError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : 'Vault deploy failed.'
    if (msg.includes('4100') || msg.includes('not been authorized')) return 'MetaMask has not authorised this site to send transactions yet (code 4100). Tap Connect wallet again, then Deploy vault — and approve the transaction when MetaMask pops it up.'
    if (msg.includes('User denied') || msg.includes('rejected')) return 'You rejected the request in MetaMask. Tap Deploy vault again and approve it in MetaMask.'
    if (msg.includes('insufficient funds') || msg.includes('insufficient balance')) return `Your wallet does not have enough ${network.env === 'mainnet' ? `real ${network.nativeSymbol}` : `test ${network.nativeSymbol}`} for the gas. ${network.env === 'mainnet' ? 'Top it up with real funds and try again.' : `Top it up${network.faucetUrl ? ` from ${network.faucetUrl}` : ''} and try again.`}`
    return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg
  }

  const ensureNetwork = async (provider: BrowserProvider) => {
    const net = await provider.getNetwork()
    if (Number(net.chainId) === network.chainId) return
    try {
      await provider.send('wallet_switchEthereumChain', [{ chainId: `0x${network.chainId.toString(16)}` }])
    } catch {
      // Switch failed (chain not added, or a stale chain list) — add it.
      // MetaMask requires decimals 18 in the chain record, even though
      // Arc gas is USDC with 6 decimals on-chain.
      await provider.send('wallet_addEthereumChain', [{
        chainId: `0x${network.chainId.toString(16)}`,
        chainName: network.name,
        nativeCurrency: { name: network.nativeSymbol, symbol: network.nativeSymbol, decimals: 18 },
        rpcUrls: [network.rpcUrl],
        blockExplorerUrls: [network.explorerUrl],
      }])
      const after = await provider.getNetwork()
      if (Number(after.chainId) !== network.chainId) {
        await provider.send('wallet_switchEthereumChain', [{ chainId: `0x${network.chainId.toString(16)}` }])
      }
    }
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
      setLog([`Connected ${address} on ${network.name} (chain ${network.chainId}).`])
    } catch (e) { setError(friendlyError(e)) }
    setBusy(false)
  }

  const deploy = async () => {
    setError(''); setLog([])
    if (locked) { setError(lockReason ?? 'Mainnet is gated — see the Mainnet gate card below.'); return }
    if (!wallet) { setError('Connect your wallet first.'); return }
    const { errors } = validateDeployParams({
      chainId, env: network.env,
      owner: params.owner.trim(), keeper: params.keeper.trim(), router: params.router.trim(),
      priceFeed: params.priceFeed.trim(), penaltyRecipient: params.penaltyRecipient.trim(),
      feeRecipient: params.feeRecipient.trim(), autoSellFeeBps: Number(params.autoSellFeeBps),
    })
    if (errors.length > 0) { setError(`Cannot deploy yet: ${errors.join(' ')}`); return }
    if (params.owner.trim().toLowerCase() === params.keeper.trim().toLowerCase()) {
      if (network.env === 'mainnet') {
        // On mainnet the keeper key goes into the keeper service, so it
        // must never be the owner's key. Refuse instead of warning.
        setError('Keeper is the same address as Owner. On mainnet the keeper must be a separate dedicated wallet — its private key goes into the keeper service, and it must never be your main wallet key. Set a different keeper in Deploy Presets first.')
        return
      }
      setLog((l) => [...l, 'Note: Keeper is the same address as Owner. That is fine for a testnet test, but on mainnet the keeper must be a separate dedicated wallet — its private key goes into the keeper service, and it must never be your main wallet key.'])
    }
    setBusy(true)
    try {
      const provider = new BrowserProvider(window.ethereum as never)
      await provider.send('eth_requestAccounts', [])
      await ensureNetwork(provider)
      const signer = await provider.getSigner()
      const deployer = await signer.getAddress()
      if (deployer.toLowerCase() !== wallet.toLowerCase()) {
        setError(`MetaMask is now on a different account (${deployer.slice(0, 6)}…${deployer.slice(-4)}) than the one you connected (${wallet.slice(0, 6)}…${wallet.slice(-4)}). Switch back to the connected account in MetaMask, then tap Deploy vault again.`)
        setBusy(false)
        return
      }
      const art = vaultArtifact as { abi: InterfaceAbi; bytecode: string; bytecodeHash: string }
      setLog((l) => [...l, `Deploying StelixVault (solc 0.8.24, bytecode sha256 ${art.bytecodeHash.slice(0, 12)}…) — sign the transaction in your wallet.`])
      setLog((l) => [...l, `Owner ${params.owner.trim()} · Keeper ${params.keeper.trim()} · Router ${params.router.trim()} · Price feed ${params.priceFeed.trim()} · Fee ${params.autoSellFeeBps} bps`])
      const factory = new ContractFactory(art.abi, art.bytecode, signer)
      const vault = await factory.deploy(
        params.owner.trim(), params.keeper.trim(), params.router.trim(),
        params.priceFeed.trim(), params.penaltyRecipient.trim(), params.feeRecipient.trim(),
        Number(params.autoSellFeeBps),
      )
      const txHash = vault.deploymentTransaction()?.hash ?? ''
      setVaultTx(txHash)
      setLog((l) => [...l, `Vault transaction sent: ${txHash} — waiting for confirmation…`])
      await vault.waitForDeployment()
      const addr = await vault.getAddress()
      setVaultAddress(addr)
      setLog((l) => [...l, `StelixVault deployed at ${addr}`])
      setLog((l) => [...l, 'Next: tap "Verify on explorer", then "Register in Chain Manager" below — registration checks on-chain code and the source hash before writing anything to D1.'])
      onDeployed(addr, txHash)
    } catch (e) { setError(friendlyError(e)) }
    setBusy(false)
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>Deploy vault — from this admin{network.env === 'mainnet' ? ' (Mainnet — gated)' : ''}</h3>
      <p className="muted">
        Deploy StelixVault on {network.name} with your own wallet, using the 7 constructor values already filled in above.
        The admin never sees your private key — your wallet signs the one deployment transaction and pays the {network.env === 'mainnet' ? `real ${network.nativeSymbol}` : `test ${network.nativeSymbol}`} gas.
        After it confirms, the address is filled into the "Deployed contract address" box below, so you can verify it on the explorer and register it in Chain Manager.
      </p>
      {network.env === 'mainnet' && locked && (
        <div className="notice alert"><ShieldAlert /><span><b>Mainnet vault deploy is locked.</b> {lockReason ?? 'See the Mainnet gate card below.'} Mainnet is real money — a vault deployed here holds real user funds once locks are created.</span></div>
      )}
      {network.env === 'mainnet' && !locked && (
        <div className="notice alert"><ShieldAlert /><span><b>Mainnet is real money.</b> The gate passed and the typed confirmation matches, so this deploy is unlocked. Check the 7 constructor values above one more time before you sign — the vault is non-upgradeable, and a wrong owner, keeper, router or price feed cannot be fixed without redeploying.</span></div>
      )}
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={connect} disabled={busy}><Wallet />{wallet ? `Connected: ${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Connect wallet'}</button>
        <button className="btn mint" onClick={deploy} disabled={busy || locked || !wallet}>{busy ? 'Deploying…' : 'Deploy vault from admin'}</button>
      </div>
      {log.length > 0 && <pre>{log.join('\n')}</pre>}
      {vaultAddress && (
        <p className="field-hint">
          StelixVault: <a href={`${explorerUrl.replace(/\/$/, '')}/address/${vaultAddress}`} target="_blank" rel="noreferrer">{vaultAddress}</a>{vaultTx ? ` (tx ${vaultTx})` : ''}
        </p>
      )}
      <p className="field-hint">Deploys the exact compiled artifact: solc 0.8.24, optimizer 200 runs, via IR, deployed size 11,713 bytes. If the source in the editor above differs from that artifact, compile first — registration will refuse a mismatched source hash.</p>
    </div>
  )
}
