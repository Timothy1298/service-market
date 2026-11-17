import test from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '../src/generated/prisma/client'
import { queueNotificationEvent, presentationForEvent } from '../src/features/notifications/events'

test('notification templates render references, amounts and safe internal actions',()=>{
  const payment=presentationForEvent('INVOICE_PAID',{reference:'INV-2026-00001',amount:1250,currency:'KES',actionUrl:'/app/invoices/invoice-id'})
  assert.equal(payment.category,'PAYMENTS')
  assert.match(payment.body,/KES 1,250\.00/)
  assert.equal(payment.actionUrl,'/app/invoices/invoice-id')
  const unsafe=presentationForEvent('INVOICE_PAID',{reference:'INV-1',amount:10,actionUrl:'javascript:alert(1)'})
  assert.equal(unsafe.actionUrl,undefined)
})

test('customer quotation notification points to the expiring public share route',()=>{
  const message=presentationForEvent('QUOTATION_SENT',{reference:'QT-2026-00001',customerFacing:true,actionUrl:'/quotation/share/0123456789abcdef0123456789abcdef0123456789abcdef'})
  assert.equal(message.title,'New quotation received')
  assert.equal(message.actionUrl,'/quotation/share/0123456789abcdef0123456789abcdef0123456789abcdef')
  assert.match(message.body,/Review the details and respond/)
})

test('outbox event publishing uses a stable idempotency key and does not overwrite a prior event',async()=>{
  let captured:unknown
  const fake={notificationEvent:{upsert:async(input:unknown)=>{captured=input;return input}}}
  await queueNotificationEvent(fake as unknown as Prisma.TransactionClient,{businessId:'business-1',actorUserId:'user-1',idempotencyKey:'invoice-paid:payment-1',eventType:'INVOICE_PAID',payload:{reference:'INV-1',amount:100,currency:'KES'}})
  const input=captured as {where:{idempotencyKey:string};create:{eventType:string;payload:{reference:string}};update:Record<string,never>}
  assert.equal(input.where.idempotencyKey,'invoice-paid:payment-1')
  assert.equal(input.create.eventType,'INVOICE_PAID')
  assert.equal(input.create.payload.reference,'INV-1')
  assert.deepEqual(input.update,{})
})
