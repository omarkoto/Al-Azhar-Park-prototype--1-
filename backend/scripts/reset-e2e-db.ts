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
  // the history tables refuse TRUNCATE (migrations 20261011090000 and 20261011100000); switch those guards off only for this reset, in one transaction
  const guards = await prisma.$queryRaw<Array<{ relname: string; tgname: string }>>`
    SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname = 'public' AND t.tgname ~ '_no_truncate$' ORDER BY t.tgname`;
  await prisma.$transaction([
    ...guards.map((g) => prisma.$executeRawUnsafe(`ALTER TABLE "${g.relname}" DISABLE TRIGGER ${g.tgname}`)),
    prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`),
    ...guards.map((g) => prisma.$executeRawUnsafe(`ALTER TABLE "${g.relname}" ENABLE TRIGGER ${g.tgname}`)),
  ]);
  await seedReference(prisma);
  await seedDevelopment(prisma, process.env.E2E_PASSWORD ?? 'E2e-Password-2026!');
  console.log(`E2E database "${name}" reset and seeded.`);
}

main().finally(() => prisma.$disconnect());
