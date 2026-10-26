const numeric = (value: number | string | null | undefined) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const formatKES = (value: number | string | null | undefined) =>
  `KES ${new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 }).format(numeric(value))}`

export const formatKESPrecise = (value: number | string | null | undefined) =>
  `KES ${new Intl.NumberFormat('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numeric(value))}`

export const formatNumber = (value: number | string | null | undefined) =>
  new Intl.NumberFormat('en-KE', { maximumFractionDigits: 2 }).format(numeric(value))

export const formatDate = (iso: string | Date | null | undefined) => {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

export const formatDateTime = (iso: string | Date | null | undefined) => {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

export const formatRelative = (iso: string | Date) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days > 1 && days < 7) return `${days} days ago`
  return formatDate(date)
}

export const formatPhone = (raw: string | null | undefined) => {
  if (!raw) return '—'
  const digits = raw.replace(/\D/g, '')
  const local = digits.startsWith('254') ? `0${digits.slice(3)}` : digits
  return local.length === 10 ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` : raw
}

export const toWhatsApp = (phone: string) => {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('0') ? `254${digits.slice(1)}` : digits.startsWith('254') ? digits : digits
}
