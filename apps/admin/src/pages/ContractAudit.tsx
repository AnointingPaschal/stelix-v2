import { useEffect, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, FileText, Play, ShieldAlert, ShieldCheck,
} from 'lucide-react'
import source from '../contracts/StelixVault.sol?raw'
import { api, type AuditGate } from '../lib/api'
import type { AuditFinding, AuditRun, ExternalAudit } from '../lib/types'
import { LiveNote, PageHeader, SectionTitle } from '../components/ui'
import { AlertModal } from '../components/AlertModal'

const sevBadge = (s: string) =>
  s === 'critical' ? 'b-red' : s === 'high' ? 'b-red' : s === 'medium' ? 'b-amber' : s === 'low' ? 'b-blue' : 'b-grey'

function parseRun(r: AuditRun): { findings: AuditFinding[]; counts: Record<string, number> } {
  let findings: AuditFinding[] = []
  let counts: Record<string, number> = {}
  try { findings = JSON.parse(r.findings_json) as AuditFinding[] } catch { findings = [] }
  try { counts = JSON.parse(r.counts_json) as Record<string, number> } catch { counts = {} }
  return { findings, counts }
}

export default function ContractAudit() {
  const [runs, setRuns] = useState<AuditRun[]>([])
  const [latest, setLatest] = useState<AuditRun | null>(null)
  const [externals, setExternals] = useState<ExternalAudit[]>([])
  const [gate, setGate] = useState<AuditGate | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [ext, setExt] = useState({ auditor: '', auditDate: '', scope: '', verdict: 'pass', reportUrl: '', reportRef: '' })

  const load = () => {
    api.getAuditRuns().then((d) => {
      setRuns(d.runs)
      setLatest(d.runs[0] ?? null)
    }).catch((e: Error) => setError(e.message))
    api.getExternalAudits().then((d) => setExternals(d.audits)).catch(() => undefined)
    api.getAuditGate().then(setGate).catch(() => undefined)
  }
  useEffect(load, [])

  const runAudit = async () => {
    setError(''); setNotice(''); setBusy(true)
    try {
      const r = await api.runContractAudit(source)
      setNotice(`Automated audit run ${r.runId ?? ''} stored: verdict ${r.verdict}, ${r.openCriticalHigh} open critical/high finding(s). This is a static check, not a human audit.`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Audit run failed.') }
    setBusy(false)
  }

  const setFinding = async (findingId: string, status: string) => {
    if (!latest) return
    try {
      const r = await api.setFindingStatus(latest.id, findingId, status)
      setNotice(`Finding ${findingId} marked ${status}. Run verdict is now ${r.verdict}.`)
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update finding.') }
  }

  const recordExternal = async () => {
    setError(''); setNotice('')
    if (!ext.auditor.trim() || !ext.auditDate || !ext.scope.trim()) { setError('Auditor, date and scope are required.'); return }
    if (!ext.reportUrl.trim() && !ext.reportRef.trim()) { setError('A report link or a stored report reference is required — do not record an audit without evidence.'); return }
    setBusy(true)
    try {
      await api.recordExternalAudit({
        auditor: ext.auditor.trim(), auditDate: ext.auditDate, scope: ext.scope.trim(),
        verdict: ext.verdict, reportUrl: ext.reportUrl.trim() || null, reportRef: ext.reportRef.trim() || null,
      })
      setNotice('Independent audit recorded.')
      setExt({ auditor: '', auditDate: '', scope: '', verdict: 'pass', reportUrl: '', reportRef: '' })
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not record audit.') }
    setBusy(false)
  }

  const deleteExternal = async (id: number) => {
    try {
      await api.deleteExternalAudit(id)
      setNotice('Independent audit record deleted.')
      load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not delete record.') }
  }

  const { findings, counts } = latest ? parseRun(latest) : { findings: [] as AuditFinding[], counts: {} as Record<string, number> }

  return (
    <div>
      <PageHeader
        icon={<ShieldCheck />}
        title="Contract Audit"
        sub="Automated audit of the exact StelixVault source and compiled artifact, plus the record of independent human audits. The mainnet gate only passes on a real audit record or a passing automated audit with zero open critical/high findings."
        pill={<LiveNote />}
        actions={
          <button className="btn mint" onClick={runAudit} disabled={busy}>
            <Play />{busy ? 'Running…' : 'Run automated audit'}
          </button>
        }
      />
      <div className="notice alert">
        <ShieldAlert />
        <span><b>Automated audit is NOT a substitute for an independent human audit.</b> The checker below finds known dangerous patterns in the exact source, but it cannot reason about economic attacks, oracle design or business logic the way a human auditor can. Mainnet still needs a real independent audit before real user funds are at risk.</span>
      </div>
      <AlertModal kind="error" message={error} onClose={() => setError('')} />
      <AlertModal kind="success" message={notice} onClose={() => setNotice('')} />
      <AlertModal
        kind="confirm"
        message={confirmDeleteId !== null ? 'Delete this independent audit record?' : null}
        confirmLabel="Delete"
        onConfirm={() => { if (confirmDeleteId !== null) void deleteExternal(confirmDeleteId) }}
        onClose={() => setConfirmDeleteId(null)}
      />

      <div className="card">
        <SectionTitle icon={<ShieldCheck />}>
          Automated audit — latest run {latest ? `#${latest.id} · ${latest.created_at}` : ''}
        </SectionTitle>
        {!latest ? (
          <p className="empty">No automated audit run yet. Run one to check the exact StelixVault source in the repo.</p>
        ) : (
          <>
            <p className="muted">
              Compiler: {latest.compiler} · Source sha256: <span className="kbd">{latest.source_hash.slice(0, 16)}…</span> · Verdict:{' '}
              <span className={'badge ' + (latest.verdict === 'pass' ? 'b-green' : 'b-red')}>{latest.verdict}</span>
            </p>
            <p className="muted">
              Findings — critical: {counts.critical ?? 0} · high: {counts.high ?? 0} · medium: {counts.medium ?? 0} · low: {counts.low ?? 0} · info: {counts.info ?? 0}
            </p>
            {findings.length === 0 ? (
              <p className="empty">No findings — the checker found no issues in this source.</p>
            ) : (
              <div className="table-wrap">
                <table className="rtable">
                  <thead><tr><th>Severity</th><th>Finding</th><th>Location</th><th>Fix status</th></tr></thead>
                  <tbody>
                    {findings.map((f) => (
                      <tr key={f.id}>
                        <td data-label="Severity"><span className={'badge ' + sevBadge(f.severity)}>{f.severity}</span></td>
                        <td data-label="Finding">
                          <b>{f.title}</b>
                          <p className="muted" style={{ margin: '4px 0' }}>{f.description}</p>
                          <p className="muted" style={{ margin: 0 }}><b>Fix:</b> {f.recommendation}</p>
                        </td>
                        <td data-label="Location"><span className="kbd">{f.file}:{f.line || '—'}</span><br /><span className="muted small">{f.rule}</span></td>
                        <td data-label="Fix status">
                          <select value={f.status} onChange={(e) => setFinding(f.id, e.target.value)}>
                            <option value="open">open</option>
                            <option value="mitigated">mitigated</option>
                            <option value="accepted">accepted</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="field-hint">Mark a finding mitigated only after the fix is in the source and a new audit run confirms it; accepted means the risk was reviewed and consciously accepted — the reason belongs in the Audit Log.</p>
          </>
        )}
      </div>

      <div className="card">
        <SectionTitle icon={<FileText />}>Audit runs</SectionTitle>
        {runs.length === 0 ? (
          <p className="empty">No runs recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>Run</th><th>When</th><th>Compiler</th><th>Verdict</th><th>Source hash</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Run">#{r.id}</td>
                    <td data-label="When">{r.created_at}</td>
                    <td data-label="Compiler">{r.compiler}</td>
                    <td data-label="Verdict"><span className={'badge ' + (r.verdict === 'pass' ? 'b-green' : 'b-red')}>{r.verdict}</span></td>
                    <td data-label="Source hash"><span className="kbd">{r.source_hash.slice(0, 16)}…</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid2">
        <div className="card">
          <SectionTitle icon={<FileText />}>Independent audits</SectionTitle>
          {externals.length === 0 ? (
            <p className="empty">No independent audit recorded. StelixVault has not been independently audited yet — do not claim otherwise.</p>
          ) : (
            externals.map((a) => (
              <div className="row-item" key={a.id}>
                <div className="row-icon"><FileText /></div>
                <div className="row-body">
                  <b>{a.auditor} — {a.audit_date}</b>
                  <p className="muted">{a.scope}</p>
                  <p className="muted">
                    Verdict: <span className={'badge ' + (a.verdict === 'pass' ? 'b-green' : a.verdict === 'fail' ? 'b-red' : 'b-amber')}>{a.verdict}</span>{' '}
                    {a.report_url && <a href={a.report_url} target="_blank" rel="noreferrer">Report link</a>}
                    {a.report_ref && <span> · Ref: {a.report_ref}</span>}
                  </p>
                </div>
                <div className="row-end"><button className="btn ghost" onClick={() => setConfirmDeleteId(a.id)}>Delete</button></div>
              </div>
            ))
          )}
          <h3 style={{ marginTop: 16 }}>Record an independent audit</h3>
          <label>Auditor name</label>
          <input value={ext.auditor} onChange={(e) => setExt({ ...ext, auditor: e.target.value })} placeholder="e.g. Audit Firm Ltd" />
          <label>Audit date</label>
          <input type="date" value={ext.auditDate} onChange={(e) => setExt({ ...ext, auditDate: e.target.value })} />
          <label>Scope (contract + commit/artifact)</label>
          <input value={ext.scope} onChange={(e) => setExt({ ...ext, scope: e.target.value })} placeholder="StelixVault.sol, solc 0.8.24, artifact sha256…" />
          <label>Verdict</label>
          <select value={ext.verdict} onChange={(e) => setExt({ ...ext, verdict: e.target.value })}>
            <option value="pass">pass</option>
            <option value="passed-with-notes">passed-with-notes</option>
            <option value="fail">fail</option>
          </select>
          <label>Report link (URL)</label>
          <input value={ext.reportUrl} onChange={(e) => setExt({ ...ext, reportUrl: e.target.value })} placeholder="https://…" />
          <label>Report reference (stored copy, e.g. R2 key)</label>
          <input value={ext.reportRef} onChange={(e) => setExt({ ...ext, reportRef: e.target.value })} placeholder="r2://stelix-audits/… or D1 ref" />
          <button className="btn mint block" style={{ marginTop: 12 }} onClick={recordExternal} disabled={busy}>Record independent audit</button>
        </div>
        <div className="card">
          <SectionTitle icon={<ShieldCheck />}>Mainnet gate — audit</SectionTitle>
          <p className="muted">
            {gate === null
              ? 'Loading gate status…'
              : gate.gatePass
                ? 'Audit gate PASSED: a passing automated audit with zero open critical/high findings, or a recorded passing independent audit, is on file.'
                : 'Audit gate NOT passed. Run the automated audit and clear every critical/high finding, or record a passing independent audit.'}
          </p>
          <p className="muted">Automated pass: {gate?.automated.pass ? 'yes' : 'no'} (open critical/high: {gate?.automated.openCriticalHigh ?? '—'}) · Independent audit pass: {gate?.external.pass ? 'yes' : 'no'}.</p>
          <p className="field-hint">The Contract Studio mainnet checkbox reads this gate from the server — it cannot be ticked by hand in the UI.</p>
        </div>
      </div>
    </div>
  )
}
