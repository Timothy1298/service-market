import test from 'node:test'
import assert from 'node:assert/strict'
import { app, prisma, closeDatabase } from '../src/server'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const enabled = process.env.RUN_DB_TESTS === 'true' && !!testDatabaseUrl && process.env.DATABASE_URL === testDatabaseUrl && !/\/marketplace_db(?:[?]|$)/.test(testDatabaseUrl)

test('customer marketplace request, quote, conversation, and job journey is scoped to its account', { skip: !enabled }, async () => {
  const server = app.listen(0)
  const address = server.address()
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api`
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const providerEmail = `customer-portal-provider-${suffix}@example.test`
  const customerEmail = `customer-portal-user-${suffix}@example.test`
  const otherCustomerEmail = `customer-portal-other-${suffix}@example.test`
  const phone = `071${suffix.slice(-7)}`
  let categoryId: string | undefined
  const sessions = new Map<string, string>()
  const call = async (session: string, path: string, options: RequestInit = {}) => {
    const response = await fetch(`${base}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(sessions.get(session) ? { Cookie: sessions.get(session)! } : {}), ...(options.headers ?? {}) } })
    const cookie = response.headers.get('set-cookie')
    if (cookie) sessions.set(session, cookie.split(';')[0])
    const body = response.status === 204 ? null : await response.json()
    assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(body)}`)
    return body as any
  }
  try {
    const category = await prisma.serviceCategory.upsert({ where: { slug: `portal-${suffix}` }, create: { slug: `portal-${suffix}`, name: `Portal service ${suffix}` }, update: { isActive: true } })
    categoryId = category.id
    const provider = await call('provider', '/auth/register', { method: 'POST', body: JSON.stringify({ fullName: 'Portal Provider', phone, email: providerEmail, password: 'PortalTest123', confirmPassword: 'PortalTest123', accountType: 'PROVIDER', businessName: `Portal Business ${suffix}`, tradeCategory: category.name }) })
    const businessId = (await prisma.providerProfile.findUniqueOrThrow({ where: { userId: provider.user.id }, select: { businessId: true } })).businessId
    const listing = await call('provider', '/provider/listings', { method: 'POST', body: JSON.stringify({ categoryId: category.id, title: 'Portal service', description: 'A service listing for the customer portal integration test.', status: 'PUBLISHED' }) })
    assert.ok(listing.listing.id)
    const customer = await call('customer', '/auth/register', { method: 'POST', body: JSON.stringify({ fullName: 'Portal Customer', phone: `072${suffix.slice(-7)}`, email: customerEmail, password: 'PortalTest123', confirmPassword: 'PortalTest123', accountType: 'CUSTOMER' }) })
    const request = await call('customer', '/requests', { method: 'POST', body: JSON.stringify({ categoryId: category.id, providerBusinessId: businessId, title: 'Fix a service issue', description: 'Please inspect and repair the service issue described here.', location: 'Nairobi, Westlands', budgetMin: 1000, budgetMax: 5000 }) })
    assert.equal(request.request.providerBusinessId, businessId)
    const other = await call('other', '/auth/register', { method: 'POST', body: JSON.stringify({ fullName: 'Other Customer', phone: `073${suffix.slice(-7)}`, email: otherCustomerEmail, password: 'PortalTest123', confirmPassword: 'PortalTest123', accountType: 'CUSTOMER' }) })
    const hiddenRequest = await fetch(`${base}/requests/${request.request.id}`, { headers: { Cookie: sessions.get('other')! } })
    assert.equal(hiddenRequest.status, 404)
    assert.ok(other.user.id !== customer.user.id)
    const crm = await call('provider', '/customers', { method: 'POST', body: JSON.stringify({ name: 'Portal Customer', phone: `072${suffix.slice(-7)}`, email: customerEmail }) })
    const quotation = await call('provider', '/quotations', { method: 'POST', body: JSON.stringify({ customerId: crm.customer.id, serviceRequestId: request.request.id, title: 'Repair quotation', items: [{ description: 'Inspection and repair', quantity: 1, unit: 'job', unitPrice: 2500 }] }) })
    await call('provider', `/quotations/${quotation.quotation.id}/issue`, { method: 'POST', body: '{}' })
    const customerQuotes = await call('customer', '/customer-portal/quotations')
    assert.ok(customerQuotes.quotations.some((item: { id: string }) => item.id === quotation.quotation.id))
    await call('customer', `/customer-portal/quotations/${quotation.quotation.id}/respond`, { method: 'POST', body: JSON.stringify({ decision: 'ACCEPTED' }) })
    const job = await call('provider', `/quotations/${quotation.quotation.id}/convert-to-job`, { method: 'POST', body: JSON.stringify({ title: 'Repair service', location: 'Westlands' }) })
    const jobs = await call('customer', '/customer-portal/jobs')
    assert.ok(jobs.jobs.some((item: { id: string }) => item.id === job.job.id))
    const conversation = await call('customer', '/customer-portal/conversations', { method: 'POST', body: JSON.stringify({ businessId, serviceRequestId: request.request.id }) })
    await call('customer', `/customer-conversations/${conversation.conversation.id}/messages`, { method: 'POST', body: JSON.stringify({ body: 'Could you confirm when you can visit?' }) })
    const providerConversations = await call('provider', '/provider/conversations')
    assert.ok(providerConversations.conversations.some((item: { id: string }) => item.id === conversation.conversation.id))
    const unauthorizedMessages = await fetch(`${base}/customer-conversations/${conversation.conversation.id}/messages`, { headers: { Cookie: sessions.get('other')! } })
    assert.equal(unauthorizedMessages.status, 404)
  } finally {
    const providerUser = await prisma.user.findUnique({ where: { email: providerEmail }, include: { providerProfile: true } })
    if (providerUser?.providerProfile) await prisma.business.delete({ where: { id: providerUser.providerProfile.businessId } })
    await prisma.user.deleteMany({ where: { email: { in: [providerEmail, customerEmail, otherCustomerEmail] } } })
    if (categoryId) await prisma.serviceCategory.delete({ where: { id: categoryId } })
    server.close()
    await closeDatabase()
  }
})
