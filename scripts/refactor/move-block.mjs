#!/usr/bin/env node
/**
 * Verbatim block mover. The ONLY way code is allowed to leave a big file during the refactor.
 *
 *   node scripts/refactor/move-block.mjs --from apps/api/src/server.ts --to apps/api/src/modules/customers/customers.routes.ts \
 *        --range "L926-L1000" --range "app.get(\"/api/customers/stats\"=>L1040" \
 *        --open "export function registerCustomersRoutes(app: Express) {" --close "}"
 *
 * --range "A-B"   A and B are either  L<number>  (1-based line of the file AS IT IS NOW)  or the exact text a line
 *                 starts with (after trimming). Write it as  "<startAnchor>=><endAnchor>"  or  "L12-L40".
 *                 All ranges are resolved against the file as it is before this call, so line numbers never drift
 *                 inside one call. Re-run `grep -n` between calls (line numbers change after every move).
 * --open/--close  optional wrapper lines written around the moved code (used for registerXRoutes(app) functions).
 * --append        allow adding to an existing destination (otherwise the destination must not exist).
 * --dry-run       print what would happen, change nothing.
 * Safety: refuses if --from has uncommitted changes (stale editor buffers!), never retypes code, writes a
 * "// IMPORTS-TODO" first line in new files, and prints the moved line count.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const get = (n) => { const out = []; argv.forEach((a, i) => { if (a === `--${n}`) out.push(argv[i + 1]) }); return out }
const flag = (n) => argv.includes(`--${n}`)
const [from] = get('from'); const [to] = get('to'); const ranges = get('range')
const [open] = get('open'); const [close] = get('close')
const die = (m) => { console.error('move-block: ' + m); process.exit(1) }
if (!from || !to || !ranges.length) die('need --from, --to and at least one --range')

try {
  const dirty = execFileSync('git', ['status', '--porcelain', '--', from], { encoding: 'utf8' }).trim()
  if (dirty && !flag('dry-run')) die(`${from} has uncommitted changes (${dirty}). Commit or discard them first - this guards against stale editor buffers.`)
} catch { die('not inside a git repository') }

const src = fs.readFileSync(from, 'utf8')
const nl = src.includes('\r\n') ? '\r\n' : '\n'
const lines = src.split(/\r?\n/)
const find = (text, after = 0) => {
  const hits = []
  lines.forEach((l, i) => { if (i >= after && l.trim().startsWith(text.trim())) hits.push(i) })
  if (hits.length === 0) die(`anchor not found: ${text}`)
  if (hits.length > 1 && after === 0) die(`anchor is ambiguous (${hits.length} lines start with it, first at L${hits[0] + 1}): ${text} - use L<number>`)
  return hits[0]
}
const parse = (spec) => {
  const sep = spec.includes('=>') ? '=>' : spec.match(/^L\d+-L\d+$/) ? '-' : null
  if (!sep) die(`bad range: ${spec}`)
  const [a, b] = spec.split(sep)
  const start = /^L\d+$/.test(a) ? Number(a.slice(1)) - 1 : find(a)
  const end = /^L\d+$/.test(b) ? Number(b.slice(1)) - 1 : find(b, start)
  if (start < 0 || end < start || end >= lines.length) die(`range out of bounds: ${spec}`)
  return [start, end]
}
const parsed = ranges.map(parse)
const sorted = [...parsed].sort((x, y) => x[0] - y[0])
for (let i = 1; i < sorted.length; i++) if (sorted[i][0] <= sorted[i - 1][1]) die('ranges overlap')

// Ranges are written to the destination in the order given (so you control route order).
const moved = parsed.flatMap(([s, e]) => lines.slice(s, e + 1))
const dest = [...(fs.existsSync(to) && flag('append') ? [] : ['// IMPORTS-TODO']), ...(open ? ['', open] : []), ...moved, ...(close ? [close] : [])]
console.log(`${flag('dry-run') ? '[dry-run] ' : ''}moving ${moved.length} lines from ${from} -> ${to}`)
parsed.forEach(([s, e]) => console.log(`  L${s + 1}-L${e + 1}: ${lines[s].trim().slice(0, 70)}  ...  ${lines[e].trim().slice(0, 40)}`))
if (flag('dry-run')) process.exit(0)
if (fs.existsSync(to) && !flag('append')) die(`${to} already exists - pass --append to add to it (it will never be overwritten)`)
fs.mkdirSync(path.dirname(to), { recursive: true })
if (fs.existsSync(to)) fs.appendFileSync(to, nl + dest.join(nl) + nl); else fs.writeFileSync(to, dest.join(nl) + nl)
const drop = new Set(); sorted.forEach(([s, e]) => { for (let i = s; i <= e; i++) drop.add(i) })
fs.writeFileSync(from, lines.filter((_, i) => !drop.has(i)).join(nl))
console.log(`done. ${from} is now ${lines.length - moved.length} lines. Next: add the imports to ${to}, run the gates.`)
