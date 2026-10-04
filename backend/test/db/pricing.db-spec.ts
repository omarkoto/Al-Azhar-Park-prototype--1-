import { PrismaClient } from '@prisma/client';
import { addDays, cairoToday, createPaidOrder, expectDbError } from '../helpers/fixtures';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';

describe('ticket pricing rules (database level)', () => {
  const prisma: PrismaClient = createTestPrisma();

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const residentAdultWeekday = () =>
    prisma.ticketPrice.findFirstOrThrow({ where: { amountMinor: 5000, dowMask: 31, audience: { code: 'RESIDENT' }, ticketType: { code: 'ADULT' } } });

  describe('no ambiguous prices', () => {
    it('rejects a second standard price that overlaps in dates for the same type, audience and weekdays', async () => {
      const base = await residentAdultWeekday();
      await expectDbError(
        prisma.ticketPrice.create({
          data: { ticketTypeId: base.ticketTypeId, audienceId: base.audienceId, dowMask: 31, amountMinor: 9999, validFrom: new Date('2027-01-01') },
        }),
        /ex_ticket_prices_no_overlap/,
      );
    });

    it('allows a new price once the old one has been closed (price change = close + insert)', async () => {
      const base = await residentAdultWeekday();
      await prisma.ticketPrice.update({ where: { id: base.id }, data: { validTo: new Date('2026-12-31') } });
      const next = await prisma.ticketPrice.create({
        data: { ticketTypeId: base.ticketTypeId, audienceId: base.audienceId, dowMask: 31, amountMinor: 5500, validFrom: new Date('2027-01-01') },
      });
      expect(next.amountMinor).toBe(5500);
    });

    it('still rejects a replacement that starts before the old price ends', async () => {
      const base = await residentAdultWeekday();
      await prisma.ticketPrice.update({ where: { id: base.id }, data: { validTo: new Date('2026-12-31') } });
      await expectDbError(
        prisma.ticketPrice.create({
          data: { ticketTypeId: base.ticketTypeId, audienceId: base.audienceId, dowMask: 31, amountMinor: 5500, validFrom: new Date('2026-12-31') },
        }),
        /ex_ticket_prices_no_overlap/,
      );
    });

    it('allows the weekend price to coexist with the weekday price (different weekday mask)', async () => {
      // the seed already has both; this documents the rule
      expect(await prisma.ticketPrice.count({ where: { audience: { code: 'RESIDENT' }, ticketType: { code: 'ADULT' } } })).toBe(2);
    });

    it('allows holiday (special-date) and promotional prices to layer on top by priority', async () => {
      const base = await residentAdultWeekday();
      const holiday = await prisma.ticketPrice.create({
        data: {
          ticketTypeId: base.ticketTypeId, audienceId: base.audienceId, kind: 'SPECIAL', priority: 10,
          dowMask: 127, specialDates: [new Date('2027-03-10'), new Date('2027-03-11')],
          amountMinor: 8000, validFrom: new Date('2027-03-01'), validTo: new Date('2027-03-31'), nameEn: 'Eid',
        },
      });
      const promo = await prisma.ticketPrice.create({
        data: {
          ticketTypeId: base.ticketTypeId, audienceId: base.audienceId, kind: 'PROMOTIONAL', priority: 20,
          promoCode: 'SPRING', amountMinor: 4000, validFrom: new Date('2027-03-01'), validTo: new Date('2027-04-30'),
        },
      });
      expect(holiday.kind).toBe('SPECIAL');
      expect(promo.priority).toBeGreaterThan(holiday.priority);
    });

    it('never lets a list column be NULL (a NULL would silently bypass the overlap rule)', async () => {
      const base = await residentAdultWeekday();
      await expectDbError(
        prisma.$executeRaw`INSERT INTO ticket_prices (id, ticket_type_id, audience_id, kind, amount_minor, valid_from, special_dates, updated_at)
          VALUES (gen_random_uuid(), ${base.ticketTypeId}::uuid, ${base.audienceId}::uuid, 'STANDARD', 1, DATE '2031-01-01', NULL, now())`,
        /23502|null value|not-null/i, // PostgreSQL's not_null_violation
      );
    });

    it('requires a SPECIAL price to name its dates', async () => {
      const base = await residentAdultWeekday();
      await expectDbError(
        prisma.ticketPrice.create({
          data: { ticketTypeId: base.ticketTypeId, audienceId: base.audienceId, kind: 'SPECIAL', priority: 10, amountMinor: 1, validFrom: new Date('2027-03-01') },
        }),
        /ck_ticket_prices_special/,
      );
    });
  });

  describe('sanity checks', () => {
    it.each([
      ['a negative amount', { amountMinor: -1, validFrom: new Date('2030-01-01') }, /ck_ticket_prices_amount/],
      ['a zero price (there are no free tickets)', { amountMinor: 0, validFrom: new Date('2030-01-01') }, /ck_ticket_prices_amount/],
      ['an empty weekday mask', { amountMinor: 1, dowMask: 0, validFrom: new Date('2030-01-01') }, /ck_ticket_prices_dow/],
      ['a weekday mask above 127', { amountMinor: 1, dowMask: 200, validFrom: new Date('2030-01-01') }, /ck_ticket_prices_dow/],
      ['an end date before the start date', { amountMinor: 1, validFrom: new Date('2030-02-01'), validTo: new Date('2030-01-01') }, /ck_ticket_prices_range/],
    ])('rejects %s', async (_label, data, pattern) => {
      const base = await residentAdultWeekday();
      await expectDbError(prisma.ticketPrice.create({ data: { ticketTypeId: base.ticketTypeId, audienceId: base.audienceId, ...data } }), pattern);
    });
  });

  describe('history is preserved', () => {
    it('keeps what a customer paid even after the price is raised', async () => {
      const today = await cairoToday(prisma);
      const { order, item, tickets, price } = await createPaidOrder(prisma, { visitDate: addDays(today, 2), quantity: 2, unitPriceMinor: 5000 });

      // admin raises the price: close the old row, add a new one at 75 EGP
      await prisma.ticketPrice.update({ where: { id: price.id }, data: { validTo: addDays(today, 1) } });
      const raised = await prisma.ticketPrice.create({
        data: { ticketTypeId: price.ticketTypeId, audienceId: price.audienceId, dowMask: price.dowMask, amountMinor: 7500, validFrom: addDays(today, 2) },
      });
      expect(raised.amountMinor).toBe(7500);

      // the old order, item and tickets still show exactly what was paid
      const reloadedItem = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
      expect(reloadedItem.unitPriceMinor).toBe(5000);
      expect(reloadedItem.lineTotalMinor).toBe(10000);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).totalMinor).toBe(10000);
      for (const t of tickets) expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).pricePaidMinor).toBe(5000);
      // and the order still points at the exact price row it used
      expect(reloadedItem.ticketPriceId).toBe(price.id);
    });

    it('refuses to rewrite a price paid, on the order item, the order or the ticket', async () => {
      const today = await cairoToday(prisma);
      const { order, item, tickets } = await createPaidOrder(prisma, { visitDate: today, quantity: 1 });
      await expectDbError(prisma.orderItem.update({ where: { id: item.id }, data: { unitPriceMinor: 1 } }), /order_items are immutable/);
      await expectDbError(prisma.orderItem.update({ where: { id: item.id }, data: { quantity: 9 } }), /order_items are immutable/);
      await expectDbError(prisma.order.update({ where: { id: order.id }, data: { totalMinor: 1, subtotalMinor: 1 } }), /immutable/);
      await expectDbError(prisma.ticket.update({ where: { id: tickets[0].id }, data: { pricePaidMinor: 1 } }), /immutable/);
    });

    it('does not let a price row be deleted while orders reference it', async () => {
      const today = await cairoToday(prisma);
      const { price } = await createPaidOrder(prisma, { visitDate: today });
      await expectDbError(prisma.ticketPrice.delete({ where: { id: price.id } }), /foreign key|violat/i);
    });
  });
});
