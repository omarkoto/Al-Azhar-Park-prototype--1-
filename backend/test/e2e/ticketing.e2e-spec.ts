import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { Clock } from '../../src/common/clock';
import { OrderLifecycleService } from '../../src/modules/ticketing/order-lifecycle.service';
import { cairoInstant } from '../helpers/cairo';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { createTestApp, TestClock } from '../helpers/app';
import { API, login, nextIp } from '../helpers/auth';

// "Today" in these tests is Wednesday 7 October 2026, 12:00 in Cairo. Thursday 8 is a weekday, Friday 9 a weekend day.
const TODAY = '2026-10-07';
const NOON = () => cairoInstant(TODAY, '12:00');

describe('ticket purchasing (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let clock: TestClock;
  const tokens: Record<string, string> = {};

  type Method = 'get' | 'post' | 'put' | 'delete';
  const call = (method: Method, path: string, as?: string, body?: object, headers: Record<string, string> = {}) =>
    request(app.getHttpServer())[method](`${API}${path}`).set('X-Forwarded-For', nextIp()).set(as ? { Authorization: `Bearer ${tokens[as]}` } : {}).set(headers).send(body);
  const audit = (action: string) => prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });

  const customer = { fullName: 'Mona Hassan', email: 'mona@example.com', phone: '+201001234567' };
  const body = (over: Record<string, unknown> = {}) => ({
    visitDate: '2026-10-08', audience: 'RESIDENT', items: [{ ticketType: 'ADULT', quantity: 2 }, { ticketType: 'CHILD', quantity: 1 }], customer, acceptTerms: true, locale: 'en', ...over,
  });
  const placeOrder = (over: Record<string, unknown> = {}, headers: Record<string, string> = {}) => call('post', '/public/orders', undefined, body(over), headers);
  const created = async (over: Record<string, unknown> = {}) => (await placeOrder(over).expect(201)).body.data as {
    order: { orderNumber: string; status: string; totalMinor: number; expiresAt: string; tickets: unknown[] };
    accessToken: string;
    payment: { providerTxnId: string; amountMinor: number; status: string };
  };
  const viewOrder = (orderNumber: string, token: string) => call('get', `/public/orders/${orderNumber}`, undefined, undefined, { 'X-Order-Token': token });
  const complete = (txn: string, payload: Record<string, unknown> = { outcome: 'SUCCESS' }) => call('post', `/public/payments/mock/${txn}/complete`, undefined, payload);
  const quote = (over: Record<string, unknown> = {}) => call('post', '/public/orders/quote', undefined, { ...body(over), customer: undefined, acceptTerms: undefined, locale: undefined });
  const setHours = async (dayOfWeek: number, closes: string) => prisma.openingHour.update({ where: { dayOfWeek }, data: { closes: new Date(`1970-01-01T${closes}:00Z`) } });

  beforeAll(async () => {
    prisma = createTestPrisma(8);
    app = await createTestApp({ TRUST_PROXY: '1' });
    clock = app.get(Clock) as TestClock;
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
    clock.set(NOON());
    for (const [k, e] of [['admin', 'admin@azharpark.test'], ['ops', 'operations@azharpark.test'], ['analyst', 'analyst@azharpark.test'], ['staff', 'staff@azharpark.test'], ['content', 'content@azharpark.test']] as const) {
      tokens[k] = (await login(app, e)).accessToken;
    }
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────── catalog and pricing ─────────────────────────────

  describe('catalog', () => {
    it('lists the audiences, the ticket types and the booking rules — and never an under-2 ticket', async () => {
      const d = (await call('get', '/public/tickets/catalog').expect(200)).body.data;
      expect(d.audiences.map((a: { code: string }) => a.code)).toEqual(['RESIDENT', 'VISITOR']);
      expect(d.ticketTypes.map((t: { code: string }) => t.code)).toEqual(['ADULT', 'CHILD']);
      expect(d.ticketTypes.every((t: { minAge: number }) => t.minAge >= 2)).toBe(true);
      expect(d.freeUnderAge).toBe(2);
      expect(d.policy).toEqual({ maxAdvanceDays: 90, sameDayCutoffMinutesBeforeClose: 60, maxTicketsPerOrder: 50, pendingExpiryMinutes: 30 });
      expect(d.today).toBe(TODAY);
      expect(d.lastBookableDate).toBe('2027-01-05');
      expect(d.onlinePayment).toBe(true);
      expect(d.day).toBeNull();
      const cell = (a: string, ty: string) => d.priceList.find((p: { audience: string; ticketType: string }) => p.audience === a && p.ticketType === ty);
      expect(cell('RESIDENT', 'ADULT')).toMatchObject({ weekdayMinor: 5000, weekendMinor: 6000 });
      expect(cell('VISITOR', 'CHILD')).toMatchObject({ weekdayMinor: 10000, weekendMinor: 15000 });
      expect(d.priceList).toHaveLength(4);
    });

    it('returns the seeded prices from the database: weekday Sunday–Thursday, weekend Friday–Saturday', async () => {
      const prices = async (date: string) => {
        const day = (await call('get', `/public/tickets/catalog?date=${date}`).expect(200)).body.data.day;
        const at = (a: string, t: string) => day.prices.find((p: { audience: string; ticketType: string }) => p.audience === a && p.ticketType === t).amountMinor;
        return [at('RESIDENT', 'ADULT'), at('RESIDENT', 'CHILD'), at('VISITOR', 'ADULT'), at('VISITOR', 'CHILD')];
      };
      expect(await prices('2026-10-11')).toEqual([5000, 3500, 15000, 10000]); // Sunday
      expect(await prices('2026-10-08')).toEqual([5000, 3500, 15000, 10000]); // Thursday
      expect(await prices('2026-10-09')).toEqual([6000, 4000, 20000, 15000]); // Friday
      expect(await prices('2026-10-10')).toEqual([6000, 4000, 20000, 15000]); // Saturday
      const day = (await call('get', '/public/tickets/catalog?date=2026-10-09').expect(200)).body.data.day;
      expect(day).toMatchObject({ dayType: 'WEEKEND', opens: '09:00', closes: '22:00', sale: { allowed: true, salesCloseAt: null } });
    });

    it('says why a date cannot be booked, with no prices', async () => {
      const reason = async (date: string) => (await call('get', `/public/tickets/catalog?date=${date}`).expect(200)).body.data.day;
      expect(await reason('2026-10-06')).toMatchObject({ sale: { allowed: false, reason: 'DATE_IN_THE_PAST' }, prices: [] });
      expect(await reason('2027-01-06')).toMatchObject({ sale: { allowed: false, reason: 'DATE_TOO_FAR_AHEAD' } });
      await call('get', '/public/tickets/catalog?date=2026-02-30').expect(400);
    });

    it('is open to everyone without logging in and is never cached', async () => {
      const res = await call('get', '/public/tickets/catalog').expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
    });
  });

  describe('quote', () => {
    it('prices a weekday resident order from the database', async () => {
      const q = (await quote().expect(200)).body.data;
      expect(q).toMatchObject({ visitDate: '2026-10-08', dayType: 'WEEKDAY', currency: 'EGP', totalTickets: 3, totalMinor: 2 * 5000 + 3500, expiresInMinutes: 30 });
      expect(q.lines).toEqual([
        { ticketType: 'ADULT', nameEn: 'Adult', nameAr: expect.any(String), unitPriceMinor: 5000, quantity: 2, lineTotalMinor: 10000 },
        { ticketType: 'CHILD', nameEn: 'Child (2–8 years)', nameAr: expect.any(String), unitPriceMinor: 3500, quantity: 1, lineTotalMinor: 3500 },
      ]);
    });

    it('prices a weekend non-resident order', async () => {
      const q = (await quote({ visitDate: '2026-10-10', audience: 'VISITOR', items: [{ ticketType: 'ADULT', quantity: 1 }, { ticketType: 'CHILD', quantity: 2 }] }).expect(200)).body.data;
      expect(q).toMatchObject({ dayType: 'WEEKEND', totalMinor: 20000 + 2 * 15000 });
    });

    it('cannot be tampered with: a price or total sent by the client is refused, never used', async () => {
      for (const extra of [{ totalMinor: 1 }, { unitPriceMinor: 1 }, { price: 1 }]) {
        const res = await quote(extra).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
      const res = await quote({ items: [{ ticketType: 'ADULT', quantity: 1, unitPriceMinor: 1 }] }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects an under-2 ticket, unknown types and audiences, and bad quantities', async () => {
      for (const t of ['INFANT', 'BABY', 'FREE', 'adult1']) {
        const res = await quote({ items: [{ ticketType: t, quantity: 1 }] });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('INVALID_TICKET_TYPE');
      }
      expect((await quote({ audience: 'TOURIST' }).expect(422)).body.error.code).toBe('INVALID_AUDIENCE');
      for (const quantity of [0, -1, 1.5, 'two', null, 1001]) {
        expect((await quote({ items: [{ ticketType: 'ADULT', quantity }] }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      }
      expect((await quote({ items: [] }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      expect((await quote({ items: [{ ticketType: 'ADULT', quantity: 1 }, { ticketType: 'ADULT', quantity: 2 }] }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    });

    it('limits the tickets in one order', async () => {
      await quote({ items: [{ ticketType: 'ADULT', quantity: 50 }] }).expect(200);
      const res = await quote({ items: [{ ticketType: 'ADULT', quantity: 30 }, { ticketType: 'CHILD', quantity: 21 }] }).expect(422);
      expect(res.body.error.code).toBe('TOO_MANY_TICKETS');
    });

    it('never sells a ticket without a price, and never for zero', async () => {
      await prisma.ticketPrice.updateMany({ where: { ticketType: { code: 'CHILD' }, audience: { code: 'RESIDENT' }, dowMask: 31 }, data: { isActive: false } });
      const res = await quote().expect(422);
      expect(res.body.error.code).toBe('PRICE_NOT_AVAILABLE');
      await quote({ items: [{ ticketType: 'ADULT', quantity: 1 }] }).expect(200);
    });

    it('does not offer a ticket type that has been switched off', async () => {
      await prisma.ticketType.update({ where: { code: 'CHILD' }, data: { isActive: false } });
      expect((await quote().expect(422)).body.error.code).toBe('INVALID_TICKET_TYPE');
      const d = (await call('get', '/public/tickets/catalog').expect(200)).body.data;
      expect(d.ticketTypes.map((t: { code: string }) => t.code)).toEqual(['ADULT']);
    });
  });

  // ───────────────────────────── visit dates ─────────────────────────────

  describe('visit date rules', () => {
    const code = async (visitDate: string) => {
      const res = await quote({ visitDate });
      return res.status === 200 ? 'OK' : res.body.error.code;
    };

    it('accepts today (before the cut-off) and the next 90 days, and refuses the past and day 91', async () => {
      expect(await code(TODAY)).toBe('OK');
      expect(await code('2026-10-06')).toBe('DATE_IN_THE_PAST');
      expect(await code('2000-01-01')).toBe('DATE_IN_THE_PAST');
      expect(await code('2027-01-05')).toBe('OK'); // 90 days ahead
      expect(await code('2027-01-06')).toBe('DATE_TOO_FAR_AHEAD'); // 91 days ahead
      expect(await code('2099-01-01')).toBe('DATE_TOO_FAR_AHEAD');
    });

    it('rejects a malformed or impossible date', async () => {
      for (const v of ['tomorrow', '2026-13-01', '2026-02-30', '08/10/2026', '', null, 20261008]) {
        expect((await quote({ visitDate: v }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('stops selling tickets for today exactly 1 hour before closing, using the opening hours (not a fixed 21:00)', async () => {
      clock.set(cairoInstant(TODAY, '20:59:59'));
      expect(await code(TODAY)).toBe('OK');
      clock.set(cairoInstant(TODAY, '21:00:00'));
      expect(await code(TODAY)).toBe('SALES_CLOSED_FOR_TODAY');
      clock.set(cairoInstant(TODAY, '21:30:00'));
      expect(await code(TODAY)).toBe('SALES_CLOSED_FOR_TODAY');
      expect(await code('2026-10-08')).toBe('OK'); // tomorrow stays on sale
    });

    it('follows a change of closing time: closing at 20:00 moves the cut-off to 19:00', async () => {
      await setHours(3, '20:00'); // Wednesday
      clock.set(cairoInstant(TODAY, '18:59:59'));
      expect(await code(TODAY)).toBe('OK');
      clock.set(cairoInstant(TODAY, '19:00:00'));
      expect(await code(TODAY)).toBe('SALES_CLOSED_FOR_TODAY');
      const day = (await call('get', `/public/tickets/catalog?date=${TODAY}`).expect(200)).body.data.day;
      expect(day.sale).toEqual({ allowed: false, reason: 'SALES_CLOSED_FOR_TODAY' });
    });

    it('shows when sales stop today', async () => {
      const day = (await call('get', `/public/tickets/catalog?date=${TODAY}`).expect(200)).body.data.day;
      expect(day.sale).toEqual({ allowed: true, salesCloseAt: '21:00' });
    });

    it('refuses a closed day: weekly closure and special closure', async () => {
      await prisma.openingHour.update({ where: { dayOfWeek: 4 }, data: { isClosed: true, opens: null, closes: null } }); // Thursdays
      expect(await code('2026-10-08')).toBe('PARK_CLOSED');
      expect(await code('2026-10-09')).toBe('OK');
      await prisma.specialHours.create({ data: { kind: 'TEMPORARY_CLOSURE', dateFrom: new Date('2026-10-12'), dateTo: new Date('2026-10-13'), isClosed: true, labelEn: 'Maintenance', labelAr: 'صيانة', priority: 10 } });
      expect(await code('2026-10-12')).toBe('PARK_CLOSED');
      expect(await code('2026-10-13')).toBe('PARK_CLOSED');
      expect(await code('2026-10-14')).toBe('OK');
    });

    it('uses special hours for the cut-off of the day they cover', async () => {
      await prisma.specialHours.create({
        data: { kind: 'SPECIAL_HOURS', dateFrom: new Date(TODAY), dateTo: new Date(TODAY), isClosed: false, opens: new Date('1970-01-01T09:00:00Z'), closes: new Date('1970-01-01T17:00:00Z'), labelEn: 'Early close', labelAr: 'إغلاق مبكر', priority: 10 },
      });
      clock.set(cairoInstant(TODAY, '15:59:59'));
      expect(await code(TODAY)).toBe('OK');
      clock.set(cairoInstant(TODAY, '16:00:00'));
      expect(await code(TODAY)).toBe('SALES_CLOSED_FOR_TODAY');
    });

    it('uses the Cairo calendar, not UTC: just after Cairo midnight "today" has already moved on', async () => {
      clock.set(cairoInstant('2026-10-08', '00:30:00'));
      expect(await code(TODAY)).toBe('DATE_IN_THE_PAST');
      expect(await code('2026-10-08')).toBe('OK');
    });
  });

  // ───────────────────────────── creating an order ─────────────────────────────

  describe('creating an order', () => {
    it('creates an unpaid order whose amounts come from the database, with its tickets waiting', async () => {
      const c = await created();
      expect(c.order).toMatchObject({ status: 'PENDING_PAYMENT', totalMinor: 13500, visitDate: '2026-10-08', tickets: [] });
      expect(c.order.orderNumber).toMatch(/^AZP-2026-\d{6}$/);
      expect(new Date(c.order.expiresAt).getTime()).toBe(NOON().getTime() + 30 * 60_000);
      expect(c.accessToken.length).toBeGreaterThanOrEqual(40);
      expect(c.payment).toMatchObject({ status: 'PENDING', amountMinor: 13500 });

      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: c.order.orderNumber }, include: { items: true, tickets: true, payments: true, customer: true } });
      expect(order).toMatchObject({ channel: 'ONLINE', status: 'PENDING_PAYMENT', subtotalMinor: 13500, discountMinor: 0, totalMinor: 13500, currency: 'EGP' });
      expect(order.items.map((i) => [i.typeNameEn, i.unitPriceMinor, i.quantity, i.lineTotalMinor]).sort()).toEqual([['Adult', 5000, 2, 10000], ['Child (2–8 years)', 3500, 1, 3500]]);
      expect(order.tickets).toHaveLength(3);
      expect(order.tickets.every((t) => t.status === 'PENDING' && t.customerId === order.customerId)).toBe(true);
      expect(new Set(order.tickets.map((t) => t.publicRef)).size).toBe(3);
      expect(order.tickets.map((t) => t.pricePaidMinor).sort()).toEqual([3500, 5000, 5000]);
      expect(order.payments).toHaveLength(1);
      expect(order.payments[0]).toMatchObject({ provider: 'MOCK', method: 'ONLINE', amountMinor: 13500, status: 'PENDING' });
      expect(order.customer).toMatchObject({ fullName: 'Mona Hassan', email: 'mona@example.com', phone: '+201001234567' });
      expect(order.customer?.consentedAt).not.toBeNull();
      expect(order.customer?.privacyNoticeVersion).toBe('draft-0');
      expect((await audit('order.created'))).toHaveLength(1);
    });

    it('numbers orders one after the other', async () => {
      const a = await created();
      const b = await created();
      expect(Number(b.order.orderNumber.slice(-6))).toBe(Number(a.order.orderNumber.slice(-6)) + 1);
    });

    it('requires the customer details and the booking terms', async () => {
      for (const over of [{ acceptTerms: false }, { acceptTerms: undefined }, { customer: { ...customer, email: 'not-an-email' } }, { customer: { ...customer, fullName: 'M' } }, { customer: { ...customer, phone: 'abc' } }, { customer: undefined }]) {
        expect((await placeOrder(over).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      }
      expect(await prisma.order.count()).toBe(0);
    });

    it('ignores any price, total, status or id sent by the client', async () => {
      for (const extra of [{ totalMinor: 1 }, { status: 'PAID' }, { id: '7b9d8c6e-1b0d-4f4a-9a2e-0f0b6c6d5a11' }, { amountMinor: 1 }]) {
        expect((await placeOrder(extra).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      }
      expect(await prisma.order.count()).toBe(0);
    });

    it('refuses every date and ticket problem and leaves nothing behind', async () => {
      await placeOrder({ visitDate: '2026-10-06' }).expect(422);
      await placeOrder({ visitDate: '2027-01-06' }).expect(422);
      await placeOrder({ items: [{ ticketType: 'INFANT', quantity: 1 }] }).expect(422);
      await placeOrder({ items: [{ ticketType: 'ADULT', quantity: 51 }] }).expect(422);
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.customer.count()).toBe(0);
      expect(await prisma.ticket.count()).toBe(0);
    });

    it('rolls everything back when something fails part-way', async () => {
      await prisma.$executeRawUnsafe('ALTER TABLE tickets ADD CONSTRAINT zz_force_failure CHECK (price_paid_minor <> 3500)');
      try {
        await placeOrder().expect(500);
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE tickets DROP CONSTRAINT zz_force_failure');
      }
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.orderItem.count()).toBe(0);
      expect(await prisma.customer.count()).toBe(0);
    });

    it('is safe to retry with the same Idempotency-Key', async () => {
      const key = 'retry-key-0000001';
      const first = await placeOrder({}, { 'Idempotency-Key': key }).expect(201);
      const again = await placeOrder({}, { 'Idempotency-Key': key }).expect(200);
      expect(again.body.data.order.orderNumber).toBe(first.body.data.order.orderNumber);
      expect(await prisma.order.count()).toBe(1);
      expect(await prisma.ticket.count()).toBe(3);
      expect(await prisma.payment.count()).toBe(1);
      const other = await placeOrder({ items: [{ ticketType: 'ADULT', quantity: 1 }] }, { 'Idempotency-Key': key }).expect(409);
      expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      await placeOrder({}, { 'Idempotency-Key': 'bad key!' }).expect(400);
    });

    it('creates exactly one order when the same key arrives twice at once', async () => {
      const key = 'parallel-key-000001';
      const results = await Promise.all([placeOrder({}, { 'Idempotency-Key': key }), placeOrder({}, { 'Idempotency-Key': key })]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(await prisma.order.count()).toBe(1);
    });

    describe('the Idempotency-Key a new order needs (at least 16 characters)', () => {
      it('refuses a key of 15 characters, creating nothing, and accepts 16 up to 100', async () => {
        const short = await placeOrder({}, { 'Idempotency-Key': 'a'.repeat(15) }).expect(400);
        expect(short.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
        expect(short.body.error.message).toContain('16');
        expect(await prisma.order.count()).toBe(0);
        expect(await prisma.customer.count()).toBe(0);
        expect(await prisma.payment.count()).toBe(0);
        await placeOrder({}, { 'Idempotency-Key': 'b'.repeat(16) }).expect(201);
        await placeOrder({}, { 'Idempotency-Key': 'c'.repeat(100) }).expect(201);
        const long = await placeOrder({}, { 'Idempotency-Key': 'd'.repeat(101) }).expect(400);
        expect(long.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
        expect(await prisma.order.count()).toBe(2);
      });

      it('refuses keys with characters outside letters, digits, - and _ whatever their length', async () => {
        for (const key of ['key with spaces 0000000', 'key/with/slashes0000', 'key.with.dots.0000001', 'key;drop-table-orders--1']) {
          expect((await placeOrder({}, { 'Idempotency-Key': key }).expect(400)).body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
        }
        expect(await prisma.order.count()).toBe(0);
      });

      it('still works without a key (the key is optional), and the UUID keys the website sends are accepted', async () => {
        await placeOrder({}).expect(201);
        await placeOrder({}, { 'Idempotency-Key': '3f2b8c1e-9d4a-4e7b-8a61-5c0d2e9f7a13' }).expect(201);
        expect(await prisma.order.count()).toBe(2);
      });

      it('a valid key retried gets the same order back and a working access key, never a second order', async () => {
        const key = 'compat-key-0000001';
        const first = await placeOrder({}, { 'Idempotency-Key': key }).expect(201);
        const again = await placeOrder({}, { 'Idempotency-Key': key }).expect(200);
        expect(again.body.data.order.orderNumber).toBe(first.body.data.order.orderNumber);
        expect(again.body.data.accessToken).not.toBe(first.body.data.accessToken);
        await viewOrder(first.body.data.order.orderNumber, again.body.data.accessToken).expect(200);
        await viewOrder(first.body.data.order.orderNumber, first.body.data.accessToken).expect(200);
        expect(await prisma.order.count()).toBe(1);
        expect(await prisma.ticket.count()).toBe(3);
      });

      it('an order created under an older, shorter key can still be replayed, but a short key never creates a new order', async () => {
        const first = await placeOrder({}, { 'Idempotency-Key': 'legacy-key-placeholder-1' }).expect(201);
        // as if it had been created before Phase 11, when 8 characters were enough
        await prisma.$executeRawUnsafe('ALTER TABLE orders DISABLE TRIGGER trg_orders_immutable');
        try {
          await prisma.$executeRawUnsafe("UPDATE orders SET idempotency_key = 'old-key-1' WHERE idempotency_key = 'legacy-key-placeholder-1'");
        } finally {
          await prisma.$executeRawUnsafe('ALTER TABLE orders ENABLE TRIGGER trg_orders_immutable');
        }
        const again = await placeOrder({}, { 'Idempotency-Key': 'old-key-1' }).expect(200);
        expect(again.body.data.order.orderNumber).toBe(first.body.data.order.orderNumber);
        await viewOrder(first.body.data.order.orderNumber, again.body.data.accessToken).expect(200);
        // a different request with that key is still refused, exactly as before
        const other = await placeOrder({ items: [{ ticketType: 'ADULT', quantity: 1 }] }, { 'Idempotency-Key': 'old-key-1' }).expect(409);
        expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
        // an unknown short key creates nothing
        await placeOrder({}, { 'Idempotency-Key': 'never-used-1' }).expect(400);
        expect(await prisma.order.count()).toBe(1);
      });

      it('two requests with the same valid key at once still create exactly one order', async () => {
        const key = 'simultaneous-key-0001';
        const results = await Promise.all([placeOrder({}, { 'Idempotency-Key': key }), placeOrder({}, { 'Idempotency-Key': key }), placeOrder({}, { 'Idempotency-Key': key })]);
        expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
        expect(new Set(results.map((r) => r.body.data.order.orderNumber)).size).toBe(1);
        expect(await prisma.order.count()).toBe(1);
        expect(await prisma.ticket.count()).toBe(3);
        expect(await prisma.payment.count()).toBe(1);
      });
    });

    it('limits how fast one address can create orders', async () => {
      const ip = '10.99.0.1';
      const statuses: number[] = [];
      for (let i = 0; i < 12; i += 1) {
        statuses.push((await request(app.getHttpServer()).post(`${API}/public/orders`).set('X-Forwarded-For', ip).send(body({ items: [{ ticketType: 'ADULT', quantity: 1 }] }))).status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    });

    it('holds capacity when a daily limit is switched on, and gives it back when an order expires', async () => {
      await prisma.systemSetting.update({ where: { key: 'capacity.dailyLimit' }, data: { value: 4 } });
      const first = await created({ items: [{ ticketType: 'ADULT', quantity: 3 }] });
      const full = await placeOrder({ items: [{ ticketType: 'ADULT', quantity: 2 }] }).expect(409);
      expect(full.body.error).toMatchObject({ code: 'SOLD_OUT', details: { remaining: 1 } });
      await created({ items: [{ ticketType: 'CHILD', quantity: 1 }] });
      expect((await placeOrder({ items: [{ ticketType: 'CHILD', quantity: 1 }] }).expect(409)).body.error.code).toBe('SOLD_OUT');
      clock.advance(31 * 60_000);
      await app.get(OrderLifecycleService).expireAllDue();
      await created({ items: [{ ticketType: 'ADULT', quantity: 4 }] });
      expect(first.order.orderNumber).toBeTruthy();
    });
  });

  // ───────────────────────────── the customer's own order ─────────────────────────────

  describe('seeing your order', () => {
    it('needs the access key given at checkout', async () => {
      const a = await created();
      const b = await created();
      expect((await viewOrder(a.order.orderNumber, a.accessToken).expect(200)).body.data).toMatchObject({ orderNumber: a.order.orderNumber, status: 'PENDING_PAYMENT', totalMinor: 13500, customer: { fullName: 'Mona Hassan' } });
      for (const [num, tok] of [[a.order.orderNumber, b.accessToken], [a.order.orderNumber, 'x'.repeat(43)], [a.order.orderNumber, ''], ['AZP-2026-999999', a.accessToken]] as const) {
        const res = await viewOrder(num, tok);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
      }
      expect((await call('get', `/public/orders/${a.order.orderNumber}`).expect(404)).body.error.code).toBe('ORDER_NOT_FOUND');
    });

    it('stores only a hash of the access key', async () => {
      const a = await created();
      const rows = await prisma.orderAccessToken.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).not.toContain(a.accessToken);
      expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('stops working once it is revoked or expired', async () => {
      const a = await created();
      await prisma.orderAccessToken.updateMany({ data: { revokedAt: new Date() } });
      await viewOrder(a.order.orderNumber, a.accessToken).expect(404);
    });
  });

  // ───────────────────────────── payment ─────────────────────────────

  describe('payment', () => {
    it('marks the order paid and issues its tickets when the payment succeeds', async () => {
      const c = await created();
      const res = await complete(c.payment.providerTxnId).expect(200);
      expect(res.body.data).toEqual({ result: 'PAID', orderNumber: c.order.orderNumber });
      const order = (await viewOrder(c.order.orderNumber, c.accessToken).expect(200)).body.data;
      expect(order.status).toBe('PAID');
      expect(order.payment.status).toBe('PAID');
      expect(order.tickets).toHaveLength(3);
      expect(order.tickets.every((t: { status: string; ref: string }) => t.status === 'VALID' && /^TKT-/.test(t.ref))).toBe(true);
      const row = await prisma.order.findUniqueOrThrow({ where: { orderNumber: c.order.orderNumber }, include: { tickets: true, payments: true } });
      expect(row.paidAt).not.toBeNull();
      expect(row.tickets.every((t) => t.status === 'VALID' && t.issuedAt)).toBe(true);
      expect(row.payments[0].paidAt).not.toBeNull();
      expect((await audit('payment.confirmed'))).toHaveLength(1);
    });

    it('treats a repeated confirmation as already done, changing nothing', async () => {
      const c = await created();
      await complete(c.payment.providerTxnId).expect(200);
      const again = await complete(c.payment.providerTxnId).expect(200);
      expect(again.body.data.result).toBe('ALREADY_PAID');
      expect(await audit('payment.confirmed')).toHaveLength(1);
      expect(await prisma.payment.count({ where: { status: 'PAID' } })).toBe(1);
    });

    it('confirms exactly once when many confirmations arrive at the same moment', async () => {
      const c = await created();
      const results = await Promise.all(Array.from({ length: 6 }, () => complete(c.payment.providerTxnId)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.body.data.result === 'PAID')).toHaveLength(1);
      expect(results.filter((r) => r.body.data.result === 'ALREADY_PAID')).toHaveLength(5);
      expect(await audit('payment.confirmed')).toHaveLength(1);
      expect(await prisma.ticket.count({ where: { status: 'VALID' } })).toBe(3);
    });

    it('refuses an amount that does not match the order, and leaves it unpaid', async () => {
      const c = await created();
      for (const wrong of [{ amountMinor: 1 }, { amountMinor: 13499 }, { amountMinor: 13501 }, { amountMinor: 0 }, { currency: 'USD' }]) {
        const res = await complete(c.payment.providerTxnId, { outcome: 'SUCCESS', ...wrong }).expect(409);
        expect(res.body.error.code).toBe('AMOUNT_MISMATCH');
      }
      expect((await prisma.order.findUniqueOrThrow({ where: { orderNumber: c.order.orderNumber } })).status).toBe('PENDING_PAYMENT');
      expect((await audit('payment.rejected')).length).toBe(5);
      await complete(c.payment.providerTxnId, { outcome: 'SUCCESS', amountMinor: 13500, currency: 'EGP' }).expect(200);
    });

    it('refuses a confirmation that names a different order', async () => {
      const a = await created();
      const b = await created();
      const res = await complete(a.payment.providerTxnId, { outcome: 'SUCCESS', orderNumber: b.order.orderNumber }).expect(409);
      expect(res.body.error.code).toBe('ORDER_MISMATCH');
      expect((await prisma.order.findMany({ where: { status: 'PAID' } })).length).toBe(0);
      await complete('mock_does-not-exist').expect(404);
    });

    it('lets the customer try again after a failed payment', async () => {
      const c = await created();
      expect((await complete(c.payment.providerTxnId, { outcome: 'FAILURE' }).expect(200)).body.data.result).toBe('FAILED');
      expect((await prisma.order.findUniqueOrThrow({ where: { orderNumber: c.order.orderNumber } })).status).toBe('PENDING_PAYMENT');
      // a failed payment can never become paid afterwards
      expect((await complete(c.payment.providerTxnId).expect(409)).body.error.code).toBe('PAYMENT_NOT_PENDING');
      const retry = (await call('post', `/public/orders/${c.order.orderNumber}/payments`, undefined, {}, { 'X-Order-Token': c.accessToken }).expect(200)).body.data;
      expect(retry.payment.providerTxnId).not.toBe(c.payment.providerTxnId);
      expect(retry.payment.amountMinor).toBe(13500);
      await complete(retry.payment.providerTxnId).expect(200);
      expect((await prisma.order.findUniqueOrThrow({ where: { orderNumber: c.order.orderNumber } })).status).toBe('PAID');
      expect(await prisma.payment.count({ where: { orderId: (await prisma.order.findUniqueOrThrow({ where: { orderNumber: c.order.orderNumber } })).id } })).toBe(2);
    });

    it('reuses the waiting payment instead of piling up attempts', async () => {
      const c = await created();
      const retry = (await call('post', `/public/orders/${c.order.orderNumber}/payments`, undefined, {}, { 'X-Order-Token': c.accessToken }).expect(200)).body.data;
      expect(retry.payment.providerTxnId).toBe(c.payment.providerTxnId);
      await call('post', `/public/orders/${c.order.orderNumber}/payments`, undefined, {}).expect(404); // no key
    });

    it('cannot pay an order that is already paid again', async () => {
      const c = await created();
      await complete(c.payment.providerTxnId).expect(200);
      const res = await call('post', `/public/orders/${c.order.orderNumber}/payments`, undefined, {}, { 'X-Order-Token': c.accessToken }).expect(409);
      expect(res.body.error.code).toBe('ORDER_NOT_PAYABLE');
    });
  });

  // ───────────────────────────── expiry ─────────────────────────────

  describe('expiry after 30 minutes', () => {
    it('keeps an unpaid order until its deadline, then expires it with its tickets and payment', async () => {
      const c = await created();
      clock.advance(29 * 60_000 + 59_000);
      expect((await viewOrder(c.order.orderNumber, c.accessToken).expect(200)).body.data.status).toBe('PENDING_PAYMENT');
      clock.advance(1_000);
      expect((await viewOrder(c.order.orderNumber, c.accessToken).expect(200)).body.data.status).toBe('EXPIRED');
      const row = await prisma.order.findUniqueOrThrow({ where: { orderNumber: c.order.orderNumber }, include: { tickets: true, payments: true } });
      expect(row.tickets.every((t) => t.status === 'EXPIRED')).toBe(true);
      expect(row.payments[0].status).toBe('CANCELLED');
      expect((await audit('order.expired'))).toHaveLength(1);
    });

    it('cannot be paid after it expired, even if the provider reports success', async () => {
      const c = await created();
      clock.advance(31 * 60_000);
      const res = await complete(c.payment.providerTxnId).expect(409);
      expect(res.body.error.code).toBe('ORDER_EXPIRED');
      expect((await prisma.order.findUniqueOrThrow({ where: { orderNumber: c.order.orderNumber } })).status).toBe('EXPIRED');
      expect(await prisma.ticket.count({ where: { status: 'VALID' } })).toBe(0);
      expect((await call('post', `/public/orders/${c.order.orderNumber}/payments`, undefined, {}, { 'X-Order-Token': c.accessToken }).expect(409)).body.error.code).toBe('ORDER_NOT_PAYABLE');
    });

    it('the background sweep expires every overdue order once', async () => {
      const a = await created();
      clock.advance(10 * 60_000);
      const b = await created();
      clock.advance(21 * 60_000);
      const lifecycle = app.get(OrderLifecycleService);
      expect(await lifecycle.expireAllDue()).toBe(1);
      expect(await lifecycle.expireAllDue()).toBe(0);
      expect((await prisma.order.findUniqueOrThrow({ where: { orderNumber: a.order.orderNumber } })).status).toBe('EXPIRED');
      expect((await prisma.order.findUniqueOrThrow({ where: { orderNumber: b.order.orderNumber } })).status).toBe('PENDING_PAYMENT');
    });

    it('never expires a paid order', async () => {
      const c = await created();
      await complete(c.payment.providerTxnId).expect(200);
      clock.advance(24 * 3_600_000);
      expect(await app.get(OrderLifecycleService).expireAllDue()).toBe(0);
      expect((await prisma.order.findUniqueOrThrow({ where: { orderNumber: c.order.orderNumber } })).status).toBe('PAID');
    });

    it('uses the configured number of minutes', async () => {
      await prisma.systemSetting.update({ where: { key: 'orders.pendingExpiryMinutes' }, data: { value: 5 } });
      const c = await created();
      expect(new Date(c.order.expiresAt).getTime()).toBe(NOON().getTime() + 5 * 60_000);
    });
  });

  // ───────────────────────────── price history ─────────────────────────────

  describe('price changes never touch past orders', () => {
    it('keeps the price an order was bought at after the price list changes', async () => {
      const c = await created();
      await complete(c.payment.providerTxnId).expect(200);

      const adult = await prisma.ticketType.findUniqueOrThrow({ where: { code: 'ADULT' } });
      const resident = await prisma.ticketAudience.findUniqueOrThrow({ where: { code: 'RESIDENT' } });
      const res = await call('post', '/prices', 'admin', { ticketTypeId: adult.id, audienceId: resident.id, days: 'WEEKDAY', amountMinor: 7500, validFrom: '2026-10-08' }).expect(201);
      expect(res.body.data).toMatchObject({ amountMinor: 7500, validFrom: '2026-10-08', validTo: null, status: 'upcoming', days: 'WEEKDAY' });

      // the new price applies from its first day …
      expect((await quote({ visitDate: '2026-10-08' }).expect(200)).body.data.totalMinor).toBe(2 * 7500 + 3500);
      expect((await quote({ visitDate: '2026-10-09' }).expect(200)).body.data.totalMinor).toBe(2 * 6000 + 4000); // weekend untouched
      // … and the order bought before it is exactly as it was
      const old = (await viewOrder(c.order.orderNumber, c.accessToken).expect(200)).body.data;
      expect(old.totalMinor).toBe(13500);
      expect(old.items.find((i: { typeNameEn: string }) => i.typeNameEn === 'Adult')).toMatchObject({ unitPriceMinor: 5000, lineTotalMinor: 10000 });
      const tickets = await prisma.ticket.findMany({ where: { order: { orderNumber: c.order.orderNumber } } });
      expect(tickets.map((t) => t.pricePaidMinor).sort()).toEqual([3500, 5000, 5000]);
      const row = await prisma.order.findUniqueOrThrow({ where: { orderNumber: c.order.orderNumber } });
      expect(row.totalMinor).toBe(13500);
    });
  });

  // ───────────────────────────── no-refund policy ─────────────────────────────

  describe('no refunds', () => {
    it('has no refund endpoint, and the database refuses a refunded state', async () => {
      const c = await created();
      await complete(c.payment.providerTxnId).expect(200);
      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: c.order.orderNumber } });
      await call('post', `/orders/${order.id}/refund`, 'admin', { reason: 'x' }).expect(404);
      await call('post', `/public/orders/${c.order.orderNumber}/refund`, undefined, {}).expect(404);
      await expect(prisma.$executeRawUnsafe(`UPDATE orders SET status = 'REFUNDED'::order_status WHERE id = '${order.id}'::uuid`)).rejects.toThrow();
      await expect(prisma.$executeRawUnsafe(`UPDATE payments SET status = 'REFUNDED'::payment_status WHERE order_id = '${order.id}'::uuid`)).rejects.toThrow();
    });
  });
});
