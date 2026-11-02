import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { formatKESPrecise } from '../../lib/format'
import { apiRequest, errorMessage } from '../../services/apiClient'
import type { Invoice } from './types'
import './InvoiceWorkspace.css'

type Customer = { id: string; name: string; phone: string; email?: string | null; billingAddress?: string | null }
type Quotation = { id: string; quotationNumber: string; status: string; customerId: string; title: string; description?: string | null; paymentTerms?: string | null; terms?: string | null; discount: number | string; tax: number | string; items: Array<{ description: string; quantity: number | string; unit: string; unitPrice: number | string }> }
type Line = { description: string; quantity: string; unit: string; unitPrice: string }
const today = () => new Date().toISOString().slice(0, 10)
const initialLine = (): Line => ({ description: '', quantity: '1', unit: 'unit', unitPrice: '' })
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100)

export default function InvoiceFormPage({ editId }: { editId?: string }) {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '')
  const fromQuoteId = params.get('quotationId') ?? ''
  const jobId = params.get('jobId') ?? ''
  const [customers, setCustomers] = useState<Customer[]>([])
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [customerId, setCustomerId] = useState('')
  const [quotationId, setQuotationId] = useState(fromQuoteId)
  const [issueDate, setIssueDate] = useState(today())
  const [dueDate, setDueDate] = useState(() => { const date = new Date(); date.setDate(date.getDate() + 14); return date.toISOString().slice(0, 10) })
  const [paymentTerms, setPaymentTerms] = useState('Payment due within 14 days.')
  const [notes, setNotes] = useState('')
  const [discount, setDiscount] = useState('0')
  const [tax, setTax] = useState('0')
  const [items, setItems] = useState<Line[]>([initialLine()])
  const [currency, setCurrency] = useState('KES')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [addingClient, setAddingClient] = useState(false)
  const [clientSaving, setClientSaving] = useState(false)
  const [clientMessage, setClientMessage] = useState('')
  const [clientForm, setClientForm] = useState({ name: '', phone: '', email: '', billingAddress: '' })
  const [error, setError] = useState('')
  const isQuote = Boolean(quotationId)

  useEffect(() => {
    let active = true
    Promise.all([
      apiRequest<{ customers: Customer[] }>('/customers?pageSize=50'),
      apiRequest<{ quotations: Quotation[] }>('/quotations'),
      apiRequest<{ profile: { business: { currency: string } } }>('/business-profile'),
      editId ? apiRequest<{ invoice: Invoice }>(`/invoices/${editId}`) : Promise.resolve(null),
      jobId ? apiRequest<{ job: { customer: { id: string } } }>(`/jobs/${jobId}`) : Promise.resolve(null),
    ]).then(([customersResult, quotationsResult, profileResult, current, jobResult]) => {
      if (!active) return
      setCustomers(customersResult.customers); setQuotations(quotationsResult.quotations.filter(item => item.status === 'ACCEPTED')); setCurrency(profileResult.profile.business.currency || 'KES')
      if (current) {
        const invoice = current.invoice
        setCustomerId(invoice.customer.id); setQuotationId(invoice.quotation?.id ?? ''); setIssueDate(invoice.issueDate?.slice(0, 10) ?? today()); setDueDate(invoice.dueDate?.slice(0, 10) ?? '')
        setPaymentTerms(invoice.paymentTerms ?? ''); setNotes(invoice.notes ?? ''); setDiscount(String(invoice.discount)); setTax(String(invoice.tax))
        setItems(invoice.items.map(item => ({ description: item.description, quantity: String(item.quantity), unit: item.unit, unitPrice: String(item.unitPrice) })))
      } else if (fromQuoteId) {
        const quote = quotationsResult.quotations.find(item => item.id === fromQuoteId)
        if (quote) { setCustomerId(quote.customerId); setDiscount(String(quote.discount)); setTax(String(quote.tax)); setPaymentTerms(quote.paymentTerms ?? ''); setNotes(quote.terms ?? quote.description ?? ''); setItems(quote.items.map(item => ({ description: item.description, quantity: String(item.quantity), unit: item.unit, unitPrice: String(item.unitPrice) }))) }
      } else if (jobResult) setCustomerId(jobResult.job.customer.id)
    }).catch(cause => { if (active) setError(errorMessage(cause)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [editId, fromQuoteId])

  const selectedCustomer = customers.find(customer => customer.id === customerId)
  const selectedQuote = quotations.find(quote => quote.id === quotationId)
  const subtotalCents = items.reduce((sum, item) => sum + cents((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)), 0)
  const discountCents = cents(Number(discount) || 0)
  const taxCents = cents(Number(tax) || 0)
  const totalCents = Math.max(0, subtotalCents - discountCents + taxCents)
  const totals = useMemo(() => ({ subtotal: (subtotalCents / 100).toFixed(2), discount: (discountCents / 100).toFixed(2), tax: (taxCents / 100).toFixed(2), total: (totalCents / 100).toFixed(2) }), [subtotalCents, discountCents, taxCents, totalCents])
  const changeQuote = (id: string) => {
    setQuotationId(id)
    const quote = quotations.find(item => item.id === id)
    if (quote) { setCustomerId(quote.customerId); setDiscount(String(quote.discount)); setTax(String(quote.tax)); setPaymentTerms(quote.paymentTerms ?? ''); setNotes(quote.terms ?? quote.description ?? ''); setItems(quote.items.map(item => ({ description: item.description, quantity: String(item.quantity), unit: item.unit, unitPrice: String(item.unitPrice) }))) }
    else { setDiscount('0'); setTax('0'); setItems([initialLine()]) }
  }
  const createClient = async () => {
    setClientSaving(true); setClientMessage('')
    if (clientForm.name.trim().length < 2 || !/^(?:\+?254|0)7\d{8}$/.test(clientForm.phone.replace(/[\s-]/g, '')) || (clientForm.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientForm.email))) { setClientMessage('Enter a client name and valid Kenyan phone number. Check the email address if provided.'); setClientSaving(false); return }
    const normalize = (phone: string) => phone.replace(/\D/g, '').replace(/^254/, '0')
    const existingRows = await apiRequest<{ customers: Customer[] }>(`/customers?search=${encodeURIComponent(clientForm.phone)}`).catch(() => ({ customers }))
    const existing = existingRows.customers.find(customer => normalize(customer.phone) === normalize(clientForm.phone))
    if (existing) { setCustomerId(existing.id); setAddingClient(false); setClientMessage(`Selected existing client ${existing.name}.`); setClientSaving(false); return }
    try {
      const result = await apiRequest<{ customer: Customer }>('/customers', { method: 'POST', body: JSON.stringify(clientForm) })
      setCustomers(rows => [...rows, result.customer]); setCustomerId(result.customer.id); setAddingClient(false); setClientMessage('Client added and selected for this invoice.')
    } catch (cause) { setClientMessage(errorMessage(cause)) } finally { setClientSaving(false) }
  }
  const submit = async (issue: boolean) => {
    setSaving(true); setError('')
    try {
      if (!customerId) throw new Error('Choose a client before saving this invoice.')
      const payload = { customerId, ...(quotationId ? { quotationId } : {}), ...(jobId ? { jobId } : {}), issueDate: issueDate || undefined, dueDate: dueDate || undefined, discount: Number(discount) || 0, tax: Number(tax) || 0, paymentTerms, notes, items: items.map(item => ({ ...item, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice) })) }
      const result = editId
        ? await apiRequest<{ invoice: Invoice }>(`/invoices/${editId}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await apiRequest<{ invoice: Invoice }>('/invoices', { method: 'POST', body: JSON.stringify(payload) })
      if (issue) await apiRequest(`/invoices/${result.invoice.id}/issue`, { method: 'POST' })
      window.location.hash = `/app/invoices/${result.invoice.id}`
    } catch (cause) { setError(errorMessage(cause)) } finally { setSaving(false) }
  }
  if (loading) return <main className="invoice-page"><div className="invoice-page__workspace">Loading invoice details…</div></main>
  return <main className="invoice-page"><a className="invoice-page__back" href="#/app/invoices"><ArrowLeft size={16} /> Invoices</a>
    <header className="invoice-page__header"><div><p className="eyebrow green">{editId ? 'EDIT DRAFT' : isQuote ? 'QUOTATION INVOICE' : 'DIRECT INVOICE'}</p><h1>{editId ? 'Edit invoice draft' : 'Create invoice'}</h1><p>{isQuote ? 'Review accepted quotation details and save the invoice.' : 'Bill a customer directly, with no quotation required.'}</p></div></header>
    {error && <div className="invoice-page__message is-error" role="alert">{error}</div>}
    {!customers.length && <div className="invoice-page__message" role="status">Add a client before creating an invoice. <a href="#/app/customers">Go to clients</a></div>}
    <form onSubmit={event => { event.preventDefault(); if (event.currentTarget.reportValidity()) void submit(false) }}>
      <div className="invoice-page__form-layout"><div>
        <section className="invoice-page__form-card"><h2>Invoice details</h2><div className="invoice-page__form-grid">
          {!editId && <label className="invoice-page__field invoice-page__field--full">Create from an accepted quotation (optional)<select value={quotationId} onChange={event => changeQuote(event.target.value)}><option value="">Direct invoice</option>{quotations.map(quote => <option key={quote.id} value={quote.id}>{quote.quotationNumber} · {quote.title}</option>)}</select></label>}
          <label className="invoice-page__field">Issue date<input type="date" value={issueDate} onChange={event => setIssueDate(event.target.value)} /></label><label className="invoice-page__field">Due date<input type="date" min={issueDate} value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
          <label className="invoice-page__field invoice-page__field--full">Payment terms<input value={paymentTerms} onChange={event => setPaymentTerms(event.target.value)} maxLength={1000} placeholder="e.g. Payment due within 14 days" /></label>
        </div></section>
        <section className="invoice-page__form-card"><h2>Client</h2><div className="invoice-page__form-grid"><label className="invoice-page__field invoice-page__field--full">Select an existing client<select required value={customerId} disabled={isQuote} onChange={event => setCustomerId(event.target.value)}><option value="">Choose a client</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name} · {customer.phone}</option>)}</select></label>{selectedCustomer && <div className="invoice-page__client-summary invoice-page__field--full"><b>{selectedCustomer.name}</b><span>{selectedCustomer.phone}{selectedCustomer.email ? ` · ${selectedCustomer.email}` : ''}</span>{selectedCustomer.billingAddress && <span>{selectedCustomer.billingAddress}</span>}</div>}</div>{!isQuote && <button type="button" className="invoice-page__add" onClick={() => { setAddingClient(value => !value); setClientMessage('') }}>{addingClient ? '− Cancel adding client' : '+ Add a new client'}</button>}{clientMessage && <p className="invoice-page__client-note" role="status">{clientMessage}</p>}{addingClient && <div className="invoice-page__client-form" role="group" aria-label="Add a client"><div className="invoice-page__form-grid"><label className="invoice-page__field">Client name<input required minLength={2} maxLength={120} value={clientForm.name} onChange={event => setClientForm({ ...clientForm, name: event.target.value })} /></label><label className="invoice-page__field">Phone<input required type="tel" pattern="(?:\+?254|0)7\d{8}" placeholder="0712 345 678" value={clientForm.phone} onChange={event => setClientForm({ ...clientForm, phone: event.target.value })} /></label><label className="invoice-page__field">Email (optional)<input type="email" value={clientForm.email} onChange={event => setClientForm({ ...clientForm, email: event.target.value })} /></label><label className="invoice-page__field">Billing address (optional)<input maxLength={240} value={clientForm.billingAddress} onChange={event => setClientForm({ ...clientForm, billingAddress: event.target.value })} /></label></div><button type="button" className="invoice-page__secondary" disabled={clientSaving} onClick={() => void createClient()}>{clientSaving ? 'Adding client…' : 'Add and select client'}</button></div>}</section>
        {selectedQuote && <section className="invoice-page__message">From quotation <b>{selectedQuote.quotationNumber}</b> · {selectedQuote.title}</section>}
        <section className="invoice-page__form-card"><h2>Line items</h2><div className="invoice-page__item-head"><span>Description</span><span>Quantity</span><span>Unit</span><span>Unit price</span><span>Line total</span><span /></div>{items.map((item, index) => <div className="invoice-page__item" key={index}><input aria-label={`Item ${index + 1} description`} placeholder="Service or goods description" required value={item.description} disabled={isQuote} onChange={event => setItems(rows => rows.map((row, position) => position === index ? { ...row, description: event.target.value } : row))} /><input aria-label={`Item ${index + 1} quantity`} type="number" min="0.001" step="0.001" required value={item.quantity} disabled={isQuote} onChange={event => setItems(rows => rows.map((row, position) => position === index ? { ...row, quantity: event.target.value } : row))} /><input aria-label={`Item ${index + 1} unit`} placeholder="unit" required value={item.unit} disabled={isQuote} onChange={event => setItems(rows => rows.map((row, position) => position === index ? { ...row, unit: event.target.value } : row))} /><input aria-label={`Item ${index + 1} unit price`} type="number" min="0" step="0.01" required value={item.unitPrice} disabled={isQuote} onChange={event => setItems(rows => rows.map((row, position) => position === index ? { ...row, unitPrice: event.target.value } : row))} /><strong>{formatKESPrecise((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), currency)}</strong><button type="button" disabled={isQuote || items.length === 1} onClick={() => setItems(rows => rows.filter((_, position) => position !== index))} aria-label={`Remove item ${index + 1}`}><Trash2 size={15} /></button></div>)}{!isQuote && <button type="button" className="invoice-page__add" onClick={() => setItems(rows => [...rows, initialLine()])}><Plus size={15} /> Add item</button>}</section>
        <section className="invoice-page__form-card"><h2>Notes and payment instructions</h2><label className="invoice-page__field">Customer-facing notes<textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={3000} placeholder="Add a note for the client" /></label></section>
      </div><aside className="invoice-page__form-card"><h2>Invoice summary</h2><div className="invoice-page__form-grid"><label className="invoice-page__field">Discount ({currency})<input type="number" min="0" step="0.01" value={discount} disabled={isQuote} onChange={event => setDiscount(event.target.value)} /></label><label className="invoice-page__field">Tax ({currency})<input type="number" min="0" step="0.01" value={tax} disabled={isQuote} onChange={event => setTax(event.target.value)} /></label></div><div className="invoice-page__totals"><span>Subtotal<strong>{formatKESPrecise(totals.subtotal, currency)}</strong></span><span>Discount<strong>− {formatKESPrecise(totals.discount, currency)}</strong></span><span>Tax<strong>{formatKESPrecise(totals.tax, currency)}</strong></span><b>Total<strong>{formatKESPrecise(totals.total, currency)}</strong></b><span>Amount paid<strong>{formatKESPrecise(0, currency)}</strong></span><span>Balance due<strong>{formatKESPrecise(totals.total, currency)}</strong></span></div><p className="invoice-page__hint">Payments are recorded separately after the invoice is issued.</p></aside></div>
      <div className="invoice-page__form-actions"><a className="invoice-page__secondary" href="#/app/invoices">Cancel</a><button type="button" className="invoice-page__secondary" disabled={saving || !items.length} onClick={event => { const form = event.currentTarget.form; if (form?.reportValidity()) void submit(false) }}>{saving ? 'Saving…' : 'Save as draft'}</button><button type="button" className="invoice-page__primary" disabled={saving || !customers.length} onClick={event => { const form = event.currentTarget.form; if (form?.reportValidity()) void submit(!editId) }}>{saving ? 'Saving…' : editId ? 'Save changes' : 'Create and issue'}</button></div>
    </form>
  </main>
}

