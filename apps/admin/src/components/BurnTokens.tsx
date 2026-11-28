// Burn tokens — a reusable card in Contract Studio (wallet-signed
// contract action, same pattern as the "Register pool on the price feed"
// card in DeployAdapters). Generic: any registry token or any pasted
// ERC-20 address on any active EVM chain.
//
// The LaunchToken contract has NO burn function (fixed supply, no mint /
// burn / owner / pause), so burning is a plain ERC-20 transfer to the
// standard dead address 0x000…dEaD. Permanent and irreversible — nobody
// controls that address. No backend call, no D1 write, no migration:
// the connected wallet signs the transfer and pays the gas (USDC on Arc).
import { useEffect, useState } from 'react'
import { BrowserProvider, Contract, isAddress } from 'ethers'
import { Flame, Wallet } from 'lucide-react'
import { api } from '../lib/api'
import type { Chain } from '../lib/types'
import {
  BURN_ERC20_ABI,
  BURN_PREFILLS,
  DEAD_ADDRESS,
  buildBurnCalldata,
  isLiveToken,
  unitsToWhole,
  wholeTokensToUnits,
} from '../lib/burn'
import { connectWallet, friendlyWalletError, hasInjectedWallet, signerForTx } from '../lib/walletDeploy'
import { AlertModal } from './AlertModal'
import { SectionTitle } from './ui'

type RegistryToken = { id: number; symbol: string; chain: string; address: string; decimals: number; verified: boolean }

export default function BurnTokens({ chains }: { chains: Chain[] }) {
  // Active EVM chains only: chainId 0 is the non-EVM sentinel (Pi), and
  // coming-soon chains are never selectable. Default Arc Mainnet.
  const evmChains = chains.filter((c) => c.chainId > 0 && c.active && !c.comingSoon)
  const [chainId, setChainId] = useState('arc-mainnet')
  const chain = evmChains.find((c) => c.id === chainId) ?? evmChains[0] ?? null

  const [tokens, setTokens] = useState<RegistryToken[]>([])
  const [tokenSource, setTokenSource] = useState('') // '' = none, 'custom', or a registry address
  const [tokenAddress, setTokenAddress] = useState('')
  const [decimals, setDecimals] = useState(18)
  const [tokenName, setTokenName] = useState('')
  const [tokenSymbol, setTokenSymbol] = useState('')
  const [balance, setBalance] = useState<bigint | null>(null)
  const [balanceLoaded, setBalanceLoaded] = useState(false)
  const [amount, setAmount] = useState('')
  const [wallet, setWallet] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [burnTx, setBurnTx] = useState('')
  const [burned, setBurned] = useState<{ symbol: string; amount: string; address: string } | null>(null)
  // Pending burn awaiting confirmation in the centred modal. Every burn
  // is permanent, so the signing step always goes through the modal; the
  // live token gets the stronger warning text.
  const [confirmBurn, setConfirmBurn] = useState<string | null>(null)

  useEffect(() => {
    api.getTokens().then(setTokens).catch(() => undefined)
  }, [])

  const chainTokens = tokens.filter((t) => t.chain === (chain?.id ?? chainId))
  const registryPick = tokenSource !== '' && tokenSource !== 'custom'
    ? chainTokens.find((t) => t.address.toLowerCase() === tokenSource.toLowerCase()) ?? null
    : null
  const liveSelected = tokenAddress !== '' && isLiveToken(tokenAddress)

  const pickRegistryToken = (value: string) => {
    setTokenSource(value)
    setBurned(null); setBurnTx(''); setNotice('')
    setBalance(null); setBalanceLoaded(false)
    setTokenName(''); setTokenSymbol('')
    if (value === 'custom') {
      setTokenAddress('')
      return
    }
    const t = chainTokens.find((x) => x.address.toLowerCase() === value.toLowerCase())
    if (t) {
      setTokenAddress(t.address)
      setDecimals(t.decimals)
      setTokenSymbol(t.symbol)
    }
  }

  const applyPrefill = (index: number) => {
    const p = BURN_PREFILLS[index]
    if (!p) return
    setChainId(p.chainId)
    setTokenSource('custom')
    setTokenAddress(p.tokenAddress)
    setDecimals(p.decimals)
    setAmount(p.amountWhole)
    setTokenName('')
    setTokenSymbol('STX')
    setBalance(null); setBalanceLoaded(false)
    setBurned(null); setBurnTx(''); setNotice('')
    setNotice(`Prefilled: ${p.label} on Arc Mainnet. Connect your wallet and load the token to check the on-chain balance before you burn.`)
  }

  const connect = async () => {
    setError('')
    if (!chain) { setError('Pick a chain first.'); return }
    if (!hasInjectedWallet()) { setError('No wallet found in this browser. Install MetaMask (or another injected wallet) and try again.'); return }
    setBusy(true)
    try {
      const address = await connectWallet(chain)
      setWallet(address)
      setNotice(`Connected ${address} on ${chain.name} (chain ${chain.chainId}).`)
    } catch (e) { setError(friendlyWalletError(e, chain)) }
    setBusy(false)
  }

  // Read the token on-chain for the connected wallet: name, symbol,
  // decimals and balance — shown before anything is signed.
  const loadToken = async () => {
    setError(''); setNotice('')
    if (!chain) { setError('Pick a chain first.'); return }
    if (!wallet) { setError('Connect your wallet first — the balance shown is your wallet\u2019s balance.'); return }
    if (!isAddress(tokenAddress)) { setError('Enter a valid token address first — pick one from the registry or paste an address.'); return }
    setBusy(true)
    try {
      const provider = new BrowserProvider(window.ethereum as never)
      await provider.send('eth_requestAccounts', [])
      const signer = await provider.getSigner()
      const signerAddress = await signer.getAddress()
      if (signerAddress.toLowerCase() !== wallet.toLowerCase()) {
        setError(`MetaMask is now on a different account (${signerAddress.slice(0, 6)}…${signerAddress.slice(-4)}) than the one you connected (${wallet.slice(0, 6)}…${wallet.slice(-4)}). Switch back to the connected account in MetaMask, then try again.`)
        setBusy(false)
        return
      }
      const token = new Contract(tokenAddress, BURN_ERC20_ABI, provider)
      const [name, symbol, dec, bal] = await Promise.all([
        token.name() as Promise<string>,
        token.symbol() as Promise<string>,
        token.decimals() as Promise<number>,
        token.balanceOf(wallet) as Promise<bigint>,
      ])
      setTokenName(name)
      setTokenSymbol(symbol)
      setDecimals(Number(dec))
      setBalance(bal)
      setBalanceLoaded(true)
      setNotice(`${symbol} (${name}) — ${Number(dec)} decimals. Your balance: ${unitsToWhole(bal, Number(dec))} ${symbol}.`)
    } catch (e) {
      setBalance(null); setBalanceLoaded(false)
      setError(e instanceof Error && /call revert|missing revert|bad address/i.test(e.message)
        ? 'That address does not look like an ERC-20 token on this chain — check the address and the chain, then try again.'
        : friendlyWalletError(e, chain))
    }
    setBusy(false)
  }

  const requestBurn = () => {
    setError('')
    if (!chain) { setError('Pick a chain first.'); return }
    if (!wallet) { setError('Connect your wallet first.'); return }
    if (!isAddress(tokenAddress)) { setError('Enter a valid token address first.'); return }
    let units: bigint
    try {
      units = wholeTokensToUnits(amount, decimals)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enter a valid amount.')
      return
    }
    if (units <= 0n) { setError('Enter an amount greater than zero.'); return }
    if (balance !== null && units > balance) {
      setError(`You only hold ${unitsToWhole(balance, decimals)} ${tokenSymbol || 'of this token'} — the burn amount is larger than your balance.`)
      return
    }
    const display = `${amount} ${tokenSymbol || 'tokens'} (${units.toString()} smallest units)`
    setConfirmBurn(liveSelected
      ? `STOP — this is the LIVE registered STX token (${tokenAddress}). Burning ${display} sends it to the dead address 0x000…dEaD forever. The live token is the one the app and the Stelix Pool use — burning it removes those tokens from circulation permanently and cannot be undone. Only continue if you are certain you mean the live token.`
      : `Burn ${display} of ${tokenAddress} on ${chain.name}? The tokens go to the dead address 0x000…dEaD — burned forever, cannot be undone. Your wallet signs the transfer and pays the gas.`)
  }

  const doBurn = async () => {
    setConfirmBurn(null)
    if (!chain || !wallet) return
    let units: bigint
    try {
      units = wholeTokensToUnits(amount, decimals)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enter a valid amount.')
      return
    }
    setBusy(true)
    try {
      const { signer, deployer } = await signerForTx(chain)
      if (deployer.toLowerCase() !== wallet.toLowerCase()) {
        setError(`MetaMask is now on a different account (${deployer.slice(0, 6)}…${deployer.slice(-4)}) than the one you connected (${wallet.slice(0, 6)}…${wallet.slice(-4)}). Switch back to the connected account in MetaMask, then try again.`)
        setBusy(false)
        return
      }
      const data = buildBurnCalldata(units)
      const tx = await signer.sendTransaction({ to: tokenAddress, data })
      setBurnTx(tx.hash)
      setNotice(`Burn transaction sent: ${tx.hash} — waiting for confirmation…`)
      await tx.wait()
      setBurned({ symbol: tokenSymbol || 'tokens', amount, address: tokenAddress })
      setBalance((b) => (b === null ? b : b - units))
      setNotice('')
    } catch (e) { setError(friendlyWalletError(e, chain)) }
    setBusy(false)
  }

  const explorer = chain?.explorerUrl?.replace(/\/$/, '') ?? ''

  return (
    <div className="card">
      <SectionTitle icon={<Flame />}>Burn tokens</SectionTitle>
      <p className="muted">
        Send any unwanted token to the dead address <span className="kbd">0x000…dEaD</span> — burned forever, cannot be undone.
        The token contract has no burn function, so this is a plain ERC-20 transfer to an address nobody controls.
        Your wallet signs it and pays the gas (USDC on Arc). No backend call, nothing is written to the database.
      </p>
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <AlertModal kind="success" message={notice} onClose={() => setNotice('')} />
      <AlertModal
        kind="confirm"
        title="Burn forever?"
        message={confirmBurn ?? ''}
        onClose={() => setConfirmBurn(null)}
        confirmLabel="Yes, burn it forever"
        onConfirm={doBurn}
      />
      <label>One-tap burns — ready to run</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {BURN_PREFILLS.map((p, i) => (
          <button key={p.tokenAddress} className="btn ghost" onClick={() => applyPrefill(i)} disabled={busy}>
            <Flame />{p.label}
          </button>
        ))}
      </div>
      <p className="field-hint">{BURN_PREFILLS[0]?.note} {BURN_PREFILLS[1]?.note} The live registered STX token is never prefilled.</p>
      <label>Chain</label>
      <select value={chain?.id ?? chainId} onChange={(e) => { setChainId(e.target.value); setTokenSource(''); setTokenAddress(''); setBalance(null); setBalanceLoaded(false); setBurned(null); setBurnTx('') }}>
        {evmChains.map((c) => <option key={c.id} value={c.id}>{c.name} (chain {c.chainId})</option>)}
      </select>
      <label>Token — registry token, or paste an address</label>
      <select value={tokenSource} onChange={(e) => pickRegistryToken(e.target.value)}>
        <option value="">Choose a token…</option>
        {chainTokens.map((t) => (
          <option key={t.id} value={t.address}>{t.symbol} · {t.address.slice(0, 6)}…{t.address.slice(-4)}{t.verified ? ' · verified' : ''}</option>
        ))}
        <option value="custom">Custom address… (unregistered token)</option>
      </select>
      {(tokenSource === 'custom' || tokenSource === '') && (
        <>
          <label style={{ marginTop: 8 }}>Token address</label>
          <input value={tokenAddress} onChange={(e) => { setTokenAddress(e.target.value); setBalance(null); setBalanceLoaded(false) }} placeholder="0x… ERC-20 token to burn" />
        </>
      )}
      {tokenAddress && (
        <p className="field-hint">
          Token: <span className="kbd">{tokenAddress}</span>
          {tokenSymbol ? <> · {tokenName ? `${tokenName} (${tokenSymbol})` : tokenSymbol}</> : ''}
          {balanceLoaded && balance !== null ? <> · your balance: {unitsToWhole(balance, decimals)} {tokenSymbol}</> : ' · connect your wallet and load the token to see its balance'}
        </p>
      )}
      {liveSelected && (
        <div className="notice alert">
          <Flame />
          <span><b>Warning — this is the LIVE registered STX token.</b> It is the token the app and the Stelix Pool use. Burning it removes those tokens from circulation permanently. Do not burn it unless you are certain.</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <button className="btn ghost" onClick={connect} disabled={busy}><Wallet />{wallet ? `Connected: ${wallet.slice(0, 6)}…${wallet.slice(-4)}` : 'Connect wallet'}</button>
        <button className="btn ghost" onClick={loadToken} disabled={busy || !wallet || !isAddress(tokenAddress)}>{busy ? 'Loading…' : 'Load token details'}</button>
      </div>
      <label style={{ marginTop: 12 }}>Amount to burn</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1000000" style={{ flex: 1 }} />
        <button className="btn ghost" onClick={() => { if (balance !== null) setAmount(unitsToWhole(balance, decimals)) }} disabled={balance === null}>Max</button>
      </div>
      <p className="field-hint">Decimals: {decimals} · Max burns your full balance ({balance !== null ? unitsToWhole(balance, decimals) : 'load the token first'} {tokenSymbol}). Amounts are converted with BigInt — no rounding, no exponent notation.</p>
      <button className="btn danger block" style={{ marginTop: 14 }} onClick={requestBurn} disabled={busy || !wallet || !isAddress(tokenAddress) || !amount.trim()}>
        <Flame />{busy ? 'Burning…' : 'Burn tokens forever'}
      </button>
      {burnTx && (
        <p className="field-hint">
          Burn transaction: <a href={`${explorer}/tx/${burnTx}`} target="_blank" rel="noreferrer">{burnTx}</a>
        </p>
      )}
      {burned && (
        <div className="notice alert" style={{ marginTop: 12 }}>
          <Flame />
          <span>
            <b>Burned forever.</b> {burned.amount} {burned.symbol} left your wallet for the dead address and cannot be recovered.
            What this means: that balance is gone from your wallet, so the app&apos;s auto-discovery stops showing the token — the old STX was already out of the registry, and the unregistered STX was never in it.
          </span>
        </div>
      )}
    </div>
  )
}
