import { execFileSync, spawn } from 'node:child_process'

const ports = ['5000/tcp', '5173/tcp']

try {
  execFileSync('fuser', ['-k', ...ports], { stdio: 'ignore' })
} catch {
  // No process is listening, or fuser is unavailable; continue safely.
}

const run = (command, args, stdio = 'inherit') => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio, shell: false })
  child.on('error', reject)
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`)))
})

try {
  await run('npm', ['run', 'prisma:generate'])
  await run('npm', ['run', 'prisma:deploy'])
  const services = spawn('npm', ['run', 'dev:services'], { stdio: 'inherit', shell: false })
  const intervalMs = Number(process.env.MIGRATION_CHECK_INTERVAL_MS ?? 30_000)
  let migrationCheckRunning = false
  const checkMigrations = async () => {
    if (migrationCheckRunning) return
    migrationCheckRunning = true
    try {
      await run('npm', ['run', 'prisma:deploy'], 'ignore')
      console.log(`[dev] migration check passed (${new Date().toLocaleTimeString()})`)
    } catch (error) {
      console.error(`[dev] migration check failed: ${error instanceof Error ? error.message : error}`)
    } finally {
      migrationCheckRunning = false
    }
  }
  const migrationTimer = setInterval(checkMigrations, intervalMs)
  const stop = () => { clearInterval(migrationTimer); services.kill('SIGTERM'); process.exit(0) }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  services.on('exit', (code) => process.exit(code ?? 0))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
