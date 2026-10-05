// Prepares everything the browser tests need, using the TEST database only:
//   1. builds the API,  2. applies the migrations to the test database,  3. empties it and loads the seed data.
// Run automatically by `npm test`. Servers are started by Playwright itself (see playwright.config.ts).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const backend = join(root, 'backend')

/** Reads KEY=VALUE lines (quotes allowed) from backend/.env — the same file the API itself uses. */
function readBackendEnv() {
  const file = join(backend, '.env')
  if (!existsSync(file)) {
    console.error('backend/.env not found. Create it from backend/.env.example and set TEST_DATABASE_URL (see docs/postgres-setup.md).')
    process.exit(1)
  }
  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return env
}

function run(label, command, env = {}) {
  console.log(`\n▶ ${label}`)
  const r = spawnSync(command, { cwd: backend, stdio: 'inherit', shell: true, env: { ...process.env, ...env } })
  if (r.status !== 0) {
    console.error(`\n✖ ${label} failed`)
    process.exit(r.status ?? 1)
  }
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('prepare.mjs')) {
  const env = readBackendEnv()
  const testUrl = env.TEST_DATABASE_URL
  if (!testUrl) {
    console.error('TEST_DATABASE_URL is missing in backend/.env')
    process.exit(1)
  }
  if (!/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) {
    console.error('Refusing to run: TEST_DATABASE_URL must point to a database whose name contains "test".')
    process.exit(1)
  }
  run('Build the API', 'npm run build')
  run('Apply migrations to the test database', 'npx prisma migrate deploy', { DATABASE_URL: testUrl })
  run('Reset and seed the test database', 'npx tsx scripts/reset-e2e-db.ts')
}
