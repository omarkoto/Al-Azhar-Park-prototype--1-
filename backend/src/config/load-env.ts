import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * Loads backend/.env into process.env for local development.
 * Real environment variables always win (override: false), so Docker or the server's own env is never overwritten.
 */
export function loadEnvFile(cwd: string = process.cwd()): void {
  const file = resolve(cwd, '.env');
  if (existsSync(file)) config({ path: file, override: false, quiet: true });
}
