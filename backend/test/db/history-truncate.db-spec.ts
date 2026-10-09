import { PrismaClient } from '@prisma/client';
import { addDays, createPaidOrder, expectDbError } from '../helpers/fixtures';
import { createTestPrisma, resetDatabase, seedAll, truncateGuards } from '../helpers/db';

// The order, payment, ticket and price history tables are never deleted and (apart from the lifecycle changes the rules allow) never
// edited. Since Phase 11 they refuse TRUNCATE too, directly and through CASCADE.
const TABLES = ['orders', 'order_items', 'payments', 'tickets', 'ticket_prices'] as const;
const MESSAGE = (table: string) => new RegExp(`Truncating [^a-z]+${table}[^a-z]+ is not allowed: order, payment, ticket and price history must be kept`);
const ANY_MESSAGE = /Truncating [^a-z]+(orders|order_items|payments|tickets|ticket_prices)[^a-z]+ is not allowed|TRUNCATE on [^a-z]+(audit_logs|ticket_scans)[^a-z]+ is not allowed|cannot truncate/;

describe('history tables refuse TRUNCATE as well as DELETE (database level)', () => {
  const prisma: PrismaClient = createTestPrisma();
  const today = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const count = async (table: string) => Number((await prisma.$queryRawUnsafe<Array<{ c: bigint }>>(`SELECT count(*) AS c FROM ${table}`))[0].c);
  const counts = async () => Object.fromEntries(await Promise.all([...TABLES, 'customers', 'users', 'audit_logs', 'ticket_scans'].map(async (t) => [t, await count(t)])));
  const withHistory = async () => {
    const made = await createPaidOrder(prisma, { seq: 1, visitDate: addDays(today(), 3), quantity: 2 });
    await createPaidOrder(prisma, { seq: 2, visitDate: addDays(today(), 4), quantity: 1 });
    await prisma.auditLog.create({ data: { action: 'test.event', entity: 'test' } });
    const staff = await prisma.user.findUniqueOrThrow({ where: { email: 'staff@azharpark.test' } });
    await prisma.ticketScan.create({ data: { scannedById: staff.id, result: 'INVALID', reason: 'NOT_FOUND', tokenFingerprint: 'abcd1234' } });
    return made;
  };

  describe('the guards', () => {
    it('exist on all five tables as enabled, statement-level BEFORE TRUNCATE triggers (and on audit_logs and ticket_scans)', async () => {
      const rows = await prisma.$queryRaw<Array<{ tgname: string; relname: string; tgenabled: string; tgtype: number }>>`
        SELECT t.tgname, c.relname, t.tgenabled::text AS tgenabled, t.tgtype FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         WHERE NOT t.tgisinternal AND t.tgname ~ '_no_truncate$' ORDER BY c.relname`;
      expect(rows.map((r) => r.relname)).toEqual(['audit_logs', 'order_items', 'orders', 'payments', 'ticket_prices', 'ticket_scans', 'tickets']);
      for (const r of rows) {
        expect(r.tgenabled).toBe('O');
        expect(r.tgtype & 1).toBe(0); // FOR EACH STATEMENT
        expect(r.tgtype & 2).toBe(2); // BEFORE
        expect(r.tgtype & 32).toBe(32); // TRUNCATE
      }
      expect((await truncateGuards(prisma)).map(([table]) => table).sort()).toEqual(rows.map((r) => r.relname).sort());
    });

    it('the existing DELETE / UPDATE guards are all still in place', async () => {
      const rows = await prisma.$queryRaw<Array<{ tgname: string }>>`
        SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
          ('trg_orders_no_delete', 'trg_order_items_no_delete', 'trg_payments_no_delete', 'trg_tickets_no_delete', 'trg_ticket_prices_no_delete',
           'trg_orders_immutable', 'trg_order_items_immutable', 'trg_payments_immutable', 'trg_tickets_guard', 'trg_ticket_prices_immutable')`;
      expect(rows).toHaveLength(10);
    });
  });

  describe('INSERT, and the UPDATEs and DELETEs the existing rules decide, behave as before', () => {
    it('still takes new orders, items, payments, tickets and prices', async () => {
      const before = await counts();
      const { order, item, tickets } = await createPaidOrder(prisma, { seq: 7, visitDate: addDays(today(), 2), quantity: 2 });
      expect(order.id && item.id && tickets).toBeTruthy();
      const after = await counts();
      expect(after.orders).toBe(before.orders + 1);
      expect(after.order_items).toBe(before.order_items + 1);
      expect(after.payments).toBe(before.payments + 1);
      expect(after.tickets).toBe(before.tickets + 2);
      const type = await prisma.ticketType.findUniqueOrThrow({ where: { code: 'ADULT' } });
      const audience = await prisma.ticketAudience.findUniqueOrThrow({ where: { code: 'VISITOR' } });
      await prisma.ticketPrice.create({ data: { ticketTypeId: type.id, audienceId: audience.id, amountMinor: 99900, kind: 'STANDARD', dowMask: 127, validFrom: new Date('2000-01-01T00:00:00Z'), validTo: new Date('2000-12-31T00:00:00Z') } });
      expect(await count('ticket_prices')).toBe(after.ticket_prices + 1);
    });

    it('still refuses DELETE and illegal UPDATE with the same messages, and still allows the lifecycle change', async () => {
      const { order, item, tickets, price } = await withHistory();
      await expectDbError(prisma.order.delete({ where: { id: order.id } }), /Deleting rows from/);
      await expectDbError(prisma.ticket.deleteMany(), /Deleting rows from/);
      await expectDbError(prisma.ticketPrice.delete({ where: { id: price.id } }), /price rows are history/);
      await expectDbError(prisma.ticketPrice.update({ where: { id: price.id }, data: { amountMinor: 1 } }), /a price row cannot be edited/);
      await expectDbError(prisma.orderItem.update({ where: { id: item.id }, data: { quantity: 9 } }), /order_items are immutable/);
      await expectDbError(prisma.ticket.update({ where: { id: tickets[0].id }, data: { pricePaidMinor: 1 } }), /immutable/);
      const used = await prisma.ticket.update({ where: { id: tickets[0].id }, data: { status: 'USED', usedAt: new Date() } }); // VALID -> USED is the lifecycle
      expect(used.status).toBe('USED');
    });
  });

  describe('TRUNCATE is refused, every way, and nothing is lost', () => {
    it.each(TABLES)('%s: plain, RESTART IDENTITY and CASCADE are all refused (by Postgres for a referenced table, or by the guard)', async (table) => {
      await withHistory();
      const before = await counts();
      await expectDbError(prisma.$executeRawUnsafe(`TRUNCATE ${table}`), ANY_MESSAGE);
      await expectDbError(prisma.$executeRawUnsafe(`TRUNCATE ${table} RESTART IDENTITY`), ANY_MESSAGE);
      await expectDbError(prisma.$executeRawUnsafe(`TRUNCATE TABLE ONLY ${table} CASCADE`), ANY_MESSAGE);
      await expectDbError(prisma.$executeRawUnsafe(`TRUNCATE ${table} RESTART IDENTITY CASCADE`), ANY_MESSAGE);
      expect(await counts()).toEqual(before);
    });

    it.each(TABLES)('%s: its OWN guard fires, with its own message (every other guard switched off inside a transaction that is rolled back)', async (table) => {
      await withHistory();
      const before = await counts();
      const others = (await truncateGuards(prisma)).filter(([t]) => t !== table);
      await expect(
        prisma.$transaction(async (tx) => {
          for (const [t, guard] of others) await tx.$executeRawUnsafe(`ALTER TABLE "${t}" DISABLE TRIGGER ${guard}`);
          await tx.$executeRawUnsafe(`TRUNCATE ${table} CASCADE`);
        }),
      ).rejects.toThrow(MESSAGE(table));
      expect(await counts()).toEqual(before);
      // the rolled-back transaction did not leave any guard off
      const states = await prisma.$queryRaw<Array<{ tgenabled: string }>>`SELECT tgenabled::text AS tgenabled FROM pg_trigger WHERE tgname ~ '_no_truncate$'`;
      expect(states.every((x) => x.tgenabled === 'O')).toBe(true);
    });

    it('TRUNCATE ... CASCADE on a table they reference (customers, users, ticket_types, ticket_audiences, gates) is refused too', async () => {
      await withHistory();
      const before = await counts();
      for (const table of ['customers', 'users', 'ticket_types', 'ticket_audiences', 'gates', 'orders']) {
        await expectDbError(prisma.$executeRawUnsafe(`TRUNCATE ${table} CASCADE`), ANY_MESSAGE);
      }
      expect(await counts()).toEqual(before);
      expect(await prisma.ticketType.count()).toBeGreaterThan(0); // the refused statements rolled back as a whole
    });

    it('a statement naming several tables is refused as a whole, so nothing else is emptied either', async () => {
      await withHistory();
      const before = await counts();
      await expectDbError(prisma.$executeRawUnsafe('TRUNCATE order_items, orders, payments, tickets, ticket_prices'), ANY_MESSAGE);
      await expectDbError(prisma.$executeRawUnsafe('TRUNCATE customers, orders'), ANY_MESSAGE);
      expect(await counts()).toEqual(before);
    });

    it('is refused inside a transaction and the transaction can still be used afterwards', async () => {
      await withHistory();
      const before = await counts();
      await expect(prisma.$transaction([prisma.$executeRawUnsafe('SELECT 1'), prisma.$executeRawUnsafe('TRUNCATE payments')])).rejects.toThrow();
      expect(await counts()).toEqual(before);
    });
  });

  describe('the test reset still empties everything, and leaves every guard enabled', () => {
    it('with history in all seven guarded tables', async () => {
      await withHistory();
      expect((await counts()).orders).toBeGreaterThan(0);
      await resetDatabase(prisma);
      const empty = await counts();
      for (const table of [...TABLES, 'customers', 'users', 'audit_logs', 'ticket_scans']) expect({ table, rows: empty[table] }).toEqual({ table, rows: 0 });
      const guards = (await truncateGuards(prisma)).map(([, g]) => g);
      expect(guards).toHaveLength(7);
      const states = await prisma.$queryRaw<Array<{ tgenabled: string }>>`SELECT tgenabled::text AS tgenabled FROM pg_trigger WHERE tgname = ANY(${guards})`;
      expect(states.every((s) => s.tgenabled === 'O')).toBe(true);
      await seedAll(prisma);
      await withHistory();
      await expectDbError(prisma.$executeRawUnsafe('TRUNCATE orders CASCADE'), ANY_MESSAGE); // protected again straight away
    });

    it('and a reset that fails half way does not leave any guard disabled', async () => {
      await withHistory();
      const guards = await truncateGuards(prisma);
      await expect(
        prisma.$transaction([
          ...guards.map(([table, guard]) => prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER ${guard}`)),
          prisma.$executeRawUnsafe('TRUNCATE "this_table_does_not_exist"'),
        ]),
      ).rejects.toThrow();
      const states = await prisma.$queryRaw<Array<{ tgenabled: string }>>`SELECT tgenabled::text AS tgenabled FROM pg_trigger WHERE tgname = ANY(${guards.map(([, g]) => g)})`;
      expect(states).toHaveLength(7);
      expect(states.every((s) => s.tgenabled === 'O')).toBe(true);
      await expectDbError(prisma.$executeRawUnsafe('TRUNCATE tickets CASCADE'), ANY_MESSAGE);
    });
  });
});
