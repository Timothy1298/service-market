import { useEffect, useState } from 'react'
import { Check, CheckCircle2, FileX2, LockKeyhole, X, XCircle } from 'lucide-react'
import { apiRequest, errorMessage } from '../../../services/apiClient'
import { formatDate, formatKESPrecise } from '../../../lib/format'
import './PublicQuotationSharePage.css'

type QuoteItem = { id: string; description: string; quantity: string | number; unit: string; unitPrice: string | number; lineTotal: string | number }
type SharedQuotation = {
  id: string; quotationNumber: string; title: string; description?: string | null; location?: string | null
  currency: string; issueDate?: string | null; expiryDate?: string | null; subtotal: string | number
  discount: string | number; tax: string | number; grandTotal: string | number; terms?: string | null
  paymentTerms?: string | null; status: string; items: QuoteItem[]
  business: { name: string; phone: string; email?: string | null; address?: string | null }
  customer: { name: string }
}
type Decision = 'ACCEPTED' | 'REJECTED'

export default function PublicQuotationSharePage({ token }: { token: string }) {
  const [quotation, setQuotation] = useState<SharedQuotation | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await apiRequest<{ quotation: SharedQuotation }>(`/quotations/share/${encodeURIComponent(token)}`)
      setQuotation(result.quotation)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [token])
  useEffect(() => {
    if (!decision) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !working) setDecision(null) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [decision, working])

  const submitDecision = async () => {
    if (!decision) return
    setWorking(true)
    setError('')
    try {
      const result = await apiRequest<{ status: string; alreadyResponded?: boolean }>(`/quotations/share/${encodeURIComponent(token)}/respond`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      })
      setQuotation(current => current ? { ...current, status: result.status } : current)
      setMessage(result.alreadyResponded ? 'A decision has already been recorded for this quotation.' : result.status === 'ACCEPTED' ? 'You accepted this quotation.' : 'You declined this quotation.')
      setDecision(null)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setWorking(false)
    }
  }

  const expiry = quotation?.expiryDate ? new Date(quotation.expiryDate) : null
  const expiredByDate = Boolean(expiry && expiry.getTime() < new Date(new Date().toDateString()).getTime())
  const isFinal = Boolean(quotation && ['ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED'].includes(quotation.status))
  const canRespond = quotation?.status === 'ISSUED' && !expiredByDate

  if (loading) return <main className="public-quote"><div className="public-quote__topbar"><a className="public-quote__brand" href="#/"><span>F</span> Fundi<b>Quote</b></a><span><LockKeyhole size={15} /> Secure quotation</span></div><div className="public-quote__skeleton" aria-label="Loading quotation"><i /><i /><i /></div></main>
  if (error && !quotation) return <main className="public-quote"><div className="public-quote__topbar"><a className="public-quote__brand" href="#/"><span>F</span> Fundi<b>Quote</b></a><span><LockKeyhole size={15} /> Secure quotation</span></div><section className="public-quote__empty"><FileX2 size={34} /><h1>This quotation link isn’t available</h1><p>It may have expired. Ask the business to send you a new link.</p><button type="button" onClick={() => void load()}>Try again</button></section></main>
  if (!quotation) return null

  return <main className="public-quote">
    <div className="public-quote__topbar"><a className="public-quote__brand" href="#/"><span>F</span> Fundi<b>Quote</b></a><span><LockKeyhole size={15} /> Secure quotation</span></div>
    <div className="public-quote__content">
      <article className="public-quote__document">
        <header className="public-quote__document-head"><div><h2>{quotation.business.name}</h2><p>{quotation.business.phone}{quotation.business.email ? ` · ${quotation.business.email}` : ''}</p>{quotation.business.address && <p>{quotation.business.address}</p>}</div><div className="public-quote__number"><span>QUOTATION</span><b>{quotation.quotationNumber}</b></div></header>
        <div className="public-quote__meta"><span>Issued <b>{formatDate(quotation.issueDate)}</b></span><span>Valid until <b>{formatDate(quotation.expiryDate)}</b></span><span>Prepared for <b>{quotation.customer.name}</b></span></div>
        <div className="public-quote__title"><span className={`public-quote__status public-quote__status--${quotation.status.toLowerCase()}`}>{quotation.status === 'ISSUED' ? 'Awaiting response' : quotation.status.replaceAll('_', ' ')}</span><h1>{quotation.title}</h1>{quotation.description && <p>{quotation.description}</p>}{quotation.location && <small>Project location: {quotation.location}</small>}</div>
        <div className="public-quote__table-wrap"><table className="public-quote__table"><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>{quotation.items.map(item => <tr key={item.id}><td>{item.description}<small>{item.unit}</small></td><td>{item.quantity}</td><td>{formatKESPrecise(item.unitPrice)}</td><td>{formatKESPrecise(item.lineTotal)}</td></tr>)}</tbody></table></div>
        <dl className="public-quote__totals"><div><dt>Subtotal</dt><dd>{formatKESPrecise(quotation.subtotal)}</dd></div><div><dt>Discount</dt><dd>{formatKESPrecise(quotation.discount)}</dd></div><div><dt>Tax</dt><dd>{formatKESPrecise(quotation.tax)}</dd></div><div className="is-total"><dt>Total</dt><dd>{formatKESPrecise(quotation.grandTotal)}</dd></div></dl>
        {(quotation.paymentTerms || quotation.terms) && <div className="public-quote__terms">{quotation.paymentTerms && <section><h2>Payment terms</h2><p>{quotation.paymentTerms}</p></section>}{quotation.terms && <section><h2>Terms and conditions</h2><p>{quotation.terms}</p></section>}</div>}
        {error && <div className="public-quote__alert is-error" role="alert">{error}</div>}
        {message && <div className="public-quote__alert" role="status"><CheckCircle2 size={18} />{message}</div>}
        {isFinal && !message && <div className="public-quote__alert" role="status"><CheckCircle2 size={18} />This quotation is {quotation.status.toLowerCase().replaceAll('_', ' ')}.</div>}
        {expiredByDate && !isFinal && <div className="public-quote__alert is-warning" role="status">This quotation has passed its validity date and can no longer be accepted.</div>}
      </article>
      {canRespond && <section className="public-quote__decision"><div><b>Ready to decide?</b><span>Choose whether to accept or decline this quotation.</span></div><div><button type="button" className="public-quote__accept" onClick={() => setDecision('ACCEPTED')}><CheckCircle2 size={18} />Accept quotation</button><button type="button" className="public-quote__decline" onClick={() => setDecision('REJECTED')}><XCircle size={18} />Decline</button></div></section>}
    </div>
    {decision && <div className="public-quote__overlay" onMouseDown={event => { if (event.target === event.currentTarget && !working) setDecision(null) }}><section className="public-quote__dialog" role="dialog" aria-modal="true" aria-labelledby="decision-title"><button className="public-quote__close" type="button" aria-label="Close confirmation" disabled={working} onClick={() => setDecision(null)}><X size={19} /></button><span className={decision === 'ACCEPTED' ? 'is-positive' : 'is-negative'}>{decision === 'ACCEPTED' ? <CheckCircle2 size={26} /> : <XCircle size={26} />}</span><h2 id="decision-title">{decision === 'ACCEPTED' ? 'Accept this quotation?' : 'Decline this quotation?'}</h2><p>{decision === 'ACCEPTED' ? 'The business will be notified that you accept the quoted work and price.' : 'The business will be notified that you decline this quotation.'}</p><div><button type="button" disabled={working} onClick={() => setDecision(null)}>Go back</button><button className={decision === 'ACCEPTED' ? 'public-quote__accept' : 'public-quote__confirm-decline'} type="button" disabled={working} onClick={() => void submitDecision()}>{working ? 'Submitting…' : decision === 'ACCEPTED' ? 'Confirm acceptance' : 'Confirm decline'}</button></div></section></div>}
    {canRespond && <div className="public-quote__mobile-actions"><button type="button" className="public-quote__accept" onClick={() => setDecision('ACCEPTED')}><Check size={17} />Accept</button><button type="button" className="public-quote__decline" onClick={() => setDecision('REJECTED')}><X size={17} />Decline</button></div>}
  </main>
}
