// Burn tokens — a reusable card in Contract Studio (wallet-signed
// contract action, same pattern as the "Register pool on the price feed"
// card in DeployAdapters). Generic: ANY ERC-20 token — registry picker
// or pasted address, any active EVM chain, any amount (partial or full
// balance via Max).
//
// The LaunchToken contract has NO burn function (fixed supply, no mint /
// burn / owner / pause), so burning is a plain ERC-20 transfer to the
// standard dead address 0x000…dEaD. Permanent and irreversible — nobody
// controls that address. No backend call, no D1 write, no migration:
// the connected wallet signs the transfer and pays the gas (USDC on Arc).
//
// SECURITY — the destination can never be changed or spoofed:
//  - The burn destination is ONE compile-time constant (DEAD_ADDRESS in
//    src/lib/burn.ts). No input field for it exists anywhere, and it is
//    never read from URL params, localStorage, the database, or an API.
//    A unit test pins its exact EIP-55 checksum.
//  - Defense in depth: the transfer recipient is validated at build
//    time (buildBurnTransaction) AND re-decoded and re-checked
//    immediately before the wallet-sign call (assertBurnCalldata).
//    Either check failing aborts and signs nothing.
//  - Before signing, the token's symbol, decimals and the wallet's
//    balance are read ON-CHAIN for the selected chain — typed-in or
//    registry metadata is never trusted for the burn. The token address
//    must be a valid checksummed address with contract code on the
//    selected chain, and the wallet must be on that same chain.
//  - Token name/symbol are untrusted metadata (a malicious token can
//    carry HTML/script in them) — they are rendered as plain React
//    text only. No dangerouslySetInnerHTML anywhere in this card.
//  - Nothing auto-executes: no URL param, deep link or prefill can
//    trigger a burn. Prefills only fill the form; the user must tap
//    Confirm on the centred modal, and the wallet prompt is the
//    second layer. Auth layers: this page only renders for an
//    authenticated admin session, and the burn is wallet-signed.
import { useEffect, useState } from 'react'
import { BrowserProvider, Contract, isAddress } from 'ethers'
import { Flame, Wallet } from 'lucide-react'
import { api } from '../lib/api'
import type { Chain } from '../lib/types'
import {
  BURN_ERC20_ABI,
  BURN_PREFILLS,
  DEAD_ADDRESS,
  assertBurnCalldata,
  buildBurnTransaction,
  isContractCode,
  isLiveToken,
  normalizeTokenAddress,
  unitsToWhole,
  wholeTokensToUnits,
} from '../lib/burn'
import { connectWallet, friendlyWalletError, hasInjectedWallet, signerForTx } from '../lib/walletDeploy'
import { AlertModal } from './AlertModal'
import { SectionTitle } from './ui'

type RegistryToken = { id: number; symbol: string; chain: string; address: string; decimals: number; verified: boolean }
type RecentBurn = { symbol: string; amount: string; token: string; chainName: string; explorerUrl: string; txHash: string }

export default function BurnTokens({ chains }: { chains: Chain[] }) {
  // Active EVM chains only: chainId 0 is the non-EVM sentinel (Pi), and
  // coming-soon chains are never selectable. Default Arc Mainnet.
  const evmChains = chains.filter((c) => c.chainId > 0 && c.active && !c.comingSoon)
  const [chainId, setChainId] = useState('arc-mainnet')
  const chain = evmChains.find((c) => c.id === chainId) ?? evmChains[0] ?? null

  const [tokens, setTokens] = useState<RegistryToken[]>([])
  const [tokenSource, setTokenSource] = useState('') // '' = none, 'custom', or a registry address
  const [tokenAddress, setTokenAddress] = useState('')
  // Decimals, symbol and name come ONLY from the on-chain read (loadToken).
  // They start empty — nothing typed or from the registry is trusted.
  const [decimals, setDecimals] = useState<number | null>(null)
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
  const [recentBurns, setRecentBurns] = useState<RecentBurn[]>([])
  // Pending burn awaiting confirmation in the centred modal. Every burn
  // is permanent, so the signing step always goes through the modal; the
  // live token gets the stronger warning text.
  const [confirmBurn, setConfirmBurn] = useState<string | null>(null)

  useEffect(() => {
    api.getTokens().then(setTokens).catch(() => undefined)
  }, [])

  const chainTokens = tokens.filter((t) => t.chain === (chain?.id ?? chainId))
  const liveSelected = tokenAddress !== '' && isLiveToken(tokenAddress)

  const resetTokenRead = () => {
    setDecimals(null); setTokenName(''); setTokenSymbol('')
    setBalance(null); setBalanceLoaded(false)
  }

  const pickRegistryToken = (value: string) => {
    setTokenSource(value)
    setBurned(null); setBurnTx(''); setNotice('')
    resetTokenRead()
    if (value === 'custom' || value === '') {
      setTokenAddress('')
      return
    }
    const t = chainTokens.find((x) => x.address.toLowerCase() === value.toLowerCase())
    if (t) setTokenAddress(t.address)
  }

  // Prefills are code constants only (BURN_PREFILLS in lib/burn.ts) —
  // they fill the form and NOTHING else. No burn can start from a
  // prefill without Connect + Load + Confirm taps.
  const applyPrefill = (index: number) => {
    const p = BURN_PREFILLS[index]
    if (!p) return
    setChainId(p.chainId)
    setTokenSource('custom')
    setTokenAddress(p.tokenAddress)
    setAmount(p.amountWhole)
    resetTokenRead()
    setBurned(null); setBurnTx(''); setNotice('')
    setNotice(`Prefilled: ${p.label} on Arc Mainnet. Connect your wallet and load the token on-chain to check its symbol, decimals and your balance before you burn — nothing is signed yet.`)
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

  // Read the token ON-CHAIN for the selected chain: name, symbol,
  // decimals and the connected wallet's balance — shown before anything
  // is signed, and the confirm step refuses to open until this has run.
  // Also refuses: a non-checksummed address, an address with no contract
  // code on this chain (not a token), and a wallet on a different chain.
  const loadToken = async () => {
    setError(''); setNotice('')
    if (!chain) { setError('Pick a chain first.'); return }
    if (!wallet) { setError('Connect your wallet first — the balance shown is your wallet\u2019s balance.'); return }
    let checksummed: string
    try {
      checksummed = normalizeTokenAddress(tokenAddress)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enter a valid token address first.')
      return
    }
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
      const net = await provider.getNetwork()
      if (Number(net.chainId) !== chain.chainId) {
        setError(`Your wallet is on chain ${Number(net.chainId)}, but ${chain.name} is chain ${chain.chainId}. Switch your wallet to ${chain.name} in MetaMask, then try again — nothing was signed.`)
        setBusy(false)
        return
      }
      const code = await provider.getCode(checksummed)
      if (!isContractCode(code)) {
        setError('That address has no contract code on this chain — it is not an ERC-20 token here. Check the address and the chain, then try again.')
        setBusy(false)
        return
      }
      const token = new Contract(checksummed, BURN_ERC20_ABI, provider)
      const [name, symbol, dec, bal] = await Promise.all([
        token.name() as Promise<string>,
        token.symbol() as Promise<string>,
        token.decimals() as Promise<number>,
        token.balanceOf(wallet) as Promise<bigint>,
      ])
      setTokenAddress(checksummed)
      setTokenName(name)
      setTokenSymbol(symbol)
      setDecimals(Number(dec))
      setBalance(bal)
      setBalanceLoaded(true)
      setNotice(`${symbol} (${name}) — ${Number(dec)} decimals, read on-chain. Your balance: ${unitsToWhole(bal, Number(dec))} ${symbol}.`)
    } catch (e) {
      resetTokenRead()
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
    if (!balanceLoaded || decimals === null || balance === null) {
      setError('Load the token details on-chain first — symbol, decimals and your balance must be read from the chain before any burn can be confirmed.')
      return
    }
    let units: bigint
    try {
      units = wholeTokensToUnits(amount, decimals)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enter a valid amount.')
      return
    }
    if (units <= 0n) { setError('Enter an amount greater than zero.'); return }
    if (units > balance) {
      setError(`You only hold ${unitsToWhole(balance, decimals)} ${tokenSymbol || 'of this token'} — the burn amount is larger than your balance.`)
      return
    }
    // Full, untruncated details in the centred confirm modal — the user
    // checks every line before tapping Confirm, and the wallet prompt
    // after that shows the destination again.
    const details =
      `Verified burn address: ${DEAD_ADDRESS}\n` +
      `Token: ${tokenSymbol} (${tokenName}) — ${tokenAddress}\n` +
      `Amount: ${amount} ${tokenSymbol} = ${units.toString()} smallest units\n` +
      `Chain: ${chain.name} (chain ID ${chain.chainId})\n` +
      `This is permanent: the tokens leave your wallet for the dead address and can never be recovered. Your wallet signs the transfer and pays the gas.`
    setConfirmBurn(liveSelected
      ? `STOP — this is the LIVE registered STX token (${tokenAddress}). The live token is the one the app and the Stelix Pool use — burning it removes those tokens from circulation permanently and cannot be undone. Only continue if you are certain you mean the live token.\n\n${details}`
      : `Burn these tokens forever?\n\n${details}`)
  }

  const doBurn = async () => {
    setConfirmBurn(null)
    if (!chain || !wallet || decimals === null) return
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
      // Refuse if the wallet drifted to another chain since loading.
      const net = await signer.provider.getNetwork()
      if (Number(net.chainId) !== chain.chainId) {
        setError(`Your wallet is on chain ${Number(net.chainId)}, but ${chain.name} is chain ${chain.chainId}. Switch back, then try again — nothing was signed.`)
        setBusy(false)
        return
      }
      // Check 1 (build time): the transaction is built with the dead
      // address constant as the only possible recipient.
      const tx = buildBurnTransaction(tokenAddress, units)
      // Check 2 (immediately before signing): decode the built calldata
      // and re-verify the recipient is the dead address and the amount
      // matches. Any mismatch aborts and signs nothing.
      assertBurnCalldata(tx.data, units)
      const sent = await signer.sendTransaction({ to: tx.to, data: tx.data, value: tx.value })
      setBurnTx(sent.hash)
      setNotice(`Burn transaction sent: ${sent.hash} — waiting for confirmation…`)
      await sent.wait()
      setBurned({ symbol: tokenSymbol || 'tokens', amount, address: tokenAddress })
      setRecentBurns((prev) => [{ symbol: tokenSymbol || 'tokens', amount, token: tokenAddress, chainName: chain.name, explorerUrl: chain.explorerUrl ?? '', txHash: sent.hash }, ...prev])
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
        Send any unwanted token to the verified burn address <span className="kbd">{DEAD_ADDRESS}</span> — burned forever, cannot be undone.
        The token contract has no burn function, so this is a plain ERC-20 transfer to an address nobody controls.
        Your wallet signs it and pays the gas (USDC on Arc). No backend call, nothing is written to the database.
        Symbol, decimals and balance are always read on-chain before you can confirm a burn.
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
      <p className="field-hint">{BURN_PREFILLS[0]?.note} {BURN_PREFILLS[1]?.note} The live registered STX token is never prefilled. A prefill only fills the form — it never starts a burn.</p>
      <label>Chain</label>
      <select value={chain?.id ?? chainId} onChange={(e) => { setChainId(e.target.value); setTokenSource(''); setTokenAddress(''); resetTokenRead(); setBurned(null); setBurnTx('') }}>
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
          <input value={tokenAddress} onChange={(e) => { setTokenAddress(e.target.value); resetTokenRead() }} placeholder="0x… ERC-20 token to burn" />
        </>
      )}
      {tokenAddress && (
        <p className="field-hint">
          Token: <span className="kbd">{tokenAddress}</span>
          {tokenSymbol ? <> · {tokenName ? `${tokenName} (${tokenSymbol})` : tokenSymbol}</> : ''}
          {balanceLoaded && balance !== null && decimals !== null
            ? <> · your balance: {unitsToWhole(balance, decimals)} {tokenSymbol} (read on-chain)</>
            : ' · connect your wallet and load the token to see its symbol, decimals and balance on-chain'}
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
        <button className="btn ghost" onClick={() => { if (balance !== null && decimals !== null) setAmount(unitsToWhole(balance, decimals)) }} disabled={balance === null || decimals === null}>Max</button>
      </div>
      <p className="field-hint">Decimals: {decimals === null ? 'not loaded yet — load the token on-chain first' : decimals} · Max burns your full balance ({balance !== null && decimals !== null ? `${unitsToWhole(balance, decimals)} ${tokenSymbol}` : 'load the token first'}). Amounts are converted with BigInt — no rounding, no exponent notation.</p>
      <button className="btn danger block" style={{ marginTop: 14 }} onClick={requestBurn} disabled={busy || !wallet || !isAddress(tokenAddress) || !amount.trim() || !balanceLoaded}>
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
      {recentBurns.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ margin: '0 0 6px' }}>Recent burns — this session</h4>
          <p className="field-hint">Kept in this browser session only — no backend record is written (a D1 audit log is a follow-up for later).</p>
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>Token</th><th>Amount</th><th>Chain</th><th>Transaction</th></tr></thead>
              <tbody>
                {recentBurns.map((b) => (
                  <tr key={b.txHash}>
                    <td data-label="Token">{b.symbol} · {b.token.slice(0, 6)}…{b.token.slice(-4)}</td>
                    <td data-label="Amount">{b.amount}</td>
                    <td data-label="Chain">{b.chainName}</td>
                    <td data-label="Transaction"><a href={`${b.explorerUrl.replace(/\/$/, '')}/tx/${b.txHash}`} target="_blank" rel="noreferrer">{b.txHash.slice(0, 10)}…{b.txHash.slice(-6)}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
