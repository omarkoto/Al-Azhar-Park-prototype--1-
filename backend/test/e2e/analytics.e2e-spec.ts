import type { NestExpressApplication } from '@nestjs/platform-express';
import { OrderStatus, PrismaClient, TicketStatus } from '@prisma/client';
import request from 'supertest';
import { Clock } from '../../src/common/clock';
import { QrService } from '../../src/modules/ticketing/qr.service';
import { generateTicketRef } from '../../src/modules/ticketing/rules/references';
import { cairoInstant } from '../helpers/cairo';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { createTestApp, TestClock } from '../helpers/app';
import { API, createUser, login, nextIp } from '../helpers/auth';

const TODAY = '2026-10-07'; // a Wednesday
const NOON = () => cairoInstant(TODAY, '12:00');
const at = (date: string, time: string) => cairoInstant(date, time);

interface Line {
  type?: string;
  audience?: string;
  qty?: number;
  unit?: number;
  /** the status of each ticket of this line (default: all the order's own) */
  tickets?: TicketStatus[];
}
interface SeedOrder {
  status?: OrderStatus;
  /** when the order was placed */
  created?: Date;
  visit?: string;
  lines?: Line[];
  /** a cancelled order that WAS paid first (the only kind of cancelled order that is a cancelled sale) */
  wasPaid?: boolean;
}

describe('analytics and reports (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let clock: TestClock;
  let qr: QrService;
  const tokens: Record<string, string> = {};
  let seq = 0;

  const anon = (path: string) => request(app.getHttpServer()).get(`${API}${path}`).set('X-Forwarded-For', nextIp());
  const call = (path: string, as = 'admin') => request(app.getHttpServer()).get(`${API}${path}`).set('X-Forwarded-For', nextIp()).set({ Authorization: `Bearer ${tokens[as]}` });
  const get = async (path: string, as = 'admin') => (await call(path, as).expect(200)).body.data;
  const csv = async (path: string, as = 'admin') => {
    const res = await call(path, as).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    return { status: res.status, headers: res.headers, bytes: res.body as Buffer, text: (res.body as Buffer).toString('utf8') };
  };
  /** The rows of a CSV the way a spreadsheet reads it (quotes, commas, line breaks inside quotes). */
  const parseCsv = (text: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    const body = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < body.length; i += 1) {
      const c = body[i];
      if (quoted) {
        if (c === '"' && body[i + 1] === '"') { cell += '"'; i += 1; }
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\r' && body[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; }
      else cell += c;
    }
    return rows;
  };

  async function seedOrder(o: SeedOrder = {}) {
    const status = o.status ?? 'PAID';
    const created = o.created ?? NOON();
    const lines = o.lines ?? [{}];
    const visit = new Date(`${o.visit ?? TODAY}T00:00:00Z`);
    const customer = await prisma.customer.create({ data: { fullName: 'Private Person', email: `private${seq}@example.test`, phone: '+201099999999' } });
    const resolved = [];
    let total = 0;
    for (const l of lines) {
      const type = await prisma.ticketType.findUniqueOrThrow({ where: { code: l.type ?? 'ADULT' } });
      const audience = await prisma.ticketAudience.findUniqueOrThrow({ where: { code: l.audience ?? 'RESIDENT' } });
      const price = await prisma.ticketPrice.findFirstOrThrow({ where: { ticketTypeId: type.id, audienceId: audience.id } });
      const qty = l.qty ?? 1;
      const unit = l.unit ?? 5000;
      total += qty * unit;
      resolved.push({ l, type, audience, price, qty, unit });
    }
    const paid = status === 'PAID' || (status === 'CANCELLED' && o.wasPaid);
    const order = await prisma.order.create({
      data: {
        orderNumber: `AZP-2026-${String(800000 + ++seq)}`, customerId: customer.id, channel: 'ONLINE', status, visitDate: visit, subtotalMinor: total, totalMinor: total, createdAt: created,
        paidAt: paid ? created : null, expiresAt: status === 'PENDING_PAYMENT' ? new Date(created.getTime() + 30 * 60_000) : null,
        ...(status === 'CANCELLED' ? { cancelledAt: created, cancelReason: 'Seeded cancellation' } : {}),
      },
    });
    const tickets = [];
    for (const { l, type, audience, price, qty, unit } of resolved) {
      const item = await prisma.orderItem.create({
        data: { orderId: order.id, ticketTypeId: type.id, audienceId: audience.id, ticketPriceId: price.id, typeNameEn: type.nameEn, typeNameAr: type.nameAr, audienceNameEn: audience.nameEn, audienceNameAr: audience.nameAr, unitPriceMinor: unit, quantity: qty, lineTotalMinor: unit * qty },
      });
      for (let i = 0; i < qty; i += 1) {
        const st: TicketStatus = l.tickets?.[i] ?? (status === 'PAID' ? 'VALID' : status === 'CANCELLED' ? 'CANCELLED' : status === 'EXPIRED' ? 'EXPIRED' : 'PENDING');
        tickets.push(
          await prisma.ticket.create({
            data: {
              publicRef: generateTicketRef(), orderId: order.id, orderItemId: item.id, customerId: customer.id, ticketTypeId: type.id, audienceId: audience.id, visitDate: visit, pricePaidMinor: unit, status: st,
              issuedAt: st === 'VALID' || st === 'USED' ? created : null, usedAt: st === 'USED' ? created : null,
              ...(st === 'CANCELLED' ? { cancelledAt: created, cancelReason: 'Seeded cancellation' } : {}),
            },
          }),
        );
      }
    }
    return { order, tickets };
  }

  const gate = (code: string) => prisma.gate.findUniqueOrThrow({ where: { code } });
  /** A real scan through the scanner endpoint, at the instant the test sets. */
  async function scan(code: string, when: Date, gateCode = 'MAIN', as = 'staff') {
    clock.set(when);
    const res = await request(app.getHttpServer()).post(`${API}/scans`).set('X-Forwarded-For', nextIp()).set({ Authorization: `Bearer ${tokens[as]}` }).send({ qr: code, gateId: (await gate(gateCode)).id }).expect(200);
    clock.set(NOON());
    return res.body.data.result as string;
  }

  beforeAll(async () => {
    prisma = createTestPrisma(10);
    app = await createTestApp({ TRUST_PROXY: '1' });
    clock = app.get(Clock) as TestClock;
    qr = app.get(QrService);
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
    clock.set(NOON());
    seq = 0;
    for (const [k, e] of [['admin', 'admin@azharpark.test'], ['analyst', 'analyst@azharpark.test'], ['ops', 'operations@azharpark.test'], ['content', 'content@azharpark.test'], ['staff', 'staff@azharpark.test'], ['super', 'superadmin@azharpark.test']] as const) {
      tokens[k] = (await login(app, e)).accessToken;
    }
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────── who may see what ─────────────────────────────

  describe('permissions (the existing analytics permissions, nothing new)', () => {
    const paths = ['overview', 'sales', 'attendance', 'tickets', 'events'];

    it('needs a login', async () => {
      for (const p of paths) await anon(`/analytics/${p}`).expect(401);
      await anon('/analytics/export/sales').expect(401);
    });

    it('analytics:read opens everything, analytics:operations only entry and tickets, analytics:content only events', async () => {
      const status = async (who: string) => Object.fromEntries(await Promise.all(['sales', 'attendance', 'tickets', 'events'].map(async (p) => [p, (await call(`/analytics/${p}?range=today`, who)).status])));
      expect(await status('admin')).toEqual({ sales: 200, attendance: 200, tickets: 200, events: 200 });
      expect(await status('analyst')).toEqual({ sales: 200, attendance: 200, tickets: 200, events: 200 });
      expect(await status('super')).toEqual({ sales: 200, attendance: 200, tickets: 200, events: 200 });
      expect(await status('ops')).toEqual({ sales: 403, attendance: 200, tickets: 200, events: 403 });
      expect(await status('content')).toEqual({ sales: 403, attendance: 403, tickets: 403, events: 200 });
      expect(await status('staff')).toEqual({ sales: 403, attendance: 403, tickets: 403, events: 403 });
    });

    it('the overview holds only the sections the caller may see, and refuses someone with none', async () => {
      const keys = async (who: string) => Object.keys(await get('/analytics/overview?range=today', who)).filter((k) => !['range', 'basis'].includes(k)).sort();
      expect(await keys('admin')).toEqual(['attendance', 'events', 'sales', 'tickets']);
      expect(await keys('ops')).toEqual(['attendance', 'tickets']);
      expect(await keys('content')).toEqual(['events']);
      await call('/analytics/overview?range=today', 'staff').expect(403);
    });

    it('a user with no permissions at all, and a role that holds only operational permissions, get nothing', async () => {
      await prisma.role.create({ data: { code: 'NOTHING', name: 'Nothing' } });
      const user = await createUser(prisma, { role: 'NOTHING' });
      tokens.nothing = (await login(app, user.email)).accessToken;
      for (const p of paths) await call(`/analytics/${p}`, 'nothing').expect(403);
      await call('/analytics/export/sales', 'nothing').expect(403);
      // orders:read and payments:read do not open analytics: only the analytics permissions do
      const role = await prisma.role.create({ data: { code: 'ORDERS_ONLY', name: 'Orders only' } });
      for (const code of ['orders:read', 'payments:read', 'tickets:read', 'scans:read']) {
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: (await prisma.permission.findUniqueOrThrow({ where: { code } })).id } });
      }
      const other = await createUser(prisma, { role: 'ORDERS_ONLY' });
      tokens.other = (await login(app, other.email)).accessToken;
      for (const p of paths) await call(`/analytics/${p}`, 'other').expect(403);
    });

    it('exports follow the same rules, report by report', async () => {
      const code = async (report: string, who: string) => (await csv(`/analytics/export/${report}?range=today`, who)).status;
      for (const report of ['sales', 'attendance', 'tickets', 'gates', 'scans', 'events']) expect({ report, status: await code(report, 'admin') }).toEqual({ report, status: 200 });
      expect(await code('sales', 'ops')).toBe(403);
      for (const report of ['attendance', 'tickets', 'gates', 'scans']) expect({ report, status: await code(report, 'ops') }).toEqual({ report, status: 200 });
      expect(await code('events', 'ops')).toBe(403);
      expect(await code('events', 'content')).toBe(200);
      for (const report of ['sales', 'attendance', 'tickets', 'gates', 'scans']) expect({ report, status: await code(report, 'content') }).toEqual({ report, status: 403 });
      for (const report of ['sales', 'attendance', 'events']) expect(await code(report, 'staff')).toBe(403);
      expect((await call('/analytics/export/everything?range=today', 'admin')).status).toBe(400);
    });

    it('no money appears in anything an operations user can fetch', async () => {
      await seedOrder({ lines: [{ qty: 2, unit: 5000 }] });
      const text = JSON.stringify([await get('/analytics/overview?range=today', 'ops'), await get('/analytics/attendance?range=today', 'ops'), await get('/analytics/tickets?range=today&basis=visit', 'ops')]);
      expect(text).not.toMatch(/Minor|revenue|paidSales|"value"/i);
    });
  });

  // ───────────────────────────── periods ─────────────────────────────

  describe('periods', () => {
    it('ready-made ranges are worked out in Cairo and reported back', async () => {
      const r = async (q: string) => (await get(`/analytics/sales?${q}`)).range;
      expect(await r('range=today')).toEqual({ key: 'today', from: TODAY, to: TODAY, days: 1, granularity: 'day' });
      expect(await r('range=yesterday')).toMatchObject({ from: '2026-10-06', to: '2026-10-06' });
      expect(await r('range=last7')).toMatchObject({ from: '2026-10-01', to: TODAY, days: 7 });
      expect(await r('range=last30')).toMatchObject({ from: '2026-09-08', days: 30 });
      expect(await r('range=thisMonth')).toMatchObject({ from: '2026-10-01', to: TODAY });
      expect(await r('range=lastMonth')).toMatchObject({ from: '2026-09-01', to: '2026-09-30', days: 30 });
      expect(await r('from=2026-10-03&to=2026-10-05')).toMatchObject({ key: 'custom', from: '2026-10-03', to: '2026-10-05', days: 3 });
      expect(await r('')).toMatchObject({ key: 'last7' });
    });

    it('"today" follows Cairo, not UTC: at 00:30 on the 8th the park is already on the 8th', async () => {
      clock.set(at('2026-10-08', '00:30:00'));
      expect(clock.now().toISOString().slice(0, 10)).toBe('2026-10-07'); // UTC is still the 7th
      expect((await get('/analytics/sales?range=today')).range).toMatchObject({ from: '2026-10-08', to: '2026-10-08' });
    });

    it('rejects bad ranges with a clear reason, and too long ones with the limit', async () => {
      const bad = async (q: string, status: number, code?: string) => {
        const res = await call(`/analytics/sales?${q}`);
        expect(res.status).toBe(status);
        if (code) expect(res.body.error.code).toBe(code);
        return res.body.error;
      };
      await bad('from=2026-10-05', 422, 'INVALID_RANGE');
      await bad('to=2026-10-05', 422, 'INVALID_RANGE');
      await bad('from=2026-10-08&to=2026-10-01', 422, 'INVALID_RANGE');
      await bad('range=last7&from=2026-10-01&to=2026-10-02', 422, 'INVALID_RANGE');
      await bad('range=custom', 422, 'INVALID_RANGE');
      await bad('from=2026-02-30&to=2026-03-01', 400, 'VALIDATION_FAILED');
      await bad('range=forever', 400, 'VALIDATION_FAILED');
      await bad('basis=payment', 400, 'VALIDATION_FAILED');
      await bad('groupBy=hour', 400, 'VALIDATION_FAILED');
    });

    it('allows exactly the configured maximum and no more', async () => {
      await call('/analytics/sales?from=2026-01-01&to=2026-12-31').expect(200); // 365 days
      await call('/analytics/sales?from=2026-01-01&to=2027-01-01').expect(200); // 366 days: the default maximum
      const error = (await call('/analytics/sales?from=2026-01-01&to=2027-01-02').expect(422)).body.error;
      expect(error.code).toBe('INVALID_RANGE');
      expect(error.message).toContain('366');
    });

    it('zero-fills the series so a quiet day is a zero, and groups by week or month on request', async () => {
      await seedOrder({ created: at('2026-10-02', '10:00') });
      const day = await get('/analytics/sales?from=2026-10-01&to=2026-10-04');
      expect(day.series.map((s: { bucket: string; paidOrders: number }) => [s.bucket, s.paidOrders])).toEqual([['2026-10-01', 0], ['2026-10-02', 1], ['2026-10-03', 0], ['2026-10-04', 0]]);
      const week = await get('/analytics/sales?from=2026-09-28&to=2026-10-11&groupBy=week');
      expect(week.series.map((s: { bucket: string; paidOrders: number }) => [s.bucket, s.paidOrders])).toEqual([['2026-09-28', 1], ['2026-10-05', 0]]); // Monday-based weeks
      const month = await get('/analytics/sales?from=2026-09-15&to=2026-10-20&groupBy=month');
      expect(month.series.map((s: { bucket: string; paidOrders: number }) => [s.bucket, s.paidOrders])).toEqual([['2026-09-01', 0], ['2026-10-01', 1]]);
      expect((await get('/analytics/sales?from=2026-01-01&to=2026-05-30')).range.granularity).toBe('week');
    });
  });

  // ───────────────────────────── Cairo boundaries ─────────────────────────────

  describe('Cairo day boundaries', () => {
    const paidOn = async (q: string) => (await get(`/analytics/sales?${q}`)).kpis.paidOrders as number;

    it('midnight in Cairo is the edge (not midnight UTC)', async () => {
      await seedOrder({ created: new Date('2026-10-06T20:59:59.999Z') }); // 23:59:59.999 on the 6th in Cairo
      await seedOrder({ created: new Date('2026-10-06T21:00:00.000Z') }); // 00:00:00 on the 7th
      await seedOrder({ created: at(TODAY, '23:59:59') });
      await seedOrder({ created: new Date('2026-10-07T21:00:00.000Z') }); // 00:00:00 on the 8th
      expect(await paidOn('range=yesterday')).toBe(1);
      expect(await paidOn('range=today')).toBe(2);
      expect(await paidOn('from=2026-10-08&to=2026-10-08')).toBe(1);
      expect(await paidOn('from=2026-10-06&to=2026-10-08')).toBe(4); // all of them, none twice
    });

    it('at 00:30 Cairo the order belongs to the new Cairo day although UTC is still the old one', async () => {
      await seedOrder({ created: at('2026-10-08', '00:30:00') });
      expect(await paidOn(`from=${TODAY}&to=${TODAY}`)).toBe(0);
      expect(await paidOn('from=2026-10-08&to=2026-10-08')).toBe(1);
      const series = (await get('/analytics/sales?from=2026-10-07&to=2026-10-08')).series;
      expect(series.map((s: { bucket: string; paidOrders: number }) => [s.bucket, s.paidOrders])).toEqual([['2026-10-07', 0], ['2026-10-08', 1]]);
    });

    it('month boundary: last second of September vs first second of October', async () => {
      await seedOrder({ created: new Date('2026-09-30T20:59:59.999Z') });
      await seedOrder({ created: new Date('2026-09-30T21:00:00.000Z') });
      expect(await paidOn('range=lastMonth')).toBe(1);
      expect(await paidOn('range=thisMonth')).toBe(1);
      const month = (await get('/analytics/sales?from=2026-09-01&to=2026-10-31&groupBy=month')).series;
      expect(month.map((s: { bucket: string; paidOrders: number }) => [s.bucket, s.paidOrders])).toEqual([['2026-09-01', 1], ['2026-10-01', 1]]);
    });

    it('year boundary: 23:59:59 on 31 December vs 00:00:00 on 1 January (winter time, UTC+2)', async () => {
      clock.set(at('2027-01-05', '12:00'));
      await seedOrder({ created: new Date('2026-12-31T21:59:59.999Z') });
      await seedOrder({ created: new Date('2026-12-31T22:00:00.000Z') });
      expect(await paidOn('from=2026-12-31&to=2026-12-31')).toBe(1);
      expect(await paidOn('from=2027-01-01&to=2027-01-01')).toBe(1);
      expect(await paidOn('from=2026-12-31&to=2027-01-01')).toBe(2);
      const year = (await get('/analytics/sales?from=2026-12-01&to=2027-01-31&groupBy=month')).series;
      expect(year.at(-2)).toMatchObject({ bucket: '2026-12-01', paidOrders: 1 });
      expect(year.at(-1)).toMatchObject({ bucket: '2027-01-01', paidOrders: 1 });
    });

    it('the October clock change: the 25-hour day holds exactly the orders placed in it', async () => {
      clock.set(at('2026-10-31', '12:00'));
      await seedOrder({ created: new Date('2026-10-28T20:59:59.999Z') }); // 28 Oct 23:59:59 (UTC+3)
      await seedOrder({ created: new Date('2026-10-28T21:00:00.000Z') }); // 29 Oct 00:00 (UTC+3)
      await seedOrder({ created: new Date('2026-10-29T21:30:00.000Z') }); // 29 Oct 23:30 the second time (UTC+2)
      await seedOrder({ created: new Date('2026-10-29T21:59:59.999Z') }); // 29 Oct 23:59:59.999
      await seedOrder({ created: new Date('2026-10-29T22:00:00.000Z') }); // 30 Oct 00:00 (UTC+2)
      expect(await paidOn('from=2026-10-28&to=2026-10-28')).toBe(1);
      expect(await paidOn('from=2026-10-29&to=2026-10-29')).toBe(3);
      expect(await paidOn('from=2026-10-30&to=2026-10-30')).toBe(1);
      expect(await paidOn('from=2026-10-28&to=2026-10-30')).toBe(5);
    });

    it('the April clock change: the day without a midnight (24 April 2026) starts at 01:00 and is counted whole', async () => {
      clock.set(at('2026-04-24', '12:00'));
      await seedOrder({ created: new Date('2026-04-23T21:59:59.999Z') }); // 23:59:59.999 on the 23rd (UTC+2)
      await seedOrder({ created: new Date('2026-04-23T22:00:00.000Z') }); // 01:00 on the 24th (UTC+3): the first moment of the 24th
      await seedOrder({ created: new Date('2026-04-24T20:59:59.999Z') }); // 23:59:59.999 on the 24th
      await seedOrder({ created: new Date('2026-04-24T21:00:00.000Z') }); // 00:00 on the 25th
      expect(await paidOn('range=today')).toBe(2);
      expect(await paidOn('from=2026-04-23&to=2026-04-23')).toBe(1);
      expect(await paidOn('from=2026-04-25&to=2026-04-25')).toBe(1);
      // the dashboard and the scan list work on that day too
      await get('/dashboard', 'admin');
      await call('/scans?date=2026-04-24', 'admin').expect(200);
    });
  });

  // ───────────────────────────── sales ─────────────────────────────

  describe('sales and revenue', () => {
    it('counts only PAID orders as paid sales, with the stored order totals', async () => {
      await seedOrder({ lines: [{ qty: 2, unit: 5000 }] }); // paid 10000
      await seedOrder({ lines: [{ qty: 1, unit: 20000, audience: 'VISITOR' }] }); // paid 20000
      await seedOrder({ status: 'PENDING_PAYMENT', lines: [{ qty: 5, unit: 5000 }] }); // not a sale
      await seedOrder({ status: 'EXPIRED', lines: [{ qty: 1, unit: 5000 }] }); // not a sale
      const s = await get('/analytics/sales?range=today');
      expect(s.kpis).toMatchObject({ paidOrders: 2, ticketsSold: 3, paidSalesMinor: 30000, averagePaidOrderMinor: 15000, ticketsCancelledInPaidOrders: 0 });
      expect(s.ordersPlaced).toEqual({ total: 4, paid: 2, unpaid: 1, expired: 1, cancelled: 0 });
      expect(s.currency).toBe('EGP');
    });

    it('takes money from the stored totals, never from today\'s price list', async () => {
      // an order sold at 77.00 EGP when the list said 50: the stored amounts rule
      await seedOrder({ lines: [{ qty: 2, unit: 7700 }] });
      expect((await get('/analytics/sales?range=today')).kpis.paidSalesMinor).toBe(15400);
      const adult = await prisma.ticketType.findUniqueOrThrow({ where: { code: 'ADULT' } });
      const resident = await prisma.ticketAudience.findUniqueOrThrow({ where: { code: 'RESIDENT' } });
      await request(app.getHttpServer()).post(`${API}/prices`).set('X-Forwarded-For', nextIp()).set({ Authorization: `Bearer ${tokens.admin}` })
        .send({ ticketTypeId: adult.id, audienceId: resident.id, days: 'WEEKDAY', amountMinor: 99900, validFrom: TODAY }).expect(201);
      const after = await get('/analytics/sales?range=today');
      expect(after.kpis.paidSalesMinor).toBe(15400);
      expect((await get('/analytics/sales?range=today&basis=visit')).kpis.paidSalesMinor).toBe(15400);
      expect(after.byTicketType[0].valueMinor).toBe(15400);
    });

    it('keeps a paid order that staff cancelled apart from paid sales', async () => {
      await seedOrder({ lines: [{ qty: 1, unit: 5000 }] });
      await seedOrder({ status: 'CANCELLED', wasPaid: true, lines: [{ qty: 2, unit: 5000 }] }); // a sale that was withdrawn
      await seedOrder({ status: 'CANCELLED', lines: [{ qty: 4, unit: 5000 }] }); // never paid: not a sale at all
      const s = await get('/analytics/sales?range=today');
      expect(s.kpis).toMatchObject({ paidOrders: 1, paidSalesMinor: 5000, ticketsSold: 1, cancelledAfterPayment: { orders: 1, tickets: 2, valueMinor: 10000 } });
      expect(s.ordersPlaced).toMatchObject({ total: 3, paid: 1, cancelled: 2 });
    });

    it('counts a ticket cancelled inside a paid order as sold AND cancelled (the order was paid in full)', async () => {
      await seedOrder({ lines: [{ qty: 3, unit: 5000, tickets: ['VALID', 'CANCELLED', 'USED'] }] });
      const s = await get('/analytics/sales?range=today');
      expect(s.kpis).toMatchObject({ paidOrders: 1, ticketsSold: 3, ticketsCancelledInPaidOrders: 1, paidSalesMinor: 15000 });
      expect(s.byTicketType[0]).toMatchObject({ tickets: 3, cancelled: 1, valueMinor: 15000 });
    });

    it('counts several tickets of one order as several tickets and one order', async () => {
      await seedOrder({ lines: [{ qty: 3, unit: 20000, audience: 'VISITOR' }, { type: 'CHILD', qty: 2, unit: 10000, audience: 'VISITOR' }] });
      const s = await get('/analytics/sales?range=today');
      expect(s.kpis).toMatchObject({ paidOrders: 1, ticketsSold: 5, paidSalesMinor: 80000, averagePaidOrderMinor: 80000 });
      expect(s.byTicketTypeAndAudience.map((r: { ticketTypeCode: string; tickets: number; valueMinor: number }) => [r.ticketTypeCode, r.tickets, r.valueMinor])).toEqual([['ADULT', 3, 60000], ['CHILD', 2, 20000]]);
    });

    it('sale date counts by the day the order was placed; visit date by the ticket\'s visit date', async () => {
      // bought today for Friday the 9th, and bought yesterday for today
      await seedOrder({ created: NOON(), visit: '2026-10-09', lines: [{ qty: 3, unit: 6000 }] }); // 18000
      await seedOrder({ created: at('2026-10-06', '10:00'), visit: TODAY, lines: [{ qty: 2, unit: 5000 }] }); // 10000
      const sold = await get('/analytics/sales?range=today&basis=sale');
      expect(sold.kpis).toMatchObject({ paidOrders: 1, ticketsSold: 3, paidSalesMinor: 18000 });
      const visiting = await get('/analytics/sales?range=today&basis=visit');
      expect(visiting.kpis).toMatchObject({ paidOrders: 1, ticketsSold: 2, paidSalesMinor: 10000 });
      const friday = await get('/analytics/sales?from=2026-10-09&to=2026-10-09&basis=visit');
      expect(friday.kpis).toMatchObject({ paidOrders: 1, ticketsSold: 3, paidSalesMinor: 18000 });
      // the same order never moves between bases for the whole period
      const all = (basis: string) => get(`/analytics/sales?from=2026-10-01&to=2026-10-31&basis=${basis}`);
      expect((await all('sale')).kpis.paidSalesMinor).toBe(28000);
      expect((await all('visit')).kpis.paidSalesMinor).toBe(28000);
      expect((await get('/analytics/sales?range=today&basis=visit')).ordersPlaced).toBeNull(); // "placed" only makes sense by sale date
    });

    it('breaks sales down by ticket type, audience (resident / visitor) and weekday / weekend', async () => {
      await seedOrder({ visit: '2026-10-08', lines: [{ qty: 2, unit: 5000 }, { type: 'CHILD', qty: 1, unit: 3500 }] }); // Thursday, resident
      await seedOrder({ visit: '2026-10-09', lines: [{ qty: 1, unit: 20000, audience: 'VISITOR' }, { type: 'CHILD', qty: 2, unit: 15000, audience: 'VISITOR' }] }); // Friday, visitor
      const s = await get('/analytics/sales?range=today');
      const t = (rows: Array<{ code: string; tickets: number; valueMinor: number; shareOfTicketsPercent: number }>) => rows.map((r) => [r.code, r.tickets, r.valueMinor, r.shareOfTicketsPercent]);
      expect(t(s.byTicketType)).toEqual([['ADULT', 3, 30000, 50], ['CHILD', 3, 33500, 50]]);
      expect(t(s.byAudience)).toEqual([['VISITOR', 3, 50000, 50], ['RESIDENT', 3, 13500, 50]].sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0]))));
      expect(t(s.byDayType)).toEqual([['WEEKDAY', 3, 13500, 50], ['WEEKEND', 3, 50000, 50]]);
      expect(s.kpis.paidSalesMinor).toBe(63500);
      expect(s.byTicketType.reduce((n: number, r: { valueMinor: number }) => n + r.valueMinor, 0)).toBe(s.kpis.paidSalesMinor); // the breakdown adds up to the total
    });

    it('filters by ticket type, audience and day type, and says the figures are for the filtered tickets', async () => {
      await seedOrder({ visit: '2026-10-08', lines: [{ qty: 2, unit: 5000 }, { type: 'CHILD', qty: 1, unit: 3500 }] });
      await seedOrder({ visit: '2026-10-09', lines: [{ qty: 1, unit: 20000, audience: 'VISITOR' }] });
      const f = async (q: string) => get(`/analytics/sales?range=today&${q}`);
      expect((await f('ticketType=CHILD')).kpis).toMatchObject({ paidOrders: 1, ticketsSold: 1, paidSalesMinor: 3500 });
      expect((await f('audience=VISITOR')).kpis).toMatchObject({ paidOrders: 1, ticketsSold: 1, paidSalesMinor: 20000 });
      expect((await f('dayType=WEEKEND')).kpis).toMatchObject({ ticketsSold: 1, paidSalesMinor: 20000 });
      expect((await f('dayType=WEEKDAY&ticketType=ADULT')).kpis).toMatchObject({ ticketsSold: 2, paidSalesMinor: 10000 });
      expect((await f('ticketType=ADULT&audience=VISITOR&dayType=WEEKDAY')).kpis).toMatchObject({ paidOrders: 0, ticketsSold: 0, paidSalesMinor: 0 });
      expect((await f('ticketType=CHILD')).filtered).toBe(true);
      expect((await f('')).filtered).toBe(false);
      expect((await f('ticketType=CHILD')).ordersPlaced).toBeNull();
      await call('/analytics/sales?range=today&dayType=SOMEDAY').expect(400);
    });

    it('is empty and still well formed when nothing was sold', async () => {
      const s = await get('/analytics/sales?range=today');
      expect(s.kpis).toMatchObject({ paidOrders: 0, ticketsSold: 0, paidSalesMinor: 0, averagePaidOrderMinor: null });
      expect(s.series).toHaveLength(1);
      expect(s.byTicketType).toEqual([]);
    });

    it('follows the weekday / weekend split of the park: Friday and Saturday are the weekend', async () => {
      for (const [visit, unit] of [['2026-10-08', 5000], ['2026-10-09', 6000], ['2026-10-10', 6000], ['2026-10-11', 5000]] as const) await seedOrder({ visit, lines: [{ unit }] });
      const s = await get('/analytics/sales?range=today');
      expect(s.byDayType.map((r: { code: string; tickets: number }) => [r.code, r.tickets])).toEqual([['WEEKDAY', 2], ['WEEKEND', 2]]);
    });
  });

  // ───────────────────────────── attendance ─────────────────────────────

  describe('attendance and entry', () => {
    it('a ticket sold but never used is a sale, not an attendance', async () => {
      await seedOrder({ lines: [{ qty: 3, unit: 5000 }] });
      expect((await get('/analytics/sales?range=today')).kpis.ticketsSold).toBe(3);
      const a = await get('/analytics/attendance?range=today');
      expect(a.kpis).toMatchObject({ entries: 0, refusedScans: 0, totalScans: 0, refusedSharePercent: null, busiestGate: null });
      const t = await get('/analytics/tickets?range=today&basis=visit');
      expect(t.kpis).toMatchObject({ total: 3, valid: 3, used: 0 });
    });

    it('a ticket let in at the gate counts as one entry, in the right place, by type and audience', async () => {
      const { tickets } = await seedOrder({ lines: [{ qty: 1, unit: 5000 }, { type: 'CHILD', audience: 'VISITOR', qty: 1, unit: 10000 }] });
      expect(await scan(qr.payloadFor(tickets[0]), at(TODAY, '10:00'), 'MAIN')).toBe('ACCESS_GRANTED');
      expect(await scan(qr.payloadFor(tickets[1]), at(TODAY, '10:05'), 'DARASSA')).toBe('ACCESS_GRANTED');
      const a = await get('/analytics/attendance?range=today');
      expect(a.kpis).toMatchObject({ entries: 2, refusedScans: 0, totalScans: 2 });
      expect(a.byGate.map((g: { code: string; entries: number }) => [g.code, g.entries])).toEqual([['DARASSA', 1], ['MAIN', 1]]);
      expect(a.entriesByTicketType.map((r: { code: string; entries: number }) => [r.code, r.entries])).toEqual([['ADULT', 1], ['CHILD', 1]]);
      expect(a.entriesByAudience.map((r: { code: string; entries: number }) => [r.code, r.entries]).sort()).toEqual([['RESIDENT', 1], ['VISITOR', 1]]);
      expect((await get('/analytics/tickets?range=today&basis=visit')).kpis).toMatchObject({ total: 2, used: 2, valid: 0 });
    });

    it('the same ticket scanned twice is one entry and one refused scan', async () => {
      const { tickets } = await seedOrder();
      const code = qr.payloadFor(tickets[0]);
      expect(await scan(code, at(TODAY, '10:00'))).toBe('ACCESS_GRANTED');
      expect(await scan(code, at(TODAY, '10:01'))).toBe('ALREADY_USED');
      expect(await scan(code, at(TODAY, '10:02'), 'DARASSA')).toBe('ALREADY_USED');
      const a = await get('/analytics/attendance?range=today');
      expect(a.kpis).toMatchObject({ entries: 1, refusedScans: 2, totalScans: 3, refusedSharePercent: 66.7 });
      expect(a.results.find((r: { code: string }) => r.code === 'ALREADY_USED')).toMatchObject({ scans: 2, granted: false });
      expect(a.results.find((r: { code: string }) => r.code === 'ACCESS_GRANTED')).toMatchObject({ scans: 1, granted: true });
    });

    it('a wrong-date scan, a cancelled ticket and an invalid code are refusals and never attendance', async () => {
      const wrong = await seedOrder({ visit: '2026-10-08' });
      const cancelled = await seedOrder({ lines: [{ tickets: ['CANCELLED'] }] });
      const pending = await seedOrder({ status: 'PENDING_PAYMENT' });
      expect(await scan(qr.payloadFor(wrong.tickets[0]), at(TODAY, '11:00'))).toBe('WRONG_DATE');
      expect(await scan(qr.payloadFor(cancelled.tickets[0]), at(TODAY, '11:01'))).toBe('CANCELLED');
      expect(await scan(qr.payloadFor(pending.tickets[0]), at(TODAY, '11:02'))).toBe('TICKET_NOT_VALID');
      expect(await scan('not a ticket', at(TODAY, '11:03'))).toBe('INVALID_QR');
      expect(await scan(`AZP1.TKT-AAAAAAAAAA.1.${'A'.repeat(22)}`, at(TODAY, '11:04'))).toBe('INVALID_SIGNATURE');
      expect(await scan(qr.payloadFor({ publicRef: 'TKT-ZZZZZZZZZZ', qrKeyId: 1 }), at(TODAY, '11:05'))).toBe('TICKET_NOT_FOUND');
      const a = await get('/analytics/attendance?range=today');
      expect(a.kpis).toMatchObject({ entries: 0, refusedScans: 6, totalScans: 6, refusedSharePercent: 100 });
      const by = Object.fromEntries(a.results.map((r: { code: string; scans: number }) => [r.code, r.scans]));
      expect(by).toMatchObject({ ACCESS_GRANTED: 0, WRONG_DATE: 1, CANCELLED: 1, TICKET_NOT_VALID: 1, INVALID_QR: 1, INVALID_SIGNATURE: 1, TICKET_NOT_FOUND: 1, ALREADY_USED: 0, EXPIRED: 0, RETIRED_KEY: 0 });
      expect((await get('/analytics/tickets?range=today&basis=visit')).kpis.used).toBe(0);
    });

    it('splits entries and refusals by gate and names the busiest gate', async () => {
      const { tickets } = await seedOrder({ lines: [{ qty: 5, unit: 5000 }] });
      for (const [i, g] of (['MAIN', 'MAIN', 'MAIN', 'DARASSA', 'DARASSA'] as const).entries()) await scan(qr.payloadFor(tickets[i]), at(TODAY, `10:0${i}`), g);
      await scan('junk', at(TODAY, '10:30'), 'DARASSA');
      const a = await get('/analytics/attendance?range=today');
      expect(a.byGate).toMatchObject([
        { code: 'DARASSA', entries: 2, refused: 1, scans: 3, shareOfEntriesPercent: 40 },
        { code: 'MAIN', entries: 3, refused: 0, scans: 3, shareOfEntriesPercent: 60 },
      ]);
      expect(a.kpis.busiestGate).toMatchObject({ code: 'MAIN', entries: 3 });
      const onlyDarassa = await get(`/analytics/attendance?range=today&gateId=${(await gate('DARASSA')).id}`);
      expect(onlyDarassa.kpis).toMatchObject({ entries: 2, refusedScans: 1 });
      expect(onlyDarassa.byGate.map((g: { code: string }) => g.code)).toEqual(['DARASSA']);
    });

    it('counts entries by the day of the scan, in Cairo, with a zero for a quiet day', async () => {
      const t1 = await seedOrder({ visit: TODAY });
      const t2 = await seedOrder({ visit: '2026-10-08' });
      await scan(qr.payloadFor(t1.tickets[0]), at(TODAY, '23:59:59'));
      await scan(qr.payloadFor(t2.tickets[0]), at('2026-10-08', '00:00:01'));
      const a = await get('/analytics/attendance?from=2026-10-06&to=2026-10-09');
      expect(a.series.map((s: { bucket: string; entries: number }) => [s.bucket, s.entries])).toEqual([['2026-10-06', 0], ['2026-10-07', 1], ['2026-10-08', 1], ['2026-10-09', 0]]);
    });

    it('filters entries by ticket type and audience', async () => {
      const { tickets } = await seedOrder({ lines: [{ qty: 2, unit: 5000 }, { type: 'CHILD', audience: 'VISITOR', qty: 1, unit: 10000 }] });
      for (const [i, t] of tickets.entries()) await scan(qr.payloadFor(t), at(TODAY, `10:0${i}`));
      expect((await get('/analytics/attendance?range=today&ticketType=ADULT')).kpis.entries).toBe(2);
      expect((await get('/analytics/attendance?range=today&ticketType=CHILD&audience=VISITOR')).kpis.entries).toBe(1);
      expect((await get('/analytics/attendance?range=today&audience=VISITOR&ticketType=ADULT')).kpis.entries).toBe(0);
    });

    it('never returns the scanned text, a fingerprint, a signature or an address', async () => {
      const { tickets } = await seedOrder();
      await scan(qr.payloadFor(tickets[0]), at(TODAY, '10:00'));
      await scan('AZP1.TKT-SECRETSECR.1.garbagegarbagegarbagegg', at(TODAY, '10:01'));
      const text = JSON.stringify([await get('/analytics/attendance?range=today'), await get('/analytics/overview?range=today'), await get('/analytics/tickets?range=today')]);
      for (const secret of ['AZP1', 'TKT-', 'garbage', 'fingerprint', 'tokenFingerprint', 'signature', '10.', 'userAgent', 'Private Person', 'private']) expect(text).not.toContain(secret);
    });
  });

  // ───────────────────────────── ticket states ─────────────────────────────

  describe('ticket states', () => {
    it('counts what the tickets are NOW, by visit date or by the day they were ordered', async () => {
      await seedOrder({ visit: TODAY, lines: [{ qty: 4, tickets: ['VALID', 'USED', 'USED', 'CANCELLED'] }] });
      await seedOrder({ status: 'PENDING_PAYMENT', visit: TODAY, lines: [{ qty: 2 }] });
      await seedOrder({ status: 'EXPIRED', visit: '2026-10-20', lines: [{ qty: 1 }] });
      const visit = await get(`/analytics/tickets?from=${TODAY}&to=${TODAY}&basis=visit`);
      expect(visit.kpis).toMatchObject({ total: 6, valid: 1, used: 2, cancelled: 1, pending: 2, expired: 0 });
      const sale = await get('/analytics/tickets?range=today&basis=sale');
      expect(sale.kpis).toMatchObject({ total: 7, valid: 1, used: 2, cancelled: 1, pending: 2, expired: 1 });
      expect(sale.asOf).toBe(TODAY);
    });

    it('tells valid tickets whose day has passed (never used) from tickets used', async () => {
      await seedOrder({ created: at('2026-10-01', '10:00'), visit: '2026-10-03', lines: [{ qty: 5, tickets: ['USED', 'USED', 'USED', 'VALID', 'VALID'] }] });
      await seedOrder({ created: at('2026-10-01', '10:00'), visit: TODAY, lines: [{ qty: 2, tickets: ['VALID', 'VALID'] }] }); // today is not over: not "passed"
      const t = (await get('/analytics/tickets?from=2026-10-01&to=2026-10-31&basis=visit')).kpis;
      expect(t).toMatchObject({ total: 7, validButDatePassed: 2, usedAfterVisitDate: 3, usedSharePercentOfPastValid: 60 });
    });

    it('has one row per ticket type, audience and state, and a series of states per day', async () => {
      await seedOrder({ visit: '2026-10-08', lines: [{ qty: 2, tickets: ['VALID', 'CANCELLED'] }, { type: 'CHILD', audience: 'VISITOR', unit: 10000 }] });
      const t = await get('/analytics/tickets?from=2026-10-08&to=2026-10-09&basis=visit');
      expect(t.byTypeAudienceStatus.map((r: { ticketTypeCode: string; audienceCode: string; status: string; tickets: number }) => [r.ticketTypeCode, r.audienceCode, r.status, r.tickets])).toEqual([
        ['ADULT', 'RESIDENT', 'CANCELLED', 1], ['ADULT', 'RESIDENT', 'VALID', 1], ['CHILD', 'VISITOR', 'VALID', 1],
      ]);
      expect(t.series).toEqual([{ bucket: '2026-10-08', valid: 2, used: 0, cancelled: 1, notPaid: 0 }, { bucket: '2026-10-09', valid: 0, used: 0, cancelled: 0, notPaid: 0 }]);
    });
  });

  // ───────────────────────────── events ─────────────────────────────

  describe('events', () => {
    const mk = (slug: string, status: 'DRAFT' | 'COMING_SOON' | 'PUBLISHED' | 'CANCELLED' | 'ARCHIVED', startsAt: Date, venue?: string) =>
      prisma.event.create({
        data: { slug, titleEn: `E ${slug}`, titleAr: `ح ${slug}`, shortDescriptionEn: 'Short description here', shortDescriptionAr: 'وصف قصير هنا', descriptionEn: 'Long description here.', descriptionAr: 'وصف طويل هنا.', status, startsAt, endsAt: new Date(startsAt.getTime() + 2 * 3_600_000), ...(venue ? { venue: { connect: { slug: venue } } } : {}) },
      });

    it('counts events by status and by Cairo day, with venues; no ticket figures (events are not tickets)', async () => {
      await prisma.event.deleteMany();
      const venues = await prisma.venue.findMany({ take: 2, orderBy: { slug: 'asc' } });
      await mk('a', 'PUBLISHED', at('2026-10-10', '20:00'), venues[0].slug);
      await mk('b', 'COMING_SOON', at('2026-10-10', '22:00'), venues[0].slug);
      await mk('c', 'DRAFT', at('2026-10-11', '18:00'), venues[1].slug);
      await mk('d', 'CANCELLED', at('2026-10-12', '18:00'));
      await mk('e', 'PUBLISHED', at('2026-11-05', '18:00'));
      const e = await get('/analytics/events?from=2026-10-01&to=2026-10-31', 'content');
      expect(e.kpis).toMatchObject({ inPeriod: 4, publishedInPeriod: 1, comingSoonInPeriod: 1, draftInPeriod: 1, cancelledInPeriod: 1, allTime: { published: 2, comingSoon: 1, draft: 1, cancelled: 1, archived: 0 } });
      expect(e.series.find((s: { bucket: string }) => s.bucket === '2026-10-10')).toMatchObject({ events: 2 }); // only what the public can see
      expect(e.byVenue.reduce((n: number, v: { events: number }) => n + v.events, 0)).toBe(2);
      expect(e.list.map((x: { titleEn: string }) => x.titleEn)).toEqual(['E a', 'E b', 'E c', 'E d']);
      expect(JSON.stringify(e)).not.toMatch(/ticket|revenue|Minor/i);
    });
  });

  // ───────────────────────────── exports ─────────────────────────────

  describe('CSV exports', () => {
    it('sales: the right headers, rows and amounts, with the file named by period and basis', async () => {
      await seedOrder({ visit: '2026-10-08', lines: [{ qty: 2, unit: 5000 }, { type: 'CHILD', qty: 1, unit: 3500 }] });
      await seedOrder({ visit: '2026-10-09', lines: [{ qty: 1, unit: 20000, audience: 'VISITOR', tickets: ['CANCELLED'] }] });
      const f = await csv('/analytics/export/sales?range=today');
      expect(f.status).toBe(200);
      expect(f.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(f.headers['content-disposition']).toBe('attachment; filename="azharpark-sales-2026-10-07_2026-10-07-sale.csv"');
      expect(f.headers['cache-control']).toBe('private, no-store');
      expect(f.bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf])); // UTF-8 byte-order mark
      const rows = parseCsv(f.text);
      expect(rows[0]).toEqual(['period_start', 'granularity', 'basis', 'ticket_type_code', 'ticket_type', 'audience_code', 'audience', 'day_type', 'tickets_sold', 'tickets_cancelled', 'value_egp', 'currency']);
      expect(rows.slice(1)).toEqual([
        ['2026-10-07', 'day', 'sale', 'ADULT', 'Adult', 'RESIDENT', 'Egyptian / resident', 'WEEKDAY', '2', '0', '100.00', 'EGP'],
        ['2026-10-07', 'day', 'sale', 'ADULT', 'Adult', 'VISITOR', 'Non-resident visitor', 'WEEKEND', '1', '1', '200.00', 'EGP'],
        ['2026-10-07', 'day', 'sale', 'CHILD', 'Child (2–8 years)', 'RESIDENT', 'Egyptian / resident', 'WEEKDAY', '1', '0', '35.00', 'EGP'],
      ]);
      expect(f.headers['x-row-count']).toBe('3');
      expect(f.text.endsWith('\r\n')).toBe(true);
    });

    it('applies the selected period, date basis and filters, and the file says which', async () => {
      await seedOrder({ created: at('2026-10-02', '10:00'), visit: '2026-10-05', lines: [{ qty: 2, unit: 5000 }, { type: 'CHILD', audience: 'VISITOR', qty: 1, unit: 10000 }] });
      await seedOrder({ created: at('2026-10-06', '10:00'), visit: '2026-10-07', lines: [{ qty: 1, unit: 5000 }] });
      const total = (rows: string[][]) => rows.slice(1).reduce((n, r) => n + Number(r[8]), 0);
      const sale = await csv('/analytics/export/sales?from=2026-10-01&to=2026-10-03&basis=sale');
      expect(total(parseCsv(sale.text))).toBe(3);
      expect(sale.headers['content-disposition']).toContain('2026-10-01_2026-10-03-sale.csv');
      const visit = await csv('/analytics/export/sales?from=2026-10-01&to=2026-10-03&basis=visit');
      expect(total(parseCsv(visit.text))).toBe(0); // nothing is VISITED in those three days
      expect(visit.headers['content-disposition']).toContain('-visit.csv');
      const visit2 = await csv('/analytics/export/sales?from=2026-10-05&to=2026-10-07&basis=visit');
      expect(total(parseCsv(visit2.text))).toBe(4);
      expect(parseCsv(visit2.text)[1].slice(0, 3)).toEqual(['2026-10-05', 'day', 'visit']);
      const filtered = parseCsv((await csv('/analytics/export/sales?from=2026-10-01&to=2026-10-31&basis=sale&audience=VISITOR')).text);
      expect(filtered.slice(1)).toHaveLength(1);
      expect(filtered[1].slice(3, 8)).toEqual(['CHILD', 'Child (2–8 years)', 'VISITOR', 'Non-resident visitor', 'WEEKDAY']);
      const week = parseCsv((await csv('/analytics/export/sales?from=2026-09-28&to=2026-10-11&groupBy=week')).text);
      expect(week[1].slice(0, 2)).toEqual(['2026-09-28', 'week']);
    });

    it('attendance, tickets, gates and scans exports hold the same numbers as the reports', async () => {
      const { tickets } = await seedOrder({ lines: [{ qty: 3, unit: 5000 }] });
      await scan(qr.payloadFor(tickets[0]), at(TODAY, '10:00'), 'MAIN');
      await scan(qr.payloadFor(tickets[1]), at(TODAY, '10:01'), 'DARASSA');
      await scan(qr.payloadFor(tickets[1]), at(TODAY, '10:02'), 'DARASSA');
      await scan('junk', at(TODAY, '10:03'), 'MAIN');
      const attendance = parseCsv((await csv('/analytics/export/attendance?range=today')).text);
      expect(attendance[0]).toEqual(['period_start', 'granularity', 'ticket_type_code', 'ticket_type', 'audience_code', 'audience', 'entries']);
      expect(attendance.slice(1)).toEqual([['2026-10-07', 'day', 'ADULT', 'Adult', 'RESIDENT', 'Egyptian / resident', '2']]);
      const gates = parseCsv((await csv('/analytics/export/gates?range=today')).text);
      expect(gates[0]).toEqual(['gate_code', 'gate', 'entries', 'refused_scans', 'total_scans', 'share_of_entries_percent']);
      expect(gates.slice(1)).toEqual([['DARASSA', 'Darassa entrance', '1', '1', '2', '50'], ['MAIN', 'Main entrance', '1', '1', '2', '50']]);
      const scans = parseCsv((await csv('/analytics/export/scans?range=today')).text);
      expect(scans[0]).toEqual(['period_start', 'granularity', 'gate_code', 'result', 'scans']);
      expect(scans.slice(1)).toEqual([['2026-10-07', 'day', 'DARASSA', 'ACCESS_GRANTED', '1'], ['2026-10-07', 'day', 'DARASSA', 'ALREADY_USED', '1'], ['2026-10-07', 'day', 'MAIN', 'ACCESS_GRANTED', '1'], ['2026-10-07', 'day', 'MAIN', 'INVALID_QR', '1']]);
      const states = parseCsv((await csv('/analytics/export/tickets?from=2026-10-07&to=2026-10-07&basis=visit')).text);
      expect(states[0]).toEqual(['basis', 'from', 'to', 'ticket_type_code', 'ticket_type', 'audience_code', 'audience', 'status', 'tickets', 'ticket_value_egp']);
      expect(states.slice(1).map((r) => [r[7], r[8], r[9]])).toEqual([['USED', '2', '100.00'], ['VALID', '1', '50.00']]);
      const gateFiltered = parseCsv((await csv(`/analytics/export/scans?range=today&gateId=${(await gate('MAIN')).id}`)).text);
      expect(gateFiltered.slice(1).every((r) => r[2] === 'MAIN')).toBe(true);
    });

    it('is only the header row when there is nothing to export', async () => {
      for (const report of ['sales', 'attendance', 'tickets', 'gates', 'scans', 'events']) {
        const f = await csv(`/analytics/export/${report}?range=today`);
        const rows = parseCsv(f.text);
        expect(f.status).toBe(200);
        expect(rows.length).toBe(report === 'gates' ? 3 : 1); // header + (the two gates, which exist with no scans)
        if (report !== 'gates') expect(f.headers['x-row-count']).toBe('0');
      }
    });

    it('writes commas, quotes, line breaks and Arabic correctly, and defuses spreadsheet formulas', async () => {
      await prisma.event.deleteMany();
      const mk = (slug: string, titleEn: string, titleAr: string) =>
        prisma.event.create({ data: { slug, titleEn, titleAr, shortDescriptionEn: 'Short description here', shortDescriptionAr: 'وصف قصير هنا', descriptionEn: 'Long description here.', descriptionAr: 'وصف طويل هنا.', status: 'PUBLISHED', startsAt: at(TODAY, '20:00'), endsAt: at(TODAY, '22:00'), locationNameEn: 'Lawn', locationNameAr: 'العشب' } });
      await mk('f1', 'Jazz, Blues & "Soul"', 'جاز، بلوز و"سول"');
      await mk('f2', 'Line one\nLine two', 'سطر أول');
      await mk('f3', '=HYPERLINK("http://evil.example","click")', '+SUM(A1:A9)');
      await mk('f4', '@cmd|\' /C calc\'!A0', '-2+3');
      await mk('f5', 'Plain title', 'عنوان عادي');
      const f = await csv('/analytics/export/events?range=today', 'content');
      expect(f.status).toBe(200);
      const rows = parseCsv(f.text).slice(1);
      expect(rows).toHaveLength(5);
      const byTitle = Object.fromEntries(rows.map((r) => [r[2], r]));
      expect(byTitle['Jazz, Blues & "Soul"'][3]).toBe('جاز، بلوز و"سول"'); // commas and quotes survive a round trip
      expect(byTitle['Line one\nLine two']).toBeDefined();
      expect(byTitle['Plain title'][3]).toBe('عنوان عادي');
      for (const r of rows) for (const cell of r) expect(/^[=+\-@\t\r]/.test(cell)).toBe(false); // nothing a spreadsheet would run
      expect(rows.find((r) => r[2].includes('HYPERLINK'))?.[2]).toBe('\'=HYPERLINK("http://evil.example","click")');
      expect(rows.find((r) => r[3].includes('SUM'))?.[3]).toBe("'+SUM(A1:A9)");
      expect(rows.find((r) => r[3].includes('2+3'))?.[3]).toBe("'-2+3");
      // the bytes are valid UTF-8 with the mark, and Arabic is not mangled
      expect(f.text).toContain('عنوان عادي');
      expect(f.bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    });

    it('defuses a formula in a gate name that reaches the gate export', async () => {
      await request(app.getHttpServer()).post(`${API}/gates`).set('X-Forwarded-For', nextIp()).set({ Authorization: `Bearer ${tokens.admin}` }).send({ code: 'EVIL', nameEn: '=1+1', nameAr: 'بوابة' }).expect(201);
      const rows = parseCsv((await csv('/analytics/export/gates?range=today')).text).slice(1);
      expect(rows.find((r) => r[0] === 'EVIL')?.[1]).toBe("'=1+1");
    });

    it('holds no QR text, secret, customer or address data in any export', async () => {
      const { tickets } = await seedOrder({ lines: [{ qty: 2, unit: 5000 }] });
      await scan(qr.payloadFor(tickets[0]), at(TODAY, '10:00'));
      await scan(qr.payloadFor(tickets[0]), at(TODAY, '10:01'));
      await scan('AZP1.TKT-SECRETSECR.1.garbagegarbagegarbagegg', at(TODAY, '10:02'));
      for (const report of ['sales', 'attendance', 'tickets', 'gates', 'scans', 'events']) {
        const text = (await csv(`/analytics/export/${report}?range=today`)).text;
        for (const secret of ['AZP1', 'TKT-', 'garbage', 'Private Person', 'private', '@example', '+2010', 'password', 'secret', 'token', 'fingerprint', 'signature']) {
          expect({ report, secret, found: text.toLowerCase().includes(secret.toLowerCase()) }).toEqual({ report, secret, found: false });
        }
      }
    });

    it('streams a large but reasonable export', async () => {
      // a year of days, every day with sales of several kinds: well over a thousand rows
      const created = [];
      for (let d = 0; d < 366; d += 1) {
        const date = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
        created.push(seedOrder({ created: at(date, '11:00'), visit: date, lines: [{ qty: 1, unit: 5000 }, { type: 'CHILD', qty: 1, unit: 3500 }, { audience: 'VISITOR', qty: 1, unit: 15000 }] }));
        if (created.length === 15) await Promise.all(created.splice(0));
      }
      await Promise.all(created);
      clock.set(at('2026-12-31', '12:00'));
      const f = await csv('/analytics/export/sales?from=2026-01-01&to=2026-12-31&groupBy=day');
      const rows = parseCsv(f.text).slice(1);
      expect(rows).toHaveLength(365 * 3);
      expect(f.headers['x-row-count']).toBe(String(365 * 3));
      expect(rows.reduce((n, r) => n + Number(r[10]) * 100, 0)).toBe(365 * (5000 + 3500 + 15000));
      expect(new Set(rows.map((r) => r[0])).size).toBe(365);
    }, 120_000);

    it('audits every export with what was asked for, never with the data', async () => {
      await seedOrder();
      await csv('/analytics/export/sales?from=2026-10-01&to=2026-10-07&basis=visit&ticketType=ADULT');
      const [entry] = await prisma.auditLog.findMany({ where: { action: 'analytics.exported' } });
      expect(entry).toMatchObject({ entity: 'analytics' });
      expect(entry.userId).not.toBeNull();
      expect(entry.newValue).toMatchObject({ report: 'sales', from: '2026-10-01', to: '2026-10-07', basis: 'visit', filters: { ticketType: 'ADULT', audience: null, dayType: null, gateId: null } });
      await csv('/analytics/export/sales?range=today', 'ops'); // refused: not audited as an export
      expect(await prisma.auditLog.count({ where: { action: 'analytics.exported' } })).toBe(1);
    });
  });

  // ───────────────────────────── what a report may cost ─────────────────────────────

  describe('limits', () => {
    it('refuses an export that would be too large, and says how to shrink it', async () => {
      const small = await createTestApp({ TRUST_PROXY: '1', ANALYTICS_EXPORT_MAX_ROWS: '100' });
      try {
        const admin = (await login(small, 'admin@azharpark.test')).accessToken;
        for (let d = 0; d < 120; d += 1) await seedOrder({ created: at(new Date(Date.UTC(2026, 5, 1 + d)).toISOString().slice(0, 10), '11:00'), visit: TODAY });
        const res = await request(small.getHttpServer()).get(`${API}/analytics/export/sales?from=2026-06-01&to=2026-09-28&groupBy=day`).set('X-Forwarded-For', nextIp()).set({ Authorization: `Bearer ${admin}` });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('EXPORT_TOO_LARGE');
        expect(res.body.error.message).toContain('limit is 100');
        expect(await prisma.auditLog.count({ where: { action: 'analytics.exported' } })).toBe(0);
        const ok = await request(small.getHttpServer()).get(`${API}/analytics/export/sales?from=2026-06-01&to=2026-06-30`).set('X-Forwarded-For', nextIp()).set({ Authorization: `Bearer ${admin}` });
        expect(ok.status).toBe(200);
      } finally {
        await small.close();
      }
    }, 120_000);

    it('a shorter maximum period can be configured', async () => {
      const short = await createTestApp({ TRUST_PROXY: '1', ANALYTICS_MAX_RANGE_DAYS: '31' });
      try {
        const admin = (await login(short, 'admin@azharpark.test')).accessToken;
        const get31 = (q: string) => request(short.getHttpServer()).get(`${API}/analytics/sales?${q}`).set('X-Forwarded-For', nextIp()).set({ Authorization: `Bearer ${admin}` });
        expect((await get31('from=2026-10-01&to=2026-10-31')).status).toBe(200);
        const refused = await get31('from=2026-10-01&to=2026-11-01');
        expect(refused.status).toBe(422);
        expect(refused.body.error.message).toContain('31 days');
      } finally {
        await short.close();
      }
    });
  });
});
