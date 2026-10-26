import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, Check, CircleDollarSign, Clock3, PackagePlus, Receipt } from 'lucide-react'
import { formatDate, formatDateTime, formatKES } from '../../../lib/format'
import { apiRequest, errorMessage } from '../../../services/apiClient'
import './JobDetailPage.css'

type JobRecord = {
  id: string; jobNumber: string; title: string; description?: string | null; location?: string | null; status: string; priority: string; scheduledStart?: string | null; expectedCompletion?: string | null; actualStart?: string | null; completedAt?: string | null; internalNotes?: string | null; createdAt: string
  customer: { id: string; name: string; phone: string }
  quotation: { id: string; quotationNumber: string; grandTotal: number | string; items: Array<{ id: string; description: string }> }
  activities: Array<{ id: string; type: string; message: string; createdAt: string; user: { fullName: string } }>
  materialsUsed: Array<{ id: string; quantity: number | string; costPerUnit: number | string; material: { name: string; unit: string } }>
  invoices: Array<{ id: string; invoiceNumber: string; status: string; grandTotal: number | string; amountPaid: number | string }>
  expenses: Array<{ id: string; description: string; amount: number | string; expenseDate: string }>
}
type Material = { id: string; name: string; unit: string; stockQuantity: number | string; costPerUnit: number | string }
const transitions: Record<string, string[]> = { SCHEDULED: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'CANCELLED'], ON_HOLD: ['IN_PROGRESS', 'CANCELLED'], COMPLETED: [], CANCELLED: [] }
const label = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, char => char.toUpperCase())

export default function JobDetailPage({ id }: { id: string }) {
  const [job, setJob] = useState<JobRecord | null>(null)
  const [materials, setMaterials] = useState<Material[]>([])
  const [selectedMaterial, setSelectedMaterial] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [reason, setReason] = useState('')
  const [showMaterials, setShowMaterials] = useState(false)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try { const result = await apiRequest<{ job: JobRecord }>(`/jobs/${id}`); setJob(result.job) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [id])

  const materialCost = useMemo(() => job?.materialsUsed.reduce((sum, entry) => sum + Number(entry.quantity) * Number(entry.costPerUnit), 0) ?? 0, [job])
  const expenseTotal = useMemo(() => job?.expenses.reduce((sum, expense) => sum + Number(expense.amount), 0) ?? 0, [job])
  const invoiceTotal = useMemo(() => job?.invoices.filter(invoice => invoice.status !== 'CANCELLED').reduce((sum, invoice) => sum + Number(invoice.grandTotal), 0) ?? 0, [job])
  const paidTotal = useMemo(() => job?.invoices.reduce((sum, invoice) => sum + Number(invoice.amountPaid), 0) ?? 0, [job])
  const allowed = job ? transitions[job.status] ?? [] : []

  const changeStatus = async (next: string) => {
    if (!job) return
    if (['COMPLETED', 'CANCELLED'].includes(next) && !window.confirm(`Mark ${job.jobNumber} ${next.toLowerCase()}?`)) return
    setWorking(true); setError(''); setMessage('')
    try { await apiRequest(`/jobs/${job.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: next }) }); setMessage(`${job.jobNumber} updated to ${label(next)}.`); await load() }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setWorking(false) }
  }

  const openMaterialForm = async () => {
    setError(''); setMessage('')
    try {
      const result = await apiRequest<{ materials: Material[] }>('/materials')
      setMaterials(result.materials.filter(item => Number(item.stockQuantity) > 0))
      setSelectedMaterial(result.materials.find(item => Number(item.stockQuantity) > 0)?.id ?? '')
      setShowMaterials(true)
    } catch (cause) { setError(errorMessage(cause)) }
  }
  const useMaterial = async (event: FormEvent) => {
    event.preventDefault()
    if (!job) return
    setWorking(true); setError(''); setMessage('')
    try {
      await apiRequest(`/jobs/${job.id}/materials`, { method: 'POST', body: JSON.stringify({ materialId: selectedMaterial, quantity: Number(quantity), reason: reason || undefined }) })
      setShowMaterials(false); setMessage('Material usage recorded and inventory reduced.'); await load()
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setWorking(false) }
  }

  if (loading) return <main className="job-detail"><div className="job-detail__loading" /></main>
  if (!job) return <main className="job-detail"><a className="job-detail__back" href="#/app/jobs"><ArrowLeft size={17} />Jobs</a><div className="job-detail__alert is-error" role="alert">{error || 'Job not found'}</div></main>
  const stepStatuses = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED']
  const currentStep = job.status === 'ON_HOLD' ? 1 : stepStatuses.indexOf(job.status)
  return <main className="job-detail">
    <a className="job-detail__back" href="#/app/jobs"><ArrowLeft size={17} />Jobs</a>
    <header className="job-detail__header"><div><p className="eyebrow green">JOB MANAGEMENT</p><h1>{job.jobNumber}</h1><p>{job.title} · <a href={`#/app/customers/${job.customer.id}`}>{job.customer.name}</a></p></div><div className="job-detail__header-actions"><span className={`job-detail__badge ${job.status.toLowerCase()}`}>{label(job.status)}</span>{allowed.map(next => <button className={next === (job.status === 'SCHEDULED' ? 'IN_PROGRESS' : 'COMPLETED') ? 'primary' : ''} type="button" key={next} disabled={working} onClick={() => void changeStatus(next)}>{next === 'IN_PROGRESS' ? 'Start job' : next === 'COMPLETED' ? 'Mark complete' : label(next)}</button>)}</div></header>
    {(message || error) && <div className={`job-detail__alert${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || message}{error && <button type="button" onClick={() => void load()}>Retry</button>}</div>}
    <section className="job-detail__stepper">{stepStatuses.map((status, index) => <div className={index < currentStep ? 'done' : index === currentStep ? 'current' : ''} key={status}><i>{index < currentStep ? <Check size={14} /> : index + 1}</i><span>{label(status)}</span></div>)}</section>
    <div className="job-detail__grid"><div className="job-detail__main-column">
      <section className="job-detail__card"><h2>Job details</h2><dl><dt>Customer</dt><dd><a href={`#/app/customers/${job.customer.id}`}>{job.customer.name}</a></dd><dt>Location</dt><dd>{job.location || 'Not specified'}</dd><dt>Priority</dt><dd><span className={`job-detail__priority ${job.priority.toLowerCase()}`}>{label(job.priority)}</span></dd><dt>Scheduled start</dt><dd>{formatDate(job.scheduledStart)}</dd><dt>Expected completion</dt><dd>{formatDate(job.expectedCompletion)}</dd><dt>Actual start</dt><dd>{formatDate(job.actualStart)}</dd><dt>Quotation</dt><dd><a href={`#/app/quotations/${job.quotation.id}`}>{job.quotation.quotationNumber}</a></dd></dl>{job.description && <p className="job-detail__description">{job.description}</p>}</section>
      <section className="job-detail__card"><header><div><h2>Materials used</h2><p>Inventory deductions linked to this job.</p></div><button type="button" onClick={() => void openMaterialForm()}><PackagePlus size={16} />Add material</button></header>{job.materialsUsed.length ? <div className="job-detail__table">{job.materialsUsed.map(entry => <div key={entry.id}><span>{entry.material.name}<small>{entry.quantity} {entry.material.unit} × {formatKES(entry.costPerUnit)}</small></span><strong>{formatKES(Number(entry.quantity) * Number(entry.costPerUnit))}</strong></div>)}</div> : <div className="job-detail__empty">No materials recorded for this job.</div>}</section>
      <section className="job-detail__card"><h2>Internal notes</h2><p className="job-detail__notes">{job.internalNotes || 'No internal notes added.'}</p></section>
    </div><aside className="job-detail__side-column">
      <section className="job-detail__card"><h2><CircleDollarSign size={17} />Financial summary</h2><dl><dt>Quoted value</dt><dd>{formatKES(job.quotation.grandTotal)}</dd><dt>Invoiced</dt><dd>{formatKES(invoiceTotal)}</dd><dt>Paid</dt><dd>{formatKES(paidTotal)}</dd><dt>Expenses</dt><dd>{formatKES(expenseTotal)}</dd><dt>Materials cost</dt><dd>{formatKES(materialCost)}</dd><dt>Estimated margin</dt><dd className={Number(job.quotation.grandTotal) - expenseTotal - materialCost < 0 ? 'negative' : ''}>{formatKES(Number(job.quotation.grandTotal) - expenseTotal - materialCost)}</dd></dl></section>
      <section className="job-detail__card"><h2><Clock3 size={17} />Activity</h2>{job.activities.length ? <div className="job-detail__activity">{job.activities.map(activity => <div key={activity.id}><i /><span><b>{activity.message}</b><small>{activity.user.fullName} · {formatDateTime(activity.createdAt)}</small></span></div>)}</div> : <div className="job-detail__empty">No activity recorded.</div>}</section>
      <section className="job-detail__card"><h2><Receipt size={17} />Linked invoices</h2>{job.invoices.length ? job.invoices.map(invoice => <a className="job-detail__linked" href={`#/app/invoices/${invoice.id}`} key={invoice.id}><span><b>{invoice.invoiceNumber}</b><small>{label(invoice.status)}</small></span><strong>{formatKES(invoice.grandTotal)}</strong></a>) : <div className="job-detail__empty">No invoices linked.</div>}</section>
    </aside></div>
    {showMaterials && <div className="job-detail__modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setShowMaterials(false) }}><section role="dialog" aria-modal="true" aria-labelledby="job-material-title"><header><div><p className="eyebrow green">INVENTORY USAGE</p><h2 id="job-material-title">Add material to job</h2></div><button type="button" onClick={() => setShowMaterials(false)} aria-label="Close">×</button></header>{materials.length ? <form onSubmit={useMaterial}><label>Material<select value={selectedMaterial} onChange={event => setSelectedMaterial(event.target.value)} required>{materials.map(item => <option value={item.id} key={item.id}>{item.name} · {item.stockQuantity} {item.unit} available</option>)}</select></label><label>Quantity<input type="number" min="0.01" step="0.01" value={quantity} onChange={event => setQuantity(event.target.value)} required /></label><label>Note (optional)<input value={reason} onChange={event => setReason(event.target.value)} maxLength={300} /></label><p>Stock updates immediately after recording usage.</p><footer><button type="button" onClick={() => setShowMaterials(false)}>Cancel</button><button className="primary" disabled={working}>{working ? 'Recording…' : 'Record usage'}</button></footer></form> : <div className="job-detail__empty">No in-stock materials available to use.</div>}</section></div>}
  </main>
}
