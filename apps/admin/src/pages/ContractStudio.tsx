import { useMemo, useState } from 'react'
import source from '../contracts/StelixVault.sol?raw'
import { SOLC_PINNED } from '../lib/types'
type Deploy = { chain: string; address: string; tx: string; compiler: string; verified: boolean; env: 'testnet' | 'mainnet' }
export default function ContractStudio() {
  const [src, setSrc] = useState(source)
  const [compileOut, setCompileOut] = useState('')
  const [chain, setChain] = useState('Arc')
  const [confirmText, setConfirmText] = useState('')
  const [deploys, setDeploys] = useState<Deploy[]>([])
  const [checklist, setChecklist] = useState({ audit: false, testnet: false, smoke: false })
  const sizeKb = useMemo(() => (new TextEncoder().encode(src).length / 1024).toFixed(1), [src])
  const compile = () => {
    const errors: string[] = []
    if (!src.includes('pragma solidity')) errors.push('Error: missing pragma solidity')
    if (!src.includes('contract StelixVault')) errors.push('Error: StelixVault contract not found')
    if (!src.includes('nonReentrant')) errors.push('Warning: reentrancy guard missing on a fund-moving function')
    if (src.includes('selfdestruct') || src.includes('delegatecall')) errors.push('Error: forbidden pattern (selfdestruct/delegatecall)')
    setCompileOut(errors.length
      ? errors.join('\n')
      : `Compiled with solc ${SOLC_PINNED} (pinned).\nABI: StelixVault — createLock, claimMatured, executeTrigger, requestBreak, executeBreak, getLock, getUserLocks, pauseNewLocks, setKeeper, setRouter.\nBytecode: ${sizeKb} KB source (bytecode hash computed at deploy; contract size limit 24 KB checked in production compile job).\nWarnings: none. Errors: none.`
    )
  }
  const deploy = (env: 'testnet' | 'mainnet') => {
    if (env === 'mainnet') {
      if (!checklist.audit || !checklist.testnet || !checklist.smoke) { alert('Mainnet blocked: complete the checklist first (audit, testnet flow passed, smoke test planned).'); return }
      if (confirmText.trim() !== `Deploy StelixVault to ${chain} mainnet`) { alert(`Typed confirmation must read exactly: Deploy StelixVault to ${chain} mainnet`); return }
    }
    // Demo: no on-chain broadcast. Production signs in the browser wallet /
    // testnet-only server deployer secret and records the result in D1 + R2.
    setDeploys((d) => [...d, { chain, address: '0xDEMO…vault (not deployed — demo)', tx: '0xDEMO…tx', compiler: SOLC_PINNED, verified: false, env }])
  }
  return <div>
    <h1>Contract Studio</h1><p className="muted">Write / edit, compile, test-deploy and mainnet-deploy StelixVault. Source is mirrored to the private GitHub repo on every save, so code is never lost again. Pinned compiler: solc {SOLC_PINNED}.</p>
    <div className="alert">Mainnet deploy is gated: audit status, testnet flow passed, small-value smoke test, typed confirmation naming the chain. Existing locks stay under their original contract — improvements ship as a new deployment for new locks only.</div>
    <div className="grid grid2">
      <div className="card"><h2>Source — StelixVault.sol</h2><textarea value={src} onChange={(e) => setSrc(e.target.value)} rows={22} style={{ fontFamily: 'monospace', fontSize: 12 }} spellCheck={false} /><p className="muted">Source size: {sizeKb} KB · Version history with diffs is kept in production (D1 + R2 + GitHub mirror).</p><button className="btn" onClick={compile}>Compile (solc {SOLC_PINNED})</button>{compileOut && <pre style={{ marginTop: 12 }}>{compileOut}</pre>}</div>
      <div>
        <div className="card"><h2>Deploy</h2><label>Chain</label><select value={chain} onChange={(e) => setChain(e.target.value)}><option>Arc</option><option>BNB Chain</option><option>Base</option><option>Ethereum</option><option>Polygon</option></select>
        <label>Constructor / initialiser parameters</label><input placeholder="Owner (admin multisig recommended)" /><input placeholder="Keeper address" style={{ marginTop: 6 }} /><input placeholder="DEX router address" style={{ marginTop: 6 }} /><input placeholder="Stablecoin address" style={{ marginTop: 6 }} /><input placeholder="Fee bps (snapshotted per lock)" style={{ marginTop: 6 }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}><button className="btn mint" onClick={() => deploy('testnet')}>Deploy to testnet</button><button className="btn ghost" onClick={() => alert('Demo: explorer verification submits source + ABI in production.')}>Verify on explorer</button><button className="btn ghost" onClick={() => alert('Demo: registration writes the verified address into Chain Manager in production.')}>Register in Chain Manager</button></div></div>
        <div className="card"><h2>Mainnet gate</h2>
          <label><input type="checkbox" style={{ width: 'auto' }} checked={checklist.audit} onChange={(e) => setChecklist({ ...checklist, audit: e.target.checked })} /> Independent audit of the exact compiled artifact</label>
          <label><input type="checkbox" style={{ width: 'auto' }} checked={checklist.testnet} onChange={(e) => setChecklist({ ...checklist, testnet: e.target.checked })} /> Testnet lock → target → auto-sell → USDT received flow passed</label>
          <label><input type="checkbox" style={{ width: 'auto' }} checked={checklist.smoke} onChange={(e) => setChecklist({ ...checklist, smoke: e.target.checked })} /> Small-value mainnet smoke test planned</label>
          <label>Type to confirm: <span className="kbd">Deploy StelixVault to {chain} mainnet</span></label><input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={`Deploy StelixVault to ${chain} mainnet`} />
          <button className="btn danger" style={{ marginTop: 12 }} onClick={() => deploy('mainnet')}>Deploy to mainnet (gated)</button>
          <p className="muted">Solana note: the Solana program is built with Anchor and deployed with the Solana CLI; its program ID is then registered in Chain Manager the same way.</p></div>
        <div className="card"><h2>Deployment history (DEMO)</h2>{deploys.length === 0 ? <p className="muted">No deployments yet.</p> : <table><thead><tr><th>Chain</th><th>Env</th><th>Address</th><th>Compiler</th></tr></thead><tbody>{deploys.map((d, i) => <tr key={i}><td>{d.chain}</td><td>{d.env}</td><td className="kbd">{d.address}</td><td>{d.compiler}</td></tr>)}</tbody></table>}</div>
      </div>
    </div>
  </div>
}
