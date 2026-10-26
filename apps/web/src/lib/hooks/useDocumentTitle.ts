import { useEffect } from 'react'

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · FundiQuote` : 'FundiQuote'
    return () => { document.title = 'FundiQuote' }
  }, [title])
}
