import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Download, Mail, MapPin, MessageCircle, Pencil, Phone, Plus, Receipt, Search, SlidersHorizontal, UserPlus, Users, Wallet } from 'lucide-react'
import { formatDate, formatKES, toWhatsApp } from '../../../lib/format'
import { apiRequest, errorMessage } from '../../../services/apiClient'
import './CustomersPage.css'

type Customer = { id: string; name: string; phone: string; email?: string | null; billingAddress?: string | null; projectLocation?: string | null; notes?: string | null; createdAt?: string; quotationCount?: number; outstandingBalance?: number | string }
type Stats = { total: number; newThisMonth: number; withBalance: number; outstandingTotal: number }
type FormValues = { name: string; phone: string; email: string; billingAddress: string; projectLocation: string; notes: string }
const emptyForm: FormValues = { name: '', phone: '', email: '', billingAddress: '', projectLocation: '', notes: '' }
const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('name')
  const [filterOpen, setFilterOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormValues>(emptyForm)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async (search = '') => {
    setLoading(true)
    setError('')
    try {
      const result = await apiRequest<{ customers: Customer[] }>('/customers?pageSize=50' + (search ? `&search=${encodeURIComponent(search)}` : ''))
      setCustomers(result.customers)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), 300)
    return () => window.clearTimeout(timer)
  }, [query])
  useEffect(() => { void apiRequest<Stats>('/customers/stats').then(setStats).catch(() => setStats(null)) }, [])

  const visibleCustomers = useMemo(() => customers.filter(customer => {
    if (filter === 'email') return Boolean(customer.email)
    if (filter === 'balance') return Number(customer.outstandingBalance) > 0
    if (filter === 'month') {
      const date = customer.createdAt ? new Date(customer.createdAt) : null
      const now = new Date()
      return Boolean(date && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear())
    }
    return true
  }).sort((left, right) => sort === 'newest' ? new Date(right.createdAt ?? 0).getTime() - new Date(left.createdAt ?? 0).getTime() : left.name.localeCompare(right.name)), [customers, filter, sort])

  const openCreate = () => { setEditingId(null); setForm(emptyForm); setError(''); setMessage(''); setShowForm(true) }
  const openEdit = (customer: Customer) => {
    setEditingId(customer.id)
    setForm({ name: customer.name, phone: customer.phone, email: customer.email ?? '', billingAddress: customer.billingAddress ?? '', projectLocation: customer.projectLocation ?? '', notes: customer.notes ?? '' })
    setError(''); setMessage(''); setShowForm(true)
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true); setError(''); setMessage('')
    try {
      const payload = { ...form, email: form.email || undefined, billingAddress: form.billingAddress || undefined, projectLocation: form.projectLocation || undefined, notes: form.notes || undefined }
      await apiRequest(editingId ? `/customers/${editingId}` : '/customers', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
      setForm(emptyForm); setShowForm(false); setEditingId(null)
      setMessage(editingId ? 'Customer updated successfully.' : 'Customer added successfully.')
      await Promise.all([load(query), apiRequest<Stats>('/customers/stats').then(setStats)])
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  const exportCsv = () => {
    const rows = [['Name', 'Phone', 'Email', 'Project location', 'Billing address', 'Quotation count', 'Outstanding balance', 'Added'], ...visibleCustomers.map(customer => [customer.name, customer.phone, customer.email, customer.projectLocation, customer.billingAddress, customer.quotationCount, Number(customer.outstandingBalance ?? 0).toFixed(2), customer.createdAt ? formatDate(customer.createdAt) : ''])]
    const csv = rows.map(row => row.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'fundiquote-customers.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const initials = (name: string) => name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase()
  const metrics = [
    { label: 'Total customers', value: stats?.total, note: 'All customer records', Icon: Users },
    { label: 'New this month', value: stats?.newThisMonth, note: 'Recently added', Icon: UserPlus },
    { label: 'With open balance', value: stats?.withBalance, note: 'Customers to follow up', Icon: Receipt },
    { label: 'Outstanding balance', value: stats ? formatKES(stats.outstandingTotal) : undefined, note: 'Across unpaid invoices', Icon: Wallet },
  ]

  return <main className="customers-page">
    <header className="customers-page__header"><div><p className="eyebrow green">BUSINESS CONTACTS</p><h1>Customers</h1><p>Everyone you quote, work for and invoice.</p></div><div className="customers-page__header-actions"><button type="button" className="customers-page__secondary" onClick={exportCsv} disabled={!visibleCustomers.length}><Download size={17} />Export visible</button><button className="customers-page__primary" type="button" onClick={openCreate}><Plus size={17} />Add customer</button></div></header>
    {message && <div className="customers-page__alert customers-page__alert--success" role="status">{message}</div>}
    {error && !showForm && <div className="customers-page__alert customers-page__alert--error" role="alert">{error}<button type="button" onClick={() => void load(query)}>Retry</button></div>}
    <section className="customers-page__metrics" aria-label="Customer summary">{metrics.map(({ label, value, note, Icon }) => <article key={label}><span><Icon size={18} /></span><small>{label}</small><strong>{loading || value === undefined ? '—' : value}</strong><em>{note}</em></article>)}</section>
    <section className="customers-page__directory"><header className="customers-page__directory-head"><div><h2>Customer directory</h2><p>{loading ? 'Loading records…' : `${visibleCustomers.length} customer${visibleCustomers.length === 1 ? '' : 's'} found`}</p></div><div className="customers-page__toolbar"><label className="customers-page__search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name or phone" aria-label="Search customers" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}</label><button className={`customers-page__filter-button${filterOpen || filter !== 'all' ? ' is-active' : ''}`} type="button" onClick={() => setFilterOpen(open => !open)} aria-expanded={filterOpen}><SlidersHorizontal size={16} />Filters{filter !== 'all' ? ' · 1' : ''}</button></div></header>
      {filterOpen && <div className="customers-page__filters"><label>Show<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All customers</option><option value="month">Added this month</option><option value="email">With email</option><option value="balance">With open balance</option></select></label><label>Sort by<select value={sort} onChange={event => setSort(event.target.value)}><option value="name">Name A–Z</option><option value="newest">Newest first</option></select></label><button type="button" onClick={() => { setFilter('all'); setSort('name') }}>Clear filters</button></div>}
      {loading ? <div className="customers-page__loading" aria-label="Loading customers"><i /><i /><i /></div> : !visibleCustomers.length ? <div className="customers-page__empty"><Users size={30} /><b>{query || filter !== 'all' ? 'No customers match your filters' : 'No customers yet'}</b><p>{query || filter !== 'all' ? 'Change your search or filters.' : 'Add your first customer to start creating quotations.'}</p><button type="button" onClick={() => query || filter !== 'all' ? (setQuery(''), setFilter('all')) : openCreate()}>{query || filter !== 'all' ? 'Clear filters' : 'Add customer'}</button></div> : <>
        <div className="customers-page__table-wrap"><table className="customers-page__table"><thead><tr><th>Customer</th><th>Phone</th><th className="customers-page__email-column">Email</th><th className="is-numeric">Quotes</th><th className="is-numeric">Balance</th><th>Added</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{visibleCustomers.map(customer => <tr key={customer.id}>
          <td><a className="customers-page__customer-link" href={`#/app/customers/${customer.id}`}><span className="customer-card__avatar">{initials(customer.name)}</span><span><b>{customer.name}</b><small>{customer.projectLocation || customer.billingAddress || 'Location not provided'}</small></span></a></td><td><a href={`tel:${customer.phone}`}>{customer.phone}</a></td><td className="customers-page__email-column">{customer.email ? <a href={`mailto:${customer.email}`}>{customer.email}</a> : '—'}</td><td className="is-numeric">{customer.quotationCount ?? 0}</td><td className={`is-numeric${Number(customer.outstandingBalance) > 0 ? ' has-balance' : ''}`}>{formatKES(customer.outstandingBalance)}</td><td>{customer.createdAt ? formatDate(customer.createdAt) : '—'}</td><td><div className="customers-page__row-actions"><button type="button" aria-label={`Edit ${customer.name}`} onClick={() => openEdit(customer)}><Pencil size={15} /></button><a href={`#/app/quotations/new?customerId=${customer.id}`} aria-label={`New quotation for ${customer.name}`}><Plus size={16} /></a><a href={`https://wa.me/${toWhatsApp(customer.phone)}?text=${encodeURIComponent(`Hello ${customer.name}, this is FundiQuote.`)}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${customer.name}`}><MessageCircle size={16} /></a></div></td>
        </tr>)}</tbody></table></div>
        <div className="customers-page__mobile-list">{visibleCustomers.map(customer => <article className="customer-card" key={customer.id}><a className="customer-card__identity" href={`#/app/customers/${customer.id}`}><span className="customer-card__avatar">{initials(customer.name)}</span><span><b>{customer.name}</b><small><MapPin size={13} />{customer.projectLocation || customer.billingAddress || 'Location not provided'}</small></span></a><div className="customer-card__contact"><a href={`tel:${customer.phone}`}><Phone size={14} />{customer.phone}</a>{customer.email && <a href={`mailto:${customer.email}`}><Mail size={14} />{customer.email}</a>}</div><div className="customer-card__stats"><span>{customer.quotationCount ?? 0} quotes</span><strong>{formatKES(customer.outstandingBalance)}</strong></div><div className="customer-card__actions"><button type="button" onClick={() => openEdit(customer)}><Pencil size={14} />Edit</button><a href={`#/app/quotations/new?customerId=${customer.id}`}>New quote</a><a href={`https://wa.me/${toWhatsApp(customer.phone)}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${customer.name}`}><MessageCircle size={16} /></a></div></article>)}</div>
      </>}
    </section>
    {showForm && <div className="customers-page__modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setShowForm(false) }}><section role="dialog" aria-modal="true" aria-labelledby="customer-form-title"><header className="customers-page__modal-head"><div><p className="eyebrow green">{editingId ? 'CUSTOMER RECORD' : 'NEW RECORD'}</p><h2 id="customer-form-title">{editingId ? 'Edit customer' : 'Add customer'}</h2></div><button type="button" onClick={() => setShowForm(false)} aria-label="Close">×</button></header>{error && <div className="customers-page__alert customers-page__alert--error" role="alert">{error}</div>}<form onSubmit={submit}><label>Name<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required minLength={2} /></label><label>Phone number<input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} required placeholder="0712 345 678" pattern="(?:\+?254|0)7\d{8}" /></label><label>Email address <span>(optional)</span><input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label><div className="customers-page__two-col"><label>Service location<input value={form.projectLocation} onChange={event => setForm({ ...form, projectLocation: event.target.value })} /></label><label>Billing address<input value={form.billingAddress} onChange={event => setForm({ ...form, billingAddress: event.target.value })} /></label></div><label>Notes<textarea value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} rows={3} /></label><div className="customers-page__modal-actions"><button type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="customers-page__primary" disabled={saving}>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Save customer'}</button></div></form></section></div>}
  </main>
}
