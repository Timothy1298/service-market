import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, LayoutGrid, List, PlayCircle, Search, SlidersHorizontal, Wrench } from 'lucide-react'
import { formatDate } from '../../../lib/format'
import { apiRequest, errorMessage } from '../../../services/apiClient'
import './JobsPage.css'

type Job = {
  id: string; jobNumber: string; title: string; description?: string | null; status: string; priority: string
  scheduledStart?: string | null; expectedCompletion?: string | null; completedAt?: string | null; createdAt: string
  customer: { name: string; phone?: string | null }
  quotation?: { quotationNumber: string; grandTotal: string | number } | null
}
type JobStats = { total: number; byStatus: Record<string, number>; active: number; startingThisWeek: number; inProgress: number; completedThisMonth: number }
const statuses = ['ALL', 'SCHEDULED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED']
const boardStatuses = ['SCHEDULED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED']
const nextStatuses: Record<string, string[]> = { SCHEDULED: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'CANCELLED'], ON_HOLD: ['IN_PROGRESS', 'CANCELLED'], COMPLETED: [], CANCELLED: [] }
const label = (value: string) => value === 'IN_PROGRESS' ? 'In progress' : value === 'ON_HOLD' ? 'On hold' : value.charAt(0) + value.slice(1).toLowerCase()
export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [stats, setStats] = useState<JobStats | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const [sort, setSort] = useState('newest')
  const [view, setView] = useState<'table' | 'board'>('table')
  const [filterOpen, setFilterOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const [result, summary] = await Promise.all([apiRequest<{ jobs: Job[] }>('/jobs?pageSize=50'), apiRequest<JobStats>('/jobs/stats')])
      setJobs(result.jobs)
      setStats(summary)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => jobs.filter(job => {
    const matchesStatus = status === 'ALL' || job.status === status
    const text = `${job.jobNumber} ${job.title} ${job.customer.name} ${job.quotation?.quotationNumber ?? ''}`.toLowerCase()
    return matchesStatus && text.includes(query.trim().toLowerCase())
  }).sort((left, right) => sort === 'oldest'
    ? new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    : sort === 'priority'
      ? ['URGENT', 'HIGH', 'NORMAL', 'LOW'].indexOf(left.priority) - ['URGENT', 'HIGH', 'NORMAL', 'LOW'].indexOf(right.priority)
      : new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()), [jobs, query, status, sort])

  const updateStatus = async (job: Job, next: string) => {
    if (['COMPLETED', 'CANCELLED'].includes(next) && !window.confirm(`Mark ${job.jobNumber} ${next === 'COMPLETED' ? 'complete' : 'cancelled'}?`)) return
    setWorking(job.id)
    setError('')
    setMessage('')
    try {
      await apiRequest(`/jobs/${job.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: next }) })
      setMessage(`${job.jobNumber} marked ${label(next).toLowerCase()}.`)
      await load()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setWorking(null)
    }
  }

  const count = (value: string) => value === 'ALL' ? stats?.total ?? 0 : stats?.byStatus[value] ?? 0
  const acceptedHref = '#/app/quotations?status=ACCEPTED'
  const metrics = [
    { title: 'Active jobs', value: stats?.active, note: 'Open work', Icon: Wrench },
    { title: 'Starting this week', value: stats?.startingThisWeek, note: 'Scheduled work', Icon: CalendarDays },
    { title: 'In progress', value: stats?.inProgress, note: 'Currently underway', Icon: PlayCircle },
    { title: 'Completed this month', value: stats?.completedThisMonth, note: 'Finished this month', Icon: CheckCircle2 },
  ]

  return <main className="jobs-page">
    <header className="jobs-page__header"><div><p className="eyebrow green">OPERATIONS</p><h1>Jobs</h1><p>Track work from scheduled to completed.</p></div><a className="jobs-page__primary" href={acceptedHref}>From an accepted quotation</a></header>
    {message && <div className="jobs-page__alert jobs-page__alert--success" role="status">{message}</div>}
    {error && <div className="jobs-page__alert jobs-page__alert--error" role="alert">{error}<button type="button" onClick={() => void load()}>Retry</button></div>}
    <section className="jobs-page__metrics" aria-label="Job summary">{metrics.map(({ title, value, note, Icon }) => <article key={title}><span><Icon size={18} /></span><small>{title}</small><strong>{loading || value === undefined ? '—' : value}</strong><em>{note}</em></article>)}</section>
    <section className="jobs-page__workspace">
      <div className="jobs-page__toolbar"><div><h2>Job workspace</h2><p>{loading ? 'Loading jobs…' : `${filtered.length} job${filtered.length === 1 ? '' : 's'} shown`}</p></div><div className="jobs-page__controls">
        <label className="jobs-page__search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search job number, title, customer…" aria-label="Search jobs" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}</label>
        <button type="button" className={filterOpen ? 'is-active' : ''} onClick={() => setFilterOpen(open => !open)} aria-label="Toggle job filters" aria-expanded={filterOpen}><SlidersHorizontal size={16} />Filters</button>
        <div className="jobs-page__view-toggle" role="group" aria-label="Job view"><button type="button" className={view === 'table' ? 'active' : ''} aria-label="List view" aria-pressed={view === 'table'} onClick={() => setView('table')}><List size={17} /></button><button type="button" className={view === 'board' ? 'active' : ''} aria-label="Board view" aria-pressed={view === 'board'} onClick={() => setView('board')}><LayoutGrid size={17} /></button></div>
      </div></div>
      {filterOpen && <div className="jobs-page__filters"><label>Status<select value={status} onChange={event => setStatus(event.target.value)}>{statuses.map(item => <option value={item} key={item}>{item === 'ALL' ? 'All statuses' : label(item)}</option>)}</select></label><label>Sort by<select value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="priority">Priority</option></select></label><button type="button" onClick={() => { setQuery(''); setStatus('ALL'); setSort('newest'); setFilterOpen(false) }}>Clear filters</button></div>}
      <div className="jobs-page__status-tabs">{statuses.map(item => <button type="button" className={status === item ? 'active' : ''} onClick={() => setStatus(item)} key={item}>{item === 'ALL' ? 'All' : label(item)} <span>{count(item)}</span></button>)}</div>
      {loading ? <div className="jobs-page__loading" aria-label="Loading jobs"><i /><i /><i /></div> : !filtered.length ? <div className="jobs-page__empty"><b>{query || status !== 'ALL' ? 'No jobs match your filters' : 'No jobs yet'}</b><p>{query || status !== 'ALL' ? 'Try another search or clear the filters.' : 'Convert an accepted quotation to create your first job.'}</p><a href={acceptedHref}>View accepted quotations</a></div> : view === 'table' ? <div className="jobs-page__table-wrap"><table className="jobs-page__table"><thead><tr><th>Job</th><th>Customer</th><th>Status</th><th>Priority</th><th>Scheduled</th><th>Expected completion</th><th>Value</th><th>Actions</th></tr></thead><tbody>{filtered.map(job => <tr key={job.id}><td><a className="jobs-page__job-link" href={`#/app/jobs/${job.id}`}>{job.jobNumber}</a><small>{job.title}</small></td><td>{job.customer.name}</td><td><span className={`job-status job-status--${job.status.toLowerCase()}`}>{label(job.status)}</span></td><td><span className={`jobs-page__priority jobs-page__priority--${job.priority.toLowerCase()}`}>{label(job.priority)}</span></td><td>{formatDate(job.scheduledStart)}</td><td className={job.expectedCompletion && new Date(job.expectedCompletion) < new Date() && !['COMPLETED', 'CANCELLED'].includes(job.status) ? 'is-overdue' : ''}>{formatDate(job.expectedCompletion)}</td><td className="jobs-page__amount">{job.quotation ? `KES ${Number(job.quotation.grandTotal).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td><td><div className="jobs-page__row-actions"><a href={`#/app/jobs/${job.id}`}>View</a>{nextStatuses[job.status]?.length > 0 && <select aria-label={`Change ${job.jobNumber} status`} disabled={working === job.id} value="" onChange={event => { const next = event.target.value; if (next) void updateStatus(job, next) }}><option value="">Update</option>{nextStatuses[job.status].map(next => <option value={next} key={next}>{label(next)}</option>)}</select>}{job.status === 'COMPLETED' && <a href={`#/app/invoices/new?jobId=${job.id}`}>Invoice</a>}</div></td></tr>)}</tbody></table></div> : <div className="jobs-page__board">{boardStatuses.map(column => <section className="jobs-page__board-column" key={column}><header><h3>{label(column)}</h3><span>{filtered.filter(job => job.status === column).length}</span></header>{filtered.filter(job => job.status === column).map(job => <article className="jobs-page__board-card" key={job.id}><div><a href={`#/app/jobs/${job.id}`}>{job.jobNumber}</a><span className={`jobs-page__priority jobs-page__priority--${job.priority.toLowerCase()}`}>{label(job.priority)}</span></div><b>{job.title}</b><small>{job.customer.name}</small><small>{job.scheduledStart ? `Scheduled ${formatDate(job.scheduledStart)}` : 'Not scheduled'}</small><div><a href={`#/app/jobs/${job.id}`}>View details</a>{nextStatuses[job.status]?.length > 0 && <select aria-label={`Change ${job.jobNumber} status`} disabled={working === job.id} value="" onChange={event => { const next = event.target.value; if (next) void updateStatus(job, next) }}><option value="">Update status</option>{nextStatuses[job.status].map(next => <option value={next} key={next}>{label(next)}</option>)}</select>}</div></article>)}</section>)}</div>}
    </section>
  </main>
}
