import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, ChevronsLeft, ChevronsRight, Coins, LayoutDashboard, Link2, LogOut,
  Megaphone, Menu, Percent, Code2, Search, Settings, ShieldCheck, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api } from '../lib/api'

const links: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/studio', label: 'Contract Studio', icon: Code2 },
  { to: '/chains', label: 'Chain Manager', icon: Link2 },
  { to: '/tokens', label: 'Token / DEX Registry', icon: Coins },
  { to: '/keeper', label: 'Keeper Monitor', icon: Activity },
  { to: '/fees', label: 'Fees and Limits', icon: Percent },
  { to: '/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/config', label: 'App Config and Releases', icon: Settings },
  { to: '/support', label: 'Support Lookup', icon: Search },
  { to: '/audit', label: 'Audit Log and Settings', icon: ShieldCheck },
]

// Bottom nav: the five most-used sections on a phone.
const bottomLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/studio', label: 'Studio', icon: Code2 },
  { to: '/chains', label: 'Chains', icon: Link2 },
  { to: '/keeper', label: 'Keeper', icon: Activity },
  { to: '/audit', label: 'Audit', icon: ShieldCheck },
]

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="navsection">Admin</div>
      {links.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} onClick={onNavigate} className={({ isActive }) => 'navlink' + (isActive ? ' active' : '')}>
          <Icon /><span>{label}</span>
        </NavLink>
      ))}
      <div className="navsection">Account</div>
      <SignOutButton />
    </>
  )
}

function SignOutButton() {
  const nav = useNavigate()
  return (
    <button
      className="navlink"
      onClick={async () => {
        await api.logout()
        nav('/', { replace: true })
      }}
    >
      <LogOut /><span>Sign out</span>
    </button>
  )
}

export default function Layout() {
  const nav = useNavigate()
  const loc = useLocation()
  const [checked, setChecked] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    api.getSession().then((s) => {
      if (!s.authenticated) nav('/', { replace: true })
      else setChecked(true)
    })
  }, [nav])

  // Close the drawer whenever the route changes; lock body scroll while open.
  useEffect(() => { setDrawerOpen(false) }, [loc.pathname])
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [drawerOpen])

  if (!checked) return <p className="loading">Checking session…</p>

  return (
    <div className={'layout' + (collapsed ? ' collapsed' : '')}>
      {/* Mobile top bar */}
      <header className="topbar">
        <button className="icon-btn" aria-label="Open menu" onClick={() => setDrawerOpen(true)}>
          <Menu />
        </button>
        <div className="brand-mini">
          <img src="/logo.png" alt="Stelix logo" />
          <div><b>STELIX</b><small>Admin · v2.0</small></div>
        </div>
        <span className="pill pill-live"><span className="dot" />Live</span>
      </header>

      {/* Desktop sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.png" alt="Stelix logo" />
          <div><b>STELIX</b><small>Admin · v2.0</small></div>
        </div>
        <button
          className="navlink collapse-btn"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
          <span>{collapsed ? '' : 'Collapse'}</span>
        </button>
        <NavItems />
        <p className="drawer-foot">Non-custodial: admin can never move user funds. No seed phrases, ever.</p>
      </aside>

      {/* Mobile drawer */}
      <div className={'drawer-overlay' + (drawerOpen ? ' open' : '')} onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      <nav className={'drawer' + (drawerOpen ? ' open' : '')} aria-label="Admin navigation">
        <div className="brand">
          <img src="/logo.png" alt="Stelix logo" />
          <div><b>STELIX</b><small>Admin · v2.0</small></div>
          <button className="icon-btn drawer-close" aria-label="Close menu" onClick={() => setDrawerOpen(false)}>
            <X />
          </button>
        </div>
        <NavItems onNavigate={() => setDrawerOpen(false)} />
        <p className="drawer-foot">Non-custodial: admin can never move user funds. No seed phrases, ever.</p>
      </nav>

      <main className="main">
        <div className="main-inner">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="bottomnav" aria-label="Primary">
        {bottomLinks.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon /><span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
