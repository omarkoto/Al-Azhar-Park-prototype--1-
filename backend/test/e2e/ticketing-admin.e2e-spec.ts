import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { Clock } from '../../src/common/clock';
import { OrderLifecycleService } from '../../src/modules/ticketing/order-lifecycle.service';
import { cairoInstant } from '../helpers/cairo';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { createTestApp, TestClock } from '../helpers/app';
import { API, createUser, login, nextIp } from '../helpers/auth';

const TODAY = '2026-10-07';

describe('ticket types, prices and orders in the portal (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let clock: TestClock;
  const tokens: Record<string, string> = {};

  type Method = 'get' | 'post' | 'put' | 'delete';
  const call = (method: Method, path: string, as?: string, body?: object, headers: Record<string, string> = {}) =>
    request(app.getHttpServer())[method](`${API}${path}`).set('X-Forwarded-For', nextIp()).set(as ? { Authorization: `Bearer ${tokens[as]}` } : {}).set(headers).send(body);
  const audit = (action: string) => prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });
  const ids = async () => ({
    adult: (await prisma.ticketType.findUniqueOrThrow({ where: { code: 'ADULT' } })).id,
    child: (await prisma.ticketType.findUniqueOrThrow({ where: { code: 'CHILD' } })).id,
    resident: (await prisma.ticketAudience.findUniqueOrThrow({ where: { code: 'RESIDENT' } })).id,
    visitor: (await prisma.ticketAudience.findUniqueOrThrow({ where: { code: 'VISITOR' } })).id,
  });

  const customer = { fullName: 'Mona Hassan', email: 'mona@example.com', phone: '+201001234567' };
  const orderBody = (over: Record<string, unknown> = {}) => ({
    visitDate: '2026-10-08', audience: 'RESIDENT', items: [{ ticketType: 'ADULT', quantity: 2 }, { ticketType: 'CHILD', quantity: 1 }], customer, acceptTerms: true, locale: 'en', ...over,
  });
  const place = async (over: Record<string, unknown> = {}) =>
    (await call('post', '/public/orders', undefined, orderBody(over)).expect(201)).body.data as { order: { orderNumber: string }; accessToken: string; payment: { providerTxnId: string } };
  const paid = async (over: Record<string, unknown> = {}) => {
    const c = await place(over);
    await call('post', `/public/payments/mock/${c.payment.providerTxnId}/complete`, undefined, { outcome: 'SUCCESS' }).expect(200);
    return c;
  };
  const idOf = async (orderNumber: string) => (await prisma.order.findUniqueOrThrow({ where: { orderNumber } })).id;
  const newPrice = (over: Record<string, unknown> = {}) => ({ ticketTypeId: '', audienceId: '', days: 'WEEKDAY', amountMinor: 7500, validFrom: '2026-10-20', ...over });

  beforeAll(async () => {
    prisma = createTestPrisma(8);
    app = await createTestApp({ TRUST_PROXY: '1' });
    clock = app.get(Clock) as TestClock;
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
    clock.set(cairoInstant(TODAY, '12:00'));
    for (const [k, e] of [['admin', 'admin@azharpark.test'], ['ops', 'operations@azharpark.test'], ['analyst', 'analyst@azharpark.test'], ['staff', 'staff@azharpark.test'], ['content', 'content@azharpark.test']] as const) {
      tokens[k] = (await login(app, e)).accessToken;
    }
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────── permissions ─────────────────────────────

  describe('access', () => {
    it('refuses everything without a login', async () => {
      for (const [m, p] of [['get', '/ticket-types'], ['get', '/ticket-audiences'], ['get', '/prices'], ['get', '/prices/current'], ['get', '/orders'], ['post', '/prices'], ['post', '/ticket-types'], ['post', '/orders/7b9d8c6e-1b0d-4f4a-9a2e-0f0b6c6d5a11/cancel']] as const) {
        await call(m, p).expect(401);
      }
    });

    it('follows permissions, not role names', async () => {
      const t = await ids();
      // reading
      await call('get', '/ticket-types', 'analyst').expect(200);
      await call('get', '/ticket-types', 'ops').expect(200);
      await call('get', '/ticket-types', 'content').expect(403);
      await call('get', '/prices', 'analyst').expect(200);
      await call('get', '/prices', 'ops').expect(403); // operations may see ticket types but not the price history
      await call('get', '/prices', 'staff').expect(403);
      await call('get', '/orders', 'analyst').expect(200);
      await call('get', '/orders', 'staff').expect(403);
      await call('get', '/orders', 'content').expect(403);
      // writing
      await call('post', '/prices', 'analyst', newPrice({ ticketTypeId: t.adult, audienceId: t.resident })).expect(403);
      await call('post', '/prices', 'ops', newPrice({ ticketTypeId: t.adult, audienceId: t.resident })).expect(403);
      await call('post', '/ticket-types', 'ops', { code: 'SENIOR', nameEn: 'Senior', nameAr: 'كبار السن', minAge: 60, isActive: false }).expect(403);
      await call('put', `/ticket-types/${t.adult}`, 'analyst', { nameEn: 'Adult', nameAr: 'بالغ', minAge: 9, isActive: true }).expect(403);
      expect(await prisma.ticketPrice.count()).toBe(8);
      // a custom role with only pricing:write can add prices but cannot read orders
      const role = await prisma.role.create({ data: { code: 'PRICE_EDITOR', name: 'Price editor' } });
      for (const code of ['pricing:write', 'pricing:read']) {
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: (await prisma.permission.findUniqueOrThrow({ where: { code } })).id } });
      }
      const user = await createUser(prisma, { role: 'PRICE_EDITOR' });
      tokens.pricer = (await login(app, user.email)).accessToken;
      await call('post', '/prices', 'pricer', newPrice({ ticketTypeId: t.adult, audienceId: t.resident })).expect(201);
      await call('get', '/orders', 'pricer').expect(403);
    });
  });

  // ───────────────────────────── ticket types ─────────────────────────────

  describe('ticket types', () => {
    it('lists the types with how often each was sold', async () => {
      await paid();
      const list = (await call('get', '/ticket-types', 'admin').expect(200)).body.data;
      expect(list.map((t: { code: string }) => t.code)).toEqual(['ADULT', 'CHILD']);
      expect(list[0]).toMatchObject({ code: 'ADULT', minAge: 9, maxAge: null, isActive: true, timesSold: 1, priceRows: 4 });
      expect(list[1]).toMatchObject({ code: 'CHILD', minAge: 2, maxAge: 8, timesSold: 1 });
      const aud = (await call('get', '/ticket-audiences', 'admin').expect(200)).body.data;
      expect(aud.map((a: { code: string }) => a.code)).toEqual(['RESIDENT', 'VISITOR']);
    });

    it('can never create a ticket for children under 2', async () => {
      for (const minAge of [0, 1, -1]) {
        const res = await call('post', '/ticket-types', 'admin', { code: 'INFANT', nameEn: 'Infant', nameAr: 'رضيع', minAge, maxAge: 1 }).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
      }
      expect(await prisma.ticketType.count()).toBe(2);
      // and the database says the same, even if the API were bypassed
      await expect(prisma.ticketType.create({ data: { code: 'INFANT', nameEn: 'Infant', nameAr: 'رضيع', minAge: 1 } })).rejects.toThrow(/ck_ticket_types_min_age/);
    });

    it('creates a type, in order, with an audit entry', async () => {
      const res = await call('post', '/ticket-types', 'admin', { code: 'senior', nameEn: 'Senior', nameAr: 'كبار السن', minAge: 70, isActive: false }).expect(201);
      expect(res.body.data).toMatchObject({ code: 'SENIOR', minAge: 70, maxAge: null, isActive: false, sortOrder: 3 });
      expect((await audit('ticket_type.created'))).toHaveLength(1);
      expect((await audit('ticket_type.created'))[0].userId).not.toBeNull();
    });

    it('rejects a duplicate code, a bad age range and an overlap with an active type', async () => {
      const base = { nameEn: 'Teen', nameAr: 'مراهق', minAge: 9, isActive: true };
      expect((await call('post', '/ticket-types', 'admin', { ...base, code: 'ADULT' }).expect(409)).body.error.code).toBe('TICKET_TYPE_CODE_TAKEN');
      expect((await call('post', '/ticket-types', 'admin', { ...base, code: 'TEEN', minAge: 12, maxAge: 10 }).expect(422)).body.error.code).toBe('INVALID_AGE_RANGE');
      expect((await call('post', '/ticket-types', 'admin', { ...base, code: 'TEEN', minAge: 5, maxAge: 7 }).expect(409)).body.error.code).toBe('AGE_RANGE_OVERLAP');
      for (const code of ['x', 'has space', '1ABC', 'ÄÖ']) {
        expect((await call('post', '/ticket-types', 'admin', { ...base, code }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      }
    });

    it('locks the age range once the type has been sold, but names stay editable', async () => {
      const t = await ids();
      await paid();
      const edit = (over: Record<string, unknown>) => call('put', `/ticket-types/${t.child}`, 'admin', { nameEn: 'Child (2–8 years)', nameAr: 'طفل', minAge: 2, maxAge: 8, isActive: true, ...over });
      expect((await edit({ maxAge: 10 }).expect(409)).body.error.code).toBe('TICKET_TYPE_AGES_LOCKED');
      expect((await edit({ minAge: 3 }).expect(409)).body.error.code).toBe('TICKET_TYPE_AGES_LOCKED');
      const ok = (await edit({ nameEn: 'Child' }).expect(200)).body.data;
      expect(ok.nameEn).toBe('Child');
      // an order made earlier keeps the name it was sold under
      const item = await prisma.orderItem.findFirstOrThrow({ where: { ticketTypeId: t.child } });
      expect(item.typeNameEn).toBe('Child (2–8 years)');
      expect((await audit('ticket_type.updated')).length).toBe(1);
    });

    it('switches a type on and off, and the website follows', async () => {
      const t = await ids();
      const body = { nameEn: 'Child (2–8 years)', nameAr: 'طفل', minAge: 2, maxAge: 8 };
      await call('put', `/ticket-types/${t.child}`, 'admin', { ...body, isActive: false }).expect(200);
      const catalog = (await call('get', '/public/tickets/catalog').expect(200)).body.data;
      expect(catalog.ticketTypes.map((x: { code: string }) => x.code)).toEqual(['ADULT']);
      expect((await audit('ticket_type.deactivated'))).toHaveLength(1);
      await call('put', `/ticket-types/${t.child}`, 'admin', { ...body, isActive: true }).expect(200);
      expect((await audit('ticket_type.activated'))).toHaveLength(1);
      // history is untouched: there is no way to delete a type
      await call('delete', `/ticket-types/${t.child}`, 'admin').expect(404);
    });

    it('refuses to switch a type on when another active type already covers its ages', async () => {
      const t = await ids();
      const made = (await call('post', '/ticket-types', 'admin', { code: 'TEEN', nameEn: 'Teen', nameAr: 'مراهق', minAge: 9, maxAge: 17, isActive: false }).expect(201)).body.data;
      const res = await call('put', `/ticket-types/${made.id}`, 'admin', { nameEn: 'Teen', nameAr: 'مراهق', minAge: 9, maxAge: 17, isActive: true }).expect(409);
      expect(res.body.error.code).toBe('AGE_RANGE_OVERLAP');
      expect(t.adult).toBeTruthy();
    });

    it('re-orders the types', async () => {
      const t = await ids();
      const res = (await call('put', '/ticket-types/order', 'admin', { ids: [t.child, t.adult] }).expect(200)).body.data;
      expect(res.map((x: { code: string }) => x.code)).toEqual(['CHILD', 'ADULT']);
      expect((await call('get', '/public/tickets/catalog').expect(200)).body.data.ticketTypes.map((x: { code: string }) => x.code)).toEqual(['CHILD', 'ADULT']);
      expect((await call('put', '/ticket-types/order', 'admin', { ids: [t.child] }).expect(422)).body.error.code).toBe('ORDER_MISMATCH');
      expect((await call('put', '/ticket-types/order', 'admin', { ids: [t.child, t.child] }).expect(422)).body.error.code).toBe('ORDER_MISMATCH');
    });
  });

  // ───────────────────────────── prices ─────────────────────────────

  describe('prices', () => {
    it('shows the seeded price list and what visitors pay now', async () => {
      const list = (await call('get', '/prices', 'analyst').expect(200)).body.data;
      expect(list).toHaveLength(8);
      expect(list.every((p: { status: string; validTo: null; kind: string }) => p.status === 'current' && p.validTo === null && p.kind === 'STANDARD')).toBe(true);
      const cur = (await call('get', '/prices/current', 'analyst').expect(200)).body.data;
      const t = await ids();
      const cell = (a: string, ty: string) => cur.cells.find((c: { audienceId: string; ticketTypeId: string }) => c.audienceId === a && c.ticketTypeId === ty);
      expect(cell(t.resident, t.adult)).toMatchObject({ weekdayMinor: 5000, weekendMinor: 6000 });
      expect(cell(t.resident, t.child)).toMatchObject({ weekdayMinor: 3500, weekendMinor: 4000 });
      expect(cell(t.visitor, t.adult)).toMatchObject({ weekdayMinor: 15000, weekendMinor: 20000 });
      expect(cell(t.visitor, t.child)).toMatchObject({ weekdayMinor: 10000, weekendMinor: 15000 });
      expect((await call('get', `/prices?ticketTypeId=${t.adult}&audienceId=${t.visitor}`, 'analyst').expect(200)).body.data).toHaveLength(2);
      expect((await call('get', '/prices?status=upcoming', 'analyst').expect(200)).body.data).toHaveLength(0);
    });

    it('adds a future price, ends the old one the day before, and keeps the history', async () => {
      const t = await ids();
      const res = await call('post', '/prices', 'admin', newPrice({ ticketTypeId: t.adult, audienceId: t.resident, notes: 'Winter 2026' })).expect(201);
      expect(res.body.data).toMatchObject({ amountMinor: 7500, days: 'WEEKDAY', validFrom: '2026-10-20', validTo: null, status: 'upcoming', isActive: true, notes: 'Winter 2026' });
      const rows = await prisma.ticketPrice.findMany({ where: { ticketTypeId: t.adult, audienceId: t.resident, dowMask: 31 }, orderBy: { validFrom: 'asc' } });
      expect(rows.map((r) => [r.amountMinor, r.validFrom.toISOString().slice(0, 10), r.validTo?.toISOString().slice(0, 10) ?? null])).toEqual([
        [5000, '2026-01-01', '2026-10-19'],
        [7500, '2026-10-20', null],
      ]);
      const quote = async (visitDate: string) => (await call('post', '/public/orders/quote', undefined, { visitDate, audience: 'RESIDENT', items: [{ ticketType: 'ADULT', quantity: 1 }] }).expect(200)).body.data.totalMinor;
      expect(await quote('2026-10-19')).toBe(5000); // Monday before
      expect(await quote('2026-10-20')).toBe(7500); // Tuesday, first day
      const entry = (await audit('price.created'))[0];
      expect(entry.userId).not.toBeNull();
      expect(entry.newValue).toMatchObject({ ticketType: 'ADULT', audience: 'RESIDENT', days: 'WEEKDAY', amountMinor: 7500, validFrom: '2026-10-20' });
      const statuses = (await call('get', `/prices?ticketTypeId=${t.adult}&audienceId=${t.resident}`, 'admin').expect(200)).body.data.map((p: { amountMinor: number; status: string }) => `${p.amountMinor}:${p.status}`);
      expect(statuses.sort()).toEqual(['5000:current', '6000:current', '7500:upcoming']);
    });

    it('can start today but never in the past', async () => {
      const t = await ids();
      expect((await call('post', '/prices', 'admin', newPrice({ ticketTypeId: t.adult, audienceId: t.resident, validFrom: '2026-10-06' })).expect(422)).body.error.code).toBe('PRICE_START_IN_THE_PAST');
      await call('post', '/prices', 'admin', newPrice({ ticketTypeId: t.adult, audienceId: t.resident, validFrom: TODAY })).expect(201);
      expect(await prisma.ticketPrice.count()).toBe(9);
    });

    it('rejects zero, negative, fractional and absurd amounts, and bad input', async () => {
      const t = await ids();
      for (const amountMinor of [0, -5, 12.5, 10_000_001, '50', null]) {
        expect((await call('post', '/prices', 'admin', newPrice({ ticketTypeId: t.adult, audienceId: t.resident, amountMinor })).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      }
      for (const over of [{ days: 'MONDAY' }, { validFrom: 'soon' }, { validFrom: '2026-02-30' }, { ticketTypeId: 'x' }, { kind: 'PROMOTIONAL' }, { isActive: false }]) {
        expect((await call('post', '/prices', 'admin', newPrice({ ticketTypeId: t.adult, audienceId: t.resident, ...over })).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      }
      await call('post', '/prices', 'admin', newPrice({ ticketTypeId: '7b9d8c6e-1b0d-4f4a-9a2e-0f0b6c6d5a11', audienceId: t.resident })).expect(404);
      expect(await prisma.ticketPrice.count()).toBe(8);
    });

    it('refuses a price that clashes with another one', async () => {
      const t = await ids();
      await call('post', '/prices', 'admin', newPrice({ ticketTypeId: t.adult, audienceId: t.resident, validFrom: '2026-11-01' })).expect(201);
      // an earlier start would sit inside the new price's span: the existing, later price must be switched off first
      const later = await call('post', '/prices', 'admin', newPrice({ ticketTypeId: t.adult, audienceId: t.resident, validFrom: '2026-10-25', amountMinor: 6000 })).expect(409);
      expect(later.body.error.code).toBe('PRICE_CONFLICT');
      // a different day grouping would overlap the weekday and weekend rows
      const every = await call('post', '/prices', 'admin', newPrice({ ticketTypeId: t.adult, audienceId: t.resident, days: 'EVERY_DAY', validFrom: '2026-12-01' })).expect(409);
      expect(every.body.error.code).toBe('PRICE_CONFLICT');
      expect(await prisma.ticketPrice.count()).toBe(9);
      // other audiences and other ticket types are separate
      await call('post', '/prices', 'admin', newPrice({ ticketTypeId: t.adult, audienceId: t.visitor, validFrom: '2026-10-25' })).expect(201);
      await call('post', '/prices', 'admin', newPrice({ ticketTypeId: t.child, audienceId: t.resident, validFrom: '2026-10-25' })).expect(201);
    });

    it('cannot create a price for a switched-off ticket type', async () => {
      const t = await ids();
      await prisma.ticketType.update({ where: { code: 'CHILD' }, data: { isActive: false } });
      expect((await call('post', '/prices', 'admin', newPrice({ ticketTypeId: t.child, audienceId: t.resident })).expect(422)).body.error.code).toBe('TICKET_TYPE_INACTIVE');
    });

    it('two staff members adding the same price at the same moment get exactly one', async () => {
      const t = await ids();
      const results = await Promise.all([1, 2, 3].map(() => call('post', '/prices', 'admin', newPrice({ ticketTypeId: t.adult, audienceId: t.resident }))));
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      const open = await prisma.ticketPrice.findMany({ where: { ticketTypeId: t.adult, audienceId: t.resident, dowMask: 31, validTo: null, isActive: true } });
      expect(open).toHaveLength(1);
    });

    it('switches a price off and on; a ticket without a price cannot be sold', async () => {
      const t = await ids();
      const row = await prisma.ticketPrice.findFirstOrThrow({ where: { ticketTypeId: t.adult, audienceId: t.resident, dowMask: 31 } });
      const off = (await call('put', `/prices/${row.id}/active`, 'admin', { isActive: false }).expect(200)).body.data;
      expect(off).toMatchObject({ isActive: false, status: 'inactive' });
      const quote = () => call('post', '/public/orders/quote', undefined, { visitDate: '2026-10-08', audience: 'RESIDENT', items: [{ ticketType: 'ADULT', quantity: 1 }] });
      expect((await quote().expect(422)).body.error.code).toBe('PRICE_NOT_AVAILABLE');
      await call('put', `/prices/${row.id}/active`, 'admin', { isActive: true }).expect(200);
      await quote().expect(200);
      expect((await audit('price.deactivated'))).toHaveLength(1);
      expect((await audit('price.activated'))).toHaveLength(1);
      await call('put', `/prices/${row.id}/active`, 'analyst', { isActive: false }).expect(403);
    });

    it('refuses to switch a price on when it would overlap an active one', async () => {
      const t = await ids();
      const old = await prisma.ticketPrice.findFirstOrThrow({ where: { ticketTypeId: t.adult, audienceId: t.resident, dowMask: 31 } });
      await call('put', `/prices/${old.id}/active`, 'admin', { isActive: false }).expect(200);
      await call('post', '/prices', 'admin', newPrice({ ticketTypeId: t.adult, audienceId: t.resident, validFrom: '2026-10-20' })).expect(201);
      const res = await call('put', `/prices/${old.id}/active`, 'admin', { isActive: true }).expect(409);
      expect(res.body.error.code).toBe('PRICE_OVERLAP');
    });

    it('has no way to edit an amount or delete a price', async () => {
      const row = await prisma.ticketPrice.findFirstOrThrow();
      await call('put', `/prices/${row.id}`, 'admin', { amountMinor: 1 }).expect(404);
      await call('delete', `/prices/${row.id}`, 'admin').expect(404);
      await call('put', `/prices/${row.id}/active`, 'admin', { isActive: true, amountMinor: 1 }).expect(400);
      expect((await prisma.ticketPrice.findUniqueOrThrow({ where: { id: row.id } })).amountMinor).toBe(row.amountMinor);
    });

    it('shows how many order lines used each price', async () => {
      await paid();
      const list = (await call('get', '/prices', 'admin').expect(200)).body.data;
      expect(list.filter((p: { timesUsed: number }) => p.timesUsed > 0)).toHaveLength(2);
    });
  });

  // ───────────────────────────── orders ─────────────────────────────

  describe('orders', () => {
    it('lists orders newest first with filters and search', async () => {
      const a = await paid();
      clock.advance(60_000);
      const b = await place({ visitDate: '2026-10-09', audience: 'VISITOR' });
      const list = (await call('get', '/orders', 'ops').expect(200)).body;
      expect(list.data.map((o: { orderNumber: string }) => o.orderNumber)).toEqual([b.order.orderNumber, a.order.orderNumber]);
      expect(list.meta).toMatchObject({ total: 2, page: 1 });
      expect(list.data[0]).toMatchObject({ status: 'PENDING_PAYMENT', channel: 'ONLINE', visitDate: '2026-10-09', ticketCount: 3, paymentStatus: 'PENDING', customer: { fullName: 'Mona Hassan', email: 'mona@example.com' } });
      const only = async (q: string) => (await call('get', `/orders?${q}`, 'ops').expect(200)).body.data.map((o: { orderNumber: string }) => o.orderNumber);
      expect(await only('status=PAID')).toEqual([a.order.orderNumber]);
      expect(await only('status=PENDING_PAYMENT')).toEqual([b.order.orderNumber]);
      expect(await only('status=CANCELLED')).toEqual([]);
      expect(await only('visitDate=2026-10-09')).toEqual([b.order.orderNumber]);
      expect(await only(`search=${a.order.orderNumber.toLowerCase()}`)).toEqual([a.order.orderNumber]);
      expect(await only('search=mona@example.com')).toHaveLength(2);
      expect(await only('search=nobody@example.com')).toEqual([]);
      expect((await call('get', '/orders?status=REFUNDED', 'ops').expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      expect((await call('get', '/orders?limit=1&page=2', 'ops').expect(200)).body.data).toHaveLength(1);
    });

    it('shows customer details only to people allowed to see them', async () => {
      const a = await paid();
      // analyst: orders:read and payments:read, but not customers:read
      const list = (await call('get', '/orders', 'analyst').expect(200)).body.data;
      expect(list[0].customer).toBeUndefined();
      expect(JSON.stringify(list)).not.toContain('mona@example.com');
      expect((await call('get', '/orders?search=mona', 'analyst').expect(200)).body.data).toHaveLength(0); // cannot search by what it cannot see
      const detail = (await call('get', `/orders/${await idOf(a.order.orderNumber)}`, 'analyst').expect(200)).body.data;
      expect(detail.customer).toBeUndefined();
      expect(JSON.stringify(detail)).not.toContain('201001234567');
      // a role with orders:read only: no payments, no tickets either
      const role = await prisma.role.create({ data: { code: 'ORDERS_ONLY', name: 'Orders only' } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: (await prisma.permission.findUniqueOrThrow({ where: { code: 'orders:read' } })).id } });
      tokens.only = (await login(app, (await createUser(prisma, { role: 'ORDERS_ONLY' })).email)).accessToken;
      const slim = (await call('get', `/orders/${await idOf(a.order.orderNumber)}`, 'only').expect(200)).body.data;
      expect(slim.payments).toBeUndefined();
      expect(slim.tickets).toBeUndefined();
      expect(slim.customer).toBeUndefined();
      expect(slim.items).toHaveLength(2);
      expect((await call('get', '/orders', 'only').expect(200)).body.data[0].paymentStatus).toBeUndefined();
    });

    it('shows one order in full: date, items, amounts, payment and customer', async () => {
      const a = await paid({ visitDate: '2026-10-10', audience: 'VISITOR' });
      const d = (await call('get', `/orders/${await idOf(a.order.orderNumber)}`, 'ops').expect(200)).body.data;
      expect(d).toMatchObject({ status: 'PAID', channel: 'ONLINE', visitDate: '2026-10-10', totalMinor: 2 * 20000 + 15000, subtotalMinor: 55000, discountMinor: 0, currency: 'EGP', cancelledAt: null, cancelledBy: null });
      expect(d.customer).toMatchObject({ fullName: 'Mona Hassan', email: 'mona@example.com', phone: '+201001234567' });
      expect(d.items.map((i: { typeNameEn: string; unitPriceMinor: number; quantity: number }) => [i.typeNameEn, i.unitPriceMinor, i.quantity])).toEqual([['Adult', 20000, 2], ['Child (2–8 years)', 15000, 1]]);
      expect(d.payments).toHaveLength(1);
      expect(d.payments[0]).toMatchObject({ provider: 'MOCK', method: 'ONLINE', status: 'PAID', amountMinor: 55000 });
      expect(d.ticketCounts).toEqual({ VALID: 3 });
      expect(d.tickets).toHaveLength(3);
      await call('get', '/orders/7b9d8c6e-1b0d-4f4a-9a2e-0f0b6c6d5a11', 'ops').expect(404);
      await call('get', '/orders/not-a-uuid', 'ops').expect(400);
    });

    it('cancels a paid order for a stated reason — as an operational decision, not a refund', async () => {
      const a = await paid();
      const id = await idOf(a.order.orderNumber);
      expect((await call('post', `/orders/${id}/cancel`, 'ops', {}).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      expect((await call('post', `/orders/${id}/cancel`, 'ops', { reason: '   ' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      expect((await call('post', `/orders/${id}/cancel`, 'ops', { reason: 'hey' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      await call('post', `/orders/${id}/cancel`, 'analyst', { reason: 'Park closed by the governor' }).expect(403);
      await call('post', `/orders/${id}/cancel`, 'staff', { reason: 'Park closed by the governor' }).expect(403);
      expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe('PAID');

      const res = await call('post', `/orders/${id}/cancel`, 'ops', { reason: 'Park closed by the governor' }).expect(200);
      expect(res.body.data).toEqual({ orderNumber: a.order.orderNumber, status: 'CANCELLED' });
      const row = await prisma.order.findUniqueOrThrow({ where: { id }, include: { tickets: true, payments: true, cancelledBy: true } });
      expect(row).toMatchObject({ status: 'CANCELLED', cancelReason: 'Park closed by the governor', totalMinor: 13500 });
      expect(row.cancelledAt).not.toBeNull();
      expect(row.cancelledBy?.email).toBe('operations@azharpark.test');
      expect(row.tickets.every((t) => t.status === 'CANCELLED' && t.cancelReason === 'Park closed by the governor' && t.cancelledAt)).toBe(true);
      // the money record is untouched: nothing is "refunded"
      expect(row.payments.map((p) => p.status)).toEqual(['PAID']);
      const [entry] = await audit('order.cancelled');
      expect(entry).toMatchObject({ action: 'order.cancelled', entity: 'order', entityId: id });
      expect(entry.userId).toBe(row.cancelledById);
      expect(entry.newValue).toMatchObject({ status: 'CANCELLED', reason: 'Park closed by the governor' });
      expect(JSON.stringify(entry.newValue).toLowerCase()).toContain('not a refund');
      expect((await audit('order.refunded'))).toHaveLength(0);

      const seen = (await call('get', `/orders/${id}`, 'ops').expect(200)).body.data;
      expect(seen).toMatchObject({ status: 'CANCELLED', cancelReason: 'Park closed by the governor', cancelledBy: 'Dev Operations' });
      // the customer sees it too, and the tickets are no longer valid
      expect((await call('get', `/public/orders/${a.order.orderNumber}`, undefined, undefined, { 'X-Order-Token': a.accessToken }).expect(200)).body.data.status).toBe('CANCELLED');
      expect((await call('post', `/orders/${id}/cancel`, 'ops', { reason: 'Again please' }).expect(409)).body.error.code).toBe('ORDER_ALREADY_CANCELLED');
    });

    it('cancels an unpaid order and stops its payment', async () => {
      const a = await place();
      const id = await idOf(a.order.orderNumber);
      await call('post', `/orders/${id}/cancel`, 'admin', { reason: 'Customer asked us to cancel' }).expect(200);
      const row = await prisma.order.findUniqueOrThrow({ where: { id }, include: { tickets: true, payments: true } });
      expect(row.status).toBe('CANCELLED');
      expect(row.tickets.every((t) => t.status === 'CANCELLED')).toBe(true);
      expect(row.payments.map((p) => p.status)).toEqual(['CANCELLED']);
      const late = await call('post', `/public/payments/mock/${a.payment.providerTxnId}/complete`, undefined, { outcome: 'SUCCESS' }).expect(409);
      expect(late.body.error.code).toBe('PAYMENT_NOT_PENDING');
      expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED');
    });

    it('cannot cancel an expired order or one with a ticket already used', async () => {
      const exp = await place();
      clock.advance(31 * 60_000);
      await app.get(OrderLifecycleService).expireAllDue();
      expect((await call('post', `/orders/${await idOf(exp.order.orderNumber)}/cancel`, 'ops', { reason: 'Clean up please' }).expect(409)).body.error.code).toBe('ORDER_NOT_CANCELLABLE');

      const used = await paid();
      const id = await idOf(used.order.orderNumber);
      await prisma.ticket.updateMany({ where: { orderId: id }, data: { status: 'USED', usedAt: new Date() } });
      expect((await call('post', `/orders/${id}/cancel`, 'ops', { reason: 'Changed our mind' }).expect(409)).body.error.code).toBe('ORDER_HAS_USED_TICKETS');
      expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe('PAID');
    });

    it('moves an order only forward: no way back from cancelled or expired, and no refund', async () => {
      const a = await paid();
      const id = await idOf(a.order.orderNumber);
      await call('post', `/orders/${id}/cancel`, 'ops', { reason: 'Park closed by the governor' }).expect(200);
      await expect(prisma.$executeRawUnsafe(`UPDATE orders SET status = 'PAID'::order_status WHERE id = '${id}'::uuid`)).rejects.toThrow(/illegal order status change/);
      await expect(prisma.$executeRawUnsafe(`UPDATE orders SET status = 'REFUNDED'::order_status WHERE id = '${id}'::uuid`)).rejects.toThrow();
      await expect(prisma.$executeRawUnsafe(`UPDATE payments SET status = 'FAILED'::payment_status WHERE order_id = '${id}'::uuid`)).rejects.toThrow(/illegal payment status change/);
      await expect(prisma.$executeRawUnsafe(`DELETE FROM orders WHERE id = '${id}'::uuid`)).rejects.toThrow();
    });
  });

  // ───────────────────────────── without a payment provider ─────────────────────────────

  describe('production-like: no payment provider configured', () => {
    it('cannot take orders, hides the mock endpoint, and tells the website', async () => {
      const prod = await createTestApp({ TRUST_PROXY: '1', PAYMENT_PROVIDER: 'none' });
      try {
        const req = (method: 'get' | 'post', path: string, body?: object) => request(prod.getHttpServer())[method](`${API}${path}`).set('X-Forwarded-For', nextIp()).send(body);
        expect((await req('get', '/public/tickets/catalog').expect(200)).body.data.onlinePayment).toBe(false);
        const res = await req('post', '/public/orders', orderBody()).expect(503);
        expect(res.body.error.code).toBe('PAYMENT_NOT_AVAILABLE');
        await req('post', '/public/payments/mock/mock_anything/complete', { outcome: 'SUCCESS' }).expect(404);
        expect(await prisma.order.count()).toBe(0);
      } finally {
        await prod.close();
      }
    });
  });
});
