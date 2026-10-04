import '../src/config/bootstrap-env';
import { PrismaClient } from '@prisma/client';
import { validateEnv } from '../src/config/env.schema';
import { seedDevelopment, seedReference } from './seed-lib';

/**
 * `npm run db:seed`
 *   • reference data: always (idempotent, never overwrites portal edits)
 *   • development users + sample content: only outside production
 */
async function main(): Promise<void> {
  const env = validateEnv(process.env);
  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  try {
    await seedReference(prisma);
    console.log('✔ reference data (permissions, roles, ticket types & prices, gates, opening hours, settings)');

    if (env.NODE_ENV === 'production') {
      console.log('• production: development users and sample content are NOT seeded');
      return;
    }
    const password = env.SEED_DEV_PASSWORD ?? 'ChangeMe-Dev-2026!';
    await seedDevelopment(prisma, password);
    console.log('✔ development users and sample content');
    console.log('\nDevelopment logins (password from SEED_DEV_PASSWORD — never use these outside development):');
    console.log('  superadmin@azharpark.test · admin@azharpark.test · operations@azharpark.test');
    console.log('  staff@azharpark.test · content@azharpark.test · analyst@azharpark.test');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
