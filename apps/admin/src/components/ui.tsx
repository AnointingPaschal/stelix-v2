import type { ReactNode } from 'react'
import { FlaskConical, Radio } from 'lucide-react'

export function LivePill() {
  return <span className="pill pill-live"><span className="dot" />Live</span>
}
export function DemoPill() {
  return <span className="pill pill-demo"><FlaskConical />Demo</span>
}
export function LiveNote() {
  return (
    <span className="pill pill-live" title="Reads live from D1">
      <Radio />Live · D1
    </span>
  )
}

export function PageHeader(props: {
  icon: ReactNode
  title: string
  sub: string
  pill?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="page-head">
      <div className="page-title">
        <div className="page-icon">{props.icon}</div>
        <div style={{ minWidth: 0 }}>
          <h1>{props.title}</h1>
          <p className="muted">{props.sub}</p>
          {props.pill && <div style={{ marginTop: 8 }}>{props.pill}</div>}
        </div>
      </div>
      {props.actions && <div className="page-actions">{props.actions}</div>}
    </div>
  )
}

export function StatCard(props: {
  icon: ReactNode
  label: string
  value: string
  tone?: 'mint' | 'navy' | 'amber' | 'red'
  pill?: ReactNode
  smallValue?: boolean
}) {
  return (
    <div className="card stat">
      <div className="stat-top">
        <div className={'stat-icon ' + (props.tone ?? 'mint')}>{props.icon}</div>
        {props.pill}
      </div>
      <b className={props.smallValue ? 'small-num' : ''}>{props.value}</b>
      <span>{props.label}</span>
    </div>
  )
}

export function SectionTitle(props: { icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <h2 style={{ justifyContent: 'space-between' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{props.icon}{props.children}</span>
      {props.right}
    </h2>
  )
}
