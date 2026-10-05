import { defineConfig } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Starts the whole stack on private ports against the TEST database, so these tests never touch your development data:
 *   API     http://localhost:3100   (built backend, test database)
 *   Portal  http://localhost:5274
 *   Website http://localhost:5273   (reads live content from the API above)
 */
const root = join(__dirname, '..')

function backendEnv(): Record<string, string> {
  const file = join(root, 'backend', '.env')
  const env: Record<string, string> = {}
  if (!existsSync(file)) return env
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return env
}

const API_PORT = 3100
const PORTAL_PORT = 5274
const SITE_PORT = 5273
const API_URL = `http://localhost:${API_PORT}/api/v1`
const dbEnv = backendEnv()

export default defineConfig({
  testDir: './tests',
  // the specs share one database and one running stack, so they run one after another
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // uses the Google Chrome installed on this machine (no browser download); set CHROME_PATH to use another build
    channel: process.env.CHROME_PATH ? undefined : 'chrome',
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
    baseURL: `http://localhost:${PORTAL_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: join(root, 'backend'),
      url: `${API_URL}/health/ready`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'development',
        PORT: String(API_PORT),
        LOG_LEVEL: 'warn',
        DATABASE_URL: dbEnv.TEST_DATABASE_URL ?? '',
        CORS_ORIGINS: `http://localhost:${PORTAL_PORT},http://localhost:${SITE_PORT}`,
        // the suite signs in many times from one address: lift the per-address sign-in limits (refused in production)
        AUTH_RATE_LIMIT_MULTIPLIER: '50',
        RATE_LIMIT_MAX: '100000',
        SWAGGER_ENABLED: 'false',
      },
    },
    {
      command: `npx vite --port ${PORTAL_PORT} --strictPort`,
      cwd: join(root, 'portal'),
      url: `http://localhost:${PORTAL_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_URL: API_URL },
    },
    {
      command: `npx vite --port ${SITE_PORT} --strictPort`,
      cwd: root,
      url: `http://localhost:${SITE_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_URL: API_URL },
    },
  ],
})
