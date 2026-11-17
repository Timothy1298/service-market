import type { NotificationCategory, NotificationPriority, Prisma } from '../../generated/prisma/client'

export type NotificationEventType =
  | 'REQUEST_CREATED' | 'REQUEST_UPDATED' | 'REQUEST_CANCELLED'
  | 'QUOTATION_SENT' | 'QUOTATION_ACCEPTED' | 'QUOTATION_REJECTED'
  | 'JOB_CREATED' | 'JOB_STATUS_CHANGED' | 'JOB_COMPLETED'
  | 'INVOICE_ISSUED' | 'INVOICE_PARTIALLY_PAID' | 'INVOICE_PAID' | 'INVOICE_CANCELLED'
  | 'PAYMENT_FAILED' | 'EXPENSE_RECORDED' | 'EXPENSE_UPDATED' | 'INVENTORY_LOW_STOCK' | 'INVENTORY_OUT_OF_STOCK' | 'INVENTORY_RESTOCKED'
  | 'TEAM_ROLE_CHANGED' | 'PASSWORD_CHANGED'
  | 'SUBSCRIPTION_ACTIVATED' | 'SUBSCRIPTION_PAYMENT_INITIATED' | 'SUBSCRIPTION_PAYMENT_FAILED' | 'SUBSCRIPTION_CANCELLED' | 'SUBSCRIPTION_EXPIRED'
  | 'INVOICE_DUE_SOON' | 'INVOICE_OVERDUE' | 'QUOTATION_EXPIRING'
  | 'JOB_UPCOMING' | 'SUBSCRIPTION_RENEWAL_APPROACHING'
  | 'MESSAGE_RECEIVED'

export type NotificationEventInput = {
  businessId?: string | null
  actorUserId?: string | null
  idempotencyKey: string
  eventType: NotificationEventType
  payload: Record<string, unknown>
}

export async function queueNotificationEvent(tx: Prisma.TransactionClient, input: NotificationEventInput) {
  await tx.notificationEvent.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: { businessId: input.businessId ?? null, actorUserId: input.actorUserId ?? null, idempotencyKey: input.idempotencyKey, eventType: input.eventType, payload: JSON.parse(JSON.stringify(input.payload)) as Prisma.InputJsonValue },
    update: {},
  })
}

export function presentationForEvent(eventType: NotificationEventType, payload: Record<string, unknown>): { category: NotificationCategory; priority: NotificationPriority; title: string; body: string; actionUrl?: string } {
  const ref = String(payload.reference ?? '')
  const amount = payload.amount == null ? '' : `${String(payload.currency ?? 'KES')} ${Number(payload.amount).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const name = String(payload.name ?? 'An item')
  const action = typeof payload.actionUrl === 'string' && (/^\/(app|customer)\/[a-z0-9\-/]+$/i.test(payload.actionUrl)||/^\/quotation\/share\/[a-f0-9]{40,}$/i.test(payload.actionUrl)) ? payload.actionUrl : undefined
  switch (eventType) {
    case 'REQUEST_CREATED': return { category: 'CUSTOMERS', priority: 'NORMAL', title: 'New customer request', body: `A customer submitted a request: ${name}.` }
    case 'REQUEST_UPDATED': return { category: 'CUSTOMERS', priority: 'NORMAL', title: 'Customer request updated', body: `A customer updated request ${ref}: ${name}.` }
    case 'REQUEST_CANCELLED': return { category: 'CUSTOMERS', priority: 'IMPORTANT', title: 'Customer request cancelled', body: `A customer cancelled request ${ref}: ${name}.` }
    case 'MESSAGE_RECEIVED': return { category: 'GENERAL', priority: 'NORMAL', title: payload.customerFacing === true ? 'New message from your provider' : 'New customer message', body: `You received a new message from ${name}.`, actionUrl: action }
    case 'QUOTATION_SENT': return { category: 'QUOTATIONS', priority: 'NORMAL', title: payload.customerFacing===true?'New quotation received':'Quotation sent', body: payload.customerFacing===true?`A service provider sent you quotation ${ref}. Review the details and respond.`:`Quotation ${ref} was sent to ${name}.`, actionUrl: action }
    case 'QUOTATION_ACCEPTED': return { category: 'QUOTATIONS', priority: 'IMPORTANT', title: 'Quotation accepted', body: `${name} accepted quotation ${ref}.`, actionUrl: action }
    case 'QUOTATION_REJECTED': return { category: 'QUOTATIONS', priority: 'NORMAL', title: 'Quotation declined', body: `${name} declined quotation ${ref}.`, actionUrl: action }
    case 'JOB_CREATED': return { category: 'JOBS', priority: 'NORMAL', title: 'Job created', body: `Job ${ref} for ${name} is ready to manage.`, actionUrl: action }
    case 'JOB_STATUS_CHANGED': return { category: 'JOBS', priority: 'NORMAL', title: 'Job status updated', body: `Job ${ref} is now ${String(payload.status ?? 'updated').replaceAll('_', ' ').toLowerCase()}.`, actionUrl: action }
    case 'JOB_COMPLETED': return { category: 'JOBS', priority: 'IMPORTANT', title: 'Job completed', body: `Job ${ref} for ${name} has been completed.`, actionUrl: action }
    case 'INVOICE_ISSUED': return { category: 'INVOICES', priority: 'IMPORTANT', title: payload.customerFacing===true?'New invoice received':'Invoice issued', body: payload.customerFacing===true?`Invoice ${ref} was issued for ${amount}.`:`Invoice ${ref} for ${name} was issued for ${amount}.`, actionUrl: action }
    case 'INVOICE_PARTIALLY_PAID': return { category: 'PAYMENTS', priority: 'IMPORTANT', title: payload.customerFacing===true?'Payment recorded':'Partial payment received', body: payload.customerFacing===true?`A payment of ${amount} was recorded against invoice ${ref}.`:`${amount} was recorded against invoice ${ref}.`, actionUrl: action }
    case 'INVOICE_PAID': return { category: 'PAYMENTS', priority: 'IMPORTANT', title: payload.customerFacing===true?'Payment confirmed':'Invoice paid', body: payload.customerFacing===true?`Your payment of ${amount} is confirmed for invoice ${ref}.`:`Invoice ${ref} has been fully paid. Payment received: ${amount}.`, actionUrl: action }
    case 'INVOICE_CANCELLED': return { category: 'INVOICES', priority: 'IMPORTANT', title: payload.customerFacing===true?'Invoice cancelled':'Invoice cancelled', body: `Invoice ${ref}${payload.customerFacing===true?'':' for '+name} was cancelled.`, actionUrl: action }
    case 'PAYMENT_FAILED': return { category: 'PAYMENTS', priority: 'IMPORTANT', title: 'M-Pesa payment failed', body: `The M-Pesa payment attempt for invoice ${ref} failed. ${String(payload.reason ?? '')}`.trim(), actionUrl: action }
    case 'EXPENSE_RECORDED': return { category: 'EXPENSES', priority: 'NORMAL', title: 'Expense recorded', body: `${String(payload.description ?? 'An expense')} · ${amount}.`, actionUrl: action }
    case 'EXPENSE_UPDATED': return { category: 'EXPENSES', priority: 'NORMAL', title: 'Expense updated', body: `${String(payload.description ?? 'An expense')} was updated · ${amount}.`, actionUrl: action }
    case 'INVENTORY_LOW_STOCK': return { category: 'INVENTORY', priority: 'IMPORTANT', title: 'Low stock warning', body: `${name} has reached its reorder level (${String(payload.quantity ?? '')} remaining).`, actionUrl: action }
    case 'INVENTORY_OUT_OF_STOCK': return { category: 'INVENTORY', priority: 'URGENT', title: 'Item out of stock', body: `${name} is out of stock. Replenish it before scheduling more work.`, actionUrl: action }
    case 'INVENTORY_RESTOCKED': return { category: 'INVENTORY', priority: 'NORMAL', title: 'Stock replenished', body: `${name} was replenished. Current quantity: ${String(payload.quantity ?? '')}.`, actionUrl: action }
    case 'TEAM_ROLE_CHANGED': return { category: 'TEAM', priority: 'IMPORTANT', title: 'Team access changed', body: `Your business role was changed to ${String(payload.role ?? 'updated')}.`, actionUrl: action }
    case 'PASSWORD_CHANGED': return { category: 'SECURITY', priority: 'URGENT', title: 'Password changed', body: 'Your FundiQuote account password was changed. If you did not do this, secure your account immediately.', actionUrl: '/app/settings/security' }
    case 'SUBSCRIPTION_ACTIVATED': return { category: 'SUBSCRIPTIONS', priority: 'IMPORTANT', title: 'Subscription activated', body: `Your ${String(payload.plan ?? 'business')} subscription is active until ${String(payload.expiresAt ?? 'further notice')}.`, actionUrl: '/app/billing' }
    case 'SUBSCRIPTION_PAYMENT_INITIATED': return { category: 'SUBSCRIPTIONS', priority: 'NORMAL', title: 'Subscription payment initiated', body: `An M-Pesa payment request for ${String(payload.plan ?? 'your subscription')} was sent to ${String(payload.phoneNumber ?? 'your phone')}. Your plan changes after Safaricom confirms payment.`, actionUrl: '/app/billing' }
    case 'SUBSCRIPTION_PAYMENT_FAILED': return { category: 'SUBSCRIPTIONS', priority: 'IMPORTANT', title: 'Subscription payment failed', body: `Your subscription payment could not be confirmed. ${String(payload.reason ?? '')}`.trim(), actionUrl: '/app/billing' }
    case 'SUBSCRIPTION_CANCELLED': return { category: 'SUBSCRIPTIONS', priority: 'IMPORTANT', title: 'Subscription cancellation scheduled', body: `Your ${String(payload.plan ?? 'subscription')} will remain available until ${String(payload.expiresAt ?? 'the end of its paid period')}.`, actionUrl: '/app/billing' }
    case 'INVOICE_DUE_SOON': return { category: 'INVOICES', priority: 'IMPORTANT', title: 'Invoice due soon', body: `Invoice ${ref} for ${name} is due on ${String(payload.dueDate ?? 'soon')}. Outstanding: ${amount}.`, actionUrl: action }
    case 'INVOICE_OVERDUE': return { category: 'INVOICES', priority: 'URGENT', title: 'Invoice overdue', body: `Invoice ${ref} for ${name} is overdue. Outstanding: ${amount}.`, actionUrl: action }
    case 'QUOTATION_EXPIRING': return { category: 'QUOTATIONS', priority: 'IMPORTANT', title: 'Quotation expiring soon', body: `Quotation ${ref} for ${name} expires on ${String(payload.expiryDate ?? 'soon')}.`, actionUrl: action }
    case 'JOB_UPCOMING': return { category: 'JOBS', priority: 'IMPORTANT', title: 'Upcoming job', body: `Job ${ref} for ${name} is scheduled to start soon.`, actionUrl: action }
    case 'SUBSCRIPTION_RENEWAL_APPROACHING': return { category: 'SUBSCRIPTIONS', priority: 'IMPORTANT', title: 'Subscription renewal approaching', body: `Your subscription is scheduled to renew or expire on ${String(payload.expiresAt ?? 'soon')}.`, actionUrl: '/app/billing' }
    case 'SUBSCRIPTION_EXPIRED': return { category: 'SUBSCRIPTIONS', priority: 'URGENT', title: 'Subscription expired', body: `Your ${String(payload.plan ?? 'business')} subscription expired on ${String(payload.expiresAt ?? 'recently')}.`, actionUrl: '/app/billing' }
  }
}
