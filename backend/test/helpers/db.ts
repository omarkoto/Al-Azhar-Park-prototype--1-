import { PrismaClient } from '@prisma/client';
import { seedDevelopment, seedReference } from '../../prisma/seed-lib';

export const TEST_PASSWORD = 'Test-Password-2026!';

/** A client on the TEST database with a generous pool so concurrency tests really run in parallel. */
export function createTestPrisma(connectionLimit = 30): PrismaClient {
  const url = new URL(process.env.TEST_DATABASE_URL as string);
  url.searchParams.set('connection_limit', String(connectionLimit));
  return new PrismaClient({ datasourceUrl: url.toString() });
}

/** Empties every table (TRUNCATE is not blocked by the row-level protection triggers). */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
}

export async function seedAll(prisma: PrismaClient): Promise<void> {
  await seedReference(prisma);
  await seedDevelopment(prisma, TEST_PASSWORD);
}
