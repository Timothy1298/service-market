export type UserRole = 'PROVIDER' | 'CUSTOMER' | 'ADMIN'

export type User = {
  id: string
  fullName: string
  phone: string
  email?: string | null
  role: UserRole
  createdAt?: string
}

export type PageResult<T> = {
  items: T[]
  page: number
  pageSize: number
  total: number
}

export type QuotationStatus = 'DRAFT' | 'ISSUED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED'
export type JobStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED'
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED'
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'MPESA' | 'OTHER'
export type SubscriptionStatus = 'FREE' | 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED'
