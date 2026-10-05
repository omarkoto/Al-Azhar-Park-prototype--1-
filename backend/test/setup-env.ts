/**
 * Runs before every e2e/db test file. It points the app at the TEST database and refuses to run against
 * anything that is not clearly a test database — these tests wipe tables.
 */
import { loadEnvFile } from '../src/config/load-env';

loadEnvFile();

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Create the azharpark_test database (docs/postgres-setup.md) and set TEST_DATABASE_URL in backend/.env.',
  );
}

const databaseName = decodeURIComponent(new URL(testUrl).pathname.replace(/^\//, ''));
if (!/test/i.test(databaseName)) {
  throw new Error(`Refusing to run tests: "${databaseName}" does not look like a test database (its name must contain "test").`);
}

// The app under test uses the test database; everything else gets quiet, deterministic defaults.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testUrl;
process.env.LOG_LEVEL = 'silent';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.SWAGGER_ENABLED = 'true';
process.env.RATE_LIMIT_TTL_SECONDS = '60';
process.env.RATE_LIMIT_MAX = '10000';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789-0123456789';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-9876543210-9876543210';
