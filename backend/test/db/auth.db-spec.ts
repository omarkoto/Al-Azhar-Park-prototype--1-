import { PrismaClient } from '@prisma/client';
import { createUser } from '../helpers/auth';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { expectDbError } from '../helpers/fixtures';

describe('authentication integrity (database level)', () => {
  const prisma: PrismaClient = createTestPrisma();

  beforeAll(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const newRefresh = async (hash: string) => {
    const user = await createUser(prisma);
    return prisma.refreshToken.create({
      data: { userId: user.id, familyId: '11111111-1111-4111-8111-111111111111', tokenHash: hash, expiresAt: new Date(Date.now() + 3_600_000) },
    });
  };

  describe('refresh tokens', () => {
    it('can be revoked once, and revocation can never be undone', async () => {
      const t = await newRefresh('h-revoke');
      const revokedAt = new Date();
      await prisma.refreshToken.update({ where: { id: t.id }, data: { revokedAt } });
      await expectDbError(prisma.refreshToken.update({ where: { id: t.id }, data: { revokedAt: null } }), /cannot be changed or re-activated/);
      await expectDbError(prisma.refreshToken.update({ where: { id: t.id }, data: { revokedAt: new Date(revokedAt.getTime() + 1000) } }), /cannot be changed or re-activated/);
    });

    it('keep their identity and expiry for life', async () => {
      const t = await newRefresh('h-identity');
      await expectDbError(prisma.refreshToken.update({ where: { id: t.id }, data: { tokenHash: 'other' } }), /immutable/);
      await expectDbError(prisma.refreshToken.update({ where: { id: t.id }, data: { expiresAt: new Date(Date.now() + 999_999_999) } }), /immutable/);
      await expectDbError(prisma.refreshToken.update({ where: { id: t.id }, data: { familyId: '22222222-2222-4222-8222-222222222222' } }), /immutable/);
    });

    it('cannot have their session start moved (the 30-day limit cannot be reset)', async () => {
      const t = await newRefresh('h-session');
      await expectDbError(prisma.refreshToken.update({ where: { id: t.id }, data: { sessionStartedAt: new Date('2030-01-01') } }), /immutable/);
    });

    it('cannot be re-linked to a different successor', async () => {
      const a = await newRefresh('h-link-a');
      const b = await newRefresh('h-link-b');
      const c = await newRefresh('h-link-c');
      await prisma.refreshToken.update({ where: { id: a.id }, data: { revokedAt: new Date(), replacedById: b.id } });
      await expectDbError(prisma.refreshToken.update({ where: { id: a.id }, data: { replacedById: c.id } }), /cannot be changed|cannot be re-linked/);
    });

    it('have unique hashes', async () => {
      const t = await newRefresh('h-unique');
      await expectDbError(
        prisma.refreshToken.create({ data: { userId: t.userId, familyId: t.familyId, tokenHash: 'h-unique', expiresAt: new Date() } }),
        /Unique constraint|unique/i,
      );
    });
  });

  describe('password-reset tokens', () => {
    it('are single use: once used they cannot be un-used or changed', async () => {
      const user = await createUser(prisma);
      const t = await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: 'r-1', expiresAt: new Date(Date.now() + 60_000) } });
      const usedAt = new Date();
      await prisma.passwordResetToken.update({ where: { id: t.id }, data: { usedAt } });
      await expectDbError(prisma.passwordResetToken.update({ where: { id: t.id }, data: { usedAt: null } }), /cannot be reused/);
      await expectDbError(prisma.passwordResetToken.update({ where: { id: t.id }, data: { tokenHash: 'r-2' } }), /immutable/);
    });
  });

  describe('users', () => {
    it('cannot have negative failure counters or token versions', async () => {
      const user = await createUser(prisma);
      await expectDbError(prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: -1 } }), /ck_users_failed_login/);
      await expectDbError(prisma.user.update({ where: { id: user.id }, data: { tokenVersion: -1 } }), /ck_users_failed_login/);
    });

    it('keep their audit trail: a user with audit entries cannot be deleted', async () => {
      const user = await createUser(prisma);
      await prisma.auditLog.create({ data: { userId: user.id, action: 'auth.login.success', entity: 'user' } });
      await expectDbError(prisma.user.delete({ where: { id: user.id } }), /foreign key|violat/i);
    });
  });
});
