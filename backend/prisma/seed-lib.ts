import { Prisma, PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/common/security/password';
import {
  CONTACT_INFORMATION,
  DEFAULT_OPENING,
  GATES,
  INITIAL_PRICES_VALID_FROM,
  INITIAL_TICKET_PRICES,
  PARK_SETTINGS,
  SYSTEM_SETTINGS,
  TICKET_AUDIENCES,
  TICKET_TYPES,
} from './seed-data/catalog';
import { DEV_USERS, PERMISSIONS, ROLES } from './seed-data/rbac';
import { EVENTS, RESTAURANTS, VENUES, JOURNAL_ARTICLES } from './seed-data/sample-content';

/** Postgres `time` / `date` columns are exchanged as Date objects pinned to UTC. */
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const date = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

/**
 * REFERENCE DATA — safe to run in every environment, including production.
 * Idempotent, and it never overwrites a value an administrator has changed in the portal:
 * rows are only created when missing (permissions' descriptions are the one exception).
 */
export async function seedReference(prisma: PrismaClient): Promise<void> {
  // permissions
  for (const [code, description] of PERMISSIONS) {
    await prisma.permission.upsert({ where: { code }, update: { description }, create: { code, description } });
  }
  const permissionIds = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));

  // roles and their permissions (only missing links are added, so portal edits survive re-seeding)
  for (const role of ROLES) {
    const saved = await prisma.role.upsert({
      where: { code: role.code },
      update: {},
      create: { code: role.code, name: role.name, description: role.description, isSystem: true },
    });
    const codes = role.permissions === '*' ? [...permissionIds.keys()] : role.permissions;
    for (const code of codes) {
      const permissionId = permissionIds.get(code);
      if (!permissionId) throw new Error(`Seed error: role ${role.code} references unknown permission "${code}"`);
    }
    await prisma.rolePermission.createMany({
      data: codes.map((code) => ({ roleId: saved.id, permissionId: permissionIds.get(code)! })),
      skipDuplicates: true,
    });
  }

  // ticket audiences & types
  for (const a of TICKET_AUDIENCES) {
    await prisma.ticketAudience.upsert({ where: { code: a.code }, update: {}, create: { ...a } });
  }
  for (const t of TICKET_TYPES) {
    await prisma.ticketType.upsert({ where: { code: t.code }, update: {}, create: { ...t } });
  }

  // initial price list — created only if that (type, audience, weekday set) has no standard price yet
  const types = new Map((await prisma.ticketType.findMany()).map((t) => [t.code, t.id]));
  const audiences = new Map((await prisma.ticketAudience.findMany()).map((a) => [a.code, a.id]));
  for (const p of INITIAL_TICKET_PRICES) {
    const ticketTypeId = types.get(p.type)!;
    const audienceId = audiences.get(p.audience)!;
    const exists = await prisma.ticketPrice.findFirst({
      where: { ticketTypeId, audienceId, kind: 'STANDARD', dowMask: p.dowMask, priority: 0 },
    });
    if (!exists) {
      await prisma.ticketPrice.create({
        data: {
          ticketTypeId,
          audienceId,
          kind: 'STANDARD',
          priority: 0,
          dowMask: p.dowMask,
          amountMinor: p.amountMinor,
          currency: 'EGP',
          validFrom: date(INITIAL_PRICES_VALID_FROM),
          validTo: null,
          notes: 'Initial price list (seed)',
        },
      });
    }
  }

  // gates
  for (const g of GATES) await prisma.gate.upsert({ where: { code: g.code }, update: {}, create: { ...g } });

  // weekly opening hours: 0 = Sunday … 6 = Saturday
  for (let day = 0; day <= 6; day++) {
    await prisma.openingHour.upsert({
      where: { dayOfWeek: day },
      update: {},
      create: { dayOfWeek: day, opens: time(DEFAULT_OPENING.opens), closes: time(DEFAULT_OPENING.closes), isClosed: false },
    });
  }

  // singletons + settings
  await prisma.parkSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, ...PARK_SETTINGS, stats: PARK_SETTINGS.stats as unknown as Prisma.InputJsonValue },
  });
  await prisma.contactInformation.upsert({ where: { id: 1 }, update: {}, create: { id: 1, ...CONTACT_INFORMATION } });
  for (const s of SYSTEM_SETTINGS) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: {},
      create: {
        key: s.key,
        value: s.value === null ? Prisma.JsonNull : (s.value as Prisma.InputJsonValue),
        description: s.description,
      },
    });
  }
}

/**
 * DEVELOPMENT DATA — dev users with a known password and sample content. Refused in production by the caller.
 * Emails use the reserved `.test` domain so they can never be real mailboxes.
 */
export async function seedDevelopment(prisma: PrismaClient, devPassword: string): Promise<void> {
  const passwordHash = await hashPassword(devPassword);
  const roles = new Map((await prisma.role.findMany()).map((r) => [r.code, r.id]));

  for (const u of DEV_USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, fullName: u.fullName, passwordHash },
    });
    await prisma.userRole.createMany({ data: [{ userId: user.id, roleId: roles.get(u.role)! }], skipDuplicates: true });
  }

  for (const v of VENUES) await prisma.venue.upsert({ where: { slug: v.slug }, update: {}, create: { ...v } });

  for (const r of RESTAURANTS) {
    const { menuUrl, opensAt, closesAt, phones, ...rest } = r;
    const restaurant = await prisma.restaurant.upsert({
      where: { slug: r.slug },
      update: {},
      create: { ...rest, phones: [...phones], opensAt: time(opensAt), closesAt: time(closesAt) },
    });
    const hasMenu = await prisma.menu.findFirst({ where: { restaurantId: restaurant.id } });
    if (!hasMenu) {
      await prisma.menu.create({
        data: { restaurantId: restaurant.id, nameEn: 'Menu', nameAr: 'القائمة', externalUrl: menuUrl },
      });
    }
  }

  // Events: created once; what editors change afterwards is never overwritten.
  for (const e of EVENTS) {
    const { venueSlug, ...rest } = e as typeof e & { venueSlug?: string };
    const venue = venueSlug ? await prisma.venue.findUnique({ where: { slug: venueSlug } }) : null;
    await prisma.event.upsert({
      where: { slug: e.slug },
      update: {},
      create: { ...rest, venueId: venue?.id ?? null, startsAt: new Date(e.startsAt), endsAt: new Date(e.endsAt), publishedAt: new Date() },
    });
  }

  // Journal: created once, published, in the order they are listed (the first is the newest); what editors change afterwards is never overwritten.
  for (const [i, a] of JOURNAL_ARTICLES.entries()) {
    await prisma.journalArticle.upsert({
      where: { slug: a.slug },
      update: {},
      create: { ...a, status: 'PUBLISHED', publishedAt: new Date(Date.now() - i * 60_000) },
    });
  }
}
