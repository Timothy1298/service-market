import { z } from 'zod'

export const phoneSchema = z.preprocess(
  value => typeof value === 'string' ? value.replace(/[\s-]/g, '') : value,
  z.string().trim().regex(/^(?:\+?254|0)7\d{8}$/, 'Use a valid Kenyan mobile number'),
)

export const registrationSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  phone: phoneSchema,
  email: z.string().trim().email().optional().or(z.literal('')),
  password: z.string().min(8).max(128).regex(/[A-Za-z]/).regex(/\d/),
  confirmPassword: z.string(),
  accountType: z.enum(['PROVIDER', 'CUSTOMER']),
  businessName: z.string().trim().max(120).optional(),
  tradeCategory: z.string().trim().max(80).optional(),
}).refine(data => data.password === data.confirmPassword, {
  path: ['confirmPassword'],
  message: 'Passwords do not match',
}).refine(data => data.accountType !== 'PROVIDER' || Boolean(
  data.businessName && data.businessName.length >= 2 && data.tradeCategory && data.tradeCategory.length >= 2,
), {
  path: ['businessName'],
  message: 'Business name and trade are required for providers',
})
