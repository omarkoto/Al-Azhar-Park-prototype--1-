/**
 * Prepares the TEST database for the browser (end-to-end) suite: empties every table, then loads the reference
 * data and the six development users. Refuses to touch anything whose name does not contain "test".
 *   E2E_PASSWORD  password for the seeded users (default below; the browser tests use the same default)
 */
import { PrismaClient } from '@prisma/client';
import { seedDevelopment, seedReference } from '../prisma/seed-lib';
import { loadEnvFile } from '../src/config/load-env';

loadEnvFile();
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL is not set (see backend/.env.example).');
const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
if (!/test/i.test(name)) throw new Error(`Refusing to reset "${name}": its name must contain "test".`);

const prisma = new PrismaClient({ datasourceUrl: url });

async function main() {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await seedReference(prisma);
  await seedDevelopment(prisma, process.env.E2E_PASSWORD ?? 'E2e-Password-2026!');
  console.log(`E2E database "${name}" reset and seeded.`);
}

main().finally(() => prisma.$disconnect());
