import { PrismaClient } from '@prisma/client';
import { createPaidOrder, expectDbError } from '../helpers/fixtures';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';

describe('ticket delivery rules (database level)', () => {
  const prisma: PrismaClient = createTestPrisma();

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const message = (over: Record<string, unknown> = {}) => ({ channel: 'EMAIL' as const, template: 'order_confirmation', recipient: 'a@example.com', payload: {}, ...over });

  it('queues one message per purpose: the same key twice is refused', async () => {
    await prisma.notification.create({ data: message({ dedupeKey: 'order_confirmation:abc' }) });
    await expectDbError(prisma.notification.create({ data: message({ dedupeKey: 'order_confirmation:abc' }) }), /Unique constraint|dedupe_key/i);
    await prisma.notification.create({ data: message({ dedupeKey: 'order_confirmation:abc:resend:1' }) });
    // messages without a key (other uses of the outbox) are not limited
    await prisma.notification.create({ data: message() });
    await prisma.notification.create({ data: message() });
  });

  it('never has a negative attempt count', async () => {
    await expectDbError(prisma.notification.create({ data: message({ attempts: -1 }) }), /ck_notifications_attempts/);
  });

  it('keeps only the two languages the site speaks', async () => {
    const { order } = await createPaidOrder(prisma, { seq: 1, visitDate: new Date('2026-10-08') });
    expect(order.locale).toBe('en');
    await prisma.$executeRaw`UPDATE orders SET locale = 'ar' WHERE id = ${order.id}::uuid`;
    await expectDbError(prisma.$executeRaw`UPDATE orders SET locale = 'fr' WHERE id = ${order.id}::uuid`, /ck_orders_locale/);
  });

  it('a ticket that was used or cancelled can never be valid again', async () => {
    for (const status of ['USED', 'CANCELLED'] as const) {
      const { tickets } = await createPaidOrder(prisma, { seq: status === 'USED' ? 2 : 3, visitDate: new Date('2026-10-08'), ticketStatus: status });
      await expectDbError(prisma.ticket.update({ where: { id: tickets[0].id }, data: { status: 'VALID' } }), /illegal ticket status change/);
    }
  });
});

describe('gate scan records (database level)', () => {
  const prisma: PrismaClient = createTestPrisma();
  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('keeps only the precise result codes the scanner uses', async () => {
    const staff = await prisma.user.findFirstOrThrow();
    const row = (detail: string | null) => ({ scannedById: staff.id, result: 'INVALID' as const, reason: 'INVALID_TOKEN' as const, detail });
    await prisma.ticketScan.create({ data: row('INVALID_SIGNATURE') });
    await prisma.ticketScan.create({ data: row(null) }); // rows from before Phase 8
    await expectDbError(prisma.ticketScan.create({ data: row('MADE_UP') }), /ck_ticket_scans_detail/);
  });

  it('claims a ticket for the Cairo day of the instant it is given, exactly once', async () => {
    const { tickets } = await createPaidOrder(prisma, { seq: 9, visitDate: new Date('2026-10-07') });
    const staff = await prisma.user.findFirstOrThrow();
    const claim = (at: string) => prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE tickets SET status = 'USED'::ticket_status, used_at = ${new Date(at)}::timestamptz, used_by_id = ${staff.id}::uuid
       WHERE id = ${tickets[0].id}::uuid AND status = 'VALID'::ticket_status AND visit_date = azharpark_date_of(${new Date(at)}::timestamptz)
      RETURNING id`;
    expect(await claim('2026-10-07T21:30:00Z')).toHaveLength(0); // already the 8th in Cairo (UTC+3), although UTC still says the 7th
    expect(await claim('2026-10-06T21:30:00Z')).toHaveLength(1); // already the 7th in Cairo, although UTC still says the 6th
    expect(await claim('2026-10-06T21:30:00Z')).toHaveLength(0); // and only once
  });
});
