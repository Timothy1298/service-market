import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRightCircle, Check, Copy, Download, MessageCircle, Send } from 'lucide-react'
import { formatDate, formatKESPrecise } from '../../../lib/format'
import { API, apiRequest, errorMessage } from '../../../services/apiClient'
import './QuotationDetailPage.css'

type Quotation = {
  id: string; quotationNumber: string; title: string; description?: string | null; location?: string | null; currency: string; issueDate?: string | null; expiryDate?: string | null; createdAt: string; updatedAt: string; status: string; subtotal: number | string; discount: number | string; tax: number | string; grandTotal: number | string; terms?: string | null; paymentTerms?: string | null
  items: Array<{ id: string; description: string; quantity: number | string; unit: string; unitPrice: number | string; lineTotal: number | string }>
  customer: { name: string; phone: string; email?: string | null; billingAddress?: string | null }
  business: { name: string; phone: string; email?: string | null; address?: string | null; slogan?: string | null }
  jobs: Array<{ id: string; jobNumber: string; status: string }>
}

export default function QuotationDetailPage({ id }: { id: string }) {
  const [quotation, setQuotation] = useState<Quotation | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const load = async () => {
    setLoading(true)
    setError('')
    try { const result = await apiRequest<{ quotation: Quotation }>(`/quotations/${id}`); setQuotation(result.quotation) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [id])

  const createShareLink = async () => {
    if (shareUrl) return shareUrl
    const result = await apiRequest<{ shareUrl: string }>(`/quotations/${id}/share`, { method: 'POST' })
    setShareUrl(result.shareUrl)
    return result.shareUrl
  }
  const copyShareLink = async () => {
    setError(''); setMessage('')
    try {
      const url = await createShareLink()
      await navigator.clipboard.writeText(url)
      setMessage('Secure quotation link copied.')
    } catch (cause) { setError(errorMessage(cause)) }
  }

  const perform = async (action: 'issue' | 'share' | 'convert') => {
    if (!quotation) return
    if (action === 'issue' && !window.confirm('Once issued, this quotation is locked and can be shared. Issue it now?')) return
    setWorking(true); setError(''); setMessage('')
    try {
      if (action === 'issue') {
        await apiRequest(`/quotations/${id}/issue`, { method: 'POST' })
        setMessage('Quotation issued successfully.')
        await load()
      } else if (action === 'share') {
        const whatsappWindow = window.open('', '_blank')
        if (whatsappWindow) whatsappWindow.opener = null
        try {
          const url = await createShareLink()
          await navigator.clipboard.writeText(url).catch(() => undefined)
          if (whatsappWindow) whatsappWindow.location.href = `https://wa.me/${quotation.customer.phone.replace(/\D/g, '').replace(/^0/, '254')}?text=${encodeURIComponent(`Hello ${quotation.customer.name}, please review quotation ${quotation.quotationNumber}: ${url}`)}`
          setMessage(whatsappWindow ? 'Secure link copied and WhatsApp opened. Attach the downloaded PDF separately if needed.' : 'Secure link copied. Allow pop-ups to open WhatsApp directly.')
        } catch (cause) {
          whatsappWindow?.close()
          throw cause
        }
      } else {
        const result = await apiRequest<{ job: { id: string } }>(`/quotations/${id}/convert-to-job`, { method: 'POST', body: JSON.stringify({ title: quotation.title, description: quotation.description ?? undefined, location: quotation.location ?? undefined }) })
        window.location.hash = `/app/jobs/${result.job.id}`
      }
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setWorking(false) }
  }

  if (loading) return <main className="quotation-detail"><div className="quotation-detail__loading" /></main>
  if (!quotation) return <main className="quotation-detail"><a href="#/app/quotations"><ArrowLeft size={17} />Quotations</a><div className="quotation-detail__alert" role="alert">{error || 'Quotation not found'}</div></main>
  const issued = Boolean(quotation.issueDate)
  return <main className="quotation-detail">
    <a className="quotation-detail__back" href="#/app/quotations"><ArrowLeft size={17} />Quotations</a>
    <header className="quotation-detail__header"><div><p className="eyebrow green">QUOTATION DETAILS</p><h1>{quotation.quotationNumber}</h1><p>{quotation.title}</p></div><span className={`quotation-detail__status ${quotation.status.toLowerCase()}`}>{quotation.status === 'ISSUED' ? 'Awaiting response' : quotation.status.replaceAll('_', ' ')}</span></header>
    {(error || message) && <div className={`quotation-detail__alert${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}{error && <button type="button" onClick={() => void load()}>Retry</button>}</div>}
    <div className="quotation-detail__layout"><article className="quotation-detail__document"><header><div><b>{quotation.business.name}</b><small>{quotation.business.phone}{quotation.business.email ? ` · ${quotation.business.email}` : ''}</small>{quotation.business.address && <small>{quotation.business.address}</small>}</div><div className="quotation-detail__doc-label"><span>QUOTATION</span><strong>{quotation.quotationNumber}</strong></div></header>
      <div className="quotation-detail__parties"><section><small>PREPARED FOR</small><b>{quotation.customer.name}</b><span>{quotation.customer.phone}</span>{quotation.customer.email && <span>{quotation.customer.email}</span>}{quotation.customer.billingAddress && <span>{quotation.customer.billingAddress}</span>}</section><section><small>DATES</small><span>Issued: {formatDate(quotation.issueDate)}</span><span>Valid until: {formatDate(quotation.expiryDate)}</span>{quotation.location && <span>Project: {quotation.location}</span>}</section></div>
      <h2>{quotation.title}</h2>{quotation.description && <p className="quotation-detail__description">{quotation.description}</p>}
      <div className="quotation-detail__table"><div className="quotation-detail__table-head"><span>Description</span><span>Qty</span><span>Unit price</span><span>Total</span></div>{quotation.items.map(item => <div className="quotation-detail__item" key={item.id}><span>{item.description}<small>{item.unit}</small></span><span>{item.quantity}</span><span>{formatKESPrecise(item.unitPrice)}</span><strong>{formatKESPrecise(item.lineTotal)}</strong></div>)}</div>
      <div className="quotation-detail__totals"><span>Subtotal<strong>{formatKESPrecise(quotation.subtotal)}</strong></span><span>Discount<strong>{formatKESPrecise(quotation.discount)}</strong></span><span>Tax<strong>{formatKESPrecise(quotation.tax)}</strong></span><b>Total<strong>{formatKESPrecise(quotation.grandTotal)}</strong></b></div>
      {(quotation.paymentTerms || quotation.terms) && <footer>{quotation.paymentTerms && <section><b>Payment terms</b><p>{quotation.paymentTerms}</p></section>}{quotation.terms && <section><b>Terms & conditions</b><p>{quotation.terms}</p></section>}</footer>}
    </article>
    <aside className="quotation-detail__sidebar"><section className="quotation-detail__side-card"><h2>Status</h2><div className="quotation-detail__timeline"><div><i><Check size={13} /></i><span><b>Created</b><small>{formatDate(quotation.createdAt)}</small></span></div><div className={issued ? 'done' : ''}><i>{issued && <Check size={13} />}</i><span><b>Issued</b><small>{issued ? formatDate(quotation.issueDate) : 'Not issued'}</small></span></div>{['ACCEPTED', 'REJECTED', 'EXPIRED'].includes(quotation.status) && <div className="done"><i><Check size={13} /></i><span><b>{quotation.status === 'ACCEPTED' ? 'Accepted' : quotation.status === 'REJECTED' ? 'Rejected' : 'Expired'}</b><small>{formatDate(quotation.updatedAt)}</small></span></div>}</div></section>
      <section className="quotation-detail__side-card"><h2>Actions</h2><div className="quotation-detail__action-list">{quotation.status === 'DRAFT' && <button type="button" disabled={working} onClick={() => void perform('issue')}><Send size={16} />Issue quotation</button>}{issued && quotation.status !== 'EXPIRED' && <button className="primary" type="button" disabled={working} onClick={() => void perform('share')}><MessageCircle size={16} />Share on WhatsApp</button>}{issued && quotation.status !== 'EXPIRED' && <><label className="quotation-detail__share-field"><span>Secure customer link</span><input readOnly value={shareUrl} placeholder="Generate a secure link to share" /></label><button type="button" disabled={working} onClick={() => void copyShareLink()}><Copy size={16} />{shareUrl ? 'Copy secure link' : 'Create and copy link'}</button></>}{issued && <a href={`${API}/quotations/${id}/pdf`} target="_blank" rel="noreferrer"><Download size={16} />Download PDF</a>}{quotation.status === 'ACCEPTED' && !quotation.jobs[0] && <button type="button" disabled={working} onClick={() => void perform('convert')}><ArrowRightCircle size={16} />Convert to job</button>}<button type="button" onClick={() => { void navigator.clipboard?.writeText(window.location.href); setMessage('Quotation page link copied.') }}><Copy size={16} />Copy page link</button></div></section>
      {quotation.jobs[0] && <section className="quotation-detail__side-card"><h2>Linked job</h2><a className="quotation-detail__linked" href={`#/app/jobs/${quotation.jobs[0].id}`}><b>{quotation.jobs[0].jobNumber}</b><span>{quotation.jobs[0].status.replaceAll('_', ' ')}</span></a></section>}
    </aside></div>
  </main>
}
