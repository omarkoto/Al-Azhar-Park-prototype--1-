import type { NestExpressApplication } from '@nestjs/platform-express';
import { OrderStatus, PrismaClient, TicketStatus } from '@prisma/client';
import request from 'supertest';
import { Clock } from '../../src/common/clock';
import { generateTicketRef } from '../../src/modules/ticketing/rules/references';
import { QrService } from '../../src/modules/ticketing/qr.service';
import { cairoInstant } from '../helpers/cairo';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { createTestApp, TestClock } from '../helpers/app';
import { API, createUser, login, nextIp } from '../helpers/auth';

const TODAY = '2026-10-07'; // a Wednesday
const NOON = () => cairoInstant(TODAY, '12:00');

describe('portal operations (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let clock: TestClock;
  const tokens: Record<string, string> = {};
  let orderSeq = 0;

  const call = (method: 'get' | 'post' | 'put', path: string, as?: string, body?: object) =>
    request(app.getHttpServer())[method](`${API}${path}`).set('X-Forwarded-For', nextIp()).set(as ? { Authorization: `Bearer ${tokens[as]}` } : {}).send(body);
  const dash = async (as: string) => (await call('get', '/dashboard', as).expect(200)).body.data;
  const audit = (action: string) => prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });

  interface SeedOrder {
    status?: OrderStatus;
    createdAt?: Date;
    visitDate?: string;
    quantity?: number;
    unitMinor?: number;
    ticketStatus?: TicketStatus;
    expiresAt?: Date | null;
    audience?: string;
    type?: string;
  }
  /** Inserts a finished order with its item and tickets directly, at the exact times a test needs. */
  async function seedOrder(o: SeedOrder = {}) {
    const status = o.status ?? 'PAID';
    const type = await prisma.ticketType.findUniqueOrThrow({ where: { code: o.type ?? 'ADULT' } });
    const audience = await prisma.ticketAudience.findUniqueOrThrow({ where: { code: o.audience ?? 'RESIDENT' } });
    const price = await prisma.ticketPrice.findFirstOrThrow({ where: { ticketTypeId: type.id, audienceId: audience.id } });
    const quantity = o.quantity ?? 1;
    const unit = o.unitMinor ?? 5000;
    const visit = new Date(`${o.visitDate ?? TODAY}T00:00:00Z`);
    const customer = await prisma.customer.create({ data: { fullName: 'Seed Customer', email: `seed${orderSeq}@example.test`, phone: '+201000000000' } });
    const order = await prisma.order.create({
      data: {
        orderNumber: `AZP-2026-${String(900000 + ++orderSeq)}`, customerId: customer.id, channel: 'ONLINE', status, visitDate: visit, subtotalMinor: unit * quantity, totalMinor: unit * quantity,
        createdAt: o.createdAt ?? NOON(), paidAt: status === 'PAID' || status === 'CANCELLED' ? (o.createdAt ?? NOON()) : null, expiresAt: o.expiresAt === undefined ? null : o.expiresAt,
        ...(status === 'CANCELLED' ? { cancelledAt: NOON(), cancelReason: 'Seeded cancellation' } : {}),
      },
    });
    const item = await prisma.orderItem.create({
      data: {
        orderId: order.id, ticketTypeId: type.id, audienceId: audience.id, ticketPriceId: price.id, typeNameEn: type.nameEn, typeNameAr: type.nameAr, audienceNameEn: audience.nameEn,
        audienceNameAr: audience.nameAr, unitPriceMinor: unit, quantity, lineTotalMinor: unit * quantity,
      },
    });
    const ticketStatus = o.ticketStatus ?? (status === 'PAID' ? 'VALID' : status === 'CANCELLED' ? 'CANCELLED' : status === 'EXPIRED' ? 'EXPIRED' : 'PENDING');
    const tickets = [];
    for (let i = 0; i < quantity; i += 1) {
      tickets.push(
        await prisma.ticket.create({
          data: {
            publicRef: generateTicketRef(), orderId: order.id, orderItemId: item.id, customerId: customer.id, ticketTypeId: type.id, audienceId: audience.id, visitDate: visit, pricePaidMinor: unit,
            status: ticketStatus, issuedAt: ticketStatus === 'VALID' || ticketStatus === 'USED' ? NOON() : null, usedAt: ticketStatus === 'USED' ? NOON() : null,
            ...(ticketStatus === 'CANCELLED' ? { cancelledAt: NOON(), cancelReason: 'Seeded cancellation' } : {}),
          },
        }),
      );
    }
    return { order, tickets };
  }
  const userId = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  const gate = (code: string) => prisma.gate.findUniqueOrThrow({ where: { code } });
  async function seedScan(o: { at: Date; email?: string; gate?: string; granted?: boolean; detail?: string; ticketId?: string | null }) {
    return prisma.ticketScan.create({
      data: {
        ticketId: o.ticketId ?? null, tokenFingerprint: 'abcdef012345', scannedById: await userId(o.email ?? 'staff@azharpark.test'), gateId: (await gate(o.gate ?? 'MAIN')).id,
        result: o.granted === false ? 'INVALID' : 'VALID', reason: o.granted === false ? (o.detail === 'ALREADY_USED' ? 'ALREADY_USED' : 'INVALID_TOKEN') : 'OK', detail: o.detail ?? (o.granted === false ? 'INVALID_QR' : 'ACCESS_GRANTED'),
        scannedAt: o.at, ip: '10.0.0.7', device: { userAgent: 'Seed' },
      },
    });
  }

  beforeAll(async () => {
    prisma = createTestPrisma(10);
    app = await createTestApp({ TRUST_PROXY: '1' });
    clock = app.get(Clock) as TestClock;
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
    clock.set(NOON());
    orderSeq = 0;
    for (const [k, e] of [['admin', 'admin@azharpark.test'], ['ops', 'operations@azharpark.test'], ['staff', 'staff@azharpark.test'], ['analyst', 'analyst@azharpark.test'], ['content', 'content@azharpark.test'], ['super', 'superadmin@azharpark.test']] as const) {
      tokens[k] = (await login(app, e)).accessToken;
    }
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────── dashboard: who sees what ─────────────────────────────

  describe('dashboard access', () => {
    it('needs a login', async () => {
      await call('get', '/dashboard').expect(401);
    });

    it('shows each person only the sections their permissions already allow', async () => {
      const sections = (d: Record<string, unknown>) => Object.keys(d).filter((k) => !['generatedAt', 'date'].includes(k)).sort();
      expect(sections(await dash('admin'))).toEqual(['activity', 'entry', 'events', 'gates', 'orders', 'park', 'tickets']);
      expect(sections(await dash('ops'))).toEqual(['entry', 'events', 'gates', 'orders', 'park', 'tickets']); // operations cannot read the audit log
      expect(sections(await dash('analyst'))).toEqual(['entry', 'events', 'orders', 'park', 'tickets']); // no gates:read, no audit:read
      expect(sections(await dash('content'))).toEqual(['events', 'park']);
      expect(sections(await dash('staff'))).toEqual(['entry', 'gates']); // ticket staff: scan own, gates
    });

    it('a user with no portal permission at all gets an empty dashboard, not an error and not data', async () => {
      await prisma.role.create({ data: { code: 'NOTHING', name: 'Nothing' } });
      const u = await createUser(prisma, { role: 'NOTHING' });
      tokens.nothing = (await login(app, u.email)).accessToken;
      const d = await dash('nothing');
      expect(Object.keys(d).sort()).toEqual(['date', 'generatedAt']);
    });

    it('revenue and order counts need orders:read, ticket counts need tickets:read', async () => {
      await seedOrder();
      expect((await dash('content')).orders).toBeUndefined();
      expect((await dash('staff')).tickets).toBeUndefined();
      expect((await dash('analyst')).orders.paidToday).toBe(1);
    });
  });

  // ───────────────────────────── dashboard: today's figures ─────────────────────────────

  describe('today\'s orders, revenue and tickets', () => {
    it('counts what was created today by status, and takes the money from stored totals of paid orders', async () => {
      await seedOrder({ quantity: 2, unitMinor: 5000 }); // paid 10000
      await seedOrder({ quantity: 1, unitMinor: 15000, audience: 'VISITOR' }); // paid 15000
      await seedOrder({ status: 'PENDING_PAYMENT', expiresAt: new Date(NOON().getTime() + 10 * 60_000), quantity: 3 });
      await seedOrder({ status: 'CANCELLED', quantity: 1, unitMinor: 9000 });
      await seedOrder({ status: 'EXPIRED', quantity: 1 });
      const o = (await dash('admin')).orders;
      expect(o).toEqual({ createdToday: 5, paidToday: 2, cancelledToday: 1, expiredToday: 1, pendingToday: 1, revenueMinor: 25000, currency: 'EGP', pendingPaymentNow: 1 });
    });

    it('does not count a pending order whose time has run out as waiting', async () => {
      await seedOrder({ status: 'PENDING_PAYMENT', expiresAt: new Date(NOON().getTime() - 60_000) });
      await seedOrder({ status: 'PENDING_PAYMENT', expiresAt: new Date(NOON().getTime() + 60_000), visitDate: '2026-10-20' });
      expect((await dash('admin')).orders.pendingPaymentNow).toBe(1);
    });

    it('uses the Cairo day: midnight in Cairo is the edge, not midnight UTC', async () => {
      await seedOrder({ createdAt: new Date('2026-10-06T20:59:59.999Z') }); // 23:59:59.999 on the 6th in Cairo
      await seedOrder({ createdAt: new Date('2026-10-06T21:00:00.000Z') }); // 00:00:00 on the 7th: today
      await seedOrder({ createdAt: new Date('2026-10-07T20:59:59.999Z') }); // 23:59:59.999 on the 7th: today
      await seedOrder({ createdAt: new Date('2026-10-07T21:00:00.000Z') }); // 00:00:00 on the 8th: tomorrow
      expect((await dash('admin')).orders.createdToday).toBe(2);
      clock.set(cairoInstant('2026-10-08', '00:30:00')); // UTC is still the 7th
      const next = await dash('admin');
      expect(next.date).toBe('2026-10-08');
      expect(next.orders.createdToday).toBe(1);
    });

    it('follows the clock change: Thursday 29 October 2026 is 25 hours long in Cairo (clocks go back at midnight)', async () => {
      clock.set(cairoInstant('2026-10-29', '12:00'));
      await seedOrder({ createdAt: new Date('2026-10-28T20:59:59.999Z'), visitDate: '2026-10-29' }); // 23:59:59 on the 28th: yesterday
      await seedOrder({ createdAt: new Date('2026-10-28T21:00:00.000Z'), visitDate: '2026-10-29' }); // 00:00 on the 29th (UTC+3): today
      await seedOrder({ createdAt: new Date('2026-10-29T21:30:00.000Z'), visitDate: '2026-10-29' }); // the repeated hour: 23:30 on the 29th again (UTC+2)
      await seedOrder({ createdAt: new Date('2026-10-29T21:59:59.999Z'), visitDate: '2026-10-29' }); // 23:59:59.999 (UTC+2): still today
      await seedOrder({ createdAt: new Date('2026-10-29T22:00:00.000Z'), visitDate: '2026-10-30' }); // 00:00 on the 30th: tomorrow
      expect((await dash('admin')).orders.createdToday).toBe(3);
    });

    it('counts tickets by their visit date and their state, not by when they were bought', async () => {
      await seedOrder({ quantity: 3 }); // valid for today
      await seedOrder({ quantity: 2, ticketStatus: 'USED' });
      await seedOrder({ status: 'CANCELLED', quantity: 1 });
      await seedOrder({ status: 'PENDING_PAYMENT', quantity: 4 });
      await seedOrder({ visitDate: '2026-10-08', quantity: 5 }); // tomorrow: not counted
      await seedOrder({ visitDate: '2026-10-06', quantity: 6, createdAt: new Date('2026-10-01T10:00:00Z') }); // yesterday
      const t = (await dash('admin')).tickets;
      expect(t).toEqual({ forToday: 5, valid: 3, used: 2, cancelled: 1, pending: 4, expired: 0 });
    });

    it('never recalculates history: changing the price list changes none of today\'s money', async () => {
      await seedOrder({ quantity: 2, unitMinor: 5000 });
      const before = (await dash('admin')).orders.revenueMinor;
      const adult = await prisma.ticketType.findUniqueOrThrow({ where: { code: 'ADULT' } });
      const resident = await prisma.ticketAudience.findUniqueOrThrow({ where: { code: 'RESIDENT' } });
      await call('post', '/prices', 'admin', { ticketTypeId: adult.id, audienceId: resident.id, days: 'WEEKDAY', amountMinor: 9900, validFrom: TODAY }).expect(201);
      expect((await dash('admin')).orders.revenueMinor).toBe(before);
      expect(before).toBe(10000);
    });
  });

  // ───────────────────────────── dashboard: the park today ─────────────────────────────

  describe('park status', () => {
    const park = async (at: string, date = TODAY) => {
      clock.set(cairoInstant(date, at));
      return (await dash('admin')).park;
    };

    it('says open inside the hours, and before opening and after closing outside them', async () => {
      expect(await park('12:00')).toMatchObject({ status: 'OPEN', opens: '09:00', closes: '22:00', source: 'WEEKLY', special: null });
      expect((await park('08:59')).status).toBe('BEFORE_OPENING');
      expect((await park('09:00')).status).toBe('OPEN');
      expect((await park('21:59')).status).toBe('OPEN');
      expect((await park('22:00')).status).toBe('AFTER_CLOSING');
    });

    it('shows when online sales stop today, from the closing time, and when they are over', async () => {
      expect((await park('12:00')).onlineSales).toEqual({ open: true, closesAt: '21:00' });
      expect((await park('20:59')).onlineSales.open).toBe(true);
      expect((await park('21:00')).onlineSales).toEqual({ open: false, closesAt: null });
    });

    it('follows the opening-hours tables: a changed closing time moves the sales cut-off', async () => {
      await prisma.openingHour.update({ where: { dayOfWeek: 3 }, data: { closes: new Date('1970-01-01T20:00:00Z') } });
      expect(await park('12:00')).toMatchObject({ closes: '20:00', onlineSales: { open: true, closesAt: '19:00' } });
    });

    it('shows a closed day, and the special entry that closed it', async () => {
      await prisma.specialHours.create({ data: { kind: 'TEMPORARY_CLOSURE', dateFrom: new Date(TODAY), dateTo: new Date(TODAY), isClosed: true, labelEn: 'Maintenance day', labelAr: 'يوم صيانة', priority: 10, noteEn: 'Closed for repairs' } });
      expect(await park('12:00')).toMatchObject({ status: 'CLOSED_TODAY', opens: null, closes: null, source: 'SPECIAL', special: { labelEn: 'Maintenance day', kind: 'TEMPORARY_CLOSURE', noteEn: 'Closed for repairs' }, onlineSales: { open: false } });
    });

    it('shows special hours, and ignores switched-off entries', async () => {
      await prisma.specialHours.create({ data: { kind: 'SPECIAL_HOURS', dateFrom: new Date(TODAY), dateTo: new Date(TODAY), isClosed: false, opens: new Date('1970-01-01T10:00:00Z'), closes: new Date('1970-01-01T16:00:00Z'), labelEn: 'Short day', labelAr: 'يوم قصير', priority: 10 } });
      await prisma.specialHours.create({ data: { kind: 'TEMPORARY_CLOSURE', dateFrom: new Date(TODAY), dateTo: new Date(TODAY), isClosed: true, labelEn: 'Off', labelAr: 'x', priority: 5, isActive: false } });
      expect(await park('12:00')).toMatchObject({ status: 'OPEN', opens: '10:00', closes: '16:00', source: 'SPECIAL', special: { labelEn: 'Short day' } });
      expect((await park('17:00')).status).toBe('AFTER_CLOSING');
    });

    it('lists the coming special dates, soonest first, without repeating today\'s', async () => {
      await prisma.specialHours.create({ data: { kind: 'HOLIDAY', dateFrom: new Date('2026-10-20'), dateTo: new Date('2026-10-21'), isClosed: false, opens: new Date('1970-01-01T08:00:00Z'), closes: new Date('1970-01-01T23:00:00Z'), labelEn: 'Holiday', labelAr: 'عطلة', priority: 1 } });
      await prisma.specialHours.create({ data: { kind: 'TEMPORARY_CLOSURE', dateFrom: new Date('2026-10-10'), dateTo: new Date('2026-10-10'), isClosed: true, labelEn: 'Closure', labelAr: 'إغلاق', priority: 1 } });
      await prisma.specialHours.create({ data: { kind: 'HOLIDAY', dateFrom: new Date('2027-03-01'), dateTo: new Date('2027-03-02'), isClosed: true, labelEn: 'Far away', labelAr: 'بعيد', priority: 1 } });
      await prisma.specialHours.create({ data: { kind: 'HOLIDAY', dateFrom: new Date('2026-09-01'), dateTo: new Date('2026-09-02'), isClosed: true, labelEn: 'Past', labelAr: 'مضى', priority: 1 } });
      const upcoming = (await park('12:00')).upcomingSpecial;
      expect(upcoming.map((u: { labelEn: string }) => u.labelEn)).toEqual(['Closure', 'Holiday']);
      expect(upcoming[0]).toMatchObject({ dateFrom: '2026-10-10', isClosed: true });
    });
  });

  // ───────────────────────────── dashboard: entry, gates, events, activity ─────────────────────────────

  describe('entry, gates, events and activity', () => {
    it('counts today\'s scans (not yesterday\'s), splits the refusals by reason, and lists the latest', async () => {
      const { tickets } = await seedOrder({ quantity: 2 });
      await seedScan({ at: new Date(NOON().getTime() - 3 * 60_000), ticketId: tickets[0].id });
      await seedScan({ at: new Date(NOON().getTime() - 2 * 60_000), gate: 'DARASSA', ticketId: tickets[1].id });
      await seedScan({ at: new Date(NOON().getTime() - 1 * 60_000), granted: false, detail: 'ALREADY_USED', ticketId: tickets[0].id });
      await seedScan({ at: new Date(NOON().getTime() - 30_000), granted: false, detail: 'INVALID_QR' });
      await seedScan({ at: new Date('2026-10-06T20:59:59Z'), ticketId: tickets[0].id }); // 23:59:59 yesterday in Cairo
      const e = (await dash('admin')).entry;
      expect(e).toMatchObject({ scope: 'ALL', granted: 2, denied: 2, deniedByReason: { ALREADY_USED: 1, INVALID_QR: 1 } });
      expect(e.recent).toHaveLength(4);
      expect(e.recent[0]).toMatchObject({ granted: false, result: 'INVALID_QR', ticketRef: null, staff: 'Dev Ticket Staff' });
      expect(e.recent[3]).toMatchObject({ granted: true, result: 'ACCESS_GRANTED', gate: { code: 'MAIN' }, ticketRef: tickets[0].publicRef });
    });

    it('never shows the scanned text, its fingerprint or the client address', async () => {
      await seedScan({ at: NOON() });
      const text = JSON.stringify((await dash('admin')).entry);
      for (const secret of ['abcdef012345', '10.0.0.7', 'Seed', 'fingerprint', 'userAgent', 'AZP1']) expect(text).not.toContain(secret);
    });

    it('shows ticket staff only their own scans, and no staff names', async () => {
      await seedScan({ at: NOON(), email: 'staff@azharpark.test' });
      await seedScan({ at: NOON(), email: 'operations@azharpark.test' });
      await seedScan({ at: NOON(), email: 'operations@azharpark.test', granted: false });
      const e = (await dash('staff')).entry;
      expect(e).toMatchObject({ scope: 'OWN', granted: 1, denied: 0 });
      expect(e.recent).toHaveLength(1);
      expect(e.recent[0].staff).toBeUndefined();
      expect((await dash('ops')).entry).toMatchObject({ scope: 'ALL', granted: 2, denied: 1 });
    });

    it('lists every gate with today\'s entries, but only people who may read scans see the counts', async () => {
      await prisma.gate.update({ where: { code: 'DARASSA' }, data: { isActive: false } });
      await seedScan({ at: NOON(), gate: 'MAIN' });
      await seedScan({ at: NOON(), gate: 'MAIN' });
      await seedScan({ at: NOON(), gate: 'MAIN', granted: false });
      const full = (await dash('admin')).gates;
      expect(full.map((g: { code: string; isActive: boolean; entriesToday: number }) => [g.code, g.isActive, g.entriesToday])).toEqual([['DARASSA', false, 0], ['MAIN', true, 2]]);
      const staff = (await dash('staff')).gates;
      expect(staff.map((g: { code: string }) => g.code)).toEqual(['DARASSA', 'MAIN']);
      expect(staff[0].entriesToday).toBeUndefined();
    });

    it('lists today\'s events and the next ones, hides cancelled and archived, and keeps Cairo days', async () => {
      await prisma.event.deleteMany(); // the development events are not part of this test
      const mk = (slug: string, status: 'DRAFT' | 'COMING_SOON' | 'PUBLISHED' | 'CANCELLED' | 'ARCHIVED', startsAt: Date, endsAt: Date | null = null) =>
        prisma.event.create({ data: { slug, titleEn: `E ${slug}`, titleAr: `ح ${slug}`, shortDescriptionEn: 'Short description here', shortDescriptionAr: 'وصف قصير هنا', descriptionEn: 'Long description here.', descriptionAr: 'وصف طويل هنا.', status, startsAt, endsAt } });
      await mk('tonight', 'PUBLISHED', cairoInstant(TODAY, '20:00'), cairoInstant('2026-10-08', '01:00'));
      await mk('early', 'COMING_SOON', cairoInstant(TODAY, '00:30'), cairoInstant(TODAY, '02:00'));
      await mk('yesterday-late', 'PUBLISHED', cairoInstant('2026-10-06', '23:30'), cairoInstant(TODAY, '01:30'));
      await mk('draft-next', 'DRAFT', cairoInstant('2026-10-12', '18:00'), cairoInstant('2026-10-12', '20:00'));
      await mk('cancelled', 'CANCELLED', cairoInstant(TODAY, '15:00'), cairoInstant(TODAY, '16:00'));
      await mk('archived', 'ARCHIVED', cairoInstant('2026-10-15', '15:00'), cairoInstant('2026-10-15', '16:00'));
      await mk('later', 'PUBLISHED', cairoInstant('2026-11-01', '18:00'), cairoInstant('2026-11-01', '20:00'));
      const e = (await dash('content')).events;
      expect(e.today.map((x: { titleEn: string }) => x.titleEn)).toEqual(['E early', 'E tonight']);
      expect(e.today[1]).toMatchObject({ status: 'PUBLISHED', date: TODAY, startTime: '20:00', endTime: '01:00' });
      expect(e.upcoming.map((x: { titleEn: string; status: string }) => [x.titleEn, x.status])).toEqual([['E draft-next', 'DRAFT'], ['E later', 'PUBLISHED']]);
    });

    it('shows recent staff activity to people who may read the audit log: who and what, not the values, not sign-ins', async () => {
      await call('put', `/gates/${(await gate('MAIN')).id}`, 'admin', { nameEn: 'Main gate', nameAr: 'البوابة الرئيسية' }).expect(200);
      const a = (await dash('admin')).activity;
      expect(a[0]).toMatchObject({ action: 'gate.updated', entity: 'gate', actor: 'Dev Admin' });
      expect(a.some((x: { action: string }) => x.action.startsWith('auth.'))).toBe(false);
      expect(JSON.stringify(a)).not.toMatch(/oldValue|newValue|Main gate/);
      expect((await dash('ops')).activity).toBeUndefined();
    });
  });

  // ───────────────────────────── tickets ─────────────────────────────

  describe('tickets', () => {
    it('is only for people with tickets:read', async () => {
      const { tickets } = await seedOrder();
      await call('get', '/tickets').expect(401);
      for (const who of ['staff', 'content']) {
        await call('get', '/tickets', who).expect(403);
        await call('get', `/tickets/${tickets[0].id}`, who).expect(403);
      }
      for (const who of ['analyst', 'ops', 'admin']) await call('get', '/tickets', who).expect(200);
    });

    it('lists tickets with their order, type, audience, price and state, newest first, with paging', async () => {
      await seedOrder({ quantity: 3, createdAt: new Date('2026-10-05T10:00:00Z') });
      const second = await seedOrder({ quantity: 2, audience: 'VISITOR', type: 'CHILD', unitMinor: 10000, ticketStatus: 'USED' });
      const res = (await call('get', '/tickets?limit=3', 'admin').expect(200)).body;
      expect(res.meta).toMatchObject({ total: 5, page: 1, limit: 3, totalPages: 2 });
      expect(res.data).toHaveLength(3);
      expect(res.data[0]).toMatchObject({ orderNumber: second.order.orderNumber, status: 'USED', typeNameEn: 'Child (2–8 years)', audienceNameEn: 'Non-resident visitor', pricePaidMinor: 10000, currency: 'EGP', visitDate: TODAY });
      expect((await call('get', '/tickets?limit=3&page=2', 'admin').expect(200)).body.data).toHaveLength(2);
    });

    it('filters by status, visit date, ticket type, audience and finds by ticket or order number', async () => {
      const a = await seedOrder({ quantity: 2 });
      await seedOrder({ visitDate: '2026-10-09', audience: 'VISITOR', unitMinor: 15000 });
      await seedOrder({ type: 'CHILD', unitMinor: 3500, ticketStatus: 'USED' });
      await seedOrder({ status: 'CANCELLED' });
      const n = async (q: string) => (await call('get', `/tickets?${q}`, 'admin').expect(200)).body.meta.total as number;
      expect(await n('')).toBe(5);
      expect(await n('status=VALID')).toBe(3);
      expect(await n('status=USED')).toBe(1);
      expect(await n('status=CANCELLED')).toBe(1);
      expect(await n('status=PENDING')).toBe(0);
      expect(await n(`visitDate=${TODAY}`)).toBe(4);
      expect(await n('visitDate=2026-10-09')).toBe(1);
      expect(await n('ticketType=CHILD')).toBe(1);
      expect(await n('audience=VISITOR')).toBe(1);
      expect(await n('ticketType=ADULT&audience=RESIDENT&status=VALID')).toBe(2);
      expect(await n(`search=${a.tickets[0].publicRef.toLowerCase()}`)).toBe(1);
      expect(await n(`search=${a.order.orderNumber}`)).toBe(2);
      expect(await n('search=TKT-NOPE')).toBe(0);
      await call('get', '/tickets?status=REFUNDED', 'admin').expect(400);
      await call('get', '/tickets?visitDate=2026-02-30', 'admin').expect(400);
      await call('get', '/tickets?ticketType=bad%20code', 'admin').expect(400);
    });

    it('shows no customer details in the list or the detail', async () => {
      const { tickets } = await seedOrder();
      const list = JSON.stringify((await call('get', '/tickets', 'admin').expect(200)).body);
      const detail = JSON.stringify((await call('get', `/tickets/${tickets[0].id}`, 'admin').expect(200)).body);
      for (const text of [list, detail]) for (const pii of ['Seed Customer', 'seed1@example.test', '+201000000000']) expect(text).not.toContain(pii);
    });

    it('shows one ticket in full, with its order; payment state and scan history only to those allowed', async () => {
      const { order, tickets } = await seedOrder();
      await prisma.payment.create({ data: { orderId: order.id, provider: 'MOCK', method: 'ONLINE', amountMinor: 5000, status: 'PAID', paidAt: NOON() } });
      await seedScan({ at: NOON(), ticketId: tickets[0].id, granted: false, detail: 'WRONG_DATE' });
      const full = (await call('get', `/tickets/${tickets[0].id}`, 'admin').expect(200)).body.data;
      expect(full).toMatchObject({
        ref: tickets[0].publicRef, status: 'VALID', visitDate: TODAY, pricePaidMinor: 5000, qrIssued: true, paymentStatus: 'PAID',
        order: { orderNumber: order.orderNumber, status: 'PAID', totalMinor: 5000 },
      });
      expect(full.scans).toHaveLength(1);
      expect(full.scans[0]).toMatchObject({ granted: false, result: 'WRONG_DATE', gate: { code: 'MAIN' }, staff: 'Dev Ticket Staff' });
      expect(JSON.stringify(full)).not.toMatch(/abcdef012345|10\.0\.0\.7/);
      const ops = (await call('get', `/tickets/${tickets[0].id}`, 'ops').expect(200)).body.data; // operations: payments:read yes, scans:read yes
      expect(ops.paymentStatus).toBe('PAID');
      await call('get', '/tickets/7b9d8c6e-1b0d-4f4a-9a2e-0f0b6c6d5a11', 'admin').expect(404);
      await call('get', '/tickets/not-a-uuid', 'admin').expect(400);
    });

    it('shows whether a ticket was used and by whom, and that an unpaid ticket has no code', async () => {
      const used = await seedOrder({ ticketStatus: 'USED' });
      await prisma.ticket.update({ where: { id: used.tickets[0].id }, data: { usedById: await userId('staff@azharpark.test') } });
      const pending = await seedOrder({ status: 'PENDING_PAYMENT' });
      const u = (await call('get', `/tickets/${used.tickets[0].id}`, 'admin').expect(200)).body.data;
      expect(u).toMatchObject({ status: 'USED', qrIssued: true, usedByName: 'Dev Ticket Staff' });
      expect(u.usedAt).not.toBeNull();
      const p = (await call('get', `/tickets/${pending.tickets[0].id}`, 'admin').expect(200)).body.data;
      expect(p).toMatchObject({ status: 'PENDING', qrIssued: false });
    });

    it('has no way to edit a ticket or move its status', async () => {
      const { tickets } = await seedOrder();
      for (const method of ['put', 'post'] as const) {
        await call(method, `/tickets/${tickets[0].id}`, 'admin', { status: 'USED', pricePaidMinor: 1 }).expect(404);
        await call(method, `/tickets/${tickets[0].id}/status`, 'admin', { status: 'USED' }).expect(404);
      }
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[0].id } })).status).toBe('VALID');
    });

    it('gives the PDF to staff who may re-deliver tickets, audits it, and refuses unusable tickets', async () => {
      const { tickets } = await seedOrder({ quantity: 2 });
      await prisma.ticket.update({ where: { id: tickets[1].id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Test reason' } });
      const get = (id: string, who: string) =>
        request(app.getHttpServer()).get(`${API}/tickets/${id}/pdf`).set('X-Forwarded-For', nextIp()).set({ Authorization: `Bearer ${tokens[who]}` }).buffer(true).parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      await call('get', `/tickets/${tickets[0].id}/pdf`).expect(401);
      expect((await get(tickets[0].id, 'analyst')).status).toBe(403); // can read tickets but not re-deliver them
      expect((await get(tickets[0].id, 'staff')).status).toBe(403);
      const ok = await get(tickets[0].id, 'ops');
      expect(ok.status).toBe(200);
      expect(ok.headers['content-type']).toBe('application/pdf');
      expect(ok.headers['cache-control']).toBe('private, no-store');
      expect((ok.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect(await audit('ticket.pdf_downloaded')).toHaveLength(1);
      expect((await get(tickets[1].id, 'ops')).status).toBe(409);
      expect(await audit('ticket.pdf_downloaded')).toHaveLength(1);
    });
  });

  // ───────────────────────────── scans ─────────────────────────────

  describe('scan list', () => {
    it('shows everything to scans:read, only your own to scans:read_own, nothing to others', async () => {
      await seedScan({ at: NOON(), email: 'staff@azharpark.test' });
      await seedScan({ at: NOON(), email: 'operations@azharpark.test', granted: false });
      await call('get', '/scans').expect(401);
      for (const who of ['content']) await call('get', '/scans', who).expect(403);
      const all = (await call('get', '/scans', 'ops').expect(200)).body;
      expect(all.meta.total).toBe(2);
      expect(all.data.map((r: { staff: string }) => r.staff).sort()).toEqual(['Dev Operations', 'Dev Ticket Staff']);
      const own = (await call('get', '/scans', 'staff').expect(200)).body;
      expect(own.meta.total).toBe(1);
      expect(own.data[0].staff).toBeUndefined();
      expect(own.data[0]).toMatchObject({ granted: true, result: 'ACCESS_GRANTED', gate: { code: 'MAIN' } });
    });

    it('filters by outcome, gate and Cairo day, and finds by ticket reference', async () => {
      const { tickets } = await seedOrder();
      await seedScan({ at: NOON(), ticketId: tickets[0].id });
      await seedScan({ at: NOON(), gate: 'DARASSA', granted: false });
      await seedScan({ at: new Date('2026-10-07T21:30:00Z') }); // 00:30 on the 8th in Cairo
      const n = async (q: string) => (await call('get', `/scans?${q}`, 'admin').expect(200)).body.meta.total as number;
      expect(await n('outcome=granted')).toBe(2);
      expect(await n('outcome=denied')).toBe(1);
      expect(await n(`gateId=${(await gate('DARASSA')).id}`)).toBe(1);
      expect(await n(`date=${TODAY}`)).toBe(2);
      expect(await n('date=2026-10-08')).toBe(1);
      expect(await n(`search=${tickets[0].publicRef}`)).toBe(1);
      await call('get', '/scans?outcome=maybe', 'admin').expect(400);
      await call('get', '/scans?gateId=nope', 'admin').expect(400);
    });

    it('never returns the scanned text, its fingerprint, the signature, the address or the device', async () => {
      await seedScan({ at: NOON() });
      const text = JSON.stringify((await call('get', '/scans', 'admin').expect(200)).body);
      for (const secret of ['abcdef012345', '10.0.0.7', 'tokenFingerprint', '"ip"', '"device"', 'AZP1']) expect(text).not.toContain(secret);
    });

    it('reflects real gate scans made through the scanner', async () => {
      const qr = app.get(QrService);
      const { tickets } = await seedOrder();
      const g = await gate('MAIN');
      await call('post', '/scans', 'staff', { qr: qr.payloadFor(tickets[0]), gateId: g.id }).expect(200);
      clock.advance(5_000); // the test clock stands still, so give the second scan its own time
      await call('post', '/scans', 'staff', { qr: qr.payloadFor(tickets[0]), gateId: g.id }).expect(200);
      const list = (await call('get', '/scans', 'admin').expect(200)).body.data;
      expect(list.map((r: { result: string }) => r.result)).toEqual(['ALREADY_USED', 'ACCESS_GRANTED']);
      const e = (await dash('admin')).entry;
      expect(e).toMatchObject({ granted: 1, denied: 1, deniedByReason: { ALREADY_USED: 1 } });
      expect((await dash('admin')).tickets).toMatchObject({ used: 1, valid: 0 });
    });
  });

  // ───────────────────────────── gates ─────────────────────────────

  describe('gate management', () => {
    it('needs gates:read to look and gates:write to change', async () => {
      const main = await gate('MAIN');
      await call('get', '/gates').expect(401);
      await call('get', '/gates', 'analyst').expect(403);
      await call('get', '/gates', 'content').expect(403);
      for (const who of ['staff', 'ops', 'admin']) await call('get', '/gates', who).expect(200);
      for (const who of ['staff', 'ops', 'analyst']) {
        await call('post', '/gates', who, { code: 'NORTH', nameEn: 'North gate', nameAr: 'البوابة الشمالية' }).expect(403);
        await call('put', `/gates/${main.id}`, who, { nameEn: 'Renamed', nameAr: 'اسم' }).expect(403);
        await call('put', `/gates/${main.id}/active`, who, { isActive: false }).expect(403);
      }
      expect((await gate('MAIN')).isActive).toBe(true);
      await call('post', '/gates', 'admin', { code: 'NORTH', nameEn: 'North gate', nameAr: 'البوابة الشمالية' }).expect(201);
    });

    it('lists every gate including switched-off ones, with usage only for people who may read scans', async () => {
      await prisma.gate.update({ where: { code: 'DARASSA' }, data: { isActive: false } });
      await seedScan({ at: NOON() });
      await seedScan({ at: NOON(), granted: false });
      await seedScan({ at: new Date('2026-10-01T10:00:00Z') });
      const admin = (await call('get', '/gates', 'admin').expect(200)).body.data;
      expect(admin.map((g: { code: string; isActive: boolean }) => [g.code, g.isActive])).toEqual([['DARASSA', false], ['MAIN', true]]);
      expect(admin[1].usage).toMatchObject({ entriesToday: 1, deniedToday: 1, totalScans: 3 });
      expect(admin[1].usage.lastScanAt).not.toBeNull();
      expect(admin[0].usage).toMatchObject({ entriesToday: 0, totalScans: 0, lastScanAt: null });
      expect((await call('get', '/gates', 'staff').expect(200)).body.data[0].usage).toBeUndefined();
    });

    it('creates a gate with a unique capital-letter code, audited', async () => {
      const res = (await call('post', '/gates', 'admin', { code: 'north_2', nameEn: ' North gate ', nameAr: 'البوابة الشمالية' }).expect(201)).body.data;
      expect(res).toMatchObject({ code: 'NORTH_2', nameEn: 'North gate', isActive: true });
      expect((await call('post', '/gates', 'admin', { code: 'NORTH_2', nameEn: 'Again', nameAr: 'مرة' }).expect(409)).body.error.code).toBe('GATE_CODE_TAKEN');
      for (const bad of [{ code: 'x' }, { code: 'has space' }, { code: '1ABC' }, { nameEn: 'N' }, { nameAr: '' }, { extra: true }]) {
        expect((await call('post', '/gates', 'admin', { code: 'OK_CODE', nameEn: 'Name', nameAr: 'اسم', ...bad }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      }
      const [entry] = await audit('gate.created');
      expect(entry).toMatchObject({ entity: 'gate', entityId: res.id });
      expect(entry.userId).not.toBeNull();
    });

    it('renames a gate but never changes its code, and audits both values', async () => {
      const main = await gate('MAIN');
      const res = (await call('put', `/gates/${main.id}`, 'admin', { nameEn: 'Main gate', nameAr: 'البوابة الرئيسية' }).expect(200)).body.data;
      expect(res).toMatchObject({ code: 'MAIN', nameEn: 'Main gate' });
      expect((await call('put', `/gates/${main.id}`, 'admin', { code: 'OTHER', nameEn: 'Main gate', nameAr: 'البوابة' }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      expect((await gate('MAIN')).nameEn).toBe('Main gate');
      const [entry] = await audit('gate.updated');
      expect(entry.oldValue).toMatchObject({ nameEn: 'Main entrance' });
      expect(entry.newValue).toMatchObject({ nameEn: 'Main gate' });
      await call('put', '/gates/7b9d8c6e-1b0d-4f4a-9a2e-0f0b6c6d5a11', 'admin', { nameEn: 'Name', nameAr: 'اسم' }).expect(404);
    });

    it('switching a gate off stops new scans at it, keeps its history, and switching on restores it', async () => {
      const qr = app.get(QrService);
      const { tickets } = await seedOrder({ quantity: 2 });
      const main = await gate('MAIN');
      await call('post', '/scans', 'staff', { qr: qr.payloadFor(tickets[0]), gateId: main.id }).expect(200);
      expect((await call('put', `/gates/${main.id}/active`, 'admin', { isActive: false }).expect(200)).body.data.isActive).toBe(false);
      expect((await call('post', '/scans', 'staff', { qr: qr.payloadFor(tickets[1]), gateId: main.id }).expect(422)).body.error.code).toBe('GATE_INACTIVE');
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: tickets[1].id } })).status).toBe('VALID'); // nobody was let in
      expect((await call('get', '/scans/gates', 'staff').expect(200)).body.data.map((g: { code: string }) => g.code)).toEqual(['DARASSA']);
      expect(await prisma.ticketScan.count({ where: { gateId: main.id } })).toBe(1); // the earlier entry is still on record, still at that gate
      const history = (await call('get', `/scans?gateId=${main.id}`, 'admin').expect(200)).body;
      expect(history.meta.total).toBe(1);
      await call('put', `/gates/${main.id}/active`, 'admin', { isActive: true }).expect(200);
      expect((await call('post', '/scans', 'staff', { qr: qr.payloadFor(tickets[1]), gateId: main.id }).expect(200)).body.data.result).toBe('ACCESS_GRANTED');
      expect((await audit('gate.deactivated')).length).toBe(1);
      expect((await audit('gate.activated')).length).toBe(1);
    });

    it('switching to the state it already has changes nothing and writes no audit entry', async () => {
      const main = await gate('MAIN');
      await call('put', `/gates/${main.id}/active`, 'admin', { isActive: true }).expect(200);
      expect(await audit('gate.activated')).toHaveLength(0);
      await call('put', `/gates/${main.id}/active`, 'admin', { isActive: 'yes' }).expect(400);
    });

    it('has no way to delete a gate', async () => {
      const main = await gate('MAIN');
      await request(app.getHttpServer()).delete(`${API}/gates/${main.id}`).set({ Authorization: `Bearer ${tokens.super}` }).expect(404);
      expect(await prisma.gate.count()).toBe(2);
    });
  });

  // ───────────────────────────── orders: find by ticket ─────────────────────────────

  describe('orders', () => {
    it('can be found by the reference of one of their tickets', async () => {
      const a = await seedOrder({ quantity: 2 });
      await seedOrder();
      const res = (await call('get', `/orders?search=${a.tickets[1].publicRef.toLowerCase()}`, 'admin').expect(200)).body;
      expect(res.meta.total).toBe(1);
      expect(res.data[0].orderNumber).toBe(a.order.orderNumber);
    });
  });
});
