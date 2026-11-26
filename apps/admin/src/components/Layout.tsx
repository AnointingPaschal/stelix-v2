import { NavLink, Outlet } from 'react-router-dom'
import { DEMO_NOTICE } from '../lib/api'
const links: [string, string][] = [
  ['/dashboard', 'Dashboard'], ['/studio', 'Contract Studio'], ['/chains', 'Chain Manager'],
  ['/tokens', 'Token / DEX Registry'], ['/keeper', 'Keeper Monitor'], ['/fees', 'Fees and Limits'],
  ['/announcements', 'Announcements'], ['/config', 'App Config and Releases'],
  ['/support', 'Support Lookup'], ['/audit', 'Audit Log and Settings'],
]
export default function Layout() {
  return <div className="layout">
    <aside className="sidebar">
      <div className="brand"><img src="/logo.png" alt="Stelix logo" /><div><b>STELIX</b><small>Admin · v2.0</small></div></div>
      <div className="navsection">Admin</div>
      {links.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>{label}</NavLink>)}
      <div className="navsection">Account</div>
      <NavLink to="/" className="navlink">Sign out</NavLink>
      <p style={{ marginTop: 'auto', fontSize: 11, color: '#7E93B3' }}>Non-custodial: admin can never move user funds. No seed phrases, ever.</p>
    </aside>
    <main className="main">
      <div className="demo">{DEMO_NOTICE}</div>
      <Outlet />
    </main>
  </div>
}
