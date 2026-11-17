import {useCallback,useEffect,useState} from 'react'
import {Bell,CheckCheck,Clock3,Settings2,TriangleAlert} from 'lucide-react'
import {Link} from 'react-router-dom'
import NotificationItem from '../components/NotificationItem'
import NotificationEmptyState from '../components/NotificationEmptyState'
import NotificationDeleteDialog from '../components/NotificationDeleteDialog'
import {notificationsApi} from '../services/notificationsApi'
import type {NotificationItem as Item,NotificationPageData} from '../types/notifications'
import {useToast} from '../../../lib/hooks/useToast'
import './NotificationsPage.css'
const categories=['GENERAL','QUOTATIONS','JOBS','INVOICES','PAYMENTS','CUSTOMERS','INVENTORY','EXPENSES','SUBSCRIPTIONS','TEAM','SECURITY','SYSTEM']
export default function NotificationsPage(){const[data,setData]=useState<NotificationPageData|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[page,setPage]=useState(1),[state,setState]=useState<'ALL'|'UNREAD'|'READ'|'IMPORTANT'>('ALL'),[category,setCategory]=useState(''),[search,setSearch]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[pendingDelete,setPendingDelete]=useState<Item|null>(null),[deleting,setDeleting]=useState(false);const{showToast}=useToast()
 const load=useCallback(async()=>{setLoading(true);setError('');try{setData(await notificationsApi.list({page,pageSize:20,state,category:category||undefined,search:search||undefined,from:from||undefined,to:to||undefined}))}catch(e){setError(e instanceof Error?e.message:'Could not load notifications')}finally{setLoading(false)}},[page,state,category,search,from,to])
 useEffect(()=>{const timer=window.setTimeout(()=>void load(),search?250:0);return()=>window.clearTimeout(timer)},[load,search])
 const changeRead=async(item:Item)=>{try{await notificationsApi.mark(item.id,!item.readAt);showToast('success',item.readAt?'Marked as unread':'Marked as read');await load()}catch(e){showToast('error',e instanceof Error?e.message:'Could not update notification')}}
 const archive=async(item:Item)=>{try{await notificationsApi.archive(item.id);showToast('success','Notification archived');await load()}catch(e){showToast('error',e instanceof Error?e.message:'Could not archive notification')}}
 const remove=async()=>{if(!pendingDelete)return;setDeleting(true);try{await notificationsApi.remove(pendingDelete.id);showToast('success','Notification deleted');setPendingDelete(null);await load()}catch(e){showToast('error',e instanceof Error?e.message:'Could not delete notification')}finally{setDeleting(false)}}
 const open=async(item:Item)=>{if(!item.actionUrl)return;if(!item.readAt){try{await notificationsApi.mark(item.id,true)}catch{showToast('error','Could not mark notification as read')}}window.location.hash=item.actionUrl}
 const readAll=async()=>{try{const result=await notificationsApi.readAll();showToast('success',`${result.updated} notification(s) marked as read`);await load()}catch(e){showToast('error',e instanceof Error?e.message:'Could not mark notifications as read')}}
 const tabs:[string,typeof state][]=[['All','ALL'],['Unread','UNREAD'],['Read','READ'],['Important','IMPORTANT']]
 return <main className="notifications-page"><header className="notifications-page__header"><div><p className="eyebrow green">ACTIVITY CENTER</p><h1>Notifications</h1><p>Important updates and activity from your FundiQuote workspace.</p></div><div className="notifications-page__header-actions"><Link to="/app/notifications/preferences"><Settings2 size={16}/>Preferences</Link><button onClick={()=>void readAll()} disabled={!data?.summary.unread}><CheckCheck size={16}/>Mark all read</button></div></header>
 {error&&<div className="notifications-page__error" role="alert">{error}<button onClick={()=>void load()}>Retry</button></div>}
 <section className="notifications-page__stats" aria-label="Notification summary">{[{label:'Total notifications',value:data?.summary.total??'—',Icon:Bell},{label:'Unread',value:data?.summary.unread??'—',Icon:Bell},{label:'Important',value:data?.summary.important??'—',Icon:TriangleAlert},{label:'Last 7 days',value:data?.summary.recent??'—',Icon:Clock3}].map(({label,value,Icon})=><article key={label}><span><Icon size={17}/></span><small>{label}</small><strong>{loading?'—':value}</strong></article>)}</section>
 <section className="notifications-page__workspace"><header className="notifications-page__toolbar"><div><h2>Activity</h2><p>{loading?'Loading…':`${data?.total??0} result${data?.total===1?'':'s'}`}</p></div><div className="notifications-page__filters"><label className="notifications-page__search"><span className="sr-only">Search notifications</span><input placeholder="Search notifications…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}}/></label><label><span className="sr-only">Filter by category</span><select value={category} onChange={e=>{setCategory(e.target.value);setPage(1)}}><option value="">All categories</option>{categories.map(item=><option key={item} value={item}>{item.replaceAll('_',' ').toLowerCase()}</option>)}</select></label><label><span className="sr-only">From date</span><input aria-label="From date" type="date" value={from} onChange={e=>{setFrom(e.target.value);setPage(1)}}/></label><label><span className="sr-only">To date</span><input aria-label="To date" type="date" value={to} onChange={e=>{setTo(e.target.value);setPage(1)}}/></label></div></header>
 <nav className="notifications-page__tabs" aria-label="Notification status">{tabs.map(([label,value])=><button key={value} className={state===value?'active':''} onClick={()=>{setState(value);setPage(1)}}>{label}{value==='UNREAD'&&data?.summary.unread?` (${data.summary.unread})`:''}</button>)}</nav>
 {loading ? (
  <div className="notifications-page__skeleton">{[1,2,3,4].map(value=><i key={value}/>)}</div>
 ) : data?.notifications.length ? (
  <>
   <div className="notifications-page__list">{data.notifications.map(item=><NotificationItem key={item.id} item={item} onRead={changeRead} onArchive={archive} onOpen={open} onDelete={setPendingDelete}/>)}</div>
   <footer className="notifications-page__pagination"><span>Page {data.page} of {Math.max(1,data.pageCount)} · {data.total} notifications</span><div><button disabled={data.page<=1} onClick={()=>setPage(value=>value-1)}>Previous</button><button disabled={data.page>=data.pageCount} onClick={()=>setPage(value=>value+1)}>Next</button></div></footer>
  </>
 ) : (
  <NotificationEmptyState filtered={Boolean(category||search||from||to||state!=='ALL')}/>
 )}
 </section>
 {pendingDelete&&<NotificationDeleteDialog item={pendingDelete} onCancel={()=>setPendingDelete(null)} onConfirm={()=>void remove()} busy={deleting}/>}
 </main>
}
