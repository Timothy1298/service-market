import test from 'node:test'
import assert from 'node:assert/strict'
import { sendPasswordResetEmail } from '../src/features/auth/passwordResetEmail'

test('password reset email uses Brevo transactional API and carries the one-time URL',async()=>{
 const previous={key:process.env.BREVO_API_KEY,from:process.env.BREVO_FROM_EMAIL,name:process.env.BREVO_SENDER_NAME}
 process.env.BREVO_API_KEY='test-api-key';process.env.BREVO_FROM_EMAIL='notifications@example.test';process.env.BREVO_SENDER_NAME='FundiQuote Test'
 let requestUrl='';let requestInit:RequestInit|undefined
 try{
  await sendPasswordResetEmail('account@example.test','https://app.example.test/#/reset-password?token=safe-test-token',async(input,init)=>{requestUrl=String(input);requestInit=init;return new Response(JSON.stringify({messageId:'test-message'}),{status:201})})
  assert.equal(requestUrl,'https://api.brevo.com/v3/smtp/email')
  const headers=requestInit?.headers as Record<string,string>
  assert.equal(headers['api-key'],'test-api-key')
  const body=JSON.parse(String(requestInit?.body)) as {to:Array<{email:string}>;subject:string;textContent:string;htmlContent:string}
  assert.equal(body.to[0].email,'account@example.test')
  assert.match(body.subject,/Reset your FundiQuote password/)
  assert.match(body.textContent,/safe-test-token/)
  assert.match(body.htmlContent,/safe-test-token/)
 }finally{
  if(previous.key===undefined)delete process.env.BREVO_API_KEY;else process.env.BREVO_API_KEY=previous.key
  if(previous.from===undefined)delete process.env.BREVO_FROM_EMAIL;else process.env.BREVO_FROM_EMAIL=previous.from
  if(previous.name===undefined)delete process.env.BREVO_SENDER_NAME;else process.env.BREVO_SENDER_NAME=previous.name
 }
})

test('password reset email reports provider failures without revealing response bodies',async()=>{
 const previous={key:process.env.BREVO_API_KEY,from:process.env.BREVO_FROM_EMAIL}
 process.env.BREVO_API_KEY='test-api-key';process.env.BREVO_FROM_EMAIL='notifications@example.test'
 try{
  await assert.rejects(()=>sendPasswordResetEmail('account@example.test','https://app.example.test/reset',async()=>new Response('private provider details',{status:401})),/HTTP 401/)
 }finally{
  if(previous.key===undefined)delete process.env.BREVO_API_KEY;else process.env.BREVO_API_KEY=previous.key
  if(previous.from===undefined)delete process.env.BREVO_FROM_EMAIL;else process.env.BREVO_FROM_EMAIL=previous.from
 }
})
