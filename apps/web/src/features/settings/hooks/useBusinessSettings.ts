import { useCallback, useEffect, useState } from 'react'
import { settingsApi } from '../services/settingsApi'
import type { BusinessProfile, BusinessSettings, BusinessSettingsResponse, TeamMember } from '../types/settings'

export function useBusinessSettings(){
  const [business,setBusiness]=useState<BusinessProfile|null>(null),[settings,setSettings]=useState<BusinessSettings|null>(null),[team,setTeam]=useState<TeamMember[]>([]),[capabilities,setCapabilities]=useState<BusinessSettingsResponse['capabilities']>({canEdit:false,mpesaConfigured:false,notificationChannels:['in-app'],logoUpload:false})
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[savedAt,setSavedAt]=useState<Date|null>(null),[baseline,setBaseline]=useState('')
  const load=useCallback(async()=>{setLoading(true);setError('');try{const result=await settingsApi.business();const profile={...result.business,tradingName:result.business.tradingName??'',description:result.business.description??'',businessType:result.business.businessType??'',alternativePhone:result.business.alternativePhone??'',website:result.business.website??'',address:result.business.address??'',town:result.business.town??'',county:result.business.county??'',country:result.business.country??'Kenya',postalAddress:result.business.postalAddress??'',postalCode:result.business.postalCode??'',registrationNumber:result.business.registrationNumber??'',kraPin:result.business.kraPin??'',slogan:result.business.slogan??'',paymentInstructions:result.business.paymentInstructions??'',mpesaNumber:result.business.mpesaNumber??''};setBusiness(profile);setSettings(result.settings);setTeam(result.team);setCapabilities(result.capabilities);setBaseline(JSON.stringify({business:profile,settings:result.settings}))}catch(cause){setError(cause instanceof Error?cause.message:'Could not load business settings')}finally{setLoading(false)}},[])
  useEffect(()=>{void load()},[load])
  const dirty=Boolean(business&&settings&&JSON.stringify({business,settings})!==baseline)
  const updateBusiness=(key:keyof BusinessProfile,value:string)=>setBusiness(current=>current?({...current,[key]:value}):current)
  const updateSettings=<G extends keyof BusinessSettings,K extends keyof BusinessSettings[G]>(group:G,key:K,value:BusinessSettings[G][K])=>setSettings(current=>current?({...current,[group]:{...current[group],[key]:value}}):current)
  const save=async()=>{if(!business||!settings)return false;setSaving(true);setError('');try{const result=await settingsApi.saveBusiness(business,settings);const nextBusiness={...business,...result.business,settings};setBusiness(nextBusiness);setBaseline(JSON.stringify({business:nextBusiness,settings}));setSavedAt(new Date());return true}catch(cause){setError(cause instanceof Error?cause.message:'Could not save business settings');return false}finally{setSaving(false)}}
  const reset=()=>{void load()}
  return {business,settings,team,capabilities,loading,saving,error,savedAt,dirty,updateBusiness,updateSettings,save,reset,reload:load,setError}
}
