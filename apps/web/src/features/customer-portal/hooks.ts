import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from '../../services/apiClient'
export function usePortalData<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  const refresh = useCallback(async () => { setLoading(true); setError(''); try { setData(await load()) } catch (cause) { setError(errorMessage(cause)) } finally { setLoading(false) } }, deps)
  useEffect(() => { void refresh() }, [refresh]); return { data, loading, error, refresh, setData }
}
