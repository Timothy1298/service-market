import test from 'node:test'
import assert from 'node:assert/strict'
import { registrationSchema } from '../src/features/auth/validation'

const common = {
  fullName: 'Example Customer',
  phone: '0740000123',
  email: 'example-customer@example.test',
  password: 'SafeTestPass123',
  confirmPassword: 'SafeTestPass123',
}

test('customer registration accepts empty provider-only fields from older clients', () => {
  const parsed = registrationSchema.parse({ ...common, accountType: 'CUSTOMER', businessName: '', tradeCategory: '' })
  assert.equal(parsed.accountType, 'CUSTOMER')
  assert.equal(parsed.phone, '0740000123')
})

test('customer registration also accepts provider fields omitted by the updated client', () => {
  const parsed = registrationSchema.parse({ ...common, accountType: 'CUSTOMER' })
  assert.equal(parsed.accountType, 'CUSTOMER')
})

test('provider registration still requires a business name and trade', () => {
  assert.throws(() => registrationSchema.parse({ ...common, accountType: 'PROVIDER', businessName: '', tradeCategory: '' }))
})
