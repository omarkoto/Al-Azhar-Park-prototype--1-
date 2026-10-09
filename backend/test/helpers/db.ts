import { PrismaClient } from '@prisma/client';
import { seedDevelopment, seedReference } from '../../prisma/seed-lib';

export const TEST_PASSWORD = 'Test-Password-2026!';

/** A client on the TEST database with a generous pool so concurrency tests really run in parallel. */
export function createTestPrisma(connectionLimit = 30): PrismaClient {
  const url = new URL(process.env.TEST_DATABASE_URL as string);
  url.searchParams.set('connection_limit', String(connectionLimit));
  return new PrismaClient({ datasourceUrl: url.toString() });
}

/**
 * Every trigger that makes a history table refuse TRUNCATE, as [table, trigger] (migrations 20261011090000_phase11_truncate_guard and
 * 20261011100000_phase11_history_truncate_guard). Found by name (*_no_truncate) so a table added later is handled without editing this.
 */
export async function truncateGuards(prisma: PrismaClient): Promise<Array<[string, string]>> {
  const rows = await prisma.$queryRaw<Array<{ relname: string; tgname: string }>>`
    SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname = 'public' AND t.tgname ~ '_no_truncate$' ORDER BY t.tgname`;
  return rows.map((r) => [r.relname, r.tgname]);
}

/**
 * Empties every table. TRUNCATE is not stopped by the row-level protection triggers, but the history tables have TRUNCATE guards;
 * they are disabled and enabled again inside the same transaction as the reset, so they are never left off.
 */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  const guards = await truncateGuards(prisma);
  await prisma.$transaction([
    ...guards.map(([table, guard]) => prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER ${guard}`)),
    prisma.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`),
    ...guards.map(([table, guard]) => prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER ${guard}`)),
  ]);
}

export async function seedAll(prisma: PrismaClient): Promise<void> {
  await seedReference(prisma);
  await seedDevelopment(prisma, TEST_PASSWORD);
}
