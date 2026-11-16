/**
 * "Nothing lost, nothing invented" check for a MOVE-ONLY refactor.
 *
 *   node scripts/refactor/line-coverage.mjs --orig .refactor/original/api-src --new apps/api/src --max-new 80
 *   node scripts/refactor/line-coverage.mjs --orig .refactor/original/web-src --new apps/web/src --max-new 80
 *
 * Every meaningful line of the ORIGINAL tree must still exist (same number of times) somewhere in the NEW tree.
 * Lines that exist only in the NEW tree are "added" (wrapper functions, barrel exports...). Too many = invented logic.
 * Ignored: imports, export lists, comments, blank lines, lines that are only closers like ")" "}" "]);",
 * a leading "export ", trailing ; and , and the difference between ' and ".
 * Skipped folders: node_modules, dist, generated.
 */
import fs from 'node:fs'
import path from 'node:path'

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback }
const orig = arg('orig'); const next = arg('new'); const maxNew = Number(arg('max-new', '100'))
if (!orig || !next) { console.error('Usage: line-coverage.mjs --orig <dir> --new <dir> [--max-new N]'); process.exit(2) }
const exts = new Set(['.ts', '.tsx', '.css', '.mts', '.mjs', '.js', '.jsx'])
const skip = new Set(['node_modules', 'dist', 'generated', '.git'])

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out); else if (exts.has(path.extname(e.name))) out.push(p)
  }
  return out
}
const normalise = (text) => {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, '')
  t = t.replace(/^\s*import\s[\s\S]*?\sfrom\s+['"][^'"]+['"];?[ \t]*$/gm, '')
  t = t.replace(/^\s*import\s+['"][^'"]+['"];?[ \t]*$/gm, '')
  t = t.replace(/^\s*export\s*(type\s*)?\{[\s\S]*?\}\s*(from\s*['"][^'"]+['"])?;?[ \t]*$/gm, '')
  t = t.replace(/^\s*export\s*\*\s*from\s*['"][^'"]+['"];?[ \t]*$/gm, '')
  const lines = []
  for (const raw of t.split('\n')) {
    let l = raw.trim().replace(/\s+/g, ' ')
    if (!l || l.startsWith('//')) continue
    l = l.replace(/^export default /, '').replace(/^export /, '').replace(/'/g, '"').replace(/[;,]+$/, '').trim()
    if (!l || /^[)\]};,]+$/.test(l) || /^[({[]+$/.test(l)) continue
    lines.push(l)
  }
  return lines
}
const count = (dir) => {
  const m = new Map()
  for (const f of walk(dir)) for (const l of normalise(fs.readFileSync(f, 'utf8'))) m.set(l, (m.get(l) ?? 0) + 1)
  return m
}
const a = count(orig); const b = count(next)
const missing = []; let added = 0; const addedSample = []
for (const [l, n] of a) { const have = b.get(l) ?? 0; if (have < n) missing.push([l, n - have]) }
for (const [l, n] of b) { const had = a.get(l) ?? 0; if (n > had) { added += n - had; if (addedSample.length < 40) addedSample.push(l) } }
const total = [...a.values()].reduce((x, y) => x + y, 0)
console.log(`original meaningful lines: ${total} | missing: ${missing.reduce((s, [, n]) => s + n, 0)} | added: ${added} (limit ${maxNew})`)
let fail = false
if (missing.length) { fail = true; console.error('\nLOST CODE - these original lines no longer exist anywhere:'); for (const [l, n] of missing.slice(0, 60)) console.error(`  x${n}  ${l.slice(0, 160)}`); if (missing.length > 60) console.error(`  ... and ${missing.length - 60} more`) }
if (added > maxNew) { fail = true; console.error(`\nINVENTED CODE - ${added} new lines (limit ${maxNew}). A move-only refactor should add only wrappers/exports. Sample:`); addedSample.forEach(l => console.error('  +  ' + l.slice(0, 160))) }
else if (added) { console.log('added lines (expected wrappers/exports):'); addedSample.slice(0, 25).forEach(l => console.log('  +  ' + l.slice(0, 120))) }
if (fail) process.exit(1)
console.log('LINE COVERAGE OK - nothing lost, nothing invented beyond the limit.')
