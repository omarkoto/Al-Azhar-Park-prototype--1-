import { PrismaClient } from '@prisma/client';
import { createUser } from '../helpers/auth';
import { createPaidOrder, expectDbError } from '../helpers/fixtures';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';

describe('ticket purchasing rules (database level)', () => {
  const prisma: PrismaClient = createTestPrisma();

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const row = (audience: string, type: string, dowMask: number) =>
    prisma.ticketPrice.findFirstOrThrow({ where: { audience: { code: audience }, ticketType: { code: type }, dowMask } });

  describe('overlapping prices', () => {
    it('refuses an "every day" price while a weekday price is active for the same dates', async () => {
      const wd = await row('RESIDENT', 'ADULT', 31);
      await expectDbError(
        prisma.ticketPrice.create({ data: { ticketTypeId: wd.ticketTypeId, audienceId: wd.audienceId, dowMask: 127, amountMinor: 7000, validFrom: new Date('2027-01-01') } }),
        /overlapping standard price/,
      );
    });

    it('refuses a weekend price that overlaps a different mask sharing a day, but not one sharing no day', async () => {
      const wd = await row('RESIDENT', 'ADULT', 31);
      await prisma.ticketPrice.update({ where: { id: wd.id }, data: { validTo: new Date('2026-12-31') } });
      const we = await row('RESIDENT', 'ADULT', 96);
      await prisma.ticketPrice.update({ where: { id: we.id }, data: { validTo: new Date('2026-12-31') } });
      // after both are closed, a combined every-day price from 2027 is fine
      await prisma.ticketPrice.create({ data: { ticketTypeId: wd.ticketTypeId, audienceId: wd.audienceId, dowMask: 127, amountMinor: 7000, validFrom: new Date('2027-01-01') } });
      // but Thursday–Friday (16 | 32) would now clash with it
      await expectDbError(
        prisma.ticketPrice.create({ data: { ticketTypeId: wd.ticketTypeId, audienceId: wd.audienceId, dowMask: 48, amountMinor: 1, validFrom: new Date('2027-02-01') } }),
        /overlapping standard price/,
      );
    });

    it('ignores switched-off prices, so a price can be replaced after it is deactivated', async () => {
      const wd = await row('RESIDENT', 'ADULT', 31);
      await prisma.ticketPrice.update({ where: { id: wd.id }, data: { isActive: false } });
      const next = await prisma.ticketPrice.create({ data: { ticketTypeId: wd.ticketTypeId, audienceId: wd.audienceId, dowMask: 31, amountMinor: 5200, validFrom: new Date('2026-06-01') } });
      expect(next.isActive).toBe(true);
      await expectDbError(prisma.ticketPrice.update({ where: { id: wd.id }, data: { isActive: true } }), /ex_ticket_prices_no_overlap|overlapping standard price/);
    });

    it('keeps other ticket types and audiences apart', async () => {
      const wd = await row('RESIDENT', 'ADULT', 31);
      const other = await row('VISITOR', 'CHILD', 31);
      expect(other.audienceId).not.toBe(wd.audienceId);
      await expect(prisma.ticketPrice.count()).resolves.toBe(8);
    });
  });

  describe('price history cannot be edited', () => {
    it('refuses to change the amount, the days, the start, the type or the audience of a price row', async () => {
      const r = await row('VISITOR', 'ADULT', 96);
      const other = await row('RESIDENT', 'CHILD', 31);
      for (const data of [{ amountMinor: 1 }, { dowMask: 127 }, { validFrom: new Date('2030-01-01') }, { ticketTypeId: other.ticketTypeId }, { audienceId: other.audienceId }, { priority: 5 }, { kind: 'SPECIAL' as const }]) {
        await expectDbError(prisma.ticketPrice.update({ where: { id: r.id }, data }), /cannot be edited/);
      }
      expect((await prisma.ticketPrice.findUniqueOrThrow({ where: { id: r.id } })).amountMinor).toBe(20000);
    });

    it('still lets a price be closed, switched off and annotated', async () => {
      const r = await row('VISITOR', 'ADULT', 96);
      const updated = await prisma.ticketPrice.update({ where: { id: r.id }, data: { validTo: new Date('2026-12-31'), notes: 'ends with winter' } });
      expect(updated.validTo?.toISOString().slice(0, 10)).toBe('2026-12-31');
      await prisma.ticketPrice.update({ where: { id: r.id }, data: { isActive: false } });
    });

    it('refuses to delete a price row', async () => {
      const r = await row('VISITOR', 'ADULT', 96);
      await expectDbError(prisma.ticketPrice.delete({ where: { id: r.id } }), /cannot be deleted/);
      expect(await prisma.ticketPrice.count()).toBe(8);
    });

    it('a sold order keeps its price even if the price row is switched off or closed', async () => {
      const { item, price } = await createPaidOrder(prisma, { seq: 1, visitDate: new Date('2026-10-08') });
      await prisma.ticketPrice.update({ where: { id: price.id }, data: { isActive: false, validTo: new Date('2026-12-31') } });
      const after = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(after.unitPriceMinor).toBe(item.unitPriceMinor);
      await expectDbError(prisma.orderItem.update({ where: { id: item.id }, data: { unitPriceMinor: 1, lineTotalMinor: item.quantity } }), /immutable/);
    });
  });

  describe('order cancellation record', () => {
    it('stores who cancelled an order, and keeps the order if that user is later removed', async () => {
      const { order } = await createPaidOrder(prisma, { seq: 2, visitDate: new Date('2026-10-08') });
      const user = await createUser(prisma, { role: 'OPERATIONS' });
      await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Park closed', cancelledById: user.id } });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).cancelledById).toBe(user.id);
      await prisma.user.delete({ where: { id: user.id } });
      const kept = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(kept.cancelledById).toBeNull();
      expect(kept.cancelReason).toBe('Park closed');
    });

    it('refuses to cancel without a reason', async () => {
      const { order } = await createPaidOrder(prisma, { seq: 3, visitDate: new Date('2026-10-08') });
      await expectDbError(prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: '  ' } }), /ck_orders_cancel/);
    });
  });
});
