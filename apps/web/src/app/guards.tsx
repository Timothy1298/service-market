import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { UserRole } from '../lib/types'

export function RequireAuth({ user, children }: { user: { role: UserRole } | null; children: ReactNode }) {
  return user ? children : <Navigate to="/login" replace />
}

export function RequireRole({ user, role, children }: { user: { role: UserRole } | null; role: UserRole; children: ReactNode }) {
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role) return <Navigate to="/app/dashboard" replace />
  return children
}
