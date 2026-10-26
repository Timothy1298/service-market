import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiRequest, errorMessage } from '../../../services/apiClient'
import './QuotationsPage.css'

type Customer = { id: string; name: string }
type Quotation = { id: string; quotationNumber: string; title: string; description?: string | null; location?: string | null; status: string; grandTotal: string | number; issueDate?: string | null; expiryDate?: string | null; createdAt: string; updatedAt?: string; customer: Customer }
type Item = { description: string; quantity: string; unit: string; unitPrice: string }
const blankItem = (): Item => ({ description: '', quantity: '1', unit: 'job', unitPrice: '' })
const money = (value: unknown) => `KES ${Number(value ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const statusLabel = (status: string) => status === 'ISSUED' ? 'Awaiting response' : status.charAt(0) + status.slice(1).toLowerCase()

export default function QuotationsPage({ editId }: { editId?: string } = {}) {
  const [searchParams] = useSearchParams()
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const [filterOpen, setFilterOpen] = useState(false)
  const [sort, setSort] = useState('newest')
  const [showEditor, setShowEditor] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loadingEditor, setLoadingEditor] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ customerId: '', title: '', description: '', location: '', expiryDate: '', discount: '0', tax: '0', terms: '', paymentTerms: '' })
  const [items, setItems] = useState<Item[]>([blankItem()])
  const load = async () => { setLoading(true); setError(''); try { const [quoteResult, customerResult] = await Promise.all([apiRequest<{ quotations: Quotation[] }>('/quotations'), apiRequest<{ customers: Customer[] }>('/customers?pageSize=50')]); setQuotations(quoteResult.quotations); setCustomers(customerResult.customers); setForm(current => ({ ...current, customerId: current.customerId || customerResult.customers[0]?.id || '' })) } catch (requestError) { setError(errorMessage(requestError)) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])
  useEffect(() => {
    const customerId = searchParams.get('customerId') ?? searchParams.get('customer')
    const requestedStatus = searchParams.get('status')
    if (requestedStatus && ['DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED'].includes(requestedStatus)) setStatus(requestedStatus)
    if (!customerId && !window.location.hash.includes('/app/quotations/new')) return
    setForm(current => ({ ...current, ...(customerId ? { customerId } : {}) }))
    setShowEditor(true)
  }, [searchParams])
  useEffect(() => {
    if (!editId) return
    let active = true
    setLoadingEditor(true)
    setError('')
    apiRequest<{ quotation: Quotation & { discount: string | number; tax: string | number; terms?: string | null; paymentTerms?: string | null; items: Array<{ description: string; quantity: string | number; unit: string; unitPrice: string | number }> } }>(`/quotations/${editId}`)
      .then(({ quotation }) => {
        if (!active) return
        if (quotation.status !== 'DRAFT') {
          setError('Only draft quotations can be edited. Open the quotation details to manage it.')
          return
        }
        setEditingId(quotation.id)
        setForm({ customerId: quotation.customer.id, title: quotation.title, description: quotation.description ?? '', location: quotation.location ?? '', expiryDate: quotation.expiryDate?.slice(0, 10) ?? '', discount: String(quotation.discount), tax: String(quotation.tax), terms: quotation.terms ?? '', paymentTerms: quotation.paymentTerms ?? '' })
        setItems(quotation.items.map(item => ({ description: item.description, quantity: String(item.quantity), unit: item.unit, unitPrice: String(item.unitPrice) })))
        setShowEditor(true)
      })
      .catch(cause => { if (active) setError(errorMessage(cause)) })
      .finally(() => { if (active) setLoadingEditor(false) })
    return () => { active = false }
  }, [editId])
  const updateForm = (key: string, value: string) => setForm(current => ({ ...current, [key]: value }))
  const updateItem = (index: number, key: keyof Item, value: string) => setItems(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item))
  const subtotal = items.reduce((total, item) => total + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0)
  const total = subtotal - Number(form.discount || 0) + Number(form.tax || 0)
  const save = async (event: { preventDefault: () => void }, issueAfterSave = false) => { event.preventDefault(); if (issueAfterSave && !window.confirm('Once issued, the quotation is locked and can be shared. Issue it now?')) return; setSaving(true); setError(''); setMessage(''); try { const payload = { ...form, location: form.location || undefined, discount: Number(form.discount || 0), tax: Number(form.tax || 0), expiryDate: form.expiryDate || undefined, items: items.map(item => ({ ...item, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice) })) }; const result = await apiRequest<{ quotation: { id: string } }>(editingId ? `/quotations/${editingId}` : '/quotations', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); if (issueAfterSave) { setEditingId(result.quotation.id); await apiRequest(`/quotations/${result.quotation.id}/issue`, { method: 'POST' }); window.location.hash = `#/app/quotations/${result.quotation.id}`; return } setMessage(editingId ? 'Quotation draft updated successfully.' : 'Quotation draft created successfully.'); setShowEditor(false); setEditingId(null); setForm({ customerId: customers[0]?.id ?? '', title: '', description: '', location: '', expiryDate: '', discount: '0', tax: '0', terms: '', paymentTerms: '' }); setItems([blankItem()]); await load() } catch (requestError) { setError(errorMessage(requestError)) } finally { setSaving(false) } }
  const filtered = useMemo(() => quotations.filter(quote => (status === 'ALL' || quote.status === status) && `${quote.quotationNumber} ${quote.customer.name} ${quote.title} ${quote.description ?? ''}`.toLowerCase().includes(query.toLowerCase())).sort((left, right) => sort === 'amount' ? Number(right.grandTotal) - Number(left.grandTotal) : sort === 'oldest' ? new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() : new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()), [quotations, status, query, sort])
  const accepted = quotations.filter(quote => quote.status === 'ACCEPTED')
  const awaiting = quotations.filter(quote => quote.status === 'ISSUED')
  const acceptedThisMonth = accepted.filter(quote => { const date = new Date(quote.updatedAt ?? quote.createdAt); const now = new Date(); return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear() })
  const decided = quotations.filter(quote => ['ACCEPTED', 'REJECTED', 'EXPIRED'].includes(quote.status)).length
  const acceptanceRate = decided ? `${Math.round(accepted.length / decided * 100)}%` : '—'
  const statusCount = (value: string) => value === 'ALL' ? quotations.length : quotations.filter(quote => quote.status === value).length
  const share = async (quote: Quotation) => { if (!['ISSUED', 'ACCEPTED', 'REJECTED'].includes(quote.status)) { window.location.hash = `#/app/quotations/${quote.id}`; return } try { const result = await apiRequest<{ shareUrl: string }>(`/quotations/${quote.id}/share`, { method: 'POST' }); await navigator.clipboard?.writeText(result.shareUrl); setMessage('Secure quotation link copied. You can now paste it into WhatsApp or another channel.'); setError('') } catch (requestError) { setError(errorMessage(requestError)) } }

  return <div className="quotations-page">
    <div className="quotations-page__header"><div><p className="eyebrow green">PROVIDER TOOLS</p><h1>Quotations</h1><p>Prepare estimates, track customer decisions, and manage approvals.</p></div><button className="quotations-page__primary" type="button" onClick={() => { setShowEditor(true); setMessage('') }}>＋ New quote</button></div>
    {message && <div className="quotations-page__alert quotations-page__alert--success" role="status">{message}</div>}
    {error && <div className="quotations-page__alert quotations-page__alert--error" role="alert">{error}<button type="button" onClick={() => void load()}>Retry</button></div>}
    <section className="quotations-page__summary">
      <div><span>▤</span><small>Total quotations</small><strong>{loading ? '—' : quotations.length}</strong><em>All recorded quotes</em></div>
      <div><span>◷</span><small>Awaiting response</small><strong>{loading ? '—' : awaiting.length}</strong><em>{money(awaiting.reduce((sum, quote) => sum + Number(quote.grandTotal), 0))} awaiting</em></div>
      <div><span>✓</span><small>Accepted this month</small><strong>{loading ? '—' : acceptedThisMonth.length}</strong><em>{money(acceptedThisMonth.reduce((sum, quote) => sum + Number(quote.grandTotal), 0))} accepted</em></div>
      <div><span>▣</span><small>Acceptance rate</small><strong>{loading ? '—' : acceptanceRate}</strong><em>{decided ? 'Of decided quotations' : 'No decisions yet'}</em></div>
    </section>
    <section className="quotations-page__workspace">
      <div className="quotations-page__workspace-head"><div><h2>Quotation workspace</h2><p>{loading ? 'Loading quotations…' : `${filtered.length} quotation${filtered.length === 1 ? '' : 's'} shown`}</p></div>
        <div className="quotations-page__search-wrap"><label className="quotations-page__search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search quote number, customer…" aria-label="Search quotations" /><button type="button" onClick={() => setFilterOpen(open => !open)} aria-label="Toggle quotation filters" aria-expanded={filterOpen}>☷</button></label>
          {filterOpen && <div className="quotations-page__sort"><label>Sort quotations<select value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="amount">Highest amount</option></select></label><button type="button" onClick={() => { setQuery(''); setStatus('ALL'); setSort('newest'); setFilterOpen(false) }}>Clear all filters</button></div>}
        </div>
      </div>
      <div className="quotations-page__filters">{['ALL', 'DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED'].map(option => <button type="button" className={status === option ? 'active' : ''} onClick={() => setStatus(option)} key={option}>{option === 'ALL' ? 'All' : statusLabel(option)} <span>{statusCount(option)}</span></button>)}</div>
      {loading ? <div className="quotations-page__loading" aria-label="Loading quotations"><i /><i /><i /></div> : !filtered.length ? <div className="quotations-page__empty"><b>{query || status !== 'ALL' ? 'No quotations match your filters' : 'No quotations yet'}</b><p>{query || status !== 'ALL' ? 'Clear the search or choose another status.' : 'Create your first quotation to start tracking work.'}</p><button type="button" onClick={() => { if (query || status !== 'ALL') { setQuery(''); setStatus('ALL') } else setShowEditor(true) }}>{query || status !== 'ALL' ? 'Clear filters' : 'Create quotation'}</button></div> : <div className="quotations-page__list">{filtered.map(quote => <article className="quotation-row" key={quote.id}>
        <div className="quotation-row__icon">{quote.status === 'ACCEPTED' ? '✓' : quote.status === 'ISSUED' ? '⌁' : '▤'}</div>
        <div className="quotation-row__main"><div><a href={`#/app/quotations/${quote.id}`}><b>{quote.quotationNumber}</b></a><span className={`quotation-status quotation-status--${quote.status.toLowerCase()}`}>{statusLabel(quote.status)}</span></div><strong>{quote.customer.name}</strong><small>{quote.title} · {quote.issueDate ? new Date(quote.issueDate).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Draft'}</small></div>
        <div className="quotation-row__total"><strong>{money(quote.grandTotal)}</strong><small>Total quoted</small></div>
        <div className="quotation-row__actions">{quote.status === 'DRAFT' ? <a href={`#/app/quotations/${quote.id}/edit`}>Edit draft</a> : <button type="button" onClick={() => void share(quote)}>{['ISSUED', 'ACCEPTED', 'REJECTED'].includes(quote.status) ? 'Share' : 'Manage'}</button>}<a href={`#/app/quotations/${quote.id}`}>Details</a></div>
      </article>)}</div>}
    </section>
    {loadingEditor && <div className="quotations-page__loading" role="status" aria-label="Loading draft"><i /><i /></div>}
    {showEditor && <div className="quotations-page__modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setShowEditor(false) }}><section role="dialog" aria-modal="true" aria-labelledby="new-quote-title"><div className="quotations-page__modal-head"><div><p className="eyebrow green">{editingId ? 'EDIT DRAFT' : 'NEW QUOTATION'}</p><h2 id="new-quote-title">{editingId ? 'Edit quotation' : 'Create quotation'}</h2></div><button type="button" onClick={() => setShowEditor(false)} aria-label="Close">×</button></div>
      <form onSubmit={event => void save(event)}><div className="quotations-page__two-col"><label>Customer<select value={form.customerId} onChange={event => updateForm('customerId', event.target.value)} required><option value="">Select customer</option>{customers.map(customer => <option value={customer.id} key={customer.id}>{customer.name}</option>)}</select></label><label>Valid until<input type="date" value={form.expiryDate} onChange={event => updateForm('expiryDate', event.target.value)} /></label></div>
        <label>Quotation title<input value={form.title} onChange={event => updateForm('title', event.target.value)} required minLength={3} placeholder="e.g. Kitchen rewiring" /></label><label>Project location<input value={form.location} onChange={event => updateForm('location', event.target.value)} /></label><label>Description<textarea value={form.description} onChange={event => updateForm('description', event.target.value)} rows={2} /></label>
        <div className="quotation-items-head"><b>Line items</b><button type="button" onClick={() => setItems(current => [...current, blankItem()])}>＋ Add item</button></div>{items.map((item, index) => <div className="quotation-item" key={index}><input aria-label="Item description" placeholder="Description" value={item.description} onChange={event => updateItem(index, 'description', event.target.value)} required /><input aria-label="Quantity" type="number" min="0.01" step="0.01" value={item.quantity} onChange={event => updateItem(index, 'quantity', event.target.value)} required /><input aria-label="Unit" placeholder="Unit" value={item.unit} onChange={event => updateItem(index, 'unit', event.target.value)} required /><input aria-label="Unit price" type="number" min="0" step="0.01" placeholder="KES price" value={item.unitPrice} onChange={event => updateItem(index, 'unitPrice', event.target.value)} required />{items.length > 1 && <button type="button" onClick={() => setItems(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Remove item">×</button>}</div>)}
        <div className="quotations-page__totals"><span>Subtotal <b>{money(subtotal)}</b></span><label>Discount<input type="number" min="0" value={form.discount} onChange={event => updateForm('discount', event.target.value)} /></label><label>Tax<input type="number" min="0" value={form.tax} onChange={event => updateForm('tax', event.target.value)} /></label><strong>Total <b>{money(total)}</b></strong></div>
        <label>Payment terms<textarea value={form.paymentTerms} onChange={event => updateForm('paymentTerms', event.target.value)} rows={2} /></label><label>Terms and conditions<textarea value={form.terms} onChange={event => updateForm('terms', event.target.value)} rows={2} /></label><div className="quotations-page__modal-actions"><button type="button" onClick={() => setShowEditor(false)}>Cancel</button><button type="submit" className="quotations-page__secondary" disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</button><button type="button" className="quotations-page__primary" disabled={saving} onClick={event => { const formElement = event.currentTarget.form; if (formElement?.reportValidity()) void save({ preventDefault() {} }, true) }}>{saving ? 'Issuing…' : 'Save & issue'}</button></div>
      </form></section></div>}
  </div>
}
