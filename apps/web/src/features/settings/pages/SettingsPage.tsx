import { useEffect } from 'react'
import { useLocation,useBlocker } from 'react-router-dom'
import { useBusinessSettings } from '../hooks/useBusinessSettings'
import SettingsSidebar from '../components/SettingsSidebar'
import SettingsSaveBar from '../components/SettingsSaveBar'
import UnsavedChangesDialog from '../components/UnsavedChangesDialog'
import BusinessProfileSettings from './BusinessProfileSettings'
import BusinessBrandingSettings from './BusinessBrandingSettings'
import FinancialSettings from './FinancialSettings'
import DocumentSettings from './DocumentSettings'
import PaymentSettings from './PaymentSettings'
import NotificationSettings from './NotificationSettings'
import TeamSettings from './TeamSettings'
import SecurityPreferencesSettings from './SecurityPreferencesSettings'
import { useToast } from '../../../lib/hooks/useToast'
import './SettingsPage.css'

const titles:Record<string,string>={business:'Business profile',branding:'Branding',financial:'Financial & tax',documents:'Documents & numbering',payments:'Payments',notifications:'Notifications',team:'Team & subscription',security:'Security & preferences'}
export default function SettingsPage(){const location=useLocation(),section=location.pathname.split('/').filter(Boolean).at(-1)??'business';const{business,settings,team,capabilities,loading,saving,error,savedAt,dirty,updateBusiness,updateSettings,save,reset,reload}=useBusinessSettings();const{showToast}=useToast();const blocker=useBlocker(({currentLocation,nextLocation})=>dirty&&currentLocation.pathname.startsWith('/app/settings')&&!nextLocation.pathname.startsWith('/app/settings'))
  useEffect(()=>{const onBeforeUnload=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue=''}};window.addEventListener('beforeunload',onBeforeUnload);return()=>window.removeEventListener('beforeunload',onBeforeUnload)},[dirty])
  const saveSettings=async()=>{const ok=await save();if(ok)showToast('success','Business settings saved. New documents will use the updated defaults.');else if(error)showToast('error',error)}
  const page=()=>{if(!business||!settings)return null;switch(section){case'branding':return <BusinessBrandingSettings business={business} settings={settings} updateBusiness={updateBusiness} updateSettings={updateSettings} disabled={!capabilities.canEdit} logoUpload={capabilities.logoUpload}/>;case'financial':return <FinancialSettings business={business} settings={settings} updateBusiness={updateBusiness} updateSettings={updateSettings} disabled={!capabilities.canEdit}/>;case'documents':return <DocumentSettings settings={settings} update={(key,value)=>updateSettings('documents',key,value)} disabled={!capabilities.canEdit}/>;case'payments':return <PaymentSettings business={business} settings={settings} updateBusiness={updateBusiness} update={(key,value)=>updateSettings('payments',key,value)} disabled={!capabilities.canEdit} mpesaConfigured={capabilities.mpesaConfigured}/>;case'notifications':return <NotificationSettings settings={settings} update={value=>updateSettings('notifications','inApp',value)} updateChannel={(key,value)=>updateSettings('notifications',key,value)} disabled={!capabilities.canEdit} channels={capabilities.notificationChannels}/>;case'team':return <TeamSettings team={team} canEdit={capabilities.canEdit} onUpdate={()=>undefined}/>;case'security':return <SecurityPreferencesSettings/>;default:return <BusinessProfileSettings business={business} update={updateBusiness} disabled={!capabilities.canEdit}/>}}
  if(loading)return <main className="settings-page"><div className="settings-skeleton"><i/><i/><i/></div></main>
  if(error&&!business)return <main className="settings-page"><div className="settings-error" role="alert">{error}<button onClick={()=>void reload()}>Retry</button></div></main>
  return <main className="settings-page"><header className="settings-page__header"><div><p className="eyebrow green">BUSINESS CONFIGURATION</p><h1>Settings</h1><p>Manage business identity, documents, financial defaults, payments and account security.</p></div></header>{error&&<div className="settings-error" role="alert">{error}</div>}<div className="settings-layout"><SettingsSidebar/><section className="settings-content"><header className="settings-content__heading"><div><h2>{titles[section]??titles.business}</h2><p>Changes are scoped to this business and saved only after server confirmation.</p></div></header>{page()}</section></div>{section!=='security'&&section!=='team'&&<SettingsSaveBar dirty={dirty} saving={saving} savedAt={savedAt} canEdit={capabilities.canEdit} onSave={()=>void saveSettings()} onReset={reset}/>}<UnsavedChangesDialog open={blocker.state==='blocked'} onStay={()=>blocker.reset?.()} onLeave={()=>blocker.proceed?.()}/></main>
}
