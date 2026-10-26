import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import './index.css'
import ErrorBoundary from './features/errors/ErrorBoundary'
import { ToastProvider } from './lib/hooks/useToast'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Skip to main content</a>
    <ErrorBoundary>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
)
