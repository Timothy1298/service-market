import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { ChevronRight } from 'lucide-react'
import { getStatusMeta } from '../../lib/statusMeta'
import clsx from 'clsx'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'link'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'primary', size = 'md', loading = false, icon, className, children, disabled, ...props }: ButtonProps) {
  return <button className={clsx('ui-button', `ui-button--${variant}`, `ui-button--${size}`, className)} disabled={disabled || loading} {...props}>
    {loading ? <Loader2 className="ui-spin" size={16} aria-hidden="true" /> : icon}
    {children}
  </button>
}

type FieldProps = { label: string; helper?: string; error?: string; className?: string }
type InputProps = InputHTMLAttributes<HTMLInputElement> & FieldProps

export function Input({ label, helper, error, className, id, ...props }: InputProps) {
  const inputId = id ?? props.name ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return <label className={clsx('ui-field', className)} htmlFor={inputId}>
    <span>{label}</span><input id={inputId} className={error ? 'has-error' : ''} aria-invalid={Boolean(error)} aria-describedby={error ? `${inputId}-error` : helper ? `${inputId}-helper` : undefined} {...props} />
    {error && <small className="ui-field__error" id={`${inputId}-error`}><AlertCircle size={14} />{error}</small>}
    {!error && helper && <small className="ui-field__helper" id={`${inputId}-helper`}>{helper}</small>}
  </label>
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & FieldProps
export function Select({ label, helper, error, className, id, children, ...props }: SelectProps) {
  const selectId = id ?? props.name ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return <label className={clsx('ui-field', className)} htmlFor={selectId}><span>{label}</span><select id={selectId} className={error ? 'has-error' : ''} aria-invalid={Boolean(error)} {...props}>{children}</select>{error && <small className="ui-field__error"><AlertCircle size={14} />{error}</small>}{!error && helper && <small className="ui-field__helper">{helper}</small>}</label>
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps
export function Textarea({ label, helper, error, className, id, ...props }: TextareaProps) {
  const textareaId = id ?? props.name ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return <label className={clsx('ui-field', className)} htmlFor={textareaId}><span>{label}</span><textarea id={textareaId} className={error ? 'has-error' : ''} aria-invalid={Boolean(error)} {...props} />{error && <small className="ui-field__error"><AlertCircle size={14} />{error}</small>}{!error && helper && <small className="ui-field__helper">{helper}</small>}</label>
}

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={clsx('ui-card', className)} {...props} />
}

export function StatCard({ label, value, footnote, Icon, href, tone = 'green', loading = false }: { label: string; value: ReactNode; footnote?: string; Icon: LucideIcon; href?: string; tone?: 'green' | 'warning' | 'danger'; loading?: boolean }) {
  const content = <><span className={`ui-stat-card__icon is-${tone}`}><Icon size={18} aria-hidden="true" /></span><small>{label}</small><strong>{loading ? <Skeleton className="ui-stat-card__value-skeleton" /> : value}</strong>{footnote && <em>{loading ? 'Loading…' : footnote}</em>}</>
  return href ? <a className="ui-stat-card ui-stat-card--link" href={`#${href}`}>{content}</a> : <article className="ui-stat-card">{content}</article>
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const meta = getStatusMeta(status)
  return <span className={`ui-status-badge is-${meta.tone}`}><i aria-hidden="true" />{label ?? meta.label}</span>
}

export function Alert({ tone = 'error', title, children, action, className }: { tone?: 'success' | 'warning' | 'error' | 'info'; title?: string; children: ReactNode; action?: ReactNode; className?: string }) {
  return <div className={clsx('ui-alert', `is-${tone}`, className)} role={tone === 'error' ? 'alert' : 'status'}><div>{title && <strong>{title}</strong>}<span>{children}</span></div>{action}</div>
}

export function EmptyState({ Icon, title, description, action, secondary }: { Icon: LucideIcon; title: string; description: string; action?: ReactNode; secondary?: ReactNode }) {
  return <div className="ui-empty-state"><span><Icon size={32} aria-hidden="true" /></span><h2>{title}</h2><p>{description}</p>{action}{secondary}</div>
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={clsx('ui-skeleton', className)} aria-hidden="true" {...props} />
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  return <span className={`ui-avatar ui-avatar--${size}`} aria-label={name}>{initials}</span>
}

export function PageHeader({ title, description, actions, breadcrumbs, className }: { title: string; description?: string; actions?: ReactNode; breadcrumbs?: Array<{ label: string; href?: string }>; className?: string }) {
  return <header className={clsx('ui-page-header', className)}>
    <div>{breadcrumbs && <nav className="ui-page-header__breadcrumbs" aria-label="Breadcrumbs">{breadcrumbs.map((crumb, index) => <span key={`${crumb.label}-${index}`}>{crumb.href ? <a href={`#${crumb.href}`}>{crumb.label}</a> : crumb.label}{index < breadcrumbs.length - 1 && <ChevronRight aria-hidden="true" />}</span>)}</nav>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
    {actions && <div className="ui-page-header__actions">{actions}</div>}
  </header>
}
