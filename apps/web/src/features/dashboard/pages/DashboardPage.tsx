import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, BarChart3, CalendarDays, CheckCircle2, Clock3, CreditCard, FileText, PackageMinus, Pencil, Receipt, Wallet, Wrench } from 'lucide-react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatDate, formatKES, formatRelative } from '../../../lib/format'
import { useDashboardData, type DashboardInvoice, type Period } from '../hooks/useDashboardData'
import './DashboardPage.css'

type Props = { user: { fullName: string; role: 'PROVIDER' | 'CUSTOMER' | 'ADMIN' } }
const number = (value: number | string | null | undefined) => Number(value ?? 0)
const activeJobStatuses = ['SCHEDULED', 'IN_PROGRESS', 'ON_HOLD']
const unpaid = (invoice: DashboardInvoice) => Math.max(0, number(invoice.grandTotal) - number(invoice.amountPaid))
const greeting = () => new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'

export default function DashboardPage({ user }: Props) {
  const [period, setPeriod] = useState<Period>('month')
  const { data, loading, error, reload } = useDashboardData(period)
  const firstName = user.fullName.trim().split(/\s+/)[0]
  const now = new Date()
  const weekEnd = new Date(now)
  weekEnd.setDate(now.getDate() + 7)
  const jobs = data?.jobs ?? []
  const invoices = data?.invoices ?? []
  const quotations = data?.quotations ?? []
  const materials = data?.materials ?? []
  const currentJobs = jobs.filter(job => activeJobStatuses.includes(job.status))
  const startingJobs = currentJobs.filter(job => job.scheduledStart && new Date(job.scheduledStart) >= now && new Date(job.scheduledStart) <= weekEnd)
  const outstandingInvoices = invoices.filter(invoice => unpaid(invoice) > 0 && invoice.status !== 'CANCELLED' && invoice.status !== 'DRAFT')
  const overdueInvoices = outstandingInvoices.filter(invoice => invoice.status === 'OVERDUE' || Boolean(invoice.dueDate && new Date(invoice.dueDate) < now))
  const awaitingQuotes = quotations.filter(quotation => quotation.status === 'ISSUED')
  const draftQuotes = quotations.filter(quotation => quotation.status === 'DRAFT')
  const lowStock = materials.filter(material => number(material.stockQuantity) <= number(material.reorderLevel))
  const outstandingTotal = outstandingInvoices.reduce((total, invoice) => total + unpaid(invoice), 0)
  const performance = useMemo(() => {
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    if (period === 'week') start.setDate(start.getDate() - 6)
    if (period === 'month') start.setDate(1)
    const buckets: Array<{ period: string; start: Date; end: Date; invoiced: number; received: number; expenses: number }> = []
    for (let cursor = new Date(start); cursor <= end; ) {
      const bucketEnd = new Date(cursor)
      if (period === 'month') bucketEnd.setDate(bucketEnd.getDate() + 6)
      bucketEnd.setHours(23, 59, 59, 999)
      const boundedEnd = bucketEnd > end ? end : bucketEnd
      buckets.push({
        period: period === 'today' ? 'Today' : period === 'month' ? `Week ${buckets.length + 1}` : cursor.toLocaleDateString('en-KE', { weekday: 'short' }),
        start: new Date(cursor), end: boundedEnd, invoiced: 0, received: 0, expenses: 0,
      })
      cursor = new Date(boundedEnd)
      cursor.setDate(cursor.getDate() + 1)
      cursor.setHours(0, 0, 0, 0)
    }
    const addToBucket = (dateValue: string | null | undefined, amount: number | string, key: 'invoiced' | 'received' | 'expenses') => {
      if (!dateValue) return
      const date = new Date(dateValue)
      const bucket = buckets.find(item => date >= item.start && date <= item.end)
      if (bucket) bucket[key] += number(amount)
    }
    data?.invoices.filter(invoice => invoice.status !== 'CANCELLED').forEach(invoice => addToBucket(invoice.issueDate, invoice.grandTotal, 'invoiced'))
    data?.payments.forEach(payment => addToBucket(payment.paymentDate, payment.amount, 'received'))
    data?.expenses.forEach(expense => addToBucket(expense.expenseDate, expense.amount, 'expenses'))
    return buckets
  }, [data, period])
  const hasPerformance = performance.some(row => row.invoiced + row.received + row.expenses > 0)
  const attention = [
    { label: 'Overdue invoices', count: overdueInvoices.length, href: '/app/invoices?status=OVERDUE', Icon: AlertTriangle, tone: 'danger' },
    { label: 'Quotes awaiting response', count: awaitingQuotes.length, href: '/app/quotations?status=ISSUED', Icon: FileText, tone: 'warning' },
    { label: 'Jobs starting this week', count: startingJobs.length, href: '/app/jobs?status=SCHEDULED', Icon: CalendarDays, tone: 'info' },
    { label: 'Low-stock materials', count: lowStock.length, href: '/app/materials?stock=low', Icon: PackageMinus, tone: 'warning' },
    { label: 'Draft quotes to finish', count: draftQuotes.length, href: '/app/quotations?status=DRAFT', Icon: Pencil, tone: 'neutral' },
  ].filter(item => item.count > 0)
  const upcoming = currentJobs.filter(job => job.scheduledStart && new Date(job.scheduledStart) >= now).sort((a, b) => new Date(a.scheduledStart!).getTime() - new Date(b.scheduledStart!).getTime()).slice(0, 5)
  const activity = useMemo(() => {
    if (!data) return []
    return [
      ...data.payments.map(item => ({ id: `payment-${item.id}`, label: 'Payment received', detail: `${item.invoice?.invoiceNumber ?? 'Invoice'} · ${formatKES(item.amount)}`, date: item.createdAt, Icon: Wallet })),
      ...data.invoices.map(item => ({ id: `invoice-${item.id}`, label: `Invoice ${item.invoiceNumber}`, detail: `${item.customer.name} · ${item.status.replaceAll('_', ' ').toLowerCase()}`, date: item.createdAt, Icon: Receipt })),
      ...data.jobs.map(item => ({ id: `job-${item.id}`, label: `Job ${item.jobNumber}`, detail: `${item.customer.name} · ${item.title}`, date: item.createdAt, Icon: Wrench })),
      ...data.expenses.map(item => ({ id: `expense-${item.id}`, label: 'Expense recorded', detail: `${item.description} · ${formatKES(item.amount)}`, date: item.createdAt, Icon: CreditCard })),
      ...data.quotations.map(item => ({ id: `quote-${item.id}`, label: `Quotation ${item.quotationNumber}`, detail: `${item.customer.name} · ${item.status.toLowerCase()}`, date: item.createdAt, Icon: FileText })),
    ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()).slice(0, 6)
  }, [data])

  return <main className="dashboard-v2">
    <header className="dashboard-v2__header">
      <div><h1>Good {greeting()}, {firstName}</h1><p>Here’s how your business is doing.</p></div>
      <div className="dashboard-v2__actions">
        <div className="dashboard-v2__period" role="group" aria-label="Reporting period">
          {([['today', 'Today'], ['week', '7 days'], ['month', 'This month']] as const).map(([key, text]) => <button type="button" key={key} className={period === key ? 'is-active' : ''} aria-pressed={period === key} onClick={() => setPeriod(key)}>{text}</button>)}
        </div>
        <a className="dashboard-v2__primary" href="#/app/quotations/new"><FileText size={17} />New quotation</a>
      </div>
    </header>
    {error && <div className="dashboard-v2__error" role="alert">{error}<button type="button" onClick={() => void reload()}>Try again</button></div>}
    <section className="dashboard-v2__stats" aria-label="Business summary">
      <StatCard label="Invoiced" value={loading ? '—' : formatKES(data?.report.invoicedAmount)} footnote="Issued this period" href="/app/invoices" Icon={Receipt} loading={loading} />
      <StatCard label="Payments received" value={loading ? '—' : formatKES(data?.report.paymentsReceived)} footnote={`${data?.payments.length ?? 0} payments recorded`} href="/app/payments" Icon={Wallet} loading={loading} />
      <StatCard label="Outstanding" value={loading ? '—' : formatKES(outstandingTotal)} footnote={`${outstandingInvoices.length} unpaid · ${overdueInvoices.length} overdue`} href="/app/invoices?status=OUTSTANDING" Icon={Clock3} tone={outstandingTotal > 0 ? 'warning' : 'green'} loading={loading} />
      <StatCard label="Active jobs" value={loading ? '—' : String(currentJobs.length)} footnote={`${startingJobs.length} starting this week`} href="/app/jobs" Icon={Wrench} loading={loading} />
    </section>
    <section className="dashboard-v2__grid dashboard-v2__grid--main">
      <article className="dashboard-v2__card dashboard-v2__cashflow">
        <div className="dashboard-v2__card-head"><div><h2>Cash flow</h2><p>Invoiced, received and spent in this period.</p></div><a href="#/app/reports">View reports <ArrowRight size={15} /></a></div>
        {loading ? <div className="dashboard-v2__chart-skeleton" /> : hasPerformance ? <div className="dashboard-v2__chart" role="img" aria-label="Cash flow chart showing invoiced, received and expenses by selected date range">
          <ResponsiveContainer width="100%" height="100%"><ComposedChart data={performance} margin={{ top: 12, right: 10, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
            <YAxis tickFormatter={value => `${Math.round(Number(value) / 1000)}K`} tickLine={false} axisLine={false} width={48} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
            <Tooltip formatter={value => formatKES(Number(value))} />
            <Legend />
            <Bar dataKey="invoiced" name="Invoiced" fill="var(--green-600)" radius={[5, 5, 0, 0]} />
            <Bar dataKey="received" name="Received" fill="#67B59B" radius={[5, 5, 0, 0]} />
            <Line dataKey="expenses" name="Expenses" stroke="#E5B75E" strokeWidth={2} dot={{ r: 4 }} />
          </ComposedChart></ResponsiveContainer>
        </div> : <div className="dashboard-v2__empty-chart"><BarChart3 size={28} /><b>No activity in this period</b><span>Recorded income and expenses will appear here.</span></div>}
      </article>
      <article className="dashboard-v2__card dashboard-v2__attention">
        <div className="dashboard-v2__card-head"><div><h2>Needs attention</h2><p>Items that may need action.</p></div></div>
        {loading ? <div className="dashboard-v2__list-skeleton" /> : attention.length ? <div>{attention.map(({ label, count, href, Icon, tone }) => <a className="dashboard-v2__attention-row" href={`#${href}`} key={label}><span className={`dashboard-v2__attention-icon ${tone}`}><Icon size={18} /></span><span>{label}</span><b>{count}</b><ArrowRight size={16} /></a>)}</div> : <div className="dashboard-v2__caught-up"><CheckCircle2 size={30} /><b>You’re all caught up</b></div>}
      </article>
    </section>
    <section className="dashboard-v2__grid">
      <article className="dashboard-v2__card dashboard-v2__list-card"><CardHeading title="Upcoming jobs" href="/app/jobs" />
        {loading ? <div className="dashboard-v2__list-skeleton" /> : upcoming.length ? upcoming.map(job => <a className="dashboard-v2__compact-row" href={`#/app/jobs/${job.id}`} key={job.id}><span className="dashboard-v2__date-tile"><b>{new Date(job.scheduledStart!).getDate()}</b><small>{new Date(job.scheduledStart!).toLocaleDateString('en-KE', { month: 'short' }).toUpperCase()}</small></span><span className="dashboard-v2__row-copy"><b>{job.jobNumber} · {job.title}</b><small>{job.customer.name}{job.customer.location ? ` · ${job.customer.location}` : ''}</small></span><Status value={job.status} /></a>) : <Empty title="No upcoming jobs" detail="Scheduled work will appear here." action="View jobs" href="/app/jobs" />}
      </article>
      <article className="dashboard-v2__card dashboard-v2__list-card"><CardHeading title="Outstanding invoices" href="/app/invoices?status=OUTSTANDING" />
        {loading ? <div className="dashboard-v2__list-skeleton" /> : outstandingInvoices.slice(0, 5).length ? outstandingInvoices.slice(0, 5).map(invoice => <a className="dashboard-v2__invoice-row" href={`#/app/invoices/${invoice.id}`} key={invoice.id}><span className="dashboard-v2__row-copy"><b>{invoice.invoiceNumber}</b><small>{invoice.customer.name} · Due {formatDate(invoice.dueDate)}</small></span><strong className={overdueInvoices.includes(invoice) ? 'is-overdue' : ''}>{formatKES(unpaid(invoice))}</strong></a>) : <Empty title="All invoices are settled" detail="Unpaid balances will appear here." action="View invoices" href="/app/invoices" />}
      </article>
    </section>
    <section className="dashboard-v2__grid">
      <article className="dashboard-v2__card dashboard-v2__list-card"><CardHeading title="Recent activity" />
        {loading ? <div className="dashboard-v2__list-skeleton" /> : activity.length ? activity.map(({ id, label, detail, date, Icon }) => <div className="dashboard-v2__activity-row" key={id}><span><Icon size={17} /></span><span className="dashboard-v2__row-copy"><b>{label}</b><small>{detail}</small></span><time>{formatRelative(date)}</time></div>) : <Empty title="No recent activity" detail="New records will be shown here." />}
      </article>
      <article className="dashboard-v2__card dashboard-v2__list-card"><CardHeading title="Inventory alerts" href="/app/materials?stock=low" />
        {loading ? <div className="dashboard-v2__list-skeleton" /> : lowStock.slice(0, 5).length ? lowStock.slice(0, 5).map(material => <div className="dashboard-v2__stock-row" key={material.id}><span className="dashboard-v2__row-copy"><b>{material.name}</b><small>{material.stockQuantity} / {material.reorderLevel} {material.unit}</small></span><span className={`dashboard-v2__stock-status ${number(material.stockQuantity) <= 0 ? 'danger' : 'warning'}`}>{number(material.stockQuantity) <= 0 ? 'Out' : 'Low'}</span><a href="#/app/materials">Restock</a></div>) : <Empty title="Inventory levels look healthy" detail="Stock alerts will appear here." action="Manage inventory" href="/app/materials" />}
      </article>
    </section>
  </main>
}

function StatCard({ label, value, footnote, href, Icon, tone = 'green', loading }: { label: string; value: string; footnote: string; href: string; Icon: typeof Receipt; tone?: string; loading: boolean }) {
  return <a className="dashboard-v2__stat" href={`#${href}`}><span className="dashboard-v2__stat-top"><small>{label}</small><i className={tone}><Icon size={20} /></i></span><strong>{loading ? <i className="dashboard-v2__value-skeleton" /> : value}</strong><em>{loading ? 'Loading…' : footnote}</em></a>
}

function CardHeading({ title, href }: { title: string; href?: string }) { return <div className="dashboard-v2__card-head"><div><h2>{title}</h2></div>{href && <a href={`#${href}`}>View all <ArrowRight size={15} /></a>}</div> }
function Empty({ title, detail, action, href }: { title: string; detail: string; action?: string; href?: string }) { return <div className="dashboard-v2__empty"><b>{title}</b><span>{detail}</span>{action && href && <a href={`#${href}`}>{action}</a>}</div> }
function Status({ value }: { value: string }) { return <span className={`dashboard-v2__status ${value.toLowerCase()}`}>{value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, character => character.toUpperCase())}</span> }
