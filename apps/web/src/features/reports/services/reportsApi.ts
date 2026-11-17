import { apiRequest, API } from '../../../services/apiClient'
import type { ReportData } from '../types'

export type TrendData = {
  trend: Array<{ month: string; invoiced: number; collected: number; expenses: number }>
  comparison: { current: { invoiced: number; collected: number; expenses: number }; previous: { start: string; end: string; invoiced: number; collected: number; expenses: number } }
}
export type PageData<T> = { rows: T[]; page: number; pageSize: number; total: number; pageCount: number; movementSummary?:Array<{type:string;quantity:number;count:number}> }
export type Movement = { id: string; type: string; quantity: number | string; costPerUnit: number | string | null; reason: string | null; reference: string | null; createdAt: string; material: { id: string; name: string; unit: string }; job: { id: string; jobNumber: string } | null; createdBy: { fullName: string } }
export type SavedReport = { id:string; name:string; filters:{from:string;to:string}; frequency:'DAILY'|'WEEKLY'|'MONTHLY'|null; nextRunAt:string|null; lastRunAt:string|null; lastResult:Record<string,unknown>|null }
const range = (from: string, to: string) => `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
export const reportsApi = {
  overview: (from: string, to: string) => apiRequest<ReportData>(`/reports/analytics?${range(from, to)}`),
  trends: (from: string, to: string) => apiRequest<TrendData>(`/reports/trends?${range(from, to)}`),
  saved: () => apiRequest<{reports:SavedReport[]}>('/reports/saved'),
  createSaved: (name:string,from:string,to:string,frequency:SavedReport['frequency']) => apiRequest<{report:SavedReport}>('/reports/saved',{method:'POST',body:JSON.stringify({name,from,to,frequency})}),
  deleteSaved: (id:string) => apiRequest<void>(`/reports/saved/${id}`,{method:'DELETE'}),
  movements: (from: string, to: string, page: number) => apiRequest<PageData<Movement>>(`/reports/details/inventory-movements?${range(from, to)}&page=${page}&pageSize=20`),
  details: (kind: string, from: string, to: string, page: number) => apiRequest<PageData<Record<string, unknown>>>(`/reports/details/${kind}?${range(from, to)}&page=${page}&pageSize=25`),
  async pdf(from: string, to: string) {
    const response = await fetch(`${API}/reports/export.pdf?${range(from, to)}`, { credentials: 'include' })
    if (!response.ok) throw new Error('Could not export the PDF report')
    return response.blob()
  },
}
