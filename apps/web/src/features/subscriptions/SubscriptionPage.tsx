import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CalendarDays, Check, CircleAlert, Clock3, CreditCard, Crown, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { apiRequest, errorMessage } from '../../services/apiClient'
import './SubscriptionPage.css'

type User = { fullName: string; phone: string; role: 'PROVIDER' | 'CUSTOMER' | 'ADMIN' }
type Plan = { id: string; code: string; name: string; description?: string; price: string | number; currency: string; durationMonths: number; billingCycle?: string; features?: string[]; limits?: Record<string, number | null> }
type Transaction = { id: string; amount: string | number; currency: string; provider: string; status: string; phoneNumber: string; mpesaReceipt?: string | null; failureReason?: string | null; requestedAt: string; completedAt?: string | null }
type Billing = { subscription: { status: string; planCode?: string; price: string | number; currency: string; startsAt?: string | null; expiresAt?: string | null; autoRenew?: boolean; cancelledAt?: string | null }; plan?: Plan; usage?: { customers: { used: number; limit: number | null }; quotations: { used: number; limit: number | null }; teamMembers: { used: number; limit: number | null } }; business?: { name: string; phone?: string; email?: string | null }; pendingTransactionId?: string | null; transactions: Transaction[]; pagination?: { page: number; pageSize: number; total: number } }
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : '—'
const statusCopy: Record<string, string> = { FREE: 'You are using the free account tier. Choose an available plan to unlock paid features.', ACTIVE: 'Your subscription is active. You can renew before the paid period ends.', PENDING: 'A payment is awaiting confirmation. Your current access remains unchanged until payment is verified.', EXPIRED: 'Your subscription has expired. Renew to restore access to restricted features.', CANCELLED: 'This subscription has ended. Choose a plan to resume paid access.', UNAVAILABLE: 'Subscription information could not be loaded. Refresh to try again.' }
const statusLabel: Record<string, string> = { FREE: 'Free', ACTIVE: 'Active', PENDING: 'Payment pending', EXPIRED: 'Expired', CANCELLED: 'Cancelled', COMPLETED: 'Successful', FAILED: 'Failed', UNKNOWN: 'Needs review', UNAVAILABLE: 'Unavailable', LOADING: 'Loading' }

export default function SubscriptionPage({ user }: { user: User }) {
  const [billing, setBilling] = useState<Billing | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [selected, setSelected] = useState('')
  const [phone, setPhone] = useState(user.phone ?? '')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [changingCancellation, setChangingCancellation] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('ALL')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(1)
  const [history, setHistory] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const pageSize = 10

  const load = useCallback(async (historyPage = 1, historyStatus = 'ALL', term = '', from = '', to = '') => {
    setError('')
    try {
      const statusQuery = historyStatus === 'ALL' ? '' : `&status=${historyStatus}`
      const searchQuery = term.trim() ? `&q=${encodeURIComponent(term.trim())}` : ''
      const dateQuery = `${from ? `&from=${encodeURIComponent(`${from}T00:00:00.000+03:00`)}` : ''}${to ? `&to=${encodeURIComponent(`${to}T23:59:59.999+03:00`)}` : ''}`
      const [current, available] = await Promise.all([
        apiRequest<Billing>('/billing'),
        apiRequest<{ plans: Plan[] }>('/billing/plans'),
      ])
      setBilling(current)
      setPlans(available.plans)
      setSelected(value => value || current.subscription.planCode || available.plans[0]?.code || '')
      const ledger = await apiRequest<{ transactions: Transaction[]; pagination: { total: number } }>(`/billing?page=${historyPage}&pageSize=${pageSize}${statusQuery}${searchQuery}${dateQuery}`)
      setHistory(ledger.transactions)
      setTotal(ledger.pagination.total)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { const timer = window.setTimeout(() => void load(page, filter, search, fromDate, toDate), 250); return () => window.clearTimeout(timer) }, [load, page, filter, search, fromDate, toDate])
  const pending = billing?.pendingTransactionId ?? null
  useEffect(() => {
    if (!pending) return
    const timer = window.setInterval(async () => {
      try {
        const result = await apiRequest<{ transaction: Transaction }>(`/billing/transactions/${pending}`)
        if (result.transaction.status !== 'PENDING') {
          setNotice(result.transaction.status === 'COMPLETED' ? 'Payment confirmed. Your subscription has been updated.' : result.transaction.failureReason || `Payment status: ${statusLabel[result.transaction.status] ?? result.transaction.status}`)
          await load(page, filter, search, fromDate, toDate)
        }
      } catch { /* Retry transient polling errors. */ }
    }, 4000)
    return () => window.clearInterval(timer)
  }, [pending, load, page, filter, search, fromDate, toDate])

  const chosenPlan = plans.find(plan => plan.code === selected) ?? plans[0]
  const beginPayment = async (event: FormEvent) => {
    event.preventDefault()
    if (!chosenPlan) return
    setWorking(true); setError(''); setNotice('')
    try {
      const result = await apiRequest<{ message: string }>('/billing/mpesa/initiate', { method: 'POST', body: JSON.stringify({ phoneNumber: phone, planCode: chosenPlan.code }) })
      setNotice(result.message)
      await load(page, filter, search, fromDate, toDate)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setWorking(false) }
  }
  const updateCancellation = async () => {
    setChangingCancellation(true); setError(''); setNotice('')
    try {
      const path = sub?.cancelledAt ? '/billing/reactivate' : '/billing/cancel-renewal'
      const result = await apiRequest<{ message: string }>(path, { method: 'POST' })
      setNotice(result.message)
      await load(page, filter, search, fromDate, toDate)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setChangingCancellation(false) }
  }
  const updateAutoRenew = async (enabled: boolean) => {
    setChangingCancellation(true); setError(''); setNotice('')
    try {
      const result = await apiRequest<{ message: string }>('/billing/auto-renew', { method: 'POST', body: JSON.stringify({ enabled }) })
      setNotice(result.message)
      await load(page, filter, search, fromDate, toDate)
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setChangingCancellation(false) }
  }

  const filteredHistory = history
  const sub = billing?.subscription
  const status = sub?.status ?? (loading ? 'LOADING' : 'UNAVAILABLE')
  const isActive = status === 'ACTIVE' && !!sub?.expiresAt && new Date(sub.expiresAt) > new Date()

  if (user.role !== 'PROVIDER') return <main className="subscription-page"><section className="subscription-history panel"><p className="eyebrow green">ACCOUNT &amp; BILLING</p><h1>Subscription &amp; billing</h1><p>Subscription management is available to business accounts.</p></section></main>

  return <div className="subscription-page">
    <header className="subscription-heading">
      <div><p className="eyebrow green">ACCOUNT & BILLING</p><h1>Subscription &amp; billing</h1><p>Manage your FundiQuote plan and review subscription payments.</p></div>
      <button className="subscription-refresh" type="button" onClick={() => void load(page, filter)} aria-label="Refresh billing"><RefreshCw size={16} /> Refresh</button>
    </header>
    {error && <div className="subscription-alert is-error" role="alert"><CircleAlert size={18} />{error}</div>}
    {notice && <div className="subscription-alert is-notice" role="status"><ShieldCheck size={18} />{notice}</div>}

    <section className="subscription-overview panel">
      <div className="subscription-overview-main">
        <span className="subscription-plan-icon"><Crown size={21} /></span>
        <div><p className="subscription-kicker">CURRENT SUBSCRIPTION</p><h2>{loading ? 'Loading subscription…' : status === 'UNAVAILABLE' ? 'Subscription unavailable' : isActive ? billing?.plan?.name ?? sub?.planCode ?? 'Subscription' : status === 'PENDING' ? 'Payment in progress' : status === 'FREE' ? 'Free plan' : billing?.plan?.name ?? sub?.planCode ?? 'Subscription'}</h2><p>{statusCopy[status] ?? 'Review your current subscription details below.'}</p></div>
      </div>
      <span className={`subscription-badge status-${status.toLowerCase()}`}><span />{statusLabel[status] ?? status}</span>
      <div className="subscription-facts">
        <div><span>Business</span><strong>{billing?.business?.name ?? 'Your business'}</strong></div>
        <div><span>Billing cycle</span><strong>{billing?.plan ? billing.plan.durationMonths === 12 ? 'Annual' : `${billing.plan.durationMonths} month${billing.plan.durationMonths === 1 ? '' : 's'}` : '—'}</strong></div>
        <div><span>Started</span><strong>{date(sub?.startsAt)}</strong></div>
        <div><span>{isActive ? 'Paid through' : 'Expiry date'}</span><strong>{date(sub?.expiresAt)}</strong></div>
        <div><span>Price</span><strong>{billing ? `${sub?.currency ?? billing.plan?.currency ?? 'KES'} ${Number(sub?.price ?? billing.plan?.price ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}` : '—'}</strong></div>
        <div><span>Renewal method</span><strong>{sub?.cancelledAt ? 'Ending at paid-through date' : sub?.autoRenew ? 'Automatic M‑Pesa prompt' : 'Manual M‑Pesa renewal'}</strong></div>
        <div><span>Billing contact</span><strong>{billing?.business?.email || billing?.business?.phone || 'Add business contact in Settings'}</strong></div>
        <div><span>Last payment method</span><strong>{billing?.transactions?.find(item => item.status === 'COMPLETED') ? 'M‑Pesa' : 'No payment recorded'}</strong></div>
      </div>
      {isActive && <p className="subscription-renew-note"><CalendarDays size={15} /> Access continues through {date(sub?.expiresAt)}. Renewals are added to the end of the paid period.</p>}
      {isActive && <div className="subscription-lifecycle-actions"><span>{sub?.cancelledAt ? `Cancellation scheduled ${date(sub.cancelledAt)}; access remains until ${date(sub.expiresAt)}.` : sub?.autoRenew ? 'An M‑Pesa prompt will be sent 24 hours before expiry. You must approve it with your PIN.' : 'Renew manually or opt in to a payment prompt 24 hours before expiry.'}</span><div><button type="button" onClick={() => void updateAutoRenew(!sub?.autoRenew)} disabled={changingCancellation || !!sub?.cancelledAt}>{changingCancellation ? 'Updating…' : sub?.autoRenew ? 'Turn off auto-renew' : 'Enable auto-renew'}</button><button type="button" onClick={() => void updateCancellation()} disabled={changingCancellation}>{changingCancellation ? 'Updating…' : sub?.cancelledAt ? 'Keep subscription' : 'Schedule cancellation'}</button></div></div>}
    </section>

    {billing?.usage && Object.values(billing.usage).some(metric => metric.limit !== null) && <section className="subscription-usage"><div className="subscription-section-heading"><div><p className="eyebrow green">USAGE</p><h2>Plan usage</h2><p>Usage is calculated from your business records.</p></div></div><div className="subscription-usage-grid">{([['Customers', billing.usage.customers], ['Quotations this month', billing.usage.quotations], ['Team members', billing.usage.teamMembers]] as const).filter(([, metric]) => metric.limit !== null).map(([label, metric]) => <article className="subscription-usage-card panel" key={label}><div><span>{label}</span><strong>{metric.used} / {metric.limit}</strong></div><progress max={Math.max(metric.limit ?? 1, 1)} value={Math.min(metric.used, metric.limit ?? metric.used)} /><small>{Math.max(0, (metric.limit ?? metric.used) - metric.used)} remaining</small></article>)}</div></section>}

    <section className="subscription-plans-section">
      <div className="subscription-section-heading"><div><p className="eyebrow green">PLANS</p><h2>Choose a subscription</h2><p>Plan availability and pricing are loaded from your account billing service.</p></div></div>
      {loading ? <div className="subscription-skeleton panel" /> : <div className="subscription-plan-grid">{plans.map(plan => <article className={`subscription-plan-card panel${selected === plan.code ? ' selected' : ''}`} key={plan.id}>
        <div className="subscription-plan-top"><div><span className="subscription-plan-icon"><Crown size={19} /></span><h3>{plan.name}</h3></div>{billing?.subscription?.planCode === plan.code && isActive && <span className="subscription-current"><Check size={13} /> Current</span>}</div>
        <p>{plan.description}</p><div className="subscription-price"><strong>{plan.currency} {Number(plan.price).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</strong><span>/ {plan.durationMonths === 12 ? 'year' : `${plan.durationMonths} month${plan.durationMonths === 1 ? '' : 's'}`}</span></div>
        <ul>{(plan.features ?? []).map(feature => <li key={feature}><Check size={15} />{feature}</li>)}</ul>
        <button className={`subscription-select${selected === plan.code ? ' chosen' : ''}`} type="button" onClick={() => setSelected(plan.code)}>{selected === plan.code ? 'Selected plan' : 'Select plan'}</button>
      </article>)}</div>}
    </section>

    {chosenPlan && <section className="subscription-checkout panel">
      <div className="subscription-section-heading"><div><p className="eyebrow green">CHECKOUT</p><h2>{isActive ? 'Renew your subscription' : 'Continue with M‑Pesa'}</h2><p>Payment is verified by Safaricom before plan access changes.</p></div><span className="subscription-mpesa-mark">M‑PESA</span></div>
      <form className="subscription-checkout-form" onSubmit={beginPayment}>
        <div className="subscription-summary"><div><span>Selected plan</span><strong>{chosenPlan.name}</strong></div><div><span>Period</span><strong>{chosenPlan.durationMonths === 12 ? '12 months' : `${chosenPlan.durationMonths} month${chosenPlan.durationMonths === 1 ? '' : 's'}`}</strong></div><div><span>Total payable</span><strong>{chosenPlan.currency} {Number(chosenPlan.price).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</strong></div></div>
        <label className="subscription-field"><span>M‑Pesa phone number</span><input type="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="0712 345 678" autoComplete="tel" required minLength={10} /></label>
        <div className="subscription-payment-method"><CreditCard size={17} /><span><strong>M‑Pesa STK Push</strong><small>We’ll send a secure payment prompt to this phone.</small></span></div>
        <button className="subscription-pay-button" type="submit" disabled={working || !chosenPlan || plans.length === 0}>{working ? <><span className="subscription-spinner" />Starting secure payment…</> : <>{isActive ? 'Renew plan' : 'Pay with M‑Pesa'}<span>→</span></>}</button>
      </form>
    </section>}

    <section className="subscription-history panel">
      <div className="subscription-history-heading"><div><p className="eyebrow green">PAYMENTS</p><h2>Subscription payment history</h2><p>These are subscription charges only; customer invoice receipts are separate.</p></div><span className="subscription-history-count">{total} transaction{total === 1 ? '' : 's'}</span></div>
      <div className="subscription-history-tools"><label className="subscription-search"><Search size={17} /><input value={search} onChange={event => { setPage(1); setSearch(event.target.value) }} placeholder="Search receipt, phone, or reference" /></label><label className="subscription-date-filter"><span>From</span><input type="date" value={fromDate} onChange={event => { setPage(1); setFromDate(event.target.value) }} /></label><label className="subscription-date-filter"><span>To</span><input type="date" value={toDate} onChange={event => { setPage(1); setToDate(event.target.value) }} /></label><select aria-label="Filter payment status" value={filter} onChange={event => { setPage(1); setFilter(event.target.value) }}><option value="ALL">All statuses</option><option value="PENDING">Pending</option><option value="COMPLETED">Successful</option><option value="FAILED">Failed</option><option value="CANCELLED">Cancelled</option><option value="UNKNOWN">Needs review</option></select></div>
      {loading ? <div className="subscription-history-empty"><Clock3 size={20} />Loading payment history…</div> : filteredHistory.length === 0 ? <div className="subscription-history-empty"><CreditCard size={22} /><strong>No subscription payments found</strong><span>{search || filter !== 'ALL' ? 'Adjust your search or status filter.' : 'Completed and pending subscription payments will appear here.'}</span></div> : <div className="subscription-table-wrap"><table className="subscription-table"><thead><tr><th>Payment</th><th>Plan</th><th>Method</th><th>Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>{filteredHistory.map(transaction => <tr key={transaction.id}><td><strong>{transaction.mpesaReceipt ?? `…${transaction.id.slice(-8)}`}</strong><small>{transaction.phoneNumber}</small>{transaction.failureReason && <small className="subscription-failure">{transaction.failureReason}</small>}</td><td>{billing?.plan?.name ?? sub?.planCode ?? 'Subscription'}</td><td>M‑Pesa</td><td>{date(transaction.completedAt ?? transaction.requestedAt)}</td><td><strong>{transaction.currency} {Number(transaction.amount).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</strong></td><td><span className={`subscription-badge status-${transaction.status.toLowerCase()}`}><span />{statusLabel[transaction.status] ?? transaction.status}</span></td></tr>)}</tbody></table></div>}
      {total > pageSize && <div className="subscription-pagination"><span>Page {page} of {Math.ceil(total / pageSize)}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><button type="button" disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage(value => value + 1)}>Next</button></div></div>}
    </section>
  </div>
}
