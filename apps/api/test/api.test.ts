import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { closeDatabase, registrationSchema } from '../src/server.ts'

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
