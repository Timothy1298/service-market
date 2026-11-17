import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Bell, BriefcaseBusiness, FileText, Heart, Home, Menu, MessageCircle, Search, UserRound, WalletCards, X } from 'lucide-react'

const links = [
  ['/customer', 'Home', Home], ['/customer/discover', 'Find services', Search], ['/customer/requests', 'My requests', FileText], ['/customer/quotations', 'Quotations', FileText], ['/customer/jobs', 'My jobs', BriefcaseBusiness], ['/customer/messages', 'Messages', MessageCircle], ['/customer/invoices', 'Invoices & payments', WalletCards], ['/customer/favorites', 'Saved providers', Heart], ['/customer/notifications', 'Notifications', Bell], ['/customer/profile', 'Profile & settings', UserRound],
] as const
export function CustomerPortalLayout({ children, onLogout, name }: { children: ReactNode; onLogout: () => void; name: string }) {
  const [open, setOpen] = useState(false); const location = useLocation()
  return <div className="customer-portal"><aside className={`customer-sidebar${open ? ' is-open' : ''}`}><Link className="customer-brand" to="/customer"><span>F</span> Fundi<strong>Quote</strong></Link><p className="customer-nav-label">YOUR SERVICES</p><nav>{links.map(([path, label, Icon]) => <Link onClick={() => setOpen(false)} className={location.pathname === path || (path !== '/customer' && location.pathname.startsWith(path + '/')) ? 'active' : ''} key={path} to={path}><Icon size={18}/>{label}</Link>)}</nav><div className="customer-sidebar-bottom"><div><b>{name}</b><small>Customer account</small></div><button onClick={onLogout}>Sign out</button></div></aside><div className="customer-main"><header className="customer-topbar"><button className="customer-menu-button" aria-label={open ? 'Close navigation' : 'Open navigation'} onClick={() => setOpen(!open)}>{open ? <X/> : <Menu/>}</button><span>Services, made simple.</span><Link to="/customer/profile" aria-label="Your profile"><UserRound size={19}/></Link></header>{children}</div>{open && <button className="customer-scrim" aria-label="Close navigation" onClick={() => setOpen(false)}/>}</div>
}
