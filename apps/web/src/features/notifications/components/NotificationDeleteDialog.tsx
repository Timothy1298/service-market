import {useEffect,useRef} from 'react'
import {AlertTriangle} from 'lucide-react'
import type {NotificationItem} from '../types/notifications'

export default function NotificationDeleteDialog({item,onCancel,onConfirm,busy=false}:{item:NotificationItem;onCancel:()=>void;onConfirm:()=>void;busy?:boolean}){
 const cancelRef=useRef<HTMLButtonElement>(null)
 useEffect(()=>{
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null
  cancelRef.current?.focus()
  const keydown=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();onCancel();return}
   if(event.key==='Tab'){
    const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('[data-notification-delete-dialog] button:not(:disabled)'))
    if(!buttons.length)return
    const first=buttons[0],last=buttons[buttons.length-1]
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
   }
  }
  document.addEventListener('keydown',keydown)
  return()=>{document.removeEventListener('keydown',keydown);previous?.focus()}
 },[onCancel])
 return <div className="notification-delete-backdrop"><section className="notification-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="notification-delete-title" aria-describedby="notification-delete-description" data-notification-delete-dialog><span><AlertTriangle size={20}/></span><h2 id="notification-delete-title">Delete notification?</h2><p id="notification-delete-description">“{item.title}” will be permanently removed from your notification history.</p><div><button ref={cancelRef} type="button" onClick={onCancel} disabled={busy}>Cancel</button><button type="button" className="is-danger" onClick={onConfirm} disabled={busy}>{busy?'Deleting…':'Delete notification'}</button></div></section></div>
}
