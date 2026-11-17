import { Prisma, type PrismaClient } from '../../generated/prisma/client'
import type { NotificationEventInput } from './events'
import { presentationForEvent } from './events'
import { businessSettingsSchema } from '../businessSettings'

export type NotificationDatabase = PrismaClient | Prisma.TransactionClient
const asObject=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
const escapeHtml=(value:string)=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')

export async function publishNotificationEvent(db:NotificationDatabase,input:NotificationEventInput){
  return db.notificationEvent.upsert({where:{idempotencyKey:input.idempotencyKey},create:{businessId:input.businessId??null,actorUserId:input.actorUserId??null,idempotencyKey:input.idempotencyKey,eventType:input.eventType,payload:JSON.parse(JSON.stringify(input.payload)) as Prisma.InputJsonValue},update:{}})
}

async function processEvent(prisma:PrismaClient,eventId:string){
  await prisma.$transaction(async tx=>{
    const event=await tx.notificationEvent.findUnique({where:{id:eventId}})
    if(!event||event.status==='PROCESSED')return
    const payload=asObject(event.payload)
    const explicit=Array.isArray(payload.recipientUserIds)?payload.recipientUserIds.filter((id):id is string=>typeof id==='string'):[]
    const members=event.businessId?await tx.businessMember.findMany({where:{businessId:event.businessId,status:'ACTIVE',role:{in:['OWNER','ADMIN']}},select:{userId:true}}):[]
    const recipientIds=[...new Set([...explicit,...members.map(member=>member.userId)])].filter(id=>event.eventType==='PASSWORD_CHANGED'||id!==event.actorUserId)
    if(!recipientIds.length){await tx.notificationEvent.update({where:{id:event.id},data:{status:'PROCESSED',processedAt:new Date(),lastError:null}});return}
    const presentation=presentationForEvent(event.eventType as Parameters<typeof presentationForEvent>[0],payload)
    const business=event.businessId?await tx.business.findUnique({where:{id:event.businessId},select:{name:true,settings:true,email:true}}):null
    const businessSettings=asObject(business?.settings),notificationSettings=asObject(businessSettings.notifications),businessInApp=asObject(notificationSettings.inApp)
    const businessEmailEnabled=notificationSettings.emailEnabled===true
    const users=await tx.user.findMany({where:{id:{in:recipientIds},isActive:true},select:{id:true,email:true,phone:true,notificationPreference:true}})
    for(const user of users){
      const preference=user.notificationPreference
      const channels=asObject(preference?.channels)
      const categories=asObject(preference?.categories)
      const isBusinessMember=members.some(member=>member.userId===user.id)
      if(presentation.category!=='SECURITY'&&(categories[presentation.category]===false||categories[event.eventType]===false))continue
      const businessPreferenceKey:Record<string,string>={REQUEST_CREATED:'newRequests',REQUEST_UPDATED:'newRequests',REQUEST_CANCELLED:'newRequests',QUOTATION_SENT:'newQuotations',QUOTATION_ACCEPTED:'quotationAccepted',QUOTATION_REJECTED:'quotationAccepted',JOB_CREATED:'jobAssignment',JOB_STATUS_CHANGED:'jobAssignment',JOB_COMPLETED:'jobCompletion',INVOICE_ISSUED:'newInvoices',INVOICE_PARTIALLY_PAID:'paymentsReceived',INVOICE_PAID:'paymentsReceived',INVOICE_CANCELLED:'newInvoices',PAYMENT_FAILED:'failedPayments',EXPENSE_RECORDED:'expenses',EXPENSE_UPDATED:'expenses',INVENTORY_LOW_STOCK:'lowInventory',INVENTORY_OUT_OF_STOCK:'lowInventory',INVENTORY_RESTOCKED:'lowInventory',TEAM_ROLE_CHANGED:'team',PASSWORD_CHANGED:'securityEvents',SUBSCRIPTION_ACTIVATED:'subscriptionRenewals',SUBSCRIPTION_PAYMENT_INITIATED:'subscriptionRenewals',SUBSCRIPTION_PAYMENT_FAILED:'subscriptionRenewals',SUBSCRIPTION_CANCELLED:'subscriptionRenewals',SUBSCRIPTION_RENEWAL_APPROACHING:'subscriptionRenewals',SUBSCRIPTION_EXPIRED:'subscriptionRenewals',INVOICE_DUE_SOON:'overdueInvoices',INVOICE_OVERDUE:'overdueInvoices',QUOTATION_EXPIRING:'newQuotations',JOB_UPCOMING:'jobAssignment'}
      const categoryKey=businessPreferenceKey[event.eventType]
      if(isBusinessMember&&categoryKey&&businessInApp[categoryKey]===false&&presentation.category!=='SECURITY')continue
      const recipientPresentation=isBusinessMember?presentation:presentationForEvent(event.eventType as Parameters<typeof presentationForEvent>[0],{...payload,customerFacing:true})
      const notification=await tx.notification.upsert({
        where:{recipientUserId_idempotencyKey:{recipientUserId:user.id,idempotencyKey:`${event.id}:${user.id}`}},
        create:{recipientUserId:user.id,businessId:isBusinessMember?event.businessId:null,eventId:event.id,idempotencyKey:`${event.id}:${user.id}`,category:recipientPresentation.category,eventType:event.eventType,title:recipientPresentation.title,body:recipientPresentation.body,metadata:payload.metadata&&typeof payload.metadata==='object'?payload.metadata as Prisma.InputJsonValue:undefined,actionUrl:isBusinessMember?(typeof payload.businessActionUrl==='string'&&/^\/app\/[a-z0-9\-/]+$/i.test(payload.businessActionUrl)?payload.businessActionUrl:recipientPresentation.actionUrl):(event.eventType==='QUOTATION_SENT'?presentation.actionUrl:undefined),priority:recipientPresentation.priority,expiresAt:new Date(Date.now()+365*86400000)},
        update:{},
      })
      if(channels.EMAIL===true&&businessEmailEnabled&&user.email&&process.env.BREVO_API_KEY&&process.env.BREVO_FROM_EMAIL){await tx.notificationDelivery.upsert({where:{notificationId_channel:{notificationId:notification.id,channel:'EMAIL'}},create:{notificationId:notification.id,recipient:user.email,channel:'EMAIL',provider:'brevo',status:'QUEUED'},update:{}})}
      if(channels.SMS===true&&notificationSettings.smsEnabled===true&&user.phone&&process.env.AT_API_KEY&&process.env.AT_USERNAME){await tx.notificationDelivery.upsert({where:{notificationId_channel:{notificationId:notification.id,channel:'SMS'}},create:{notificationId:notification.id,recipient:user.phone,channel:'SMS',provider:'africas-talking',status:'QUEUED'},update:{}})}
    }
    await tx.notificationEvent.update({where:{id:event.id},data:{status:'PROCESSED',processedAt:new Date(),lastError:null}})
  })
}

async function deliver(prisma:PrismaClient,id:string){
  const claimed=await prisma.notificationDelivery.updateMany({where:{id,status:'QUEUED',nextAttemptAt:{lte:new Date()}},data:{status:'PROCESSING',attemptCount:{increment:1},lastAttemptAt:new Date()}})
  if(!claimed.count)return
  const delivery=await prisma.notificationDelivery.findUnique({where:{id},include:{notification:true}})
  if(!delivery)return
  try{
    const preference=await prisma.notificationPreference.findUnique({where:{userId:delivery.notification.recipientUserId},select:{quietStart:true,quietEnd:true,timezone:true}})
    if(preference?.quietStart&&preference.quietEnd&&preference.quietStart!==preference.quietEnd){
      const localTime=new Intl.DateTimeFormat('en-GB',{timeZone:preference.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date())
      const quiet=preference.quietStart<preference.quietEnd?localTime>=preference.quietStart&&localTime<preference.quietEnd:localTime>=preference.quietStart||localTime<preference.quietEnd
      if(quiet){await prisma.notificationDelivery.update({where:{id},data:{status:'QUEUED',nextAttemptAt:new Date(Date.now()+5*60_000),failureReason:null}});return}
    }
    let providerReference:string|undefined
    if(delivery.channel==='EMAIL'){
      const apiKey=process.env.BREVO_API_KEY,from=process.env.BREVO_FROM_EMAIL
      if(!apiKey||!from)throw new Error('Email provider is not configured')
      const subject=delivery.notification.title,body=delivery.notification.body
      const actionHref=delivery.notification.actionUrl&&process.env.APP_BASE_URL?`${process.env.APP_BASE_URL.replace(/\/$/,'')}/#${delivery.notification.actionUrl}`:undefined
      const senderName=process.env.BREVO_SENDER_NAME||'FundiQuote'
      const response=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':apiKey,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({sender:{email:from,name:senderName},to:[{email:delivery.recipient}],subject,textContent:body,htmlContent:`<!doctype html><html><body style="font-family:Arial,sans-serif;color:#17312b"><main style="max-width:560px;margin:24px auto;padding:28px;border:1px solid #dce7e1;border-radius:12px"><strong style="color:#237e65">${escapeHtml(senderName)}</strong><h1 style="font-size:20px">${escapeHtml(subject)}</h1><p style="line-height:1.6">${escapeHtml(body)}</p>${actionHref?`<p><a href="${escapeHtml(actionHref)}" style="display:inline-block;background:#237e65;color:white;padding:12px 16px;border-radius:7px;text-decoration:none">Open FundiQuote</a></p>`:''}</main></body></html>`})})
      const result=await response.json().catch(()=>({})) as {messageId?:string;message?:string;code?:string}
      if(!response.ok)throw new Error(`Email provider returned ${response.status}: ${result.message??result.code??'request failed'}`)
      providerReference=result.messageId
    }else if(delivery.channel==='SMS'){
      const apiKey=process.env.AT_API_KEY,username=process.env.AT_USERNAME
      if(!apiKey||!username)throw new Error('SMS provider is not configured')
      const phone=delivery.recipient.replace(/[\s-]/g,'').replace(/^0/,'+254').replace(/^254/,'+254')
      if(!/^\+254[17]\d{8}$/.test(phone))throw new Error('SMS recipient phone number is invalid')
      const text=`${delivery.notification.title}: ${delivery.notification.body}`
      const params=new URLSearchParams({username,to:phone,message:text,...(process.env.AT_SENDER_ID?{from:process.env.AT_SENDER_ID}:{})})
      const response=await fetch('https://api.africastalking.com/version1/messaging',{method:'POST',headers:{apiKey,'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','Accept':'application/json'},body:params})
      const result=await response.json().catch(()=>({})) as {SMSMessageData?:{Recipients?:Array<{status?:string;messageId?:string;statusCode?:number}>}}
      const recipient=result.SMSMessageData?.Recipients?.[0]
      // Africa's Talking returns 100 (processing), 101 (sent), or 102 (queued)
      // when it has accepted the message. This is provider acceptance only;
      // handset delivery remains unconfirmed until a delivery report arrives.
      if(!response.ok||!recipient||![100,101,102].includes(recipient.statusCode??-1))throw new Error(`SMS provider rejected message: ${recipient?.status??`HTTP ${response.status}`}`)
      providerReference=recipient.messageId
    }else throw new Error(`Unsupported delivery channel ${delivery.channel}`)
    await prisma.notificationDelivery.update({where:{id},data:{status:'SENT',providerReference,sentAt:new Date(),failureReason:null}})
  }catch(error){
    const message=error instanceof Error?error.message:'Unknown delivery error'
    const attempts=delivery.attemptCount
    const permanent=attempts>=5||/not configured|invalid|Unsupported/.test(message)||/Email provider returned 4(?!08|09|29)\d{2}/.test(message)
    await prisma.notificationDelivery.update({where:{id},data:{status:permanent?'FAILED':'QUEUED',failureReason:message.slice(0,500),nextAttemptAt:new Date(Date.now()+Math.min(3600000,30_000*2**Math.max(0,attempts-1)))}})
    console.error('[notifications] delivery failed',{deliveryId:id,channel:delivery.channel,attempts,error:message})
  }
}

export async function processNotificationQueue(prisma:PrismaClient){
  const staleBefore=new Date(Date.now()-5*60_000)
  await prisma.notificationEvent.updateMany({where:{status:'PROCESSING',updatedAt:{lt:staleBefore}},data:{status:'PENDING',nextAttemptAt:new Date()}})
  await prisma.notificationDelivery.updateMany({where:{status:'PROCESSING',updatedAt:{lt:staleBefore}},data:{status:'QUEUED',nextAttemptAt:new Date()}})
  const events=await prisma.notificationEvent.findMany({where:{status:'PENDING',nextAttemptAt:{lte:new Date()}},orderBy:{createdAt:'asc'},take:20,select:{id:true}})
  for(const event of events){
    const claim=await prisma.notificationEvent.updateMany({where:{id:event.id,status:'PENDING'},data:{status:'PROCESSING',attemptCount:{increment:1}}})
    if(!claim.count)continue
    try{await processEvent(prisma,event.id)}catch(error){const attempts=(await prisma.notificationEvent.findUnique({where:{id:event.id},select:{attemptCount:true}}))?.attemptCount??1;await prisma.notificationEvent.update({where:{id:event.id},data:{status:attempts>=8?'FAILED':'PENDING',lastError:(error instanceof Error?error.message:'Unknown event error').slice(0,500),nextAttemptAt:new Date(Date.now()+Math.min(3600000,15_000*2**Math.max(0,attempts-1)))}});console.error('[notifications] event processing failed',{eventId:event.id,attempts})}
  }
  const deliveries=await prisma.notificationDelivery.findMany({where:{status:'QUEUED',nextAttemptAt:{lte:new Date()}},orderBy:{createdAt:'asc'},take:20,select:{id:true}})
  for(const delivery of deliveries)await deliver(prisma,delivery.id)
}

export async function cleanupExpiredNotifications(prisma:PrismaClient){
  const now=new Date()
  await prisma.notification.deleteMany({where:{expiresAt:{lt:now}}})
  await prisma.notificationEvent.deleteMany({where:{status:{in:['PROCESSED','FAILED']},createdAt:{lt:new Date(now.getTime()-90*86400000)},notifications:{none:{}}}})
}

const businessDate=(date:Date,timeZone:string)=>{let parts:Record<string,string>;try{parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(part=>[part.type,part.value]))}catch{parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(part=>[part.type,part.value]))}return `${parts.year}-${parts.month}-${parts.day}`}
const calendarDay=(value:string)=>Date.parse(`${value}T00:00:00.000Z`)
export async function runNotificationReminders(prisma:PrismaClient,now=new Date()){
  const businesses=await prisma.business.findMany({select:{id:true,settings:true}})
  for(const business of businesses){
    const settings=businessSettingsSchema.parse(business.settings??{}),timeZone=settings.financial.timeZone
    const today=businessDate(now,timeZone)
    const [invoices,quotations,jobs,subscriptions]=await prisma.$transaction([
      prisma.invoice.findMany({where:{businessId:business.id,status:{in:['ISSUED','PARTIALLY_PAID','OVERDUE']},dueDate:{lte:new Date(now.getTime()+4*86400000)}},select:{id:true,invoiceNumber:true,currency:true,grandTotal:true,amountPaid:true,dueDate:true,customer:{select:{name:true}}}}),
      prisma.quotation.findMany({where:{businessId:business.id,status:'ISSUED',expiryDate:{gte:now,lte:new Date(now.getTime()+4*86400000)}},select:{id:true,quotationNumber:true,expiryDate:true,customer:{select:{name:true}}}}),
      prisma.job.findMany({where:{businessId:business.id,status:'SCHEDULED',scheduledStart:{gte:now,lte:new Date(now.getTime()+26*3600000)}},select:{id:true,jobNumber:true,title:true,scheduledStart:true,assignedUserId:true,customer:{select:{name:true}}}}),
      prisma.subscription.findMany({where:{businessId:business.id,status:'ACTIVE',expiresAt:{lte:new Date(now.getTime()+4*86400000)}},select:{id:true,planCode:true,expiresAt:true}}),
    ])
    for(const invoice of invoices){
      if(!invoice.dueDate)continue
      const dueDate=businessDate(invoice.dueDate,timeZone),days=Math.floor((calendarDay(dueDate)-calendarDay(today))/86400000),outstanding=Number(invoice.grandTotal)-Number(invoice.amountPaid)
      if(outstanding<=0)continue
      if(days<0)await publishNotificationEvent(prisma,{businessId:business.id,idempotencyKey:`invoice-overdue:${invoice.id}:${dueDate}`,eventType:'INVOICE_OVERDUE',payload:{reference:invoice.invoiceNumber,name:invoice.customer.name,amount:outstanding,currency:invoice.currency,actionUrl:`/app/invoices/${invoice.id}`}})
      else if(days<=3)await publishNotificationEvent(prisma,{businessId:business.id,idempotencyKey:`invoice-due:${invoice.id}:${dueDate}`,eventType:'INVOICE_DUE_SOON',payload:{reference:invoice.invoiceNumber,name:invoice.customer.name,amount:outstanding,currency:invoice.currency,dueDate,actionUrl:`/app/invoices/${invoice.id}`}})
    }
    for(const quotation of quotations){if(!quotation.expiryDate)continue;const expiryDate=businessDate(quotation.expiryDate,timeZone),days=Math.floor((calendarDay(expiryDate)-calendarDay(today))/86400000);if(days>=0&&days<=3)await publishNotificationEvent(prisma,{businessId:business.id,idempotencyKey:`quotation-expiring:${quotation.id}:${expiryDate}`,eventType:'QUOTATION_EXPIRING',payload:{reference:quotation.quotationNumber,name:quotation.customer.name,expiryDate,actionUrl:`/app/quotations/${quotation.id}`}})}
    for(const job of jobs){if(!job.scheduledStart)continue;const scheduledDate=businessDate(job.scheduledStart,timeZone);await publishNotificationEvent(prisma,{businessId:business.id,idempotencyKey:`job-upcoming:${job.id}:${job.scheduledStart.toISOString()}`,eventType:'JOB_UPCOMING',payload:{reference:job.jobNumber,name:job.customer.name,recipientUserIds:job.assignedUserId?[job.assignedUserId]:[],actionUrl:`/app/jobs/${job.id}`}})}
    for(const subscription of subscriptions){if(!subscription.expiresAt)continue;const expiresAt=businessDate(subscription.expiresAt,timeZone),days=Math.floor((calendarDay(expiresAt)-calendarDay(today))/86400000),eventType=days<0?'SUBSCRIPTION_EXPIRED':'SUBSCRIPTION_RENEWAL_APPROACHING';await publishNotificationEvent(prisma,{businessId:business.id,idempotencyKey:`subscription-expiry:${subscription.id}:${subscription.expiresAt.toISOString()}`,eventType,payload:{plan:subscription.planCode,expiresAt,actionUrl:'/app/billing'}})}
  }
}
