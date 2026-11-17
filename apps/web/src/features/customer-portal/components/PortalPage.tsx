import type { ReactNode } from 'react'
import { AlertCircle, LoaderCircle } from 'lucide-react'

export function PortalPage({ title, eyebrow = 'YOUR FUNDIQUOTE', subtitle, action, children }: { title: string; eyebrow?: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return <main className="customer-page"><header className="customer-page-heading"><div><p className="eyebrow green">{eyebrow}</p><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</header>{children}</main>
}
export function PortalPanel({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) { return <section className="customer-panel">{(title || action) && <header className="customer-panel-heading">{title && <h2>{title}</h2>}{action}</header>}{children}</section> }
export function PortalState({ loading, error, empty, children }: { loading?: boolean; error?: string; empty?: string; children?: ReactNode }) {
  if (loading) return <div className="customer-state"><LoaderCircle className="customer-spin" />Loading your information…</div>
  if (error) return <div className="customer-state customer-error"><AlertCircle />{error}</div>
  if (empty) return <div className="customer-state">{empty}</div>
  return children ?? null
}
export function formatMoney(value: unknown, currency = 'KES') { return `${currency} ${Number(value ?? 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
