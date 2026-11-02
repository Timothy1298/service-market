import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './primitives'

function useDialog(onClose: () => void, open: boolean) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const priorOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector<HTMLElement>('button, input, select, textarea, a[href]')?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'Tab' && ref.current) {
        const focusable = [...ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')]
        if (!focusable.length) return
        const first = focusable[0]
        const last = focusable.at(-1)!
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown); document.body.style.overflow = priorOverflow; previous?.focus() }
  }, [open, onClose])
  return ref
}

export function Drawer({ open, onClose, title, children, footer, labelledBy = 'ui-drawer-title' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; labelledBy?: string }) {
  const ref = useDialog(onClose, open)
  if (!open) return null
  return <div className="ui-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><section ref={ref} className="ui-drawer" role="dialog" aria-modal="true" aria-labelledby={labelledBy}><header><h2 id={labelledBy}>{title}</h2><button type="button" aria-label="Close" onClick={onClose}><X size={19} /></button></header><div className="ui-drawer__body">{children}</div>{footer && <footer>{footer}</footer>}</section></div>
}

export function ConfirmDialog({ open, title, description, confirmLabel = 'Confirm', destructive = false, busy = false, onConfirm, onCancel }: { open: boolean; title: string; description: string; confirmLabel?: string; destructive?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ref = useDialog(onCancel, open)
  if (!open) return null
  return <div className="ui-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onCancel() }}><section ref={ref} className="ui-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ui-confirm-title" aria-describedby="ui-confirm-description"><button type="button" className="ui-confirm-dialog__close" aria-label="Close" onClick={onCancel}><X size={18} /></button><h2 id="ui-confirm-title">{title}</h2><p id="ui-confirm-description">{description}</p><footer><Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button><Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>{confirmLabel}</Button></footer></section></div>
}
