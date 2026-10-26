import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, FileText, Mail, MapPin, MessageCircle, Receipt, Wallet } from 'lucide-react'
import { formatDate, formatKES } from '../../../lib/format'
import { apiRequest, errorMessage } from '../../../services/apiClient'
import './CustomerDetailPage.css'

type CustomerRecord = {
  id: string; name: string; phone: string; email?: string | null; billingAddress?: string | null; projectLocation?: string | null; notes?: string | null; createdAt: string
  quotations: Array<{ id: string; quotationNumber: string; title: string; status: string; grandTotal: number | string; createdAt: string }>
  jobs: Array<{ id: string; jobNumber: string; title: string; status: string; createdAt: string }>
  invoices: Array<{ id: string; invoiceNumber: string; status: string; grandTotal: number | string; amountPaid: number | string; issueDate?: string | null; dueDate?: string | null }>
}
type Tab = 'overview' | 'quotations' | 'jobs' | 'invoices'

export default function CustomerDetailPage({ id }: { id: string }) {
  const [customer, setCustomer] = useState<CustomerRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('overview')

  useEffect(() => {
    let active = true
    setLoading(true)
    apiRequest<{ customer: CustomerRecord }>(`/customers/${id}`).then(result => { if (active) setCustomer(result.customer) })
      .catch(cause => { if (active) setError(errorMessage(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  const totals = useMemo(() => {
    const quotes = customer?.quotations.reduce((sum, item) => sum + Number(item.grandTotal), 0) ?? 0
    const invoiced = customer?.invoices.filter(item => item.status !== 'DRAFT' && item.status !== 'CANCELLED').reduce((sum, item) => sum + Number(item.grandTotal), 0) ?? 0
    const outstanding = customer?.invoices.filter(item => !['DRAFT', 'CANCELLED', 'PAID'].includes(item.status)).reduce((sum, item) => sum + Math.max(0, Number(item.grandTotal) - Number(item.amountPaid)), 0) ?? 0
    return { quotes, invoiced, outstanding }
  }, [customer])

  if (loading) return <main className="customer-detail"><div className="customer-detail__loading" /></main>
  if (error || !customer) return <main className="customer-detail"><a className="customer-detail__back" href="#/app/customers"><ArrowLeft size={17} />Customers</a><section className="customer-detail__notice" role="alert">{error || 'Customer not found'} <a href="#/app/customers">Return to customers</a></section></main>

  const phone = customer.phone.replace(/\D/g, '').replace(/^0/, '254')
  const tabs: Array<{ key: Tab; label: string; count?: number }> = [{ key: 'overview', label: 'Overview' }, { key: 'quotations', label: 'Quotations', count: customer.quotations.length }, { key: 'jobs', label: 'Jobs', count: customer.jobs.length }, { key: 'invoices', label: 'Invoices', count: customer.invoices.length }]
  return <main className="customer-detail">
    <a className="customer-detail__back" href="#/app/customers"><ArrowLeft size={17} />Customers</a>
    <header className="customer-detail__header"><span className="customer-detail__avatar">{customer.name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase()}</span><div className="customer-detail__identity"><p className="eyebrow green">CUSTOMER PROFILE</p><h1>{customer.name}</h1><div className="customer-detail__chips"><a href={`tel:${customer.phone}`}><MessageCircle size={15} />{customer.phone}</a>{customer.email && <a href={`mailto:${customer.email}`}><Mail size={15} />{customer.email}</a>}{customer.projectLocation && <span><MapPin size={15} />{customer.projectLocation}</span>}</div></div><div className="customer-detail__actions"><a className="customer-detail__button primary" href={`#/app/quotations/new?customerId=${customer.id}`}><FileText size={16} />New quotation</a><a className="customer-detail__button" href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer"><MessageCircle size={16} />WhatsApp</a></div></header>
    <section className="customer-detail__stats"><article><span><FileText size={18} /></span><small>Quoted total</small><strong>{formatKES(totals.quotes)}</strong></article><article><span><Receipt size={18} /></span><small>Invoiced total</small><strong>{formatKES(totals.invoiced)}</strong></article><article><span><Wallet size={18} /></span><small>Outstanding</small><strong>{formatKES(totals.outstanding)}</strong></article></section>
    <section className="customer-detail__panel"><nav className="customer-detail__tabs" aria-label="Customer details">{tabs.map(item => <button type="button" key={item.key} className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}>{item.label}{item.count !== undefined && <small>{item.count}</small>}</button>)}</nav>
      {tab === 'overview' && <div className="customer-detail__overview"><div><h2>Contact details</h2><dl><dt>Phone</dt><dd>{customer.phone}</dd><dt>Email</dt><dd>{customer.email || 'Not provided'}</dd><dt>Project location</dt><dd>{customer.projectLocation || 'Not provided'}</dd><dt>Billing address</dt><dd>{customer.billingAddress || 'Not provided'}</dd><dt>Customer since</dt><dd>{formatDate(customer.createdAt)}</dd></dl></div><div><h2>Notes</h2><p>{customer.notes || 'No notes have been added for this customer.'}</p></div></div>}
      {tab === 'quotations' && <RecordList rows={customer.quotations.map(item => ({ id: item.id, title: item.quotationNumber, subtitle: `${item.title} · ${formatDate(item.createdAt)}`, status: item.status, value: formatKES(item.grandTotal), href: `/app/quotations/${item.id}` }))} empty="No quotations for this customer yet." />}
      {tab === 'jobs' && <RecordList rows={customer.jobs.map(item => ({ id: item.id, title: item.jobNumber, subtitle: `${item.title} · ${formatDate(item.createdAt)}`, status: item.status, href: `/app/jobs/${item.id}` }))} empty="No jobs for this customer yet." />}
      {tab === 'invoices' && <RecordList rows={customer.invoices.map(item => ({ id: item.id, title: item.invoiceNumber, subtitle: `${item.issueDate ? formatDate(item.issueDate) : 'Draft'} · Balance ${formatKES(Math.max(0, Number(item.grandTotal) - Number(item.amountPaid)))}`, status: item.status, value: formatKES(item.grandTotal), href: `/app/invoices/${item.id}` }))} empty="No invoices for this customer yet." />}
    </section>
  </main>
}

function RecordList({ rows, empty }: { rows: Array<{ id: string; title: string; subtitle: string; status: string; value?: string; href: string }>; empty: string }) {
  if (!rows.length) return <div className="customer-detail__empty">{empty}</div>
  return <div className="customer-detail__records">{rows.map(row => <a href={`#${row.href}`} key={row.id}><span><b>{row.title}</b><small>{row.subtitle}</small></span><span className={`customer-detail__badge ${row.status.toLowerCase()}`}>{row.status.replaceAll('_', ' ')}</span>{row.value && <strong>{row.value}</strong>}</a>)}</div>
}
