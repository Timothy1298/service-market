import { useEffect, useState, type FormEvent } from 'react'
import { AtSign, BadgeCheck, Phone, Save, ShieldCheck, UserRound } from 'lucide-react'
import { apiRequest, errorMessage } from '../../../services/apiClient'
import { useToast } from '../../../lib/hooks/useToast'
import './MyProfilePage.css'

type ProfileUser = {id:string;fullName:string;phone:string;email?:string|null;role:'PROVIDER'|'CUSTOMER'|'ADMIN';createdAt?:string}

export default function MyProfilePage({user,onUpdate}:{user:ProfileUser;onUpdate:(user:ProfileUser)=>void}) {
  const [form,setForm]=useState({fullName:user.fullName,phone:user.phone,email:user.email??''})
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false)
  const {showToast}=useToast()
  useEffect(()=>{let active=true;apiRequest<{user:ProfileUser}>('/profile').then(result=>{if(!active)return;onUpdate(result.user);setForm({fullName:result.user.fullName,phone:result.user.phone,email:result.user.email??''})}).catch(error=>showToast('error',errorMessage(error))).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[])
  const submit=async(event:FormEvent)=>{event.preventDefault();setSaving(true);try{const result=await apiRequest<{user:ProfileUser}>('/profile',{method:'PATCH',body:JSON.stringify(form)});onUpdate(result.user);setForm({fullName:result.user.fullName,phone:result.user.phone,email:result.user.email??''});showToast('success','Your profile was saved.')}catch(error){showToast('error',errorMessage(error))}finally{setSaving(false)}}
  return <main className="my-profile">
    <header className="my-profile__header"><div><p className="eyebrow green">ACCOUNT</p><h1>My profile</h1><p>Manage your personal contact details and account identity.</p></div></header>
    <section className="my-profile__overview"><div className="my-profile__avatar">{form.fullName.trim().charAt(0).toUpperCase()||'U'}</div><div className="my-profile__identity"><h2>{form.fullName||'Your account'}</h2><p>{form.email||form.phone}</p></div><span className="my-profile__role"><BadgeCheck size={16}/>{user.role==='PROVIDER'?'Service provider':user.role==='ADMIN'?'Administrator':'Customer'}</span></section>
    <div className="my-profile__columns"><section className="my-profile__panel"><div className="my-profile__panel-heading"><span><UserRound size={18}/></span><div><h2>Personal information</h2><p>These details identify you across your FundiQuote account.</p></div></div>
      <form onSubmit={submit}><label><span>Full name</span><div className="my-profile__input"><UserRound size={17}/><input autoComplete="name" required minLength={2} maxLength={100} value={form.fullName} onChange={e=>setForm({...form,fullName:e.target.value})}/></div></label><label><span>Phone number</span><div className="my-profile__input"><Phone size={17}/><input autoComplete="tel" type="tel" required value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></div></label><label><span>Email address</span><div className="my-profile__input"><AtSign size={17}/><input autoComplete="email" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></div></label><div className="my-profile__actions"><button type="submit" disabled={loading||saving}><Save size={16}/>{saving?'Saving…':'Save profile'}</button><span>{loading?'Loading your saved details…':'Updates are saved to your personal account.'}</span></div></form>
    </section><aside className="my-profile__panel my-profile__security"><span className="my-profile__security-icon"><ShieldCheck size={20}/></span><h2>Account security</h2><p>Password changes, active sessions and your personal preferences are available in the Security & preferences section.</p><a href="#/app/settings/security">Open security settings <span aria-hidden="true">→</span></a><div className="my-profile__divider"/><small>Your business profile, branding and shared business settings live in Business settings.</small><a href="#/app/settings/business">Open business settings <span aria-hidden="true">→</span></a></aside></div>
  </main>
}
