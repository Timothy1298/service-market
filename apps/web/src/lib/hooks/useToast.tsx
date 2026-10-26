import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type ToastKind = 'success' | 'error' | 'info'
type ToastMessage = { id: number; kind: ToastKind; message: string }
type ToastContextValue = { showToast: (kind: ToastKind, message: string) => void }

const ToastContext = createContext<ToastContextValue | null>(null)
let nextToastId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const dismiss = useCallback((id: number) => setToasts(current => current.filter(toast => toast.id !== id)), [])
  const showToast = useCallback((kind: ToastKind, message: string) => {
    const id = ++nextToastId
    setToasts(current => [...current, { id, kind, message }])
    window.setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 4000)
  }, [dismiss])
  const value = useMemo(() => ({ showToast }), [showToast])
  return <ToastContext.Provider value={value}>
    {children}
    <div className="toast-region" aria-live="polite" aria-relevant="additions">
      {toasts.map(toast => <div className={`toast toast-${toast.kind}`} role="status" key={toast.id}>
        <span>{toast.message}</span>
        <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}>×</button>
      </div>)}
    </div>
  </ToastContext.Provider>
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
