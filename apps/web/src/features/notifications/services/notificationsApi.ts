import {apiRequest} from '../../../services/apiClient'
import type {NotificationChannelStatus,NotificationItem,NotificationPageData,NotificationPreference} from '../types/notifications'
export type NotificationQuery={page?:number;pageSize?:number;state?:'ALL'|'UNREAD'|'READ'|'IMPORTANT';category?:string;search?:string;from?:string;to?:string}
const queryString=(query:NotificationQuery)=>{const params=new URLSearchParams();for(const[key,value]of Object.entries(query))if(value!==undefined&&value!=='')params.set(key,String(value));return params.toString()}
export const notificationsApi={
 list:(query:NotificationQuery={})=>apiRequest<NotificationPageData>(`/notifications?${queryString(query)}`),
 unreadCount:()=>apiRequest<{unreadCount:number}>('/notifications/unread-count'),
 mark:(id:string,read:boolean)=>apiRequest<{notification:Pick<NotificationItem,'id'|'readAt'>}>(`/notifications/${id}`,{method:'PATCH',body:JSON.stringify({read})}),
 archive:(id:string)=>apiRequest<{notification:{id:string;archivedAt:string|null}}>(`/notifications/${id}`,{method:'PATCH',body:JSON.stringify({archive:true})}),
 remove:(id:string)=>apiRequest<void>(`/notifications/${id}`,{method:'DELETE'}),
 readAll:()=>apiRequest<{updated:number}>('/notifications/read-all',{method:'POST'}),
 preferences:()=>apiRequest<{preference:NotificationPreference;channels:NotificationChannelStatus}>('/notifications/preferences'),
 savePreferences:(preference:NotificationPreference)=>apiRequest<{preference:NotificationPreference;channels:NotificationChannelStatus}>('/notifications/preferences',{method:'PUT',body:JSON.stringify(preference)}),
}
