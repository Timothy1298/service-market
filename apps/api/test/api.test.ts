import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { closeDatabase, getNairobiDayMonthBounds, registrationSchema } from '../src/server.ts'

after(async () => closeDatabase())

const provider = { fullName: 'Test User', phone: '0712 345 678', email: 'test@example.com', password: 'Password123', confirmPassword: 'Password123', accountType: 'PROVIDER' as const, businessName: 'Test Services', tradeCategory: 'Plumbing' }

test('registration schema accepts a valid provider', () => {
  assert.equal(registrationSchema.parse(provider).accountType, 'PROVIDER')
})

test('registration schema rejects a password without a letter', () => {
  assert.throws(() => registrationSchema.parse({ ...provider, password: '41181671', confirmPassword: '41181671' }))
})

test('registration schema accepts formatted Kenyan phone numbers', () => {
  assert.equal(registrationSchema.parse(provider).phone, '0712345678')
})

test('registration schema rejects a provider without business details', () => {
  assert.throws(() => registrationSchema.parse({
    ...provider,
    businessName: '',
    tradeCategory: '',
  }))
})

test('Nairobi day and month bounds honor the UTC+3 calendar boundary', () => {
  const bounds = getNairobiDayMonthBounds(new Date('2026-10-31T20:30:00.000Z'))
  assert.equal(bounds.dayStart.toISOString(), '2026-10-30T21:00:00.000Z')
  assert.equal(bounds.dayEnd.toISOString(), '2026-10-31T20:59:59.999Z')
  assert.equal(bounds.monthStart.toISOString(), '2026-09-30T21:00:00.000Z')
  assert.equal(bounds.monthEnd.toISOString(), '2026-10-31T20:59:59.999Z')
})
