import { useMemo, useState } from 'react'
import { BadgeCheck, Code2, FileCode2, Hammer, Rocket, ShieldAlert } from 'lucide-react'
import source from '../contracts/StelixVault.sol?raw'
import { SOLC_PINNED } from '../lib/types'
import { DemoPill, PageHeader, SectionTitle } from '../components/ui'

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

  return (
    <div>
      <PageHeader
        icon={<Code2 />}
        title="Contract Studio"
        sub={`Write / edit, compile, test-deploy and mainnet-deploy StelixVault. Source is mirrored to the private GitHub repo on every save, so code is never lost again. Pinned compiler: solc ${SOLC_PINNED}.`}
        pill={<DemoPill />}
      />
      <div className="notice alert">
        <ShieldAlert />
        <span><b>Mainnet deploy is gated:</b> audit status, testnet flow passed, small-value smoke test, typed confirmation naming the chain. Existing locks stay under their original contract — improvements ship as a new deployment for new locks only.</span>
      </div>
      <div className="grid grid2">
        <div className="card">
          <SectionTitle icon={<FileCode2 />}>Source — StelixVault.sol</SectionTitle>
          <textarea value={src} onChange={(e) => setSrc(e.target.value)} rows={22} style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12 }} spellCheck={false} />
          <p className="field-hint">Source size: {sizeKb} KB · Version history with diffs is kept in production (D1 + R2 + GitHub mirror).</p>
          <button className="btn block" onClick={compile}><Hammer />Compile (solc {SOLC_PINNED})</button>
          {compileOut && <pre>{compileOut}</pre>}
        </div>
        <div>
          <div className="card">
            <SectionTitle icon={<Rocket />}>Deploy</SectionTitle>
            <label>Chain</label>
            <select value={chain} onChange={(e) => setChain(e.target.value)}>
              <option>Arc</option><option>BNB Chain</option><option>Base</option><option>Ethereum</option><option>Polygon</option>
            </select>
            <label>Constructor / initialiser parameters</label>
            <input placeholder="Owner (admin multisig recommended)" />
            <input placeholder="Keeper address" style={{ marginTop: 8 }} />
            <input placeholder="DEX router address" style={{ marginTop: 8 }} />
            <input placeholder="Stablecoin address" style={{ marginTop: 8 }} />
            <input placeholder="Fee bps (snapshotted per lock)" style={{ marginTop: 8 }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button className="btn mint" onClick={() => deploy('testnet')}><Rocket />Deploy to testnet</button>
              <button className="btn ghost" onClick={() => alert('Demo: explorer verification submits source + ABI in production.')}>Verify on explorer</button>
              <button className="btn ghost" onClick={() => alert('Demo: registration writes the verified address into Chain Manager in production.')}>Register in Chain Manager</button>
            </div>
          </div>
          <div className="card">
            <SectionTitle icon={<ShieldAlert />}>Mainnet gate</SectionTitle>
            <label className="check-row"><input type="checkbox" checked={checklist.audit} onChange={(e) => setChecklist({ ...checklist, audit: e.target.checked })} />Independent audit of the exact compiled artifact</label>
            <label className="check-row"><input type="checkbox" checked={checklist.testnet} onChange={(e) => setChecklist({ ...checklist, testnet: e.target.checked })} />Testnet lock → target → auto-sell → USDT received flow passed</label>
            <label className="check-row"><input type="checkbox" checked={checklist.smoke} onChange={(e) => setChecklist({ ...checklist, smoke: e.target.checked })} />Small-value mainnet smoke test planned</label>
            <label>Type to confirm: <span className="kbd">Deploy StelixVault to {chain} mainnet</span></label>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={`Deploy StelixVault to ${chain} mainnet`} />
            <button className="btn danger block" style={{ marginTop: 14 }} onClick={() => deploy('mainnet')}><Rocket />Deploy to mainnet (gated)</button>
            <p className="field-hint">Solana note: the Solana program is built with Anchor and deployed with the Solana CLI; its program ID is then registered in Chain Manager the same way.</p>
          </div>
          <div className="card">
            <SectionTitle icon={<BadgeCheck />}>Deployment history</SectionTitle>
            {deploys.length === 0 ? (
              <p className="empty">No deployments yet.</p>
            ) : (
              <div className="table-wrap">
                <table className="rtable">
                  <thead><tr><th>Chain</th><th>Env</th><th>Address</th><th>Compiler</th></tr></thead>
                  <tbody>
                    {deploys.map((d, i) => (
                      <tr key={i}>
                        <td data-label="Chain">{d.chain}</td>
                        <td data-label="Env"><span className={'badge ' + (d.env === 'mainnet' ? 'b-red' : 'b-blue')}>{d.env}</span></td>
                        <td data-label="Address"><span className="kbd">{d.address}</span></td>
                        <td data-label="Compiler">{d.compiler}</td>
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
