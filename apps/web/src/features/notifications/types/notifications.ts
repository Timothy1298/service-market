export type NotificationCategory='GENERAL'|'QUOTATIONS'|'JOBS'|'INVOICES'|'PAYMENTS'|'CUSTOMERS'|'INVENTORY'|'EXPENSES'|'SUBSCRIPTIONS'|'TEAM'|'SECURITY'|'SYSTEM'
export type NotificationPriority='NORMAL'|'IMPORTANT'|'URGENT'
export type NotificationItem={id:string;category:NotificationCategory;eventType:string;title:string;body:string;metadata:Record<string,unknown>|null;actionUrl:string|null;priority:NotificationPriority;readAt:string|null;createdAt:string}
export type NotificationPageData={notifications:NotificationItem[];page:number;pageSize:number;total:number;pageCount:number;summary:{total:number;unread:number;important:number;recent:number}}
export type NotificationPreference={channels:{IN_APP:true;EMAIL:boolean;SMS:boolean};categories:Record<string,boolean>;quietStart:string|null;quietEnd:string|null;timezone:string}
export type NotificationChannelStatus={inApp:{configured:boolean;enabled:boolean};email:{configured:boolean;enabled:boolean;provider:string};sms:{configured:boolean;enabled:boolean;provider:string};whatsapp:{configured:boolean;enabled:boolean;provider:string|null}}
