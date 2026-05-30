import { spawnSync } from 'node:child_process'
import path from 'node:path'

const zenstackBin = path.join(process.cwd(), 'node_modules', '.bin', 'zenstack')

function run(args) {
  const result = spawnSync(zenstackBin, args, { stdio: 'inherit' })
  return result.status ?? 1
}

const generateExit = run(['generate'])
if (generateExit !== 0) {
  process.exit(generateExit)
}

const vercelEnv = process.env.VERCEL_ENV ?? 'local'

if (!process.env.DATABASE_URL) {
  if (vercelEnv === 'production') {
    console.error('[prebuild] DATABASE_URL is required for production builds')
    process.exit(1)
  }

  console.warn(
    `[prebuild] DATABASE_URL unset (${vercelEnv}); skipping zenstack migrate deploy`,
  )
  process.exit(0)
}

const migrateExit = run(['migrate', 'deploy'])
if (migrateExit !== 0 && vercelEnv === 'preview') {
  console.warn(
    '[prebuild] zenstack migrate deploy failed on preview; continuing build',
  )
  process.exit(0)
}

process.exit(migrateExit)
