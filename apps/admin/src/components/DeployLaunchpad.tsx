// Deploy Launchpad contracts from the admin — every EVM chain, testnet
// AND mainnet. The admin itself never holds a private key and never
// broadcasts. This component deploys the token factory and the launchpad
// with the wallet connected in THIS browser (MetaMask / any injected
// wallet): the user signs the deployment transactions, pays the gas, and
// the admin then saves the addresses into the chain record, so the
// Launchpad page and the wallet know where the contracts live.
//   StelixTokenFactory — creates ERC-20s for free (gas only, no Stelix
//     fee). No constructor args. Holds no funds.
//   StelixLaunchpad — fixed-price sale contract. Constructor:
//     (stablecoin address, owner). The owner is the deploying wallet;
//     transfer ownership later if you want. The launchpad holds sale
//     funds (tokens + raised stablecoin) until the sale finalizes —
//     sellers withdraw the raised amount, contributors claim tokens,
//     and the liquidity reserve stays locked until a liquidity manager
//     is set (pending Arc DEX confirmation — the admin must never
//     present a launch as "liquidity locked on a DEX" before then).
// Mainnet deploys are real money: the wallet pays real gas in the
// chain's native token, and the deployed contracts are permanent. The
// factory holds no funds; the launchpad holds sale funds only while a
// sale is running. If no injected wallet is present, the Foundry
// command below is the fallback — same contracts, same constructor args.
import { useState } from 'react'
import { ContractFactory, type InterfaceAbi } from 'ethers'
import { BadgeCheck, ShieldAlert, Wallet } from 'lucide-react'
import launchpadArtifact from '../contracts/launchpad.artifact.json'
import type { Chain } from '../lib/types'
import { connectWallet, friendlyWalletError, hasInjectedWallet, signerForTx } from '../lib/walletDeploy'
import { AlertModal } from './AlertModal'

type Props = {
  chain: Chain
  onDeployed: (kind: 'factory' | 'launchpad', address: string, txHash: string, deployer: string) => void
}

export default function DeployLaunchpad({ chain, onDeployed }: Props) {
  const [wallet, setWallet] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState('')
  const [factoryAddress, setFactoryAddress] = useState('')
  const [launchpadAddress, setLaunchpadAddress] = useState('')
  const [factoryTx, setFactoryTx] = useState('')
  const [launchpadTx, setLaunchpadTx] = useState('')

  const isMainnet = !chain.isTestnet
  const hasWallet = hasInjectedWallet()
  const factoryDeployed = Boolean(chain.tokenFactoryAddress)
  const launchpadDeployed = Boolean(chain.launchpadAddress)
  const canDeployLaunchpad = chain.stablecoinAddress !== ''

  const connect = async () => {
    setError('')
    if (!hasWallet) { setError('No wallet found in this browser. Install MetaMask (or another injected wallet) and try again, or use the Foundry command below.'); return }
    setBusy(true)
    try {
      const address = await connectWallet(chain)
      setWallet(address)
      setLog([`Connected ${address} on ${chain.name} (chain ${chain.chainId}). ${isMainnet ? `Fund it with real ${chain.nativeToken} before deploying — mainnet gas is real money.` : `Fund it with test ${chain.nativeToken} before deploying.`}`])
    } catch (e) { setError(friendlyWalletError(e, chain)) }
    setBusy(false)
  }

  const deployOne = async (kind: 'factory' | 'launchpad') => {
    setError(''); setLog([])
    if (!wallet) { setError('Connect your wallet first.'); return }
    if (kind === 'launchpad' && !canDeployLaunchpad) {
      setError(`Set the ${chain.stablecoin} address for ${chain.name} in Chain Manager first — the launchpad needs it as its stablecoin.`)
      return
    }
    setBusy(true)
    try {
      const { signer, deployer } = await signerForTx(chain)
      if (deployer.toLowerCase() !== wallet.toLowerCase()) {
        setError(`MetaMask is now on a different account (${deployer.slice(0, 6)}…${deployer.slice(-4)}) than the one you connected (${wallet.slice(0, 6)}…${wallet.slice(-4)}). Switch back to the connected account in MetaMask, then tap Deploy again.`)
        setBusy(false)
        return
      }
      const arts = launchpadArtifact as unknown as {
        factory: { abi: InterfaceAbi; bytecode: string }
        launchpad: { abi: InterfaceAbi; bytecode: string }
      }
      if (kind === 'factory') {
        setLog((l) => [...l, 'Deploying StelixTokenFactory (no constructor args, owner is the deployer)… — sign the transaction in your wallet.'])
        const f = new ContractFactory(arts.factory.abi, arts.factory.bytecode, signer)
        const c = await f.deploy()
        const tx = c.deploymentTransaction()?.hash ?? ''
        setFactoryTx(tx)
        setLog((l) => [...l, `Factory transaction sent: ${tx} — waiting for confirmation…`])
        await c.waitForDeployment()
        const addr = await c.getAddress()
        setFactoryAddress(addr)
        setLog((l) => [...l, `StelixTokenFactory deployed at ${addr}`])
        setLog((l) => [...l, 'Saving the factory address into the chain record — the "Create a token" card can use it now.'])
        onDeployed('factory', addr, tx, deployer)
      } else {
        setLog((l) => [...l, `Deploying StelixLaunchpad (stablecoin ${chain.stablecoin} ${chain.stablecoinAddress}, owner ${deployer})… — sign the transaction in your wallet.`])
        const f = new ContractFactory(arts.launchpad.abi, arts.launchpad.bytecode, signer)
        const c = await f.deploy(chain.stablecoinAddress, deployer)
        const tx = c.deploymentTransaction()?.hash ?? ''
        setLaunchpadTx(tx)
        setLog((l) => [...l, `Launchpad transaction sent: ${tx} — waiting for confirmation…`])
        await c.waitForDeployment()
        const addr = await c.getAddress()
        setLaunchpadAddress(addr)
        setLog((l) => [...l, `StelixLaunchpad deployed at ${addr}`])
        setLog((l) => [...l, 'Saving the launchpad address into the chain record — launches on this chain can go live now.'])
        onDeployed('launchpad', addr, tx, deployer)
      }
    } catch (e) { setError(friendlyWalletError(e, chain)) }
    setBusy(false)
  }

  const explorer = chain.explorerUrl.replace(/\/$/, '')
  const foundryCmd = [
    'cd contracts',
    `RPC_URL=${chain.rpcUrls[0] ?? '<rpc>'} PRIVATE_KEY=$${isMainnet ? 'MAINNET' : 'TESTNET'}_DEPLOYER_KEY \\`,
    'forge create src/launchpad/StelixTokenFactory.sol:StelixTokenFactory --rpc-url $RPC_URL --broadcast',
    `forge create src/launchpad/StelixLaunchpad.sol:StelixLaunchpad --rpc-url $RPC_URL --broadcast --constructor-args ${chain.stablecoinAddress || '<stablecoin>'} $DEPLOYER`,
  ].join('\n')

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        Token factory: <span className="mono">{chain.tokenFactoryAddress ?? factoryAddress ?? 'Not deployed yet'}</span><br />
        Launchpad: <span className="mono">{chain.launchpadAddress ?? launchpadAddress ?? 'Not deployed yet'}</span><br />
        Liquidity manager: <span className="mono">None set — pending Arc DEX confirmation</span>
      </p>
      <p className="muted">
        Deploy them here with your own wallet — the admin never sees your private key, your wallet signs the transactions and pays the gas (no Stelix fee — gas only). After each confirms, its address is saved into this chain automatically.
      </p>
      {isMainnet && (
        <div className="notice alert"><ShieldAlert /><span><b>Mainnet is real money.</b> Your wallet pays real {chain.nativeToken} gas for these deploys, and the contracts are permanent on {chain.name}. The factory holds no funds; the launchpad holds sale funds only while a sale is running (sellers withdraw the raised amount, contributors claim their tokens).</span></div>
      )}
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <p className="field-hint">
        Stablecoin for sales: <span className="kbd">{chain.stablecoin} {chain.stablecoinAddress || '— not set in Chain Manager'}</span><br />
        Deployer / launchpad owner: {wallet || 'your connected wallet — it becomes the launchpad owner'}<br />
        If MetaMask is already on {chain.name}, just tap Connect wallet again — it will not try to add the chain a second time.
      </p>
      {!hasWallet && <p className="field-hint">No injected wallet in this browser. Use MetaMask on a computer, or the Foundry command below.</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn ghost" onClick={connect} disabled={busy}><Wallet />{wallet ? `Connected: ${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Connect wallet'}</button>
        <button className="btn mint" onClick={() => deployOne('factory')} disabled={busy || !wallet || factoryDeployed}>{busy ? 'Deploying…' : factoryDeployed ? 'Factory deployed' : 'Deploy token factory'}</button>
        <button className="btn mint" onClick={() => deployOne('launchpad')} disabled={busy || !wallet || launchpadDeployed || !canDeployLaunchpad}>{busy ? 'Deploying…' : launchpadDeployed ? 'Launchpad deployed' : 'Deploy launchpad'}</button>
      </div>
      {log.length > 0 && <pre>{log.join('\n')}</pre>}
      {(factoryAddress || launchpadAddress) && (
        <p className="field-hint">
          {factoryAddress && <>Token factory: <a href={`${explorer}/address/${factoryAddress}`} target="_blank" rel="noreferrer">{factoryAddress}</a>{factoryTx ? ` (tx ${factoryTx})` : ''}<br /></>}
          {launchpadAddress && <>Launchpad: <a href={`${explorer}/address/${launchpadAddress}`} target="_blank" rel="noreferrer">{launchpadAddress}</a>{launchpadTx ? ` (tx ${launchpadTx})` : ''}</>}
        </p>
      )}
      {factoryDeployed && launchpadDeployed && (
        <p className="field-hint"><BadgeCheck /> Both contracts are deployed on {chain.name} — tokens can be created and launches can go live here.</p>
      )}
      <label style={{ marginTop: 12 }}>Or deploy with Foundry (same contracts, same args)</label>
      <pre>{foundryCmd}</pre>
    </div>
  )
}
