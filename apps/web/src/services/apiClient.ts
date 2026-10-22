export const API = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api'

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const normalizedPath = path.startsWith('/api/') ? path.slice(4) : path
  const response = await fetch(`${API}${normalizedPath}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  })
  const body = response.status === 204 ? null : await response.json()
  if (!response.ok) {
    const error = new Error(body?.error ?? 'Something went wrong') as Error & { fields?: Record<string, string[]> }
    error.fields = body?.fields
    throw error
  }
  return body as T
}

export const errorMessage = (error: unknown) => {
  if (!(error instanceof Error)) return 'Something went wrong'
  const fields = (error as Error & { fields?: Record<string, string[]> }).fields
  const details = fields ? Object.values(fields).flat().join(' ') : ''
  return details ? `${error.message}. ${details}` : error.message
}
