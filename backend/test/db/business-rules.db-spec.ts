import { PrismaClient } from '@prisma/client';
import { cairoInstant } from '../helpers/cairo';
import { createPaidOrder, expectDbError, orderNumber, randomTicketRef } from '../helpers/fixtures';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import {
  CAPACITY_COUNTED_STATUSES,
  checkCapacity,
  dateToIso,
  evaluateSale,
  evaluateScan,
  parkDateOf,
  parseCapacityLimit,
  requiresTicket,
  SalesPolicy,
  SpecialHours,
  timeToHhmm,
  WeeklyHours,
} from '../../src/modules/ticketing/rules';

/**
 * The park's final ticket rules, proved against the real database and its seeded configuration:
 *   1. children under 2 need no ticket           4. no refunds
 *   2. no capacity limit now, configurable later  5. a ticket is valid only on its visit date
 *   3. same-day sales stop 1 hour before closing  6. opening hours are fully configurable
 */
describe('ticket business rules', () => {
  const prisma: PrismaClient = createTestPrisma();

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Reads opening hours and policy from the database — exactly what the sales service will do. */
  async function loadConfig() {
    const weekly: WeeklyHours[] = (await prisma.openingHour.findMany()).map((h) => ({
      dayOfWeek: h.dayOfWeek,
      opens: h.opens ? timeToHhmm(h.opens) : null,
      closes: h.closes ? timeToHhmm(h.closes) : null,
      isClosed: h.isClosed,
    }));
    const special: SpecialHours[] = (await prisma.specialHours.findMany()).map((s) => ({
      dateFrom: dateToIso(s.dateFrom),
      dateTo: dateToIso(s.dateTo),
      opens: s.opens ? timeToHhmm(s.opens) : null,
      closes: s.closes ? timeToHhmm(s.closes) : null,
      isClosed: s.isClosed,
      priority: s.priority,
      isActive: s.isActive,
    }));
    const settings = new Map((await prisma.systemSetting.findMany()).map((s) => [s.key, s.value]));
    const policy: SalesPolicy = {
      sameDayCutoffMinutesBeforeClose: Number(settings.get('booking.sameDayCutoffMinutesBeforeClose')),
      maxAdvanceDays: Number(settings.get('booking.maxAdvanceDays')),
    };
    return { weekly, special, policy };
  }

  const canSellAt = async (date: string, time: string) => {
    const { weekly, special, policy } = await loadConfig();
    return evaluateSale({ now: cairoInstant(date, time), visitDate: date, weekly, special, policy });
  };

  // ───────────────────────── Rule 1: children under 2 ─────────────────────────
  describe('1 · children under 2 do not need a ticket', () => {
    it('has no ticket type that includes a child under 2', async () => {
      const types = await prisma.ticketType.findMany();
      for (const age of [0, 0.5, 1, 1.9]) {
        const covered = types.filter((t) => age >= t.minAge && (t.maxAge === null || age <= t.maxAge));
        expect(covered).toHaveLength(0);
        expect(requiresTicket(age)).toBe(false);
      }
      for (const age of [2, 8, 9, 60]) {
        expect(types.some((t) => age >= t.minAge && (t.maxAge === null || age <= t.maxAge))).toBe(true);
        expect(requiresTicket(age)).toBe(true);
      }
    });

    it('refuses a ticket type that starts below age 2', async () => {
      for (const minAge of [0, 1]) {
        await expectDbError(
          prisma.ticketType.create({ data: { code: `INFANT${minAge}`, nameEn: 'Infant', nameAr: 'رضيع', minAge } }),
          /ck_ticket_types_min_age/,
        );
      }
      const ok = await prisma.ticketType.create({ data: { code: 'TODDLER', nameEn: 'Toddler', nameAr: 'x', minAge: 2, maxAge: 3 } });
      expect(ok.minAge).toBe(2);
    });

    it('never allows a 0 EGP price, order, order item, payment or ticket', async () => {
      const base = await prisma.ticketPrice.findFirstOrThrow({ where: { ticketType: { code: 'ADULT' } } });
      await expectDbError(
        prisma.ticketPrice.create({ data: { ticketTypeId: base.ticketTypeId, audienceId: base.audienceId, dowMask: 1, amountMinor: 0, validFrom: new Date('2040-01-01') } }),
        /ck_ticket_prices_amount/,
      );

      const visit = new Date('2026-10-10');
      await expectDbError(
        prisma.order.create({ data: { orderNumber: orderNumber(900), channel: 'ONLINE', visitDate: visit, subtotalMinor: 0, totalMinor: 0 } }),
        /ck_orders_money/,
      );

      const { order, item, type, audience, price } = await createPaidOrder(prisma, { seq: 1, visitDate: visit });
      await expectDbError(
        prisma.orderItem.create({
          data: {
            orderId: order.id, ticketTypeId: type.id, audienceId: audience.id, ticketPriceId: price.id,
            typeNameEn: 'x', typeNameAr: 'x', audienceNameEn: 'x', audienceNameAr: 'x', unitPriceMinor: 0, quantity: 1, lineTotalMinor: 0,
          },
        }),
        /ck_order_items_money/,
      );
      await expectDbError(prisma.payment.create({ data: { orderId: order.id, provider: 'MANUAL', method: 'CASH', amountMinor: 0 } }), /ck_payments_amount/);
      await expectDbError(
        prisma.ticket.create({
          data: { publicRef: randomTicketRef(), orderId: order.id, orderItemId: item.id, ticketTypeId: type.id, audienceId: audience.id, visitDate: visit, pricePaidMinor: 0 },
        }),
        /ck_tickets_price/,
      );
    });

    it('has no zero-priced row in the seeded price list', async () => {
      expect(await prisma.ticketPrice.count({ where: { amountMinor: { lte: 0 } } })).toBe(0);
    });
  });

  // ───────────────────────── Rule 2: capacity ─────────────────────────
  describe('2 · no daily capacity limit now; one can be switched on later', () => {
    const visit = new Date('2026-10-10');

    const issuedFor = (date: Date) => prisma.ticket.count({ where: { visitDate: date, status: { in: [...CAPACITY_COUNTED_STATUSES] } } });
    const configuredLimit = async () => parseCapacityLimit((await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'capacity.dailyLimit' } })).value);

    it('is unlimited as seeded', async () => {
      await createPaidOrder(prisma, { seq: 1, visitDate: visit, quantity: 3 });
      const limit = await configuredLimit();
      expect(limit).toBeNull();
      expect(checkCapacity({ limit, alreadyTicketed: await issuedFor(visit), requested: 100_000 })).toEqual({ ok: true, remaining: null });
    });

    it('starts enforcing the moment a limit is configured — a setting change only, no schema change', async () => {
      await createPaidOrder(prisma, { seq: 1, visitDate: visit, quantity: 3 });
      await prisma.systemSetting.update({ where: { key: 'capacity.dailyLimit' }, data: { value: 3 } });

      const limit = await configuredLimit();
      expect(limit).toBe(3);
      expect(checkCapacity({ limit, alreadyTicketed: await issuedFor(visit), requested: 1 })).toEqual({ ok: false, remaining: 0 });
      // a different day has its own capacity
      expect(checkCapacity({ limit, alreadyTicketed: await issuedFor(new Date('2026-10-11')), requested: 3 }).ok).toBe(true);
    });

    it('frees capacity when a ticket is cancelled', async () => {
      const { tickets } = await createPaidOrder(prisma, { seq: 1, visitDate: visit, quantity: 3 });
      await prisma.systemSetting.update({ where: { key: 'capacity.dailyLimit' }, data: { value: 3 } });
      expect(checkCapacity({ limit: 3, alreadyTicketed: await issuedFor(visit), requested: 1 }).ok).toBe(false);

      await prisma.ticket.update({ where: { id: tickets[0].id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'operational' } });
      expect(await issuedFor(visit)).toBe(2);
      expect(checkCapacity({ limit: 3, alreadyTicketed: await issuedFor(visit), requested: 1 })).toEqual({ ok: true, remaining: 0 });
    });

    it('counts used tickets too (someone who already entered still occupies the day)', async () => {
      await createPaidOrder(prisma, { seq: 1, visitDate: visit, quantity: 2, ticketStatus: 'USED' });
      expect(await issuedFor(visit)).toBe(2);
    });

    it('rejects an invalid limit in settings instead of silently treating it as unlimited', async () => {
      await prisma.systemSetting.update({ where: { key: 'capacity.dailyLimit' }, data: { value: 'lots' } });
      await expect(configuredLimit()).rejects.toThrow(/capacity\.dailyLimit/);
    });
  });

  // ───────────────────────── Rule 3 + 6: same-day cut-off and opening hours ─────────────────────────
  describe('3 · same-day tickets stop exactly 1 hour before closing (from the configured hours)', () => {
    const sunday = '2026-10-04';
    const friday = '2026-10-09';

    it('uses the seeded 09:00–22:00 hours: 20:59:59 sells, 21:00:00 does not', async () => {
      expect(await canSellAt(sunday, '20:59:59')).toMatchObject({ allowed: true });
      expect(await canSellAt(sunday, '21:00:00')).toEqual({ allowed: false, reason: 'SALES_CLOSED_FOR_TODAY' });
    });

    it('moves the cut-off when an administrator changes that day’s closing time', async () => {
      await prisma.openingHour.update({ where: { dayOfWeek: 5 }, data: { closes: new Date('1970-01-01T23:30:00Z') } }); // Friday
      expect(await canSellAt(friday, '22:29:59')).toMatchObject({ allowed: true });
      expect(await canSellAt(friday, '22:30:00')).toMatchObject({ allowed: false });
      expect(await canSellAt(sunday, '22:00:00')).toMatchObject({ allowed: false }); // other days unchanged
    });

    it('follows special hours such as Ramadan, without touching the weekly hours', async () => {
      await prisma.specialHours.create({
        data: {
          kind: 'SPECIAL_HOURS', dateFrom: new Date(sunday), dateTo: new Date(sunday), labelEn: 'Event night', labelAr: 'ليلة خاصة',
          opens: new Date('1970-01-01T10:00:00Z'), closes: new Date('1970-01-01T23:59:00Z'), priority: 5,
        },
      });
      expect(await canSellAt(sunday, '22:58:59')).toMatchObject({ allowed: true });
      expect(await canSellAt(sunday, '22:59:00')).toMatchObject({ allowed: false });
      expect(await canSellAt('2026-10-05', '21:00:00')).toMatchObject({ allowed: false }); // next day: normal hours
    });

    it('sells nothing on a temporary closure or holiday, and resumes afterwards', async () => {
      await prisma.specialHours.create({
        data: { kind: 'TEMPORARY_CLOSURE', dateFrom: new Date('2026-10-06'), dateTo: new Date('2026-10-06'), isClosed: true, labelEn: 'Maintenance', labelAr: 'صيانة' },
      });
      const { weekly, special, policy } = await loadConfig();
      const now = cairoInstant(sunday, '10:00');
      expect(evaluateSale({ now, visitDate: '2026-10-06', weekly, special, policy })).toEqual({ allowed: false, reason: 'PARK_CLOSED' });
      expect(evaluateSale({ now, visitDate: '2026-10-07', weekly, special, policy })).toMatchObject({ allowed: true });
    });

    it('reads the 60-minute rule from system settings (changing the setting changes the cut-off)', async () => {
      await prisma.systemSetting.update({ where: { key: 'booking.sameDayCutoffMinutesBeforeClose' }, data: { value: 45 } });
      expect(await canSellAt(sunday, '21:14:59')).toMatchObject({ allowed: true });
      expect(await canSellAt(sunday, '21:15:00')).toMatchObject({ allowed: false });
    });

    it('still sells future days late in the evening', async () => {
      expect(await canSellAt(sunday, '23:45:00')).toMatchObject({ allowed: false });
      const { weekly, special, policy } = await loadConfig();
      expect(evaluateSale({ now: cairoInstant(sunday, '23:45:00'), visitDate: '2026-10-05', weekly, special, policy })).toMatchObject({ allowed: true });
    });
  });

  // ───────────────────────── Rule 4: no refunds ─────────────────────────
  describe('4 · there are no refunds (cancelling is not refunding)', () => {
    const visit = new Date('2026-10-10');
    const cancellation = { cancelledAt: new Date(), cancelReason: 'Cancelled by an administrator for an operational reason' };

    it('does not let a paid order become REFUNDED', async () => {
      const { order } = await createPaidOrder(prisma, { seq: 1, visitDate: visit });
      await expectDbError(prisma.order.update({ where: { id: order.id }, data: { status: 'REFUNDED' } }), /illegal order status change/);
    });

    it('does not let a valid ticket become REFUNDED', async () => {
      const { tickets } = await createPaidOrder(prisma, { seq: 1, visitDate: visit });
      await expectDbError(prisma.ticket.update({ where: { id: tickets[0].id }, data: { status: 'REFUNDED' } }), /illegal ticket status change/);
    });

    it('does not let a paid payment become REFUNDED, or be reversed in any way', async () => {
      const { order } = await createPaidOrder(prisma, { seq: 1, visitDate: visit });
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      for (const status of ['REFUNDED', 'FAILED', 'CANCELLED', 'PENDING'] as const) {
        await expectDbError(prisma.payment.update({ where: { id: payment.id }, data: { status } }), /illegal payment status change|ck_payments_no_refund/);
      }
    });

    it('cannot even create a row that is already REFUNDED', async () => {
      await expectDbError(
        prisma.order.create({ data: { orderNumber: orderNumber(5), channel: 'ONLINE', status: 'REFUNDED', visitDate: visit, subtotalMinor: 5000, totalMinor: 5000 } }),
        /ck_orders_no_refund/,
      );
      const { order, item, type, audience } = await createPaidOrder(prisma, { seq: 2, visitDate: visit });
      await expectDbError(
        prisma.ticket.create({
          data: { publicRef: randomTicketRef(), orderId: order.id, orderItemId: item.id, ticketTypeId: type.id, audienceId: audience.id, visitDate: visit, pricePaidMinor: 5000, status: 'REFUNDED' },
        }),
        /ck_tickets_no_refund/,
      );
      await expectDbError(prisma.payment.create({ data: { orderId: order.id, provider: 'MANUAL', method: 'CASH', amountMinor: 5000, status: 'REFUNDED' } }), /ck_payments_no_refund/);
    });

    it('has no refund permission, and no role can refund', async () => {
      expect(await prisma.permission.count({ where: { code: { contains: 'refund' } } })).toBe(0);
    });

    it('lets an authorised admin CANCEL a paid order and its tickets for an operational reason — and the payment stays PAID', async () => {
      const { order, tickets } = await createPaidOrder(prisma, { seq: 1, visitDate: visit, quantity: 2 });
      await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', ...cancellation } });
      await prisma.ticket.updateMany({ where: { orderId: order.id }, data: { status: 'CANCELLED', ...cancellation } });

      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
      for (const t of tickets) expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('CANCELLED');
      // the system does not move money back: the recorded payment is untouched
      expect((await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe('PAID');
    });

    it('requires a reason and timestamp for every cancellation', async () => {
      const { order, tickets } = await createPaidOrder(prisma, { seq: 1, visitDate: visit });
      await expectDbError(prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } }), /ck_orders_cancel/);
      await expectDbError(prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: '   ' } }), /ck_orders_cancel/);
      await expectDbError(prisma.ticket.update({ where: { id: tickets[0].id }, data: { status: 'CANCELLED' } }), /ck_tickets_cancel/);
    });

    it('keeps a cancelled order cancelled (it cannot be silently re-opened)', async () => {
      const { order } = await createPaidOrder(prisma, { seq: 1, visitDate: visit });
      await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', ...cancellation } });
      await expectDbError(prisma.order.update({ where: { id: order.id }, data: { status: 'PAID' } }), /illegal order status change/);
    });

    it('follows the allowed order lifecycle: PENDING_PAYMENT → PAID, and nothing else after EXPIRED', async () => {
      const pending = await prisma.order.create({ data: { orderNumber: orderNumber(7), channel: 'ONLINE', visitDate: visit, subtotalMinor: 5000, totalMinor: 5000 } });
      expect(pending.status).toBe('PENDING_PAYMENT');
      expect((await prisma.order.update({ where: { id: pending.id }, data: { status: 'PAID', paidAt: new Date() } })).status).toBe('PAID');

      const stale = await prisma.order.create({ data: { orderNumber: orderNumber(8), channel: 'ONLINE', visitDate: visit, subtotalMinor: 5000, totalMinor: 5000 } });
      await prisma.order.update({ where: { id: stale.id }, data: { status: 'EXPIRED' } });
      await expectDbError(prisma.order.update({ where: { id: stale.id }, data: { status: 'PAID' } }), /illegal order status change/);
    });
  });

  // ───────────────────────── Rule 5: valid only on the visit date ─────────────────────────
  describe('5 · a ticket is valid only on its visit date', () => {
    // exactly the statement the scan service will run, with the scan instant made explicit so tests can pick it
    const claimAt = (ticketId: string, staffId: string, instant: Date) =>
      prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE tickets
           SET status = 'USED'::ticket_status, used_at = ${instant}::timestamptz, used_by_id = ${staffId}::uuid
         WHERE id = ${ticketId}::uuid AND status = 'VALID' AND visit_date = azharpark_date_of(${instant}::timestamptz)
        RETURNING id`;

    const staffId = async () => (await prisma.user.findUniqueOrThrow({ where: { email: 'staff@azharpark.test' } })).id;

    it('rejects a ticket for 10 October scanned on 11 October — even one second after midnight', async () => {
      const { tickets } = await createPaidOrder(prisma, { seq: 1, visitDate: new Date('2026-10-10'), quantity: 4 });
      const staff = await staffId();

      expect(await claimAt(tickets[0].id, staff, cairoInstant('2026-10-11', '00:00:01'))).toHaveLength(0);
      expect(await claimAt(tickets[1].id, staff, cairoInstant('2026-10-11', '12:00:00'))).toHaveLength(0);
      expect(await claimAt(tickets[2].id, staff, cairoInstant('2026-10-09', '23:59:59'))).toHaveLength(0);

      // the same tickets are still VALID: a refused scan changes nothing
      for (const t of tickets.slice(0, 3)) expect((await prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('VALID');
      // and the right day works, from the first second to the last
      expect(await claimAt(tickets[3].id, staff, cairoInstant('2026-10-10', '00:00:00'))).toHaveLength(1);
    });

    it('admits a ticket at the last second of its day', async () => {
      const { tickets } = await createPaidOrder(prisma, { seq: 1, visitDate: new Date('2026-10-10') });
      expect(await claimAt(tickets[0].id, await staffId(), cairoInstant('2026-10-10', '23:59:59'))).toHaveLength(1);
    });

    it('agrees with the readable rule (evaluateScan) at every tricky instant', async () => {
      const instants = [
        cairoInstant('2026-10-09', '23:59:59'), cairoInstant('2026-10-10', '00:00:00'), cairoInstant('2026-10-10', '12:00:00'),
        cairoInstant('2026-10-10', '23:59:59'), cairoInstant('2026-10-11', '00:00:01'), new Date('2026-10-09T21:30:00Z'), new Date('2026-10-10T21:30:00Z'),
      ];
      for (const instant of instants) {
        const { tickets } = await createPaidOrder(prisma, { seq: Math.floor(Math.random() * 900_000) + 1, visitDate: new Date('2026-10-10') });
        const dbAdmits = (await claimAt(tickets[0].id, await staffId(), instant)).length === 1;
        const ruleAdmits = evaluateScan({ status: 'VALID', visitDate: '2026-10-10' }, instant) === 'OK';
        expect(dbAdmits).toBe(ruleAdmits);
      }
    });

    it('computes the Cairo calendar day the same way as PostgreSQL across both daylight-saving changes', async () => {
      const windows: Array<[string, string]> = [
        ['2026-04-20T00:00:00Z', '2026-04-30T00:00:00Z'], // Egypt DST starts (last Friday of April)
        ['2026-10-25T00:00:00Z', '2026-11-03T00:00:00Z'], // DST ends (last Thursday of October)
        ['2027-04-26T00:00:00Z', '2027-05-04T00:00:00Z'],
        ['2027-10-25T00:00:00Z', '2027-11-03T00:00:00Z'],
      ];
      let compared = 0;
      for (const [from, to] of windows) {
        const rows = await prisma.$queryRaw<Array<{ ts: Date; d: string }>>`
          SELECT ts, azharpark_date_of(ts)::text AS d
            FROM generate_series(${from}::timestamptz, ${to}::timestamptz, interval '15 minutes') AS ts`;
        for (const r of rows) {
          expect(parkDateOf(r.ts)).toBe(r.d);
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(2000);
    });
  });

  // ───────────────────────── Rule 6: opening hours default and flexibility ─────────────────────────
  describe('6 · opening hours: 09:00–22:00 every day, fully configurable', () => {
    it('is 09:00–22:00 on all seven days by default, one row per weekday', async () => {
      const { weekly } = await loadConfig();
      expect(weekly).toHaveLength(7);
      for (const w of weekly) expect(w).toMatchObject({ opens: '09:00', closes: '22:00', isClosed: false });
    });

    it('lets Friday, a holiday, Ramadan and a closure each differ — all as data', async () => {
      await prisma.openingHour.update({ where: { dayOfWeek: 5 }, data: { opens: new Date('1970-01-01T10:00:00Z'), closes: new Date('1970-01-01T23:00:00Z') } });
      await prisma.specialHours.createMany({
        data: [
          { kind: 'HOLIDAY', dateFrom: new Date('2027-03-10'), dateTo: new Date('2027-03-12'), opens: new Date('1970-01-01T08:00:00Z'), closes: new Date('1970-01-01T23:59:00Z'), labelEn: 'Eid', labelAr: 'العيد', priority: 10 },
          { kind: 'SPECIAL_HOURS', dateFrom: new Date('2027-02-08'), dateTo: new Date('2027-03-09'), opens: new Date('1970-01-01T10:00:00Z'), closes: new Date('1970-01-01T23:30:00Z'), labelEn: 'Ramadan', labelAr: 'رمضان', priority: 5 },
          { kind: 'TEMPORARY_CLOSURE', dateFrom: new Date('2027-05-01'), dateTo: new Date('2027-05-02'), isClosed: true, labelEn: 'Closed', labelAr: 'مغلق' },
        ],
      });
      expect(await prisma.specialHours.count()).toBe(3);
      expect((await prisma.openingHour.findUniqueOrThrow({ where: { dayOfWeek: 5 } })).closes?.toISOString().slice(11, 16)).toBe('23:00');
    });
  });
});
