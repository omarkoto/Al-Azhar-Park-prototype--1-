import { execSync } from 'node:child_process';
import { loadEnvFile } from '../src/config/load-env';

/** Once per test run: bring the TEST database up to the latest migration (never touches the dev database). */
export default function globalSetup(): void {
  loadEnvFile();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see docs/postgres-setup.md).');
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!/test/i.test(name)) throw new Error(`Refusing to migrate "${name}": not a test database.`);

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
