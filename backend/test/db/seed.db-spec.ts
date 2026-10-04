import { PrismaClient } from '@prisma/client';
import { verifyPassword } from '../../src/common/security/password';
import { seedAll, createTestPrisma, resetDatabase, TEST_PASSWORD } from '../helpers/db';

describe('seed data', () => {
  const prisma: PrismaClient = createTestPrisma();

  beforeAll(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const priceTable = async () => {
    const rows = await prisma.ticketPrice.findMany({ include: { ticketType: true, audience: true } });
    return Object.fromEntries(
      rows.map((r) => [`${r.audience.code}/${r.ticketType.code}/${r.dowMask === 31 ? 'weekday' : 'weekend'}`, r.amountMinor]),
    );
  };

  it('seeds the official ticket prices as database rows, in piastres', async () => {
    expect(await priceTable()).toEqual({
      'RESIDENT/ADULT/weekday': 5000,
      'RESIDENT/ADULT/weekend': 6000,
      'RESIDENT/CHILD/weekday': 3500,
      'RESIDENT/CHILD/weekend': 4000,
      'VISITOR/ADULT/weekday': 15000,
      'VISITOR/ADULT/weekend': 20000,
      'VISITOR/CHILD/weekday': 10000,
      'VISITOR/CHILD/weekend': 15000,
    });
    const rows = await prisma.ticketPrice.findMany();
    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.currency === 'EGP' && r.kind === 'STANDARD' && r.validTo === null && r.isActive)).toBe(true);
  });

  it('encodes weekdays as Sun–Thu and weekends as Fri–Sat', async () => {
    const masks = new Set((await prisma.ticketPrice.findMany()).map((p) => p.dowMask));
    expect([...masks].sort((a, b) => a - b)).toEqual([31, 96]);
  });

  it('seeds opening hours 09:00–22:00 for all seven days (one row per day)', async () => {
    const hours = await prisma.openingHour.findMany({ orderBy: { dayOfWeek: 'asc' } });
    expect(hours.map((h) => h.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const h of hours) {
      expect(h.isClosed).toBe(false);
      expect(h.opens?.toISOString().slice(11, 16)).toBe('09:00');
      expect(h.closes?.toISOString().slice(11, 16)).toBe('22:00');
    }
  });

  it('seeds the business-rule settings: 60-minute same-day cut-off and NO capacity limit', async () => {
    const cutoff = await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'booking.sameDayCutoffMinutesBeforeClose' } });
    const capacity = await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'capacity.dailyLimit' } });
    expect(cutoff.value).toBe(60);
    expect(capacity.value).toBeNull(); // null = unlimited
  });

  it('seeds ticket types that all start at age 2 or later (children under 2 need no ticket)', async () => {
    const types = await prisma.ticketType.findMany({ orderBy: { code: 'asc' } });
    expect(types.map((t) => [t.code, t.minAge, t.maxAge])).toEqual([['ADULT', 9, null], ['CHILD', 2, 8]]);
  });

  it('has no refund permission anywhere', async () => {
    expect(await prisma.permission.count({ where: { code: { contains: 'refund' } } })).toBe(0);
  });

  it('seeds two gates, both audiences and both ticket types', async () => {
    expect((await prisma.gate.findMany()).map((g) => g.code).sort()).toEqual(['DARASSA', 'MAIN']);
    expect((await prisma.ticketAudience.findMany()).map((a) => a.code).sort()).toEqual(['RESIDENT', 'VISITOR']);
    expect((await prisma.ticketType.findMany()).map((t) => t.code).sort()).toEqual(['ADULT', 'CHILD']);
  });

  describe('roles and permissions', () => {
    const permissionsOf = async (role: string) =>
      (await prisma.rolePermission.findMany({ where: { role: { code: role } }, include: { permission: true } })).map((rp) => rp.permission.code);

    it('gives SUPER_ADMIN every permission', async () => {
      const all = (await prisma.permission.findMany()).map((p) => p.code).sort();
      expect((await permissionsOf('SUPER_ADMIN')).sort()).toEqual(all);
    });

    it('keeps ticket staff away from prices, content, users and settings', async () => {
      const staff = await permissionsOf('TICKET_STAFF');
      expect(staff).toEqual(expect.arrayContaining(['scans:create', 'tickets:read_entry', 'counter-sales:create']));
      for (const forbidden of ['pricing:write', 'users:read', 'users:write', 'settings:write', 'events:write', 'park:write', 'orders:read', 'payments:record_cash']) {
        expect(staff).not.toContain(forbidden);
      }
    });

    it('makes the analyst strictly read-only', async () => {
      const analyst = await permissionsOf('ANALYST');
      expect(analyst.length).toBeGreaterThan(0);
      for (const code of analyst) expect(code).toMatch(/:read$/);
    });

    it('lets only the super admin manage roles and system settings', async () => {
      for (const role of ['ADMIN', 'OPERATIONS', 'TICKET_STAFF', 'CONTENT_MANAGER', 'ANALYST']) {
        const perms = await permissionsOf(role);
        expect(perms).not.toContain('roles:write');
        expect(perms).not.toContain('settings:write');
      }
    });

    it('keeps content managers out of pricing and the ticketing money flow', async () => {
      const content = await permissionsOf('CONTENT_MANAGER');
      for (const code of content) expect(code).not.toMatch(/^(pricing|orders|payments|tickets|counter-sales|scans):/);
      expect(content).toEqual(expect.arrayContaining(['events:publish', 'restaurants:write', 'menus:write', 'hours:write']));
    });

    it('lets only operations-level roles record cash payments on existing orders', async () => {
      for (const role of ['ADMIN', 'OPERATIONS']) expect(await permissionsOf(role)).toContain('payments:record_cash');
      for (const role of ['TICKET_STAFF', 'CONTENT_MANAGER', 'ANALYST']) expect(await permissionsOf(role)).not.toContain('payments:record_cash');
    });
  });

  describe('development users', () => {
    it('creates six users with exactly one role each, on the reserved .test domain', async () => {
      const users = await prisma.user.findMany({ include: { roles: { include: { role: true } } } });
      expect(users).toHaveLength(6);
      for (const u of users) {
        expect(u.email.endsWith('@azharpark.test')).toBe(true);
        expect(u.roles).toHaveLength(1);
      }
    });

    it('stores argon2id hashes, never plaintext, and they verify', async () => {
      const users = await prisma.user.findMany();
      for (const u of users) {
        expect(u.passwordHash.startsWith('$argon2id$')).toBe(true);
        expect(u.passwordHash).not.toContain(TEST_PASSWORD);
        await expect(verifyPassword(u.passwordHash, TEST_PASSWORD)).resolves.toBe(true);
      }
    });

    it('matches email case-insensitively (citext)', async () => {
      const found = await prisma.user.findUnique({ where: { email: 'ADMIN@AzharPark.TEST' } });
      expect(found?.email).toBe('admin@azharpark.test');
    });
  });

  describe('idempotency', () => {
    it('can be run again without creating duplicates', async () => {
      const count = async () => ({
        permissions: await prisma.permission.count(),
        rolePermissions: await prisma.rolePermission.count(),
        users: await prisma.user.count(),
        prices: await prisma.ticketPrice.count(),
        events: await prisma.event.count(),
        restaurants: await prisma.restaurant.count(),
      });
      const before = await count();
      await seedAll(prisma);
      expect(await count()).toEqual(before);
    });

    it('never overwrites what an administrator changed in the portal', async () => {
      // admin sets Friday to 10:00–23:00 and raises a price by closing the old row and adding a new one
      await prisma.openingHour.update({
        where: { dayOfWeek: 5 },
        data: { opens: new Date('1970-01-01T10:00:00Z'), closes: new Date('1970-01-01T23:00:00Z') },
      });
      const old = await prisma.ticketPrice.findFirstOrThrow({ where: { amountMinor: 5000 } });
      await prisma.ticketPrice.update({ where: { id: old.id }, data: { validTo: new Date('2026-12-31') } });
      await prisma.ticketPrice.create({
        data: {
          ticketTypeId: old.ticketTypeId, audienceId: old.audienceId, dowMask: old.dowMask,
          amountMinor: 5500, validFrom: new Date('2027-01-01'),
        },
      });
      const pricesBefore = await prisma.ticketPrice.count();

      await seedAll(prisma);

      const friday = await prisma.openingHour.findUniqueOrThrow({ where: { dayOfWeek: 5 } });
      expect(friday.opens?.toISOString().slice(11, 16)).toBe('10:00');
      expect(friday.closes?.toISOString().slice(11, 16)).toBe('23:00');
      expect(await prisma.ticketPrice.count()).toBe(pricesBefore); // no duplicate standard price was added
    });
  });
});
