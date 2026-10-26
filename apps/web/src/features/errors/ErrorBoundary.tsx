import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { hasError: boolean }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) return <main className="not-found-page">
      <h1>Something went wrong</h1>
      <p>Reload the page to try again.</p>
      <button type="button" onClick={() => window.location.reload()}>Reload</button>
    </main>
    return this.props.children
  }
}
