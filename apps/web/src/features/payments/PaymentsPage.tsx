import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, CircleDollarSign, Search, Wallet } from 'lucide-react'
import { formatDate, formatKESPrecise } from '../../lib/format'
import { apiRequest, errorMessage } from '../../services/apiClient'
import RecordPaymentModal from './RecordPaymentModal'
import './PaymentsPage.css'

type Payment = {
  id: string
  amount: number | string
  paymentDate: string
  method: 'CASH' | 'BANK_TRANSFER' | 'MPESA' | 'OTHER'
  reference?: string | null
  notes?: string | null
  createdAt: string
  invoice?: {
    id: string
    invoiceNumber: string
    status: string
    grandTotal: number | string
    amountPaid: number | string
    customer: { name: string; phone?: string | null }
  } | null
  recordedBy?: { fullName: string } | null
}

type PaymentStats = {
  total: number
  totalReceived: number
  today: number
  activeInvoices: number
}

const label = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase())

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([])
  const [stats, setStats] = useState<PaymentStats | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<{
    id: string
    invoiceNumber: string
    outstanding: number
  } | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await apiRequest<{ payments: Payment[]; total: number }>('/payments?page=1&pageSize=50')
      const totalReceived = result.payments.reduce((sum, payment) => sum + Number(payment.amount), 0)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const paidInvoices = new Set(
        result.payments
          .map((payment) => payment.invoice?.id)
          .filter((value): value is string => Boolean(value)),
      )
      const todays = result.payments.filter((payment) => {
        const date = new Date(payment.paymentDate)
        return !Number.isNaN(date.getTime()) && date >= today
      }).reduce((sum, payment) => sum + Number(payment.amount), 0)
      setPayments(result.payments)
      setStats({
        total: result.total,
        totalReceived,
        today: todays,
        activeInvoices: paidInvoices.size,
      })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const filtered = useMemo(
    () =>
      payments.filter((payment) => {
        const invoiceNumber = payment.invoice?.invoiceNumber ?? ''
        const customerName = payment.invoice?.customer?.name ?? ''
        const text = `${invoiceNumber} ${customerName} ${payment.reference ?? ''} ${payment.method}`.toLowerCase()
        return text.includes(query.trim().toLowerCase())
      }),
    [payments, query],
  )

  const metrics = [
    { title: 'Payments recorded', value: stats?.total, note: 'Total entries', Icon: Wallet },
    { title: 'Cashflow', value: stats ? formatKESPrecise(stats.totalReceived) : '—', note: 'Collected this period', Icon: CircleDollarSign },
    { title: 'Today', value: stats ? formatKESPrecise(stats.today) : '—', note: 'Receipts received today', Icon: CircleDollarSign },
    { title: 'Invoices paid', value: stats?.activeInvoices, note: 'Unique invoices touched', Icon: ArrowUpRight },
  ]

  const recordPayment = async (draft: { amount: string; method: 'CASH' | 'BANK_TRANSFER' | 'MPESA' | 'OTHER'; reference: string; paymentDate: string }) => {
    if (!selectedInvoice) return
    await apiRequest(`/invoices/${selectedInvoice.id}/payments`, {
      method: 'POST',
      body: JSON.stringify({
        amount: Number(draft.amount),
        method: draft.method,
        paymentDate: draft.paymentDate,
        reference: draft.reference || undefined,
      }),
    })
  }

  return (
    <main className="payments-page">
      <header className="payments-page__header">
        <div>
          <p className="eyebrow green">MONEY MOVEMENT</p>
          <h1>Payments</h1>
          <p>Track customer receipts and match them to invoices.</p>
        </div>
      </header>

      {message && <div className="payments-page__alert payments-page__alert--success" role="status">{message}</div>}
      {error && <div className="payments-page__alert payments-page__alert--error" role="alert">{error}</div>}

      <section className="payments-page__metrics" aria-label="Payment summary">
        {metrics.map(({ title, value, note, Icon }) => (
          <article key={title}>
            <span><Icon size={18} /></span>
            <small>{title}</small>
            <strong>{loading || value === undefined ? '—' : value}</strong>
            <em>{note}</em>
          </article>
        ))}
      </section>

      <section className="payments-page__workspace">
        <div className="payments-page__toolbar">
          <div>
            <h2>Payment ledger</h2>
            <p>{loading ? 'Loading payments…' : `${filtered.length} payment${filtered.length === 1 ? '' : 's'} shown`}</p>
          </div>
          <label className="payments-page__search">
            <Search size={16} />
            <input
              aria-label="Search payments"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search invoice, client, or reference…"
            />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
          </label>
        </div>

        {loading ? (
          <div className="payments-page__loading" aria-label="Loading payments"><i /><i /><i /></div>
        ) : !filtered.length ? (
          <div className="payments-page__empty">
            <b>{query ? 'No payments match your search' : 'No payments recorded yet'}</b>
            <p>{query ? 'Try another invoice or customer name.' : 'Once invoices are issued and paid, receipts will appear here.'}</p>
          </div>
        ) : (
          <div className="payments-page__table-wrap">
            <table className="payments-page__table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Recorded by</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((payment) => (
                  <tr key={payment.id}>
                    <td>
                      {payment.invoice ? (
                        <a href={`#/app/invoices/${payment.invoice.id}`} className="payments-page__invoice-link">
                          {payment.invoice.invoiceNumber}
                        </a>
                      ) : (
                        '—'
                      )}
                      <small>{payment.invoice ? label(payment.invoice.status) : 'Manual entry'}</small>
                    </td>
                    <td>
                      {payment.invoice?.customer?.name ?? '—'}
                      <small>{payment.invoice?.customer?.phone ?? 'No mobile saved'}</small>
                    </td>
                    <td>{label(payment.method)}</td>
                    <td>{payment.reference ?? '—'}</td>
                    <td>{formatDate(payment.paymentDate)}</td>
                    <td className="payments-page__amount">{formatKESPrecise(payment.amount)}</td>
                    <td>{payment.recordedBy?.fullName ?? 'System'} </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RecordPaymentModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false)
          setSelectedInvoice(null)
        }}
        invoiceNumber={selectedInvoice?.invoiceNumber}
        maxAmount={selectedInvoice?.outstanding ?? 0}
        onSave={async (draft) => {
          await recordPayment(draft)
          setMessage(selectedInvoice ? `Payment recorded for ${selectedInvoice.invoiceNumber}.` : 'Payment recorded.')
          setModalOpen(false)
          setSelectedInvoice(null)
          await load()
        }}
      />
    </main>
  )
}
