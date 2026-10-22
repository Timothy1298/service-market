export const ROUTES = {
  home: '/',
  login: '/login',
  register: '/register',
  forgotPassword: '/forgot-password',
  app: '/app',
  dashboard: '/app/dashboard',
  customers: '/app/customers',
  quotations: '/app/quotations',
  jobs: '/app/jobs',
  inventory: '/app/materials',
  invoices: '/app/invoices',
  payments: '/app/payments',
  expenses: '/app/expenses',
  reports: '/app/reports',
  billing: '/app/billing',
  profile: '/app/profile',
  businessProfile: '/app/business-profile',
} as const

export const route = (path: string) => `#${path}`
