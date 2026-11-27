// Shared wallet helpers for the admin's wallet-signed deploys
// (DeployAdapters, DeployLaunchpad, and the Launchpad "Create a token"
// card). The admin never holds a private key: the connected wallet in
// this browser signs every transaction and pays the gas.
//
// MetaMask (EIP-3085) requires nativeCurrency.decimals to be 18 when
// adding a chain, even though Arc's gas token is USDC with 6 decimals
// on-chain. The 18 here is only what MetaMask accepts for the chain
// record; it does not change the on-chain gas token.
import { BrowserProvider } from 'ethers'
import type { Chain } from './types'

declare global {
  interface Window { ethereum?: unknown }
}

export const hasInjectedWallet = (): boolean =>
  typeof window !== 'undefined' && Boolean(window.ethereum)

export async function ensureChain(provider: BrowserProvider, chain: Chain): Promise<void> {
  const net = await provider.getNetwork()
  if (Number(net.chainId) === chain.chainId) return
  try {
    await provider.send('wallet_switchEthereumChain', [{ chainId: `0x${chain.chainId.toString(16)}` }])
  } catch (e) {
    const code = walletErrorCode(e)
    if (code !== 4902) throw e
    await provider.send('wallet_addEthereumChain', [{
      chainId: `0x${chain.chainId.toString(16)}`,
      chainName: chain.name,
      nativeCurrency: { name: chain.nativeToken, symbol: chain.nativeToken, decimals: 18 },
      rpcUrls: chain.rpcUrls.length > 0 ? chain.rpcUrls : [],
      blockExplorerUrls: chain.explorerUrl ? [chain.explorerUrl] : [],
    }])
    const after = await provider.getNetwork()
    if (Number(after.chainId) !== chain.chainId) {
      // Add succeeded but the wallet did not switch (some wallets add
      // without switching) — switch once more, now it exists.
      await provider.send('wallet_switchEthereumChain', [{ chainId: `0x${chain.chainId.toString(16)}` }])
    }
  }
}

/** Walk an ethers-wrapped wallet error for the numeric code (4902, 4100…). */
export function walletErrorCode(e: unknown, depth = 0): number | undefined {
  if (e == null || depth > 4) return undefined
  if (typeof e === 'number') return e
  if (typeof e === 'object') {
    const rec = e as Record<string, unknown>
    if (typeof rec.code === 'number') return rec.code
    for (const v of Object.values(rec)) {
      const c = walletErrorCode(v, depth + 1)
      if (c !== undefined) return c
    }
  }
  return undefined
}

/** One readable line from a wallet/ethers error, instead of the JSON blob. */
export function friendlyWalletError(e: unknown, chain: Chain): string {
  const msg = e instanceof Error ? e.message : 'Could not connect wallet.'
  if (msg.includes('Unrecognized chain ID') || msg.includes('4902')) {
    return `MetaMask does not know ${chain.name} yet. Tap Connect wallet again — the admin will now add ${chain.name} (chain ${chain.chainId}, RPC ${chain.rpcUrls[0] ?? '—'}) and switch to it. If MetaMask asks you to approve adding the network, approve it.`
  }
  if (msg.includes('nativeCurrency.decimals')) return 'MetaMask refused the chain details. Please hard-refresh this page, then tap Connect wallet again.'
  if (msg.includes('User denied') || msg.includes('rejected')) return 'You rejected the request in MetaMask. Tap Connect wallet again and approve it in MetaMask.'
  if (msg.includes('4100') || msg.includes('not been authorized')) {
    return `MetaMask has not authorised this site to send transactions yet (code 4100). In MetaMask, check that stelix-admin.pages.dev is connected to this account on ${chain.name}, then tap Connect wallet again in the admin, then Deploy — and approve the transaction when MetaMask pops it up. If it still fails, disconnect the site in MetaMask (Settings → Connected sites) and reconnect it fresh.`
  }
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg
}

/** Connect the injected wallet and switch it to the chain. Returns the
 *  connected account address. Throws a friendly message on failure. */
export async function connectWallet(chain: Chain): Promise<string> {
  const provider = new BrowserProvider(window.ethereum as never)
  await provider.send('eth_requestAccounts', [])
  const signer = await provider.getSigner()
  const address = await signer.getAddress()
  await ensureChain(provider, chain)
  return address
}

/** Fresh provider + signer for a transaction, re-requesting accounts
 *  first (MetaMask mobile can authorise the site for reading but still
 *  return 4100 on eth_sendTransaction after a chain switch/add, until
 *  accounts are requested again). */
export async function signerForTx(chain: Chain) {
  const provider = new BrowserProvider(window.ethereum as never)
  await provider.send('eth_requestAccounts', [])
  await ensureChain(provider, chain)
  const signer = await provider.getSigner()
  return { provider, signer, deployer: await signer.getAddress() }
}
