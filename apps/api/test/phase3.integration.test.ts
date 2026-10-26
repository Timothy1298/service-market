import test from 'node:test'
import assert from 'node:assert/strict'
import { app, prisma, closeDatabase } from '../src/server'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const enabled = process.env.RUN_DB_TESTS === 'true' && !!testDatabaseUrl && process.env.DATABASE_URL === testDatabaseUrl && !/\/marketplace_db(?:[?]|$)/.test(testDatabaseUrl)

test('Phase 3 workflow persists jobs, stock, invoices, payments, expenses, and reports', { skip: !enabled }, async () => {
  const server = app.listen(0)
  const address = server.address()
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const phone = `071${suffix.slice(-7)}`
  const email = `phase3-${suffix}@example.test`
  let cookie = ''
  const call = async (path: string, options: RequestInit = {}) => {
    const response = await fetch(`${base}/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers ?? {}) } })
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    const body = response.status === 204 ? null : await response.json()
    assert.ok(response.ok, `${path}: ${response.status} ${JSON.stringify(body)}`)
    return body
  }
  try {
    const registration = await call('/auth/register', { method: 'POST', body: JSON.stringify({ fullName: 'Phase Three Provider', phone, email, password: 'Phase3Pass1', confirmPassword: 'Phase3Pass1', accountType: 'PROVIDER', businessName: `Phase 3 ${suffix}`, tradeCategory: 'Electrical' }) })
    const provider = await prisma.user.findUniqueOrThrow({ where: { id: registration.user.id }, include: { providerProfile: true } })
    const customer = await call('/customers', { method: 'POST', body: JSON.stringify({ name: 'Integration Customer', phone: `072${suffix.slice(-7)}`, email: `customer-${suffix}@example.test` }) })
    const customerList = await call('/customers?page=1&pageSize=50')
    assert.equal(customerList.customers[0].quotationCount, 0)
    assert.equal(Number(customerList.customers[0].outstandingBalance), 0)
    const initialCustomerStats = await call('/customers/stats')
    assert.equal(initialCustomerStats.total, 1)
    assert.equal(initialCustomerStats.withBalance, 0)
    const quotation = await call('/quotations', { method: 'POST', body: JSON.stringify({ customerId: customer.customer.id, title: 'Integration job', items: [{ description: 'Labour', quantity: 1, unit: 'job', unitPrice: 1000 }] }) })
    const quotationDetail = await call(`/quotations/${quotation.quotation.id}`)
    assert.equal(quotationDetail.quotation.items.length, 1)
    assert.equal(quotationDetail.quotation.business.name, `Phase 3 ${suffix}`)
    await call(`/quotations/${quotation.quotation.id}/issue`, { method: 'POST' })
    const share = await call(`/quotations/${quotation.quotation.id}/share`, { method: 'POST' })
    const token = share.shareUrl.split('/').pop()
    await call(`/quotations/share/${token}/respond`, { method: 'POST', body: JSON.stringify({ decision: 'ACCEPTED' }), headers: { Cookie: '' } })
    const job = await call(`/quotations/${quotation.quotation.id}/convert-to-job`, { method: 'POST', body: JSON.stringify({ title: 'Integration job' }) })
    const jobStats = await call('/jobs/stats')
    assert.equal(jobStats.total, 1)
    assert.equal(jobStats.byStatus.SCHEDULED, 1)
    assert.equal(jobStats.active, 1)
    const jobDetail = await call(`/jobs/${job.job.id}`)
    assert.equal(jobDetail.job.quotation.quotationNumber, quotation.quotation.quotationNumber)
    assert.equal(jobDetail.job.activities.length, 1)
    const material = await call('/materials', { method: 'POST', body: JSON.stringify({ name: 'Cable', unit: 'metre', costPerUnit: 10, reorderLevel: 2 }) })
    await call(`/materials/${material.material.id}/restock`, { method: 'POST', body: JSON.stringify({ quantity: 5 }) })
    await call(`/jobs/${job.job.id}/materials`, { method: 'POST', body: JSON.stringify({ materialId: material.material.id, quantity: 2 }) })
    const invoice = await call('/invoices', { method: 'POST', body: JSON.stringify({ jobId: job.job.id, customerId: customer.customer.id, quotationId: quotation.quotation.id, items: [{ description: 'Labour', quantity: 1, unit: 'job', unitPrice: 1000 }] }) })
    await call(`/invoices/${invoice.invoice.id}/issue`, { method: 'POST' })
    await call(`/invoices/${invoice.invoice.id}/payments`, { method: 'POST', body: JSON.stringify({ amount: 400, method: 'MPESA', reference: 'MANUAL-TEST' }) })
    const updatedCustomerStats = await call('/customers/stats')
    assert.equal(updatedCustomerStats.withBalance, 1)
    assert.equal(Number(updatedCustomerStats.outstandingTotal), 600)
    const customerDetail = await call(`/customers/${customer.customer.id}`)
    assert.equal(customerDetail.customer.quotations.length, 1)
    assert.equal(customerDetail.customer.jobs.length, 1)
    assert.equal(customerDetail.customer.invoices.length, 1)
    await call('/expenses', { method: 'POST', body: JSON.stringify({ category: 'TRANSPORT', description: 'Site transport', amount: 100 }) })
    const report = await call('/reports/overview')
    assert.equal(report.paymentsReceived, 400)
    assert.equal(report.recordedExpenses, 100)
    assert.equal(Number(report.outstandingBalance), 600)
  } finally {
    const provider = await prisma.user.findUnique({ where: { email }, include: { providerProfile: true } })
    if (provider?.providerProfile) await prisma.business.delete({ where: { id: provider.providerProfile.businessId } })
    if (provider) await prisma.user.delete({ where: { id: provider.id } })
    server.close()
    await closeDatabase()
  }
})
