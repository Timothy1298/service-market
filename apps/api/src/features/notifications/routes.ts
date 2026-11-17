import { Router, type Request } from 'express'
import { z } from 'zod'
import { Prisma, type PrismaClient } from '../../generated/prisma/client'

const listQuery=z.object({page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(20),state:z.enum(['ALL','UNREAD','READ','IMPORTANT']).default('ALL'),category:z.enum(['GENERAL','QUOTATIONS','JOBS','INVOICES','PAYMENTS','CUSTOMERS','INVENTORY','EXPENSES','SUBSCRIPTIONS','TEAM','SECURITY','SYSTEM']).optional(),search:z.string().trim().max(100).optional(),from:z.coerce.date().optional(),to:z.coerce.date().optional()})
const preferenceSchema=z.object({channels:z.object({IN_APP:z.literal(true),EMAIL:z.boolean(),SMS:z.boolean()}).strict(),categories:z.record(z.string().regex(/^[A-Z_]+$/),z.boolean()).default({}),quietStart:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),quietEnd:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),timezone:z.string().min(1).max(64).default('Africa/Nairobi')}).strict().refine(value=>Boolean(value.quietStart)===Boolean(value.quietEnd),{message:'Set both quiet hour times or leave both blank'}).refine(value=>{try{new Intl.DateTimeFormat('en-US',{timeZone:value.timezone}).format();return true}catch{return false}},{path:['timezone'],message:'Use a valid IANA timezone'})
type AuthRequest=Request&{user?:{id:string;role:string}}
const userId=(req:Request)=> (req as AuthRequest).user?.id!
const channelsStatus=()=>({inApp:{configured:true,enabled:true},email:{configured:Boolean(process.env.BREVO_API_KEY&&process.env.BREVO_FROM_EMAIL),enabled:Boolean(process.env.BREVO_API_KEY&&process.env.BREVO_FROM_EMAIL),provider:'Brevo'},sms:{configured:Boolean(process.env.AT_API_KEY&&process.env.AT_USERNAME),enabled:Boolean(process.env.AT_API_KEY&&process.env.AT_USERNAME),provider:"Africa's Talking"},whatsapp:{configured:false,enabled:false,provider:null}})
async function tenantScope(prisma:PrismaClient,id:string):Promise<Prisma.NotificationWhereInput>{const memberships=await prisma.businessMember.findMany({where:{userId:id,status:'ACTIVE'},select:{businessId:true}});return {OR:[{businessId:null},{businessId:{in:memberships.map(member=>member.businessId)}}]}}

export function createNotificationRouter(prisma:PrismaClient){
 const router=Router()
 router.get('/unread-count',async(req,res,next)=>{try{const id=userId(req),scope=await tenantScope(prisma,id);const unreadCount=await prisma.notification.count({where:{recipientUserId:id,readAt:null,archivedAt:null,AND:[scope,{OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}]}});res.json({unreadCount})}catch(error){next(error)}})
 router.get('/preferences',async(req,res,next)=>{try{const preference=await prisma.notificationPreference.findUnique({where:{userId:userId(req)}});res.json({preference:preference??{channels:{IN_APP:true,EMAIL:false,SMS:false},categories:{},quietStart:null,quietEnd:null,timezone:'Africa/Nairobi'},channels:channelsStatus()})}catch(error){next(error)}})
 router.put('/preferences',async(req,res,next)=>{try{const input=preferenceSchema.parse(req.body),available=channelsStatus();if(input.channels.EMAIL&&!available.email.configured)return res.status(409).json({error:'Email delivery is not configured'});if(input.channels.SMS&&!available.sms.configured)return res.status(409).json({error:'SMS delivery is not configured'});const preference=await prisma.notificationPreference.upsert({where:{userId:userId(req)},create:{userId:userId(req),...input},update:input});res.json({preference,channels:available})}catch(error){next(error)}})
 router.get('/delivery-diagnostics',async(req,res,next)=>{try{const id=userId(req);const membership=await prisma.businessMember.findFirst({where:{userId:id,status:'ACTIVE',role:{in:['OWNER','ADMIN']}},select:{businessId:true}});if(!membership)return res.status(403).json({error:'Business administrator access required'});const deliveries=await prisma.notificationDelivery.findMany({where:{notification:{businessId:membership.businessId}},orderBy:{updatedAt:'desc'},take:50,select:{id:true,channel:true,provider:true,status:true,attemptCount:true,lastAttemptAt:true,nextAttemptAt:true,sentAt:true,deliveredAt:true,failureReason:true,notification:{select:{title:true,eventType:true,createdAt:true}}}});res.json({deliveries})}catch(error){next(error)}})
 router.get('/',async(req,res,next)=>{try{
   const query=listQuery.parse(req.query),id=userId(req),scope=await tenantScope(prisma,id)
   const filters:Prisma.NotificationWhereInput[]=[scope,{OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}]
   if(query.state==='UNREAD')filters.push({readAt:null})
   if(query.state==='READ')filters.push({readAt:{not:null}})
   if(query.state==='IMPORTANT')filters.push({priority:{in:['IMPORTANT','URGENT']}})
   if(query.category)filters.push({category:query.category})
   if(query.from||query.to)filters.push({createdAt:{...(query.from?{gte:query.from}:{}),...(query.to?{lte:query.to}:{})}})
   if(query.search)filters.push({OR:[{title:{contains:query.search,mode:'insensitive'}},{body:{contains:query.search,mode:'insensitive'}}]})
   const where:Prisma.NotificationWhereInput={recipientUserId:id,archivedAt:null,AND:filters}
   const summaryWhere:Prisma.NotificationWhereInput={recipientUserId:id,archivedAt:null,AND:[scope,{OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}]}
   const [notifications,total,unread,important,recent]=await prisma.$transaction([
     prisma.notification.findMany({where,orderBy:[{createdAt:'desc'}],skip:(query.page-1)*query.pageSize,take:query.pageSize,select:{id:true,category:true,eventType:true,title:true,body:true,metadata:true,actionUrl:true,priority:true,readAt:true,createdAt:true}}),
     prisma.notification.count({where}),
     prisma.notification.count({where:{...summaryWhere,readAt:null}}),
     prisma.notification.count({where:{...summaryWhere,priority:{in:['IMPORTANT','URGENT']}}}),
     prisma.notification.count({where:{...summaryWhere,createdAt:{gte:new Date(Date.now()-7*86400000)}}}),
   ])
   res.json({notifications,page:query.page,pageSize:query.pageSize,total,pageCount:Math.ceil(total/query.pageSize),summary:{total:await prisma.notification.count({where:summaryWhere}),unread,important,recent}})
 }catch(error){next(error)}})
 router.post('/read-all',async(req,res,next)=>{try{const id=userId(req),scope=await tenantScope(prisma,id);const result=await prisma.notification.updateMany({where:{recipientUserId:id,readAt:null,archivedAt:null,AND:[scope]},data:{readAt:new Date()}});res.json({updated:result.count})}catch(error){next(error)}})
 router.patch('/:id',async(req,res,next)=>{try{const input=z.object({read:z.boolean().optional(),archive:z.boolean().optional()}).strict().refine(value=>value.read!==undefined||value.archive!==undefined).parse(req.body),id=userId(req),scope=await tenantScope(prisma,id);const update={...(input.read!==undefined?{readAt:input.read?new Date():null}:{}),...(input.archive!==undefined?{archivedAt:input.archive?new Date():null}:{})};const result=await prisma.notification.updateMany({where:{id:String(req.params.id),recipientUserId:id,AND:[scope]},data:update});if(!result.count)return res.status(404).json({error:'Notification not found'});const notification=await prisma.notification.findFirst({where:{id:String(req.params.id),recipientUserId:id,AND:[scope]},select:{id:true,readAt:true,archivedAt:true}});res.json({notification})}catch(error){next(error)}})
 router.delete('/:id',async(req,res,next)=>{try{const id=userId(req),scope=await tenantScope(prisma,id);const result=await prisma.notification.deleteMany({where:{id:String(req.params.id),recipientUserId:id,AND:[scope]}});if(!result.count)return res.status(404).json({error:'Notification not found'});res.status(204).end()}catch(error){next(error)}})
 return router
}
