export const API = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api'

const parseBody = async <T>(response: Response): Promise<T | null> => {
  if (response.status === 204) return null
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) return (await response.json()) as T

  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text) as T
  } catch {
    return { error: text } as T
  }
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const normalizedPath = path.startsWith('/api/') ? path.slice(4) : path
  const response = await fetch(`${API}${normalizedPath}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  })
  const body = await parseBody<T>(response)
  if (!response.ok) {
    const error = new Error(
      (body as { error?: string } | null)?.error ?? 'Something went wrong',
    ) as Error & { fields?: Record<string, string[]> }
    error.fields = (body as { fields?: Record<string, string[]> } | null)?.fields
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
