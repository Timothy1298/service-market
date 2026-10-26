import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  BarChart3, Building2, ChevronDown, CreditCard, Crown, FileText,
  LayoutDashboard, LogOut, Menu, Package, Receipt, Users, Wallet,
  Wrench, User, Plus, X,
} from 'lucide-react'
import { ROUTES } from '../app/routes'
import { apiRequest } from '../services/apiClient'

type UserInfo = { id?: string; fullName: string; role: 'PROVIDER' | 'CUSTOMER' | 'ADMIN' }
type Props = { children: ReactNode; user: UserInfo; onLogout: () => void }
type NavItem = { label: string; to: string; icon: typeof LayoutDashboard }

const providerGroups: Array<{ label: string; items: NavItem[] }> = [
  { label: 'Workspace', items: [{ label: 'Dashboard', to: ROUTES.dashboard, icon: LayoutDashboard }] },
  { label: 'Sales', items: [
    { label: 'Customers', to: ROUTES.customers, icon: Users },
    { label: 'Quotations', to: ROUTES.quotations, icon: FileText },
    { label: 'Jobs', to: ROUTES.jobs, icon: Wrench },
  ] },
  { label: 'Money & stock', items: [
    { label: 'Invoices', to: ROUTES.invoices, icon: Receipt },
    { label: 'Payments', to: ROUTES.payments, icon: Wallet },
    { label: 'Expenses', to: ROUTES.expenses, icon: CreditCard },
    { label: 'Inventory', to: ROUTES.inventory, icon: Package },
    { label: 'Reports', to: ROUTES.reports, icon: BarChart3 },
  ] },
  { label: 'Account', items: [
    { label: 'My profile', to: ROUTES.profile, icon: User },
    { label: 'Business profile', to: ROUTES.businessProfile, icon: Building2 },
    { label: 'Subscription', to: ROUTES.billing, icon: Crown },
  ] },
]

export function AppLayout({ children, user, onLogout }: Props) {
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [quickOpen, setQuickOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [mobileSheet, setMobileSheet] = useState<'money' | 'more' | null>(null)
  const [planLabel, setPlanLabel] = useState('')
  const [planExpiry, setPlanExpiry] = useState<string | null>(null)
  const pageTitle = providerGroups.flatMap(group => group.items).find(item => location.pathname.startsWith(item.to))?.label ?? 'Dashboard'
  const groups = user.role === 'PROVIDER' ? providerGroups : user.role === 'ADMIN'
    ? [
        { label: 'Workspace', items: [{ label: 'Dashboard', to: ROUTES.dashboard, icon: LayoutDashboard }] },
        { label: 'Account', items: [{ label: 'Subscription pricing', to: ROUTES.billing, icon: Crown }, { label: 'My profile', to: ROUTES.profile, icon: User }] },
      ]
    : [
        { label: 'Workspace', items: [{ label: 'Dashboard', to: ROUTES.dashboard, icon: LayoutDashboard }] },
        { label: 'Account', items: [{ label: 'My profile', to: ROUTES.profile, icon: User }] },
      ]
  const closeMenus = () => { setDrawerOpen(false); setQuickOpen(false); setAccountOpen(false) }
  useEffect(() => {
    if (user.role !== 'PROVIDER') return
    apiRequest<{ subscription: { status: string; expiresAt?: string | null } }>('/billing')
      .then(({ subscription }) => {
        setPlanLabel(subscription.status === 'ACTIVE' ? 'Pro plan' : subscription.status === 'PENDING' ? 'Payment pending' : subscription.status === 'EXPIRED' ? 'Plan expired' : 'Free plan')
        setPlanExpiry(subscription.status === 'ACTIVE' ? subscription.expiresAt ?? null : null)
      })
      .catch(() => { setPlanLabel('') })
  }, [user.role])

  return <div className="fq-shell">
    {drawerOpen && <button className="fq-backdrop" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />}
    <aside className={`fq-sidebar${drawerOpen ? ' is-open' : ''}`} aria-label="Main navigation">
      <Link className="fq-brand" to={ROUTES.dashboard} onClick={closeMenus}>
        <span className="fq-brand-mark">F</span><span>Fundi<b>Quote</b></span>
      </Link>
      <nav className="fq-nav">
        {groups.map(group => <section className="fq-nav-group" key={group.label}>
          <p>{group.label}</p>
          {group.items.map(item => {
            const Icon = item.icon
            return <NavLink key={item.to} to={item.to} title={item.label} onClick={closeMenus} className={({ isActive }) => `fq-nav-link${isActive ? ' active' : ''}`}>
              <Icon size={20} strokeWidth={1.75} aria-hidden="true" /><span>{item.label}</span>
            </NavLink>
          })}
        </section>)}
      </nav>
      {user.role === 'PROVIDER' && planLabel && <div className="fq-plan-card"><strong>{planLabel}</strong>{planExpiry && <span>Active until {new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(planExpiry))}</span>}<Link to={ROUTES.billing} onClick={closeMenus}>{planLabel === 'Pro plan' ? 'Manage plan' : 'Upgrade'}</Link></div>}
      <div className="fq-user-row">
        <span className="fq-avatar" aria-hidden="true">{user.fullName.trim().charAt(0).toUpperCase()}</span>
        <span className="fq-user-copy"><b>{user.fullName}</b><small>{user.role === 'PROVIDER' ? 'Service provider' : user.role.toLowerCase()}</small></span>
        <button className="fq-icon-button fq-logout" type="button" onClick={onLogout} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
      </div>
    </aside>
    <main className="workspace fq-workspace">
      <header className="fq-topbar">
        <button className="fq-icon-button fq-menu-trigger" type="button" onClick={() => setDrawerOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
        <div className="fq-mobile-title">{pageTitle}</div>
        <div className="fq-topbar-actions">
          {user.role === 'PROVIDER' && <div className="fq-menu-wrap">
            <button className="fq-new-button" type="button" aria-expanded={quickOpen} onClick={() => setQuickOpen(open => !open)}><Plus size={17} />New<ChevronDown size={15} /></button>
            {quickOpen && <div className="fq-popover" role="menu">
              <Link to={`${ROUTES.quotations}/new`} role="menuitem" onClick={closeMenus}><FileText />New quotation</Link>
              <Link to={ROUTES.customers} role="menuitem" onClick={closeMenus}><Users />New customer</Link>
              <Link to={`${ROUTES.invoices}/new`} role="menuitem" onClick={closeMenus}><Receipt />New invoice</Link>
              <Link to={ROUTES.payments} role="menuitem" onClick={closeMenus}><Wallet />Record payment</Link>
              <Link to={ROUTES.expenses} role="menuitem" onClick={closeMenus}><CreditCard />Add expense</Link>
            </div>}
          </div>}
          <div className="fq-menu-wrap">
            <button className="fq-account-button" type="button" aria-expanded={accountOpen} onClick={() => setAccountOpen(open => !open)}>
              <span className="fq-avatar">{user.fullName.trim().charAt(0).toUpperCase()}</span><span>{user.fullName}</span><ChevronDown size={15} />
            </button>
            {accountOpen && <div className="fq-popover fq-account-menu" role="menu">
              <Link to={ROUTES.profile} role="menuitem" onClick={closeMenus}><User />My profile</Link>
              {user.role === 'PROVIDER' && <><Link to={ROUTES.businessProfile} role="menuitem" onClick={closeMenus}><Building2 />Business profile</Link><Link to={ROUTES.billing} role="menuitem" onClick={closeMenus}><Crown />Subscription</Link></>}
              <button role="menuitem" type="button" onClick={() => { closeMenus(); onLogout() }}><LogOut />Sign out</button>
            </div>}
          </div>
        </div>
      </header>
      <div className="workspace-content fq-content" id="main-content" tabIndex={-1}>{children}</div>
      {user.role === 'PROVIDER' && <nav className="fq-mobile-tabs" aria-label="Mobile navigation">
        <NavLink to={ROUTES.dashboard}><LayoutDashboard /><span>Home</span></NavLink>
        <NavLink to={ROUTES.quotations}><FileText /><span>Quotes</span></NavLink>
        <NavLink to={ROUTES.jobs}><Wrench /><span>Jobs</span></NavLink>
        <button type="button" aria-expanded={mobileSheet === 'money'} onClick={() => setMobileSheet('money')}><Wallet /><span>Money</span></button>
        <button type="button" aria-expanded={mobileSheet === 'more'} onClick={() => setMobileSheet('more')}><Menu /><span>More</span></button>
      </nav>}
      {mobileSheet && <div className="fq-sheet-layer" onClick={() => setMobileSheet(null)}>
        <section className="fq-mobile-sheet" aria-label={mobileSheet === 'money' ? 'Money navigation' : 'More navigation'} onClick={event => event.stopPropagation()}>
          <div className="fq-sheet-grip" />
          <div className="fq-sheet-heading"><b>{mobileSheet === 'money' ? 'Money' : 'More'}</b><button type="button" aria-label="Close menu" onClick={() => setMobileSheet(null)}><X size={19} /></button></div>
          {(mobileSheet === 'money' ? [
            { label: 'Invoices', to: ROUTES.invoices, Icon: Receipt }, { label: 'Payments', to: ROUTES.payments, Icon: Wallet },
            { label: 'Expenses', to: ROUTES.expenses, Icon: CreditCard }, { label: 'Reports', to: ROUTES.reports, Icon: BarChart3 },
          ] : [
            { label: 'Customers', to: ROUTES.customers, Icon: Users }, { label: 'Inventory', to: ROUTES.inventory, Icon: Package },
            { label: 'My profile', to: ROUTES.profile, Icon: User }, { label: 'Business profile', to: ROUTES.businessProfile, Icon: Building2 },
            { label: 'Subscription', to: ROUTES.billing, Icon: Crown },
          ]).map(({ label: itemLabel, to, Icon }) => <Link className="fq-sheet-link" to={to} key={to} onClick={() => setMobileSheet(null)}><Icon size={19} />{itemLabel}</Link>)}
          {mobileSheet === 'more' && <button type="button" className="fq-sheet-link" onClick={() => { setMobileSheet(null); onLogout() }}><LogOut size={19} />Sign out</button>}
        </section>
      </div>}
    </main>
  </div>
}
