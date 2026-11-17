import { apiRequest } from '../../../services/apiClient'
import type { BusinessProfile, BusinessSettings, BusinessSettingsResponse, UserPreferences } from '../types/settings'

export const settingsApi = {
  business: () => apiRequest<BusinessSettingsResponse>('/settings/business'),
  saveBusiness: (business:BusinessProfile, settings:BusinessSettings) => apiRequest<{business:BusinessProfile}>('/settings/business',{method:'PATCH',body:JSON.stringify({name:business.name,tradingName:business.tradingName??'',description:business.description??'',businessType:business.businessType??'',tradeCategory:business.tradeCategory,email:business.email??'',phone:business.phone,alternativePhone:business.alternativePhone??'',website:business.website??'',address:business.address??'',town:business.town??'',county:business.county??'',country:business.country??'Kenya',postalAddress:business.postalAddress??'',postalCode:business.postalCode??'',registrationNumber:business.registrationNumber??'',kraPin:business.kraPin??'',slogan:business.slogan??'',paymentInstructions:business.paymentInstructions??'',mpesaNumber:business.mpesaNumber??'',currency:business.currency,settings})}),
  preferences: () => apiRequest<{preferences:UserPreferences}>('/settings/preferences'),
  savePreferences: (preferences:UserPreferences) => apiRequest<{preferences:UserPreferences}>('/settings/preferences',{method:'PATCH',body:JSON.stringify(preferences)}),
  sessions: () => apiRequest<{sessions:Array<{createdAt:string;expiresAt:string;current:boolean}>}>('/settings/security/sessions'),
  revokeSessions: () => apiRequest<{revoked:number}>('/settings/security/sessions',{method:'DELETE'}),
  changePassword: (currentPassword:string,newPassword:string) => apiRequest<{changed:boolean}>('/settings/security/password',{method:'POST',body:JSON.stringify({currentPassword,newPassword})}),
  updateMember: (id:string,update:{role?:'OWNER'|'ADMIN'|'MEMBER';status?:'ACTIVE'|'SUSPENDED'}) => apiRequest<{member:import('../types/settings').TeamMember}>(`/settings/team/${id}`,{method:'PATCH',body:JSON.stringify(update)}),
}
