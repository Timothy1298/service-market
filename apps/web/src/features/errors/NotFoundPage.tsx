export default function NotFoundPage() {
  return <main className="not-found-page">
    <div className="not-found-icon" aria-hidden="true">?</div>
    <h1>Page not found</h1>
    <p>This page may have moved, or the address may be incorrect.</p>
    <div>
      <a href="#/app/dashboard">Go to dashboard</a>
      <button type="button" onClick={() => window.history.back()}>Go back</button>
    </div>
  </main>
}
