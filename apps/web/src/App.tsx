import { useEffect, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import { ArrowRight, Check, Circle, Eye, EyeOff, FileText, UserRound, Wallet, Wrench } from 'lucide-react'
import { Navigate, useLocation } from 'react-router-dom'
import './App.css'
import { API, apiRequest, errorMessage } from './services/apiClient'
import { AppLayout } from './layouts/AppLayout'
import CustomersPage from './features/customers/pages/CustomersPage'
import QuotationsPage from './features/quotations/pages/QuotationsPage'
import JobsPage from './features/jobs/pages/JobsPage'
import InventoryPage from './features/inventory/pages/InventoryWorkspacePage'
import { RequireAuth } from './app/guards'
import NotFoundPage from './features/errors/NotFoundPage'
import { useDocumentTitle } from './lib/hooks/useDocumentTitle'
import DashboardPage from './features/dashboard/pages/DashboardPage'
import CustomerDetailPage from './features/customers/pages/CustomerDetailPage'
import QuotationDetailPage from './features/quotations/pages/QuotationDetailPage'
import JobDetailPage from './features/jobs/pages/JobDetailPage'
import PublicQuotationSharePage from './features/quotations/pages/PublicQuotationSharePage'

type Role = 'PROVIDER' | 'CUSTOMER' | 'ADMIN'
type User = { id: string; fullName: string; phone: string; email?: string | null; role: Role; createdAt?: string }
const categories = ['Electrical installation and repairs', 'Plumbing', 'HVAC and refrigeration', 'Masonry and construction', 'Painting', 'Carpentry and joinery', 'General maintenance', 'Other']
const request = apiRequest
const Logo = () => <a className="logo" href="#/"><span className="logo-mark">F</span> Fundi<span>Quote</span></a>
const Button = ({ children, variant = 'primary', ...props }: { children: ReactNode; variant?: 'primary' | 'ghost' } & ButtonHTMLAttributes<HTMLButtonElement>) => <button className={`button ${variant}`} {...props}>{props.disabled && <span className="spinner" aria-label="Loading" />} {children}</button>
const LinkButton = ({ children, href }: { children: ReactNode; href: string }) => <a className="button" href={href}>{children}</a>
const Field = ({ label, error, ...props }: { label: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) => <label className={`field${error ? ' has-error' : ''}`}><span>{label}</span><input {...props} />{error && <small className="field-error">{error}</small>}</label>
function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const benefits = [
    { Icon: FileText, title: 'Send professional quotes', detail: 'Share them with customers on WhatsApp.' },
    { Icon: Wrench, title: 'Organise your jobs', detail: 'Turn accepted quotations into work.' },
    { Icon: Wallet, title: 'Track your cash flow', detail: 'Keep invoices and M-Pesa payments together.' },
  ]
  return <div className="auth-page">
    <section className="auth-visual">
      <Logo />
      <div className="auth-hero-copy">
        <h1>Quote faster.<br /><em>Get paid sooner.</em></h1>
        <p>Quotations, jobs, invoices and M-Pesa payments for Kenyan fundis — in one simple app.</p>
        <div className="auth-benefits">{benefits.map(({ Icon, title: benefitTitle, detail }) => <div className="auth-benefit" key={benefitTitle}><span><Icon size={18} /></span><div><b>{benefitTitle}</b><small>{detail}</small></div></div>)}</div>
      </div>
      <small className="visual-foot">Made for the people who keep Kenya moving.</small>
    </section>
    <section className="auth-form"><div className="form-wrap">
      <Logo />
      <div className="form-heading"><h2>{title}</h2><p>{subtitle}</p></div>
      {children}
    </div></section>
  </div>
}

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setLoading(true)
    try {
      const result = await request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) })
      onLogin(result.user)
      window.location.hash = '/app/dashboard'
    } catch (cause) { setError(errorMessage(cause)); setLoading(false) }
  }
  return <AuthLayout title="Welcome back" subtitle="Sign in to keep your work moving.">
    <form onSubmit={submit}>
      {error && <div className="message error" role="alert">{error}</div>}
      <Field label="Phone or email" value={identifier} onChange={event => setIdentifier(event.target.value)} autoComplete="username" required placeholder="0712 345 678" />
      <label className="field"><span>Password</span><div className="password"><input type={show ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /><button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
      <div className="form-row"><span /><a href="#/forgot-password">Forgot password?</a></div>
      <Button disabled={loading}>{loading ? 'Signing in…' : 'Sign in'} <ArrowRight size={18} /></Button>
      <p className="switch">New to FundiQuote? <a href="#/register">Create an account</a></p>
    </form>
  </AuthLayout>
}

function Register({ onLogin }: { onLogin: (user: User) => void }) {
  const [type, setType] = useState<'PROVIDER' | 'CUSTOMER'>('PROVIDER')
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', password: '', confirmPassword: '', businessName: '', tradeCategory: categories[0] })
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const update = (key: string, value: string) => { setForm(current => ({ ...current, [key]: value })); setFieldErrors(current => ({ ...current, [key]: '' })) }
  const rules = [form.password.length >= 8, /[A-Za-z]/.test(form.password), /\d/.test(form.password)]
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setFieldErrors({}); setLoading(true)
    try {
      const result = await request<{ user: User }>('/auth/register', { method: 'POST', body: JSON.stringify({ ...form, accountType: type }) })
      onLogin(result.user)
      window.location.hash = '/app/dashboard'
    } catch (cause) {
      const typed = cause as Error & { fields?: Record<string, string[]> }
      setError(errorMessage(cause)); setLoading(false)
      if (typed.fields) setFieldErrors(Object.fromEntries(Object.entries(typed.fields).map(([key, messages]) => [key, messages[0] ?? 'Invalid value'])))
    }
  }
  return <AuthLayout title="Create your account" subtitle="Start building a better business today.">
    <form onSubmit={submit}>
      {error && <div className="message error" role="alert">{error}</div>}
      <div className="account-types">
        <button type="button" className={type === 'PROVIDER' ? 'selected' : ''} onClick={() => setType('PROVIDER')}><Wrench size={20} /><b>Service provider</b><small>I offer services to customers</small>{type === 'PROVIDER' && <Check size={16} />}</button>
        <button type="button" className={type === 'CUSTOMER' ? 'selected' : ''} onClick={() => setType('CUSTOMER')}><UserRound size={20} /><b>Customer</b><small>I'm looking for a service</small>{type === 'CUSTOMER' && <Check size={16} />}</button>
      </div>
      <div className="two-col"><Field label="Full name" error={fieldErrors.fullName} value={form.fullName} onChange={event => update('fullName', event.target.value)} required /><Field label="Phone number" error={fieldErrors.phone} value={form.phone} onChange={event => update('phone', event.target.value)} required placeholder="0712 345 678" inputMode="tel" /></div>
      <Field label="Email address (optional)" error={fieldErrors.email} type="email" value={form.email} onChange={event => update('email', event.target.value)} />
      {type === 'PROVIDER' && <><Field label="Business name" error={fieldErrors.businessName} value={form.businessName} onChange={event => update('businessName', event.target.value)} required /><label className={`field${fieldErrors.tradeCategory ? ' has-error' : ''}`}><span>Trade or service</span><select value={form.tradeCategory} onChange={event => update('tradeCategory', event.target.value)}>{categories.map(category => <option key={category}>{category}</option>)}</select>{fieldErrors.tradeCategory && <small className="field-error">{fieldErrors.tradeCategory}</small>}</label></>}
      <Field label="Password" error={fieldErrors.password} type="password" value={form.password} onChange={event => update('password', event.target.value)} required autoComplete="new-password" />
      <div className="password-rules" aria-live="polite">{['At least 8 characters', 'At least one letter', 'At least one number'].map((rule, index) => <span className={rules[index] ? 'is-valid' : ''} key={rule}>{rules[index] ? <Check size={14} /> : <Circle size={14} />}{rule}</span>)}</div>
      <Field label="Confirm password" error={fieldErrors.confirmPassword} type="password" value={form.confirmPassword} onChange={event => update('confirmPassword', event.target.value)} required autoComplete="new-password" />
      <Button disabled={loading}>{loading ? 'Creating account…' : 'Create account'} <ArrowRight size={18} /></Button>
      <p className="auth-terms">By creating an account, you agree to use FundiQuote responsibly.</p>
      <p className="switch">Already have an account? <a href="#/login">Sign in</a></p>
    </form>
  </AuthLayout>
}
function Dashboard({ user }: { user: User }) { const provider = user.role === 'PROVIDER'; const admin = user.role === 'ADMIN'; return <><div className="page-heading"><div><p className="eyebrow green">{admin ? 'ADMINISTRATION' : provider ? 'YOUR WORKSPACE' : 'YOUR SPACE'}</p><h1>Good morning, {user.fullName.split(' ')[0]}.</h1><p>{admin ? 'Manage the FundiQuote platform.' : provider ? 'Here’s what’s happening with your business.' : 'Find the right people for your next project.'}</p></div>{provider ? <LinkButton href="#/app/business-profile">Manage business <span>→</span></LinkButton> : null}</div>{provider ? <><div className="subscription"><div><span className="status-dot"></span><b>Free plan</b><span>Subscription management is coming soon.</span></div><a href="#/app/business-profile">Manage business →</a></div><div className="metrics">{['Quotations', 'Accepted', 'Active jobs', 'Outstanding'].map(label => <div className="metric" key={label}><span>{label}</span><strong>—</strong><small>Coming soon</small></div>)}</div><section className="panel"><div className="panel-title"><div><h3>Recent activity</h3><p>Your latest business activity will appear here.</p></div></div><div className="empty"><div className="empty-icon">◷</div><b>No activity yet</b><p>Once you start sending quotations, your activity will show up here.</p></div></section></> : admin ? <section className="panel profile-panel"><div className="panel-title"><p className="eyebrow green">PLATFORM OVERVIEW</p><h2>Administrator dashboard</h2><p>Administration tools will be added in a future phase.</p></div></section> : <><section className="customer-hero"><div><p className="eyebrow green">COMING SOON</p><h2>What do you need help with?</h2><p>Discover trusted local fundis and get the right quote for your project.</p><LinkButton href="#/app/customer-dashboard">Explore services <span>→</span></LinkButton></div><div className="hero-shape">⌂</div></section><div className="metrics">{['Service requests', 'Received quotes', 'Completed jobs'].map(label => <div className="metric" key={label}><span>{label}</span><strong>—</strong><small>Coming soon</small></div>)}</div></>}</> }
function App() {
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)
  const location = useLocation()
  const path = location.pathname
  const authCheckStarted = useRef(false)

  useEffect(() => {
    if (authCheckStarted.current) return
    authCheckStarted.current = true
    request<{ user: User | null }>('/auth/me')
      .then(result => setUser(result.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false))
  }, [])

  const logout = async () => {
    await request('/auth/logout', { method: 'POST' }).catch(() => undefined)
    setUser(null)
    window.location.hash = '/login'
  }
  const titles: Record<string, string> = {
    '/login': 'Sign in', '/register': 'Create account', '/forgot-password': 'Forgot password',
    '/reset-password': 'Reset password', '/app/dashboard': 'Dashboard', '/app/customers': 'Customers',
    '/app/quotations': 'Quotations', '/app/jobs': 'Jobs', '/app/materials': 'Inventory',
    '/app/invoices': 'Invoices', '/app/payments': 'Payments', '/app/expenses': 'Expenses',
    '/app/reports': 'Reports', '/app/billing': 'Subscription', '/app/profile': 'My profile',
    '/app/business-profile': 'Business profile',
  }
  useDocumentTitle(path.startsWith('/quotation/share/') ? 'Shared quotation' : titles[path] ?? 'FundiQuote')

  if (path.startsWith('/quotation/share/')) return <PublicQuotationSharePage token={path.split('/').pop() ?? ''} />
  if (checking) return <div className="loading-screen"><Logo /><span>Loading your workspace…</span></div>
  if (path === '/login' || (!user && path === '/')) return <Login onLogin={setUser} />
  if (path === '/register') return <Register onLogin={setUser} />
  if (path === '/forgot-password') return <ForgotPassword />
  if (path === '/reset-password') return <ResetPassword />
  if (path === '/' && user) return <Navigate to="/app/dashboard" replace />
  if (path.startsWith('/app')) {
    const page = path.match(/^\/app\/customers\/[^/]+$/) ? <CustomerDetailPage id={path.split('/').pop() ?? ''} />
      : path === '/app/customers' ? <CustomersPage />
      : path.match(/^\/app\/quotations\/[^/]+\/edit$/) ? <QuotationsPage editId={path.split('/').at(-2) ?? ''} />
      : path.match(/^\/app\/quotations\/[^/]+$/) && path !== '/app/quotations/new' ? <QuotationDetailPage id={path.split('/').pop() ?? ''} />
        : path.match(/^\/app\/jobs\/[^/]+$/) ? <JobDetailPage id={path.split('/').pop() ?? ''} />
      : path.includes('quotations') ? <QuotationsPage />
        : path.includes('jobs') ? <JobsPage />
          : path.includes('materials') || path.startsWith('/app/inventory') ? <InventoryPage />
            : path.includes('invoices') ? <Operations section="invoices" />
              : path.includes('payments') ? <Operations section="payments" />
                : path.includes('expenses') ? <Operations section="expenses" />
                  : path.includes('reports') ? <Operations section="reports" />
                    : path.includes('billing') ? <Billing user={user!} />
                      : path.includes('business-profile') ? <ConnectedProfile user={user!} business />
                        : path.includes('/profile') ? <ConnectedProfile user={user!} />
                          : path === '/app' || path === '/app/dashboard' ? user!.role === 'PROVIDER' ? <DashboardPage user={user!} /> : <Dashboard user={user!} />
                            : <NotFoundPage />
    return <RequireAuth user={user}><AppLayout user={user!} onLogout={logout}>{page}</AppLayout></RequireAuth>
  }
  return <NotFoundPage />
}
export default App

function Customers() {
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; phone: string; email?: string | null }>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', phone: '', email: '' })
  const load = async () => { try { const result = await request<{ customers: typeof customers }>('/customers'); setCustomers(result.customers) } catch (requestError) { setError(errorMessage(requestError)) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(''); setMessage(''); try { await request('/customers', { method: 'POST', body: JSON.stringify(form) }); setForm({ name: '', phone: '', email: '' }); setMessage('Customer saved successfully.'); await load() } catch (requestError) { setError(errorMessage(requestError)) } finally { setSaving(false) } }
  return <><div className="page-heading"><div><p className="eyebrow green">BUSINESS CONTACTS</p><h1>Customers</h1><p>Keep customer records ready for quotations and invoices.</p></div></div><section className="panel profile-panel"><div className="panel-title"><h2>Add customer</h2><p>Customer records are scoped to your business.</p></div><form onSubmit={submit}><div className="two-col"><Field label="Name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} required /><Field label="Phone" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} required placeholder="0712 345 678" /></div><Field label="Email (optional)" type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} />{message && <div className="message success-message">{message}</div>}{error && <div className="message error">{error}</div>}<Button disabled={saving}>{saving ? 'Saving…' : 'Save customer'} <span>→</span></Button></form></section><section className="panel"><div className="panel-title"><h2>Customer list</h2><p>{loading ? 'Loading…' : `${customers.length} customer${customers.length === 1 ? '' : 's'}`}</p></div>{!loading && customers.length === 0 ? <div className="empty"><b>No customers yet</b><p>Add a customer above to create quotations.</p></div> : <div className="quote-list">{customers.map(customer => <div className="quote-row" key={customer.id}><div><b>{customer.name}</b><small>{customer.phone}{customer.email ? ` · ${customer.email}` : ''}</small></div><a className="text-button" href={`#/app/quotations?customer=${customer.id}`}>Create quotation</a></div>)}</div>}</section></>
}

void Customers

function Operations({ section }: { section: 'jobs' | 'materials' | 'invoices' | 'payments' | 'expenses' | 'reports' }) {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', unit: 'piece', costPerUnit: '', reorderLevel: '', description: '', amount: '', category: 'OTHER', expenseDate: new Date().toISOString().slice(0, 10) })
  const endpoint = section === 'materials' ? '/materials' : section === 'expenses' ? '/expenses' : section === 'reports' ? '/reports/overview' : `/${section}`
  const load = async () => { setLoading(true); try { const result = await request<any>(endpoint); setData(section === 'reports' ? [result] : result[section] ?? []) } catch (requestError) { setError(errorMessage(requestError)) } finally { setLoading(false) } }
  useEffect(() => { load() }, [section])
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(''); setMessage(''); try { if (section === 'materials') await request('/materials', { method: 'POST', body: JSON.stringify({ name: form.name, unit: form.unit, costPerUnit: Number(form.costPerUnit), reorderLevel: Number(form.reorderLevel || 0), description: form.description }) }); else if (section === 'expenses') await request('/expenses', { method: 'POST', body: JSON.stringify({ description: form.description || form.name, amount: Number(form.amount), category: form.category, expenseDate: form.expenseDate }) }); setMessage(`${section.slice(0, 1).toUpperCase() + section.slice(1)} saved successfully.`); setForm({ ...form, name: '', description: '', costPerUnit: '', reorderLevel: '', amount: '' }); await load() } catch (requestError) { setError(errorMessage(requestError)) } finally { setSaving(false) } }
  const title = section[0].toUpperCase() + section.slice(1)
  if (section === 'reports') return <><div className="page-heading"><div><p className="eyebrow green">BUSINESS REPORTING</p><h1>Reports</h1><p>Real database-backed activity for your business.</p></div></div><section className="metrics">{[['Invoiced', data[0]?.invoicedAmount], ['Payments received', data[0]?.paymentsReceived], ['Expenses', data[0]?.recordedExpenses], ['Outstanding', data[0]?.outstandingBalance]].map(([label, value]) => <div className="metric" key={String(label)}><span>{label}</span><strong>KES {value ?? '0.00'}</strong><small>Selected reporting period</small></div>)}</section><section className="panel"><h2>Job status</h2>{loading ? <p>Loading report…</p> : <div className="quote-list">{(data[0]?.jobs ?? []).map((job: any) => <div className="quote-row" key={job.status}><span>{job.status}</span><strong>{job._count}</strong></div>)}</div>}</section></>
  return <><div className="page-heading"><div><p className="eyebrow green">BUSINESS OPERATIONS</p><h1>{title}</h1><p>Manage your {section} using saved business data.</p></div></div><section className="panel"><div className="panel-title"><h2>Add {section === 'materials' ? 'material' : section === 'expenses' ? 'expense' : title.toLowerCase()}</h2><p>Changes are validated and saved by the API.</p></div>{(section === 'materials' || section === 'expenses') && <form onSubmit={submit} className="quote-editor-form"><div className="two-col"><Field label={section === 'materials' ? 'Material name' : 'Description'} value={section === 'materials' ? form.name : form.description} onChange={event => setForm({ ...form, [section === 'materials' ? 'name' : 'description']: event.target.value })} required /><Field label={section === 'materials' ? 'Unit' : 'Amount (KES)'} type={section === 'materials' ? 'text' : 'number'} value={section === 'materials' ? form.unit : form.amount} onChange={event => setForm({ ...form, [section === 'materials' ? 'unit' : 'amount']: event.target.value })} required /></div>{section === 'materials' ? <div className="two-col"><Field label="Cost per unit" type="number" value={form.costPerUnit} onChange={event => setForm({ ...form, costPerUnit: event.target.value })} required /><Field label="Reorder level" type="number" value={form.reorderLevel} onChange={event => setForm({ ...form, reorderLevel: event.target.value })} /></div> : <label className="field"><span>Category</span><select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}><option>OTHER</option><option>MATERIALS</option><option>TRANSPORT</option><option>LABOUR</option><option>TOOLS</option><option>UTILITIES</option><option>RENT</option><option>MAINTENANCE</option></select></label>} {message && <div className="message success-message">{message}</div>}{error && <div className="message error">{error}</div>}<Button disabled={saving}>{saving ? 'Saving…' : `Save ${section === 'materials' ? 'material' : 'expense'}`}</Button></form>}</section><section className="panel"><div className="panel-title"><h2>{title} list</h2><p>{loading ? 'Loading…' : `${data.length} record${data.length === 1 ? '' : 's'}`}</p></div>{!loading && data.length === 0 ? <div className="empty"><b>No {section} yet</b><p>Create the first record above.</p></div> : <div className="quote-list">{data.map((item: any) => <div className="quote-row" key={item.id}><div><b>{item.name ?? item.description ?? item.jobNumber ?? item.invoiceNumber}</b><small>{item.status ?? item.category ?? item.unit ?? ''}</small></div><strong>{item.stockQuantity !== undefined ? `${item.stockQuantity} ${item.unit}` : item.amount ? `KES ${item.amount}` : item.grandTotal ? `KES ${item.grandTotal}` : ''}</strong></div>)}</div>}</section></>
}

function AdminPricing() {
  const [plan, setPlan] = useState<any>(null)
  const [price, setPrice] = useState('299')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { request<any>('/admin/subscription-plan').then(result => { setPlan(result.plan); setPrice(String(result.plan.price)) }).catch(requestError => setError(errorMessage(requestError))) }, [])
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(''); setMessage(''); try { const result = await request<any>('/admin/subscription-plan', { method: 'PATCH', body: JSON.stringify({ price: Number(price), currency: 'KES' }) }); setPlan(result.plan); setMessage('Subscription price updated for new payments.') } catch (requestError) { setError(errorMessage(requestError)) } finally { setSaving(false) } }
  return <><div className="page-heading"><div><p className="eyebrow green">ADMINISTRATION</p><h1>Subscription pricing</h1><p>Historical transactions keep their original price.</p></div></div><section className="panel profile-panel"><form onSubmit={save}>{error && <div className="message error">{error}</div>}{message && <div className="message success-message">{message}</div>}<Field label="Monthly price (KES)" type="number" min="1" value={price} onChange={event => setPrice(event.target.value)} required /><p className="hint">Current configured plan: {plan?.name ?? 'Loading…'}</p><Button disabled={saving}>{saving ? 'Saving…' : 'Save price'}</Button></form></section></>
}

function Billing({ user }: { user: User }) {
  const [billing, setBilling] = useState<any>(null)
  const [phone, setPhone] = useState(user.phone)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const load = async () => { try { setBilling(await request<any>('/billing')) } catch (requestError) { setError(errorMessage(requestError)) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])
  useEffect(() => { const transactionId = billing?.transactions?.[0]?.status === 'PENDING' ? billing.transactions[0].id : null; if (!transactionId) return; const timer = window.setInterval(() => request<any>(`/billing/transactions/${transactionId}`).then(result => { if (result.transaction.status !== 'PENDING') { setMessage(result.transaction.status === 'COMPLETED' ? 'Subscription payment confirmed.' : `Payment status: ${result.transaction.status}`); load() } }).catch(() => undefined), 5000); return () => window.clearInterval(timer) }, [billing])
  const startPayment = async (event: FormEvent) => { event.preventDefault(); setWorking(true); setError(''); setMessage(''); try { const result = await request<any>('/billing/mpesa/initiate', { method: 'POST', body: JSON.stringify({ phoneNumber: phone }) }); setMessage(result.message); await load() } catch (requestError) { setError(errorMessage(requestError)) } finally { setWorking(false) } }
  if (user.role === 'ADMIN') return <AdminPricing />
  if (user.role !== 'PROVIDER') return <section className="panel profile-panel"><h2>Billing</h2><p>Subscription billing is available to providers.</p></section>
  return <><div className="page-heading"><div><p className="eyebrow green">BILLING</p><h1>Subscription</h1><p>Unlock quotations, invoices, exports, and other Pro tools.</p></div></div><section className="panel profile-panel"><div className="panel-title"><h2>{loading ? 'Loading plan…' : billing?.subscription?.status === 'ACTIVE' ? 'Pro subscription active' : 'Pro monthly plan'}</h2><p>KES {billing?.subscription?.price ?? 299} · One calendar month</p></div>{billing?.subscription?.expiresAt && <p>Renews or expires on {new Date(billing.subscription.expiresAt).toLocaleDateString()}</p>}{error && <div className="message error">{error}</div>}{message && <div className="message success-message">{message}</div>}<form onSubmit={startPayment}><Field label="M-Pesa phone number" value={phone} onChange={event => setPhone(event.target.value)} required placeholder="0712 345 678" /><Button disabled={working || billing?.subscription?.status === 'ACTIVE'}>{working ? 'Starting payment…' : billing?.subscription?.status === 'ACTIVE' ? 'Subscription active' : 'Pay with M-Pesa'} <span>→</span></Button></form></section><section className="panel"><div className="panel-title"><h2>Payment history</h2><p>Only transactions belonging to your business are shown.</p></div>{!billing?.transactions?.length ? <div className="empty"><b>No subscription payments yet</b><p>Start a secure M-Pesa checkout above.</p></div> : <div className="quote-list">{billing.transactions.map((transaction: any) => <div className="quote-row" key={transaction.id}><div><b>{new Date(transaction.requestedAt).toLocaleDateString()} · KES {transaction.amount}</b><small>{transaction.status}{transaction.mpesaReceipt ? ` · ${transaction.mpesaReceipt}` : ''}</small></div>{transaction.status === 'COMPLETED' && <a className="text-button" href={`${API}/billing/transactions/${transaction.id}`} target="_blank" rel="noreferrer">View</a>}</div>)}</div>}</section></>
}

function ConnectedProfile({ user, business = false }: { user: User; business?: boolean }) {
  const [form, setForm] = useState<any>({ fullName: user.fullName, phone: user.phone, email: user.email ?? '', name: '', address: '', tradeCategory: categories[0], slogan: '', paymentInstructions: '', mpesaNumber: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { request<any>(business ? '/business-profile' : '/profile').then(result => { const profile = result.profile?.business ?? result.profile; setForm((current: any) => ({ ...current, ...result.user, ...(business ? { ...profile, name: profile?.name ?? '' } : {}) })) }).catch(requestError => setError(errorMessage(requestError))).finally(() => setLoading(false)) }, [business])
  const update = (key: string, value: string) => setForm((current: any) => ({ ...current, [key]: value }))
  const submit = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(''); setMessage(''); try { const payload = business ? { name: form.name, phone: form.phone, email: form.email, address: form.address, tradeCategory: form.tradeCategory, slogan: form.slogan, paymentInstructions: form.paymentInstructions, mpesaNumber: form.mpesaNumber } : { fullName: form.fullName, phone: form.phone, email: form.email }; const result = await request<any>(business ? '/business-profile' : '/profile', { method: 'PATCH', body: JSON.stringify(payload) }); if (!business && result.user) setForm((current: any) => ({ ...current, ...result.user })); setMessage('Changes saved successfully.') } catch (requestError) { setError(errorMessage(requestError)) } finally { setSaving(false) } }
  return <section className="panel profile-panel"><div className="panel-title"><p className="eyebrow green">{business ? 'BUSINESS DETAILS' : 'ACCOUNT DETAILS'}</p><h2>{business ? 'Your business profile' : 'Personal profile'}</h2><p>{loading ? 'Loading saved details…' : 'Changes are saved to your account.'}</p></div><form onSubmit={submit}>{error && <div className="message error">{error}</div>}{message && <div className="message success-message">{message}</div>}{business ? <><Field label="Business name" value={form.name} onChange={event => update('name', event.target.value)} required /><Field label="Business phone" value={form.phone} onChange={event => update('phone', event.target.value)} required /><Field label="Business email" value={form.email} onChange={event => update('email', event.target.value)} /><Field label="Business address" value={form.address} onChange={event => update('address', event.target.value)} /><label className="field"><span>Trade category</span><select value={form.tradeCategory} onChange={event => update('tradeCategory', event.target.value)}>{categories.map(category => <option key={category}>{category}</option>)}</select></label><Field label="M-Pesa number" value={form.mpesaNumber} onChange={event => update('mpesaNumber', event.target.value)} /></> : <><Field label="Full name" value={form.fullName} onChange={event => update('fullName', event.target.value)} required /><Field label="Phone number" value={form.phone} onChange={event => update('phone', event.target.value)} required /><Field label="Email address" value={form.email} onChange={event => update('email', event.target.value)} /></>}<Button disabled={loading || saving}>{saving ? 'Saving…' : 'Save changes'}</Button></form></section>
}

function Quotations({ user }: { user: User }) {
  const [quotations, setQuotations] = useState<Array<{ id: string; quotationNumber: string; title: string; status: string; grandTotal: string; customer: { name: string } }>>([])
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([])
  const [customerId, setCustomerId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [item, setItem] = useState({ description: '', quantity: '1', unit: 'item', unitPrice: '' })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const load = async () => { try { const [quoteResult, customerResult] = await Promise.all([request<{ quotations: typeof quotations }>('/quotations'), request<{ customers: typeof customers }>('/customers')]); setQuotations(quoteResult.quotations); setCustomers(customerResult.customers); if (!customerId && customerResult.customers[0]) setCustomerId(customerResult.customers[0].id) } catch (requestError) { setError(errorMessage(requestError)) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])
  const create = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(''); setMessage(''); try { await request('/quotations', { method: 'POST', body: JSON.stringify({ customerId, title, description, items: [{ ...item, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice) }] }) }); setMessage('Draft quotation saved successfully.'); setTitle(''); setDescription(''); setItem({ description: '', quantity: '1', unit: 'item', unitPrice: '' }); await load() } catch (requestError) { setError(errorMessage(requestError)) } finally { setSaving(false) } }
  const share = async (id: string) => { try { const result = await request<{ shareUrl: string; message: string }>(`/quotations/${id}/share`, { method: 'POST' }); await navigator.clipboard?.writeText(result.shareUrl); window.open(`https://wa.me/?text=${encodeURIComponent(`Please review your FundiQuote quotation: ${result.shareUrl}`)}`, '_blank', 'noopener,noreferrer'); setMessage(`${result.message} Link copied and WhatsApp opened.`) } catch (requestError) { setError(errorMessage(requestError)) } }
  if (user.role !== 'PROVIDER') return <section className="panel profile-panel"><h2>Quotations</h2><p>Only service providers can manage quotations.</p></section>
  return <><div className="page-heading"><div><p className="eyebrow green">PROVIDER TOOLS</p><h1>Quotations</h1><p>Create clear, itemised estimates for your customers.</p></div></div><section className="panel quote-editor"><div className="panel-title"><h2>New draft</h2><p>Totals are calculated and validated by the server.</p></div><form onSubmit={create}><label className="field"><span>Customer</span><select value={customerId} onChange={event => setCustomerId(event.target.value)} required><option value="">Select a customer</option>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><Field label="Quotation title" value={title} onChange={event => setTitle(event.target.value)} required placeholder="e.g. Kitchen rewiring" /><label className="field"><span>Work description</span><textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} /></label><div className="two-col"><Field label="Line item" value={item.description} onChange={event => setItem({ ...item, description: event.target.value })} required placeholder="Labour or materials" /><Field label="Unit price (KES)" type="number" min="0" step="0.01" value={item.unitPrice} onChange={event => setItem({ ...item, unitPrice: event.target.value })} required /></div>{message && <div className="message success-message">{message}</div>}{error && <div className="message error">{error}</div>}<Button disabled={saving || loading}>{saving ? 'Saving draft…' : 'Save draft'} <span>→</span></Button></form></section><section className="panel"><div className="panel-title"><h2>Recent quotations</h2><p>{loading ? 'Loading…' : `${quotations.length} quotation${quotations.length === 1 ? '' : 's'}`}</p></div>{!loading && quotations.length === 0 ? <div className="empty"><b>No quotations yet</b><p>Your saved drafts and issued quotations will appear here.</p></div> : <div className="quote-list">{quotations.map(quotation => <div className="quote-row" key={quotation.id}><div><b>{quotation.quotationNumber} · {quotation.title}</b><small>{quotation.customer.name} · {quotation.status}</small></div><div><strong>KES {quotation.grandTotal}</strong>{quotation.status !== 'DRAFT' && <button type="button" onClick={() => share(quotation.id)}>Share</button>}</div></div>)}</div>}</section></>
}

void Quotations

function ResetPassword() {
  const token = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const rules = [password.length >= 8, /[A-Za-z]/.test(password), /\d/.test(password)]
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setMessage('')
    if (!token) { setError('This reset link is missing its token. Request a new link.'); return }
    if (password !== confirm) { setError('The passwords do not match.'); return }
    if (!rules.every(Boolean)) { setError('Use at least 8 characters, including a letter and a number.'); return }
    setSaving(true)
    try {
      const result = await request<{ message: string }>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) })
      setMessage(result.message)
      window.setTimeout(() => { window.location.hash = '/login' }, 1200)
    } catch (cause) { setError(errorMessage(cause)) } finally { setSaving(false) }
  }
  return <AuthLayout title="Choose a new password" subtitle="Use a strong password you have not used before.">
    <form onSubmit={submit}>
      {error && <div className="message error" role="alert">{error}</div>}
      {message && <div className="message success-message" role="status">{message}</div>}
      <Field label="New password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} required />
      <div className="password-rules" aria-live="polite">
        {['At least 8 characters', 'At least one letter', 'At least one number'].map((rule, index) => <span className={rules[index] ? 'is-valid' : ''} key={rule}>{rules[index] ? '✓' : '○'} {rule}</span>)}
      </div>
      <Field label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} required />
      <Button disabled={saving || !token}>{saving ? 'Saving password…' : 'Reset password'} <span>→</span></Button>
      <p className="switch"><a href="#/forgot-password">Request a new reset link</a></p>
    </form>
  </AuthLayout>
}

function ForgotPassword() {
  const [identifier, setIdentifier] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const result = await request<{ message: string }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ identifier }) })
      setMessage(result.message)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setLoading(false)
    }
  }
  return <AuthLayout title="Reset your password" subtitle="Enter your email or phone and we’ll help you get back in."><form onSubmit={submit}>{error && <div className="message error">{error}</div>}{message && <div className="message success-message">{message}</div>}<Field label="Phone or email" value={identifier} onChange={event => setIdentifier(event.target.value)} required placeholder="you@example.com" /><Button disabled={loading}>{loading ? 'Preparing recovery…' : 'Send recovery link'} <span>→</span></Button><p className="switch"><a href="#/login">← Back to sign in</a></p></form></AuthLayout>
}
