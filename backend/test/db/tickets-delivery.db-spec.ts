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
