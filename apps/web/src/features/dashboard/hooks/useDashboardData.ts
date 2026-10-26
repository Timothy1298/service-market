import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../../../services/apiClient'

export type Period = 'today' | 'week' | 'month'
export type CustomerSummary = { id: string; name: string; location?: string | null }
export type DashboardJob = { id: string; jobNumber: string; title: string; status: string; scheduledStart?: string | null; createdAt: string; customer: CustomerSummary }
export type DashboardInvoice = { id: string; invoiceNumber: string; status: string; dueDate?: string | null; issueDate?: string | null; grandTotal: number | string; amountPaid: number | string; createdAt: string; customer: CustomerSummary }
export type DashboardPayment = { id: string; amount: number | string; paymentDate: string; createdAt: string; invoice?: { invoiceNumber: string; customer: CustomerSummary } | null }
export type DashboardExpense = { id: string; description: string; amount: number | string; expenseDate: string; createdAt: string }
export type DashboardMaterial = { id: string; name: string; stockQuantity: number | string; reorderLevel: number | string; unit: string }
export type DashboardQuotation = { id: string; quotationNumber: string; title: string; status: string; grandTotal: number | string; createdAt: string; customer: CustomerSummary }
export type DashboardReport = { invoicedAmount: number | string; paymentsReceived: number | string; recordedExpenses: number | string }
export type DashboardData = {
  report: DashboardReport
  jobs: DashboardJob[]
  invoices: DashboardInvoice[]
  payments: DashboardPayment[]
  expenses: DashboardExpense[]
  materials: DashboardMaterial[]
  quotations: DashboardQuotation[]
}

function periodBounds(period: Period) {
  const to = new Date()
  const from = new Date(to)
  if (period === 'today') from.setHours(0, 0, 0, 0)
  else if (period === 'week') from.setDate(from.getDate() - 6)
  else from.setDate(1)
  return { from: from.toISOString(), to: to.toISOString() }
}

export function useDashboardData(period: Period) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const bounds = periodBounds(period)
      const [report, jobs, invoices, payments, expenses, materials, quotations] = await Promise.all([
        apiRequest<DashboardReport>(`/reports/overview?from=${encodeURIComponent(bounds.from)}&to=${encodeURIComponent(bounds.to)}`),
        apiRequest<{ jobs: DashboardJob[] }>('/jobs?page=1&pageSize=50'),
        apiRequest<{ invoices: DashboardInvoice[] }>('/invoices'),
        apiRequest<{ payments: DashboardPayment[] }>('/payments'),
        apiRequest<{ expenses: DashboardExpense[] }>('/expenses'),
        apiRequest<{ materials: DashboardMaterial[] }>('/materials'),
        apiRequest<{ quotations: DashboardQuotation[] }>('/quotations'),
      ])
      setData({ report, jobs: jobs.jobs, invoices: invoices.invoices, payments: payments.payments, expenses: expenses.expenses, materials: materials.materials, quotations: quotations.quotations })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load dashboard data.')
    } finally { setLoading(false) }
  }, [period])
  useEffect(() => { void load() }, [load])
  return { data, loading, error, reload: load }
}
