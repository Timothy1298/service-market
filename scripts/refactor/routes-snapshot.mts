/**
 * API route safety net for the modularisation refactor.
 *
 *   node --import tsx scripts/refactor/routes-snapshot.mts baseline --expect 71
 *   node --import tsx scripts/refactor/routes-snapshot.mts check
 *
 * baseline  -> loads apps/api/src/server.ts, records every route + middleware layer to .refactor/routes.baseline.json
 * check     -> loads it again and FAILS if: a route is missing/added, a static route is shadowed by an earlier
 *              ":param" route (e.g. /customers/stats after /customers/:id), the paywall / origin check /
 *              request log / error handlers moved to a wrong place, or a nested router is used.
 * No database is needed (a dummy DATABASE_URL is injected; nothing connects).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

process.env.DATABASE_URL ??= 'postgresql://snapshot:snapshot@127.0.0.1:1/snapshot'
process.env.NODE_ENV ??= 'test'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const entry = path.join(root, 'apps/api/src/server.ts')
const snapFile = path.join(root, '.refactor/routes.baseline.json')
const mode = process.argv[2]
const expectIdx = process.argv.indexOf('--expect')
const expected = expectIdx > 0 ? Number(process.argv[expectIdx + 1]) : undefined
if (mode !== 'baseline' && mode !== 'check') { console.error('Usage: routes-snapshot.mts baseline|check [--expect N]'); process.exit(2) }

type Item = { kind: 'route'; id: string; method: string; path: string } | { kind: 'mw'; id: string }
const tagOf = (layer: any, src: string) => {
  if (layer.handle.length === 4) return 'ERROR_HANDLER'
  if (src.includes('paidFeaturePath')) return 'PAYWALL'
  if (src.includes('Request origin is not allowed')) return 'ORIGIN_CHECK'
  if (src.includes('startedAt')) return 'REQUEST_LOG'
  return `MW:${layer.name || 'anonymous'}`
}

const mod: any = await import(pathToFileURL(entry).href)
const app = mod.app
if (!app?.router?.stack) { console.error('server.ts must still export { app } (tests import it).'); process.exit(1) }
const items: Item[] = []
for (const layer of app.router.stack as any[]) {
  if (layer.route) {
    for (const [m, on] of Object.entries(layer.route.methods)) if (on) items.push({ kind: 'route', id: `${m.toUpperCase()} ${layer.route.path}`, method: m.toUpperCase(), path: String(layer.route.path) })
  } else if (layer.handle?.stack) {
    console.error('FAIL: a nested express.Router() is mounted. This refactor keeps absolute "/api/..." paths and uses registerXRoutes(app) functions.')
    process.exit(1)
  } else {
    items.push({ kind: 'mw', id: tagOf(layer, Function.prototype.toString.call(layer.handle)) })
  }
}
await mod.closeDatabase?.().catch(() => undefined)

const routes = items.filter(i => i.kind === 'route') as Extract<Item, { kind: 'route' }>[]
const toRegex = (p: string) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z0-9_]+/g, '[^/]+') + '/?$')
const shadows = (): string[] => {
  const out: string[] = []
  routes.forEach((later, j) => {
    for (let i = 0; i < j; i++) {
      const earlier = routes[i]
      if (earlier.method !== later.method || earlier.path === later.path || !earlier.path.includes(':')) continue
      const sample = later.path.replace(/:[A-Za-z0-9_]+/g, '__p__')
      if (toRegex(earlier.path).test(sample) && !later.path.includes(':')) out.push(`${later.id}  is shadowed by earlier  ${earlier.id}`)
    }
  })
  return out
}
const snapshot = { count: routes.length, routes: routes.map(r => r.id).sort(), mw: items.filter(i => i.kind === 'mw').map(i => i.id).sort(), shadows: shadows() }

if (mode === 'baseline') {
  if (expected !== undefined && routes.length !== expected) {
    console.error(`FAIL: expected ${expected} routes but server.ts registers ${routes.length}. Your server.ts is not the complete one - restore it before refactoring.`)
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(snapFile), { recursive: true })
  fs.writeFileSync(snapFile, JSON.stringify(snapshot, null, 2))
  console.log(`BASELINE saved: ${routes.length} routes, middleware layers: ${snapshot.mw.join(', ')}`)
  if (snapshot.shadows.length) console.log('Pre-existing shadowing (not caused by you):\n  ' + snapshot.shadows.join('\n  '))
  process.exit(0)
}

const base = JSON.parse(fs.readFileSync(snapFile, 'utf8')) as typeof snapshot
const problems: string[] = []
const setDiff = (a: string[], b: string[]) => a.filter(x => !b.includes(x))
setDiff(base.routes, snapshot.routes).forEach(r => problems.push(`MISSING ROUTE   ${r}`))
setDiff(snapshot.routes, base.routes).forEach(r => problems.push(`UNEXPECTED NEW ROUTE   ${r}`))
if (JSON.stringify(base.mw) !== JSON.stringify(snapshot.mw)) problems.push(`MIDDLEWARE CHANGED  baseline=[${base.mw.join(', ')}]  now=[${snapshot.mw.join(', ')}]`)
snapshot.shadows.filter(s => !base.shadows.includes(s)).forEach(s => problems.push(`SHADOWED ROUTE   ${s}`))

const idx = (pred: (i: Item) => boolean) => items.findIndex(pred)
const firstRoute = idx(i => i.kind === 'route')
const lastOf = (tag: string) => items.map(i => i.id).lastIndexOf(tag)
for (const tag of ['ORIGIN_CHECK', 'REQUEST_LOG']) { const at = idx(i => i.id === tag); if (at === -1 || at > firstRoute) problems.push(`${tag} must be registered before every route`) }
const paywall = idx(i => i.id === 'PAYWALL')
const firstPaid = idx(i => i.kind === 'route' && /^\/api\/(quotations|invoices)(\/|$)/.test((i as any).path) && !(i as any).path.startsWith('/api/quotations/share/'))
if (paywall === -1) problems.push('PAYWALL middleware is missing (402 for unpaid quotations/invoices)')
else if (firstPaid !== -1 && paywall > firstPaid) problems.push('PAYWALL must be registered BEFORE the first /api/quotations* and /api/invoices* route')
const handlers = items.map((i, n) => (i.id === 'ERROR_HANDLER' ? n : -1)).filter(n => n >= 0)
if (handlers.length !== 2) problems.push(`expected exactly 2 error handlers, found ${handlers.length}`)
else {
  if (handlers[1] !== items.length - 1) problems.push('the FINAL error handler must be the very last registration')
  const early = handlers[0]
  const at = (id: string) => idx(i => i.id === id)
  if (!(at('PATCH /api/business-profile') < early && early < at('GET /api/marketplace/categories'))) problems.push('the EARLY error handler must sit after PATCH /api/business-profile and before GET /api/marketplace/categories (original position)')
}
if (problems.length) { console.error(`ROUTE CHECK FAILED (${problems.length})\n  - ` + problems.join('\n  - ')); process.exit(1) }
console.log(`ROUTE CHECK OK - ${routes.length} routes identical to baseline, no shadowing, paywall/origin/log/error-handler order preserved.`)
