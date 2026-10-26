export type StatusTone = 'success' | 'warning' | 'info' | 'danger' | 'neutral'

export const statusMeta: Record<string, { label: string; tone: StatusTone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  ISSUED: { label: 'Awaiting response', tone: 'warning' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  EXPIRED: { label: 'Expired', tone: 'danger' },
  SUPERSEDED: { label: 'Superseded', tone: 'neutral' },
  SCHEDULED: { label: 'Scheduled', tone: 'warning' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  ON_HOLD: { label: 'On hold', tone: 'warning' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  PARTIALLY_PAID: { label: 'Partially paid', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
  OVERDUE: { label: 'Overdue', tone: 'danger' },
  FREE: { label: 'Free', tone: 'neutral' },
  PENDING: { label: 'Pending', tone: 'warning' },
  ACTIVE: { label: 'Active', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  UNKNOWN: { label: 'Unknown', tone: 'neutral' },
}

export const getStatusMeta = (status: string) => statusMeta[status] ?? {
  label: status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, character => character.toUpperCase()),
  tone: 'neutral' as const,
}
