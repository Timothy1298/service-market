import { useEffect, useMemo, useState } from 'react'
import { ArrowDownUp, CircleDollarSign, Clock3, FilePlus2, FileText, Search } from 'lucide-react'
import { formatDate, formatKESPrecise } from '../../lib/format'
import { API, apiRequest, errorMessage } from '../../services/apiClient'
import type { Invoice } from './types'
import './InvoiceWorkspace.css'

type Stats = { total: number; awaitingPayment: number; paid: number; overdue: number; overdueAmount: number }
const statuses = ['ALL', 'DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED']
const label = (status: string) => status === 'ALL' ? 'All statuses' : status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase())

export default function InvoiceListPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('status') ?? 'ALL')
  const [source, setSource] = useState('ALL')
  const [sort, setSort] = useState('createdAt')
  const [direction, setDirection] = useState('desc')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const pageSize = 20
  const load = async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ search: query, status, source, page: String(page), pageSize: String(pageSize), sort, direction })
      const [list, summary] = await Promise.all([apiRequest<{ invoices: Invoice[]; total: number }>(`/invoices?${params}`), apiRequest<Stats>('/invoices/stats')])
      setInvoices(list.invoices); setTotal(list.total); setStats(summary)
    } catch (cause) { setError(errorMessage(cause)) } finally { setLoading(false) }
  }
  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 180); return () => window.clearTimeout(timer) }, [query, status, source, sort, direction, page])
  const dueBalance = (invoice: Invoice) => Math.max(0, Number(invoice.grandTotal) - Number(invoice.amountPaid))
  const metrics = [
    { title: 'Total invoices', value: stats?.total, note: 'Excludes cancelled invoices', Icon: FileText },
    { title: 'Awaiting payment', value: stats ? formatKESPrecise(stats.awaitingPayment) : '—', note: 'Outstanding on issued invoices', Icon: CircleDollarSign },
    { title: 'Paid invoices', value: stats?.paid, note: 'Fully settled', Icon: FilePlus2 },
    { title: 'Overdue invoices', value: stats?.overdue, note: stats ? `${formatKESPrecise(stats.overdueAmount)} outstanding` : 'Past due date', Icon: Clock3 },
  ]
  const maxPage = Math.max(1, Math.ceil(total / pageSize))
  const shown = useMemo(() => invoices, [invoices])
  return <main className="invoice-page">
    <header className="invoice-page__header"><div><p className="eyebrow green">BUSINESS OPERATIONS</p><h1>Invoices</h1><p>Create, issue, track, and manage customer invoices.</p></div><a className="invoice-page__primary" href="#/app/invoices/new"><FilePlus2 size={17} />Create invoice</a></header>
    {error && <div className="invoice-page__message is-error" role="alert">{error} <button className="invoice-page__secondary" type="button" onClick={() => void load()}>Retry</button></div>}
    <section className="invoice-page__metrics" aria-label="Invoice summary">{metrics.map(({ title, value, note, Icon }) => <article key={title}><span><Icon size={18} /></span><small>{title}</small><strong>{loading || value === undefined ? '—' : value}</strong><em>{note}</em></article>)}</section>
    <section className="invoice-page__workspace"><div className="invoice-page__toolbar"><div><h2>Invoice workspace</h2><p>{loading ? 'Loading invoices…' : `${total} invoice${total === 1 ? '' : 's'} found`}</p></div><div className="invoice-page__controls"><label className="invoice-page__search"><Search size={16} /><input aria-label="Search invoices" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} placeholder="Search invoice number or client…" /></label><select aria-label="Filter by status" value={status} onChange={event => { setStatus(event.target.value); setPage(1) }}>{statuses.map(item => <option value={item} key={item}>{label(item)}</option>)}</select><select aria-label="Filter by source" value={source} onChange={event => { setSource(event.target.value); setPage(1) }}><option value="ALL">All sources</option><option value="DIRECT">Direct invoice</option><option value="QUOTATION">From quotation</option></select><select aria-label="Sort invoices" value={`${sort}:${direction}`} onChange={event => { const [nextSort, nextDirection] = event.target.value.split(':'); setSort(nextSort); setDirection(nextDirection) }}><option value="createdAt:desc">Newest first</option><option value="createdAt:asc">Oldest first</option><option value="dueDate:asc">Due date</option><option value="grandTotal:desc">Highest amount</option><option value="grandTotal:asc">Lowest amount</option></select><ArrowDownUp size={15} aria-hidden="true" /></div></div>
      {loading ? <div className="jobs-page__loading" aria-label="Loading invoices"><i /><i /><i /></div> : !shown.length ? <div className="invoice-page__empty"><b>{query || status !== 'ALL' || source !== 'ALL' ? 'No invoices match these filters' : 'No invoices yet'}</b><p>{query || status !== 'ALL' || source !== 'ALL' ? 'Try changing your search or filters.' : 'Create an invoice directly for a customer or start from an accepted quotation.'}</p><a className="invoice-page__primary" href="#/app/invoices/new"><FilePlus2 size={16} />Create invoice</a></div> : <div className="invoice-page__table-wrap"><table className="invoice-page__table"><thead><tr><th>Invoice</th><th>Client</th><th>Issue date</th><th>Due date</th><th>Source</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody>{shown.map(invoice => {
        const overdue = invoice.status !== 'DRAFT' && invoice.status !== 'CANCELLED' && dueBalance(invoice) > 0 && invoice.dueDate && new Date(invoice.dueDate).getTime() < new Date().setHours(0, 0, 0, 0)
        const effectiveStatus = overdue ? 'OVERDUE' : invoice.status
        return <tr key={invoice.id}><td><a href={`#/app/invoices/${invoice.id}`}>{invoice.invoiceNumber}</a>{invoice.quotation && <small>{invoice.quotation.quotationNumber}</small>}</td><td>{invoice.issuedSnapshot?.customer?.name ?? invoice.customer.name}<small>{invoice.issuedSnapshot?.customer?.phone ?? invoice.customer.phone}</small></td><td>{formatDate(invoice.issueDate)}</td><td className={overdue ? 'is-overdue' : ''}>{formatDate(invoice.dueDate)}</td><td>{invoice.quotation ? 'From quotation' : 'Direct invoice'}</td><td className="invoice-page__amount">{formatKESPrecise(invoice.grandTotal, invoice.currency)}</td><td className="invoice-page__amount">{formatKESPrecise(invoice.amountPaid, invoice.currency)}</td><td className="invoice-page__amount">{formatKESPrecise(dueBalance(invoice), invoice.currency)}</td><td><span className={`invoice-page__status invoice-page__status--${effectiveStatus.toLowerCase()}`}>{label(effectiveStatus)}</span></td><td><div className="invoice-page__actions"><a href={`#/app/invoices/${invoice.id}`}>View</a>{invoice.status === 'DRAFT' && <a href={`#/app/invoices/${invoice.id}/edit`}>Edit</a>}{invoice.status !== 'DRAFT' && invoice.status !== 'CANCELLED' && <a href={`${API}/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>}</div></td></tr>
      })}</tbody></table></div>}
      {!loading && total > pageSize && <footer className="invoice-page__pagination"><span>Page {page} of {maxPage}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button> <button type="button" disabled={page >= maxPage} onClick={() => setPage(value => value + 1)}>Next</button></div></footer>}
    </section>
  </main>
}

