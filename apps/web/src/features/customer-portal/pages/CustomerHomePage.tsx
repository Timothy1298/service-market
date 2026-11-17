import { ArrowRight, BriefcaseBusiness, FileText, Search, WalletCards } from 'lucide-react'
import { Link } from 'react-router-dom'
import { customerPortalApi } from '../services/customerPortalApi'
import { usePortalData } from '../hooks'
import { PortalPage, PortalPanel, PortalState } from '../components/PortalPage'
export default function CustomerHomePage({ name }: { name: string }) {
 const { data, loading, error } = usePortalData(() => customerPortalApi.dashboard())
 const stats = data?.stats ?? { requests: 0, quotations: 0, jobs: 0, invoices: 0 }
 return <PortalPage title={`Good day, ${name.split(' ')[0]}`} subtitle="What service can we help you arrange today?" action={<Link className="button" to="/customer/discover"><Search size={17}/> Find a service</Link>}>
  <div className="customer-welcome"><div><p className="eyebrow">YOUR NEXT STEP</p><h2>Find a trusted professional for the work you need.</h2><p>Tell providers what you need, compare their quotes and keep everything about the job in one place.</p><Link className="button" to="/customer/requests/new">Request a quote <ArrowRight size={17}/></Link></div><div className="customer-welcome-art"><BriefcaseBusiness size={58}/></div></div>
  <PortalState loading={loading} error={error}/><div className="customer-stat-grid">{[['Open requests', stats.requests, '/customer/requests', FileText], ['Quotes to review', stats.quotations, '/customer/quotations', FileText], ['Active jobs', stats.jobs, '/customer/jobs', BriefcaseBusiness], ['Invoices due', stats.invoices, '/customer/invoices', WalletCards]].map(([label, value, href, Icon]: any) => <Link className="customer-stat" to={href} key={label}><span><Icon size={18}/></span><small>{label}</small><b>{value}</b></Link>)}</div>
  <PortalPanel title="Recent service requests" action={<Link to="/customer/requests">View all <ArrowRight size={15}/></Link>}><PortalState loading={loading} error={error} empty={!data?.recentRequests?.length ? 'Your requests and provider responses will appear here.' : undefined}><div className="customer-record-list">{data?.recentRequests?.map((item: any) => <Link className="customer-record" to={`/customer/requests/${item.id}`} key={item.id}><span><b>{item.title}</b><small>{item.category.name} · {new Date(item.createdAt).toLocaleDateString()}</small></span><strong>{item.quotations?.length ?? 0} quotes</strong></Link>)}</div></PortalState></PortalPanel>
 </PortalPage>
}
