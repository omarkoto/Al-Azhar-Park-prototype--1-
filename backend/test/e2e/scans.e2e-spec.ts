import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import request from 'supertest';
import { Clock } from '../../src/common/clock';
import { qrFingerprint } from '../../src/common/security/ticket-qr';
import { PrismaService } from '../../src/prisma/prisma.service';
import { OrderLifecycleService } from '../../src/modules/ticketing/order-lifecycle.service';
import { QrService } from '../../src/modules/ticketing/qr.service';
import { cairoInstant } from '../helpers/cairo';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { createTestApp, TestClock } from '../helpers/app';
import { API, createUser, login, nextIp } from '../helpers/auth';

const TODAY = '2026-10-07';
const KEYS = JSON.stringify({ 1: 'k'.repeat(40), 2: 'j'.repeat(40) });

describe('gate scanning (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let clock: TestClock;
  let qr: QrService;
  const tokens: Record<string, string> = {};
  let gates: Record<string, { id: string }> = {};

  const call = (method: 'get' | 'post', path: string, as?: string, body?: object, ip = nextIp()) =>
    request(app.getHttpServer())[method](`${API}${path}`).set('X-Forwarded-For', ip).set(as ? { Authorization: `Bearer ${tokens[as]}` } : {}).send(body);
  const scan = (payload: string, as = 'staff', gate = 'MAIN') => call('post', '/scans', as, { qr: payload, gateId: gates[gate].id });
  const audit = (action: string) => prisma.auditLog.findMany({ where: { action } });

  const customer = { fullName: 'Mona Hassan', email: 'mona@example.com', phone: '+201001234567' };
  /** Buys and pays for tickets (the Phase 6 flow) and returns their references. */
  async function paidTickets(visitDate = TODAY, quantity = 1) {
    const body = { visitDate, audience: 'RESIDENT', items: [{ ticketType: 'ADULT', quantity }], customer, acceptTerms: true, locale: 'en' };
    const placed = (await call('post', '/public/orders', undefined, body).expect(201)).body.data;
    await call('post', `/public/payments/mock/${placed.payment.providerTxnId}/complete`, undefined, { outcome: 'SUCCESS' }).expect(200);
    const tickets = await prisma.ticket.findMany({ where: { order: { orderNumber: placed.order.orderNumber } }, orderBy: { publicRef: 'asc' } });
    return { placed, tickets, payloads: tickets.map((t) => qr.payloadFor(t)) };
  }
  const reload = (id: string) => prisma.ticket.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    prisma = createTestPrisma(15);
    app = await createTestApp({ TRUST_PROXY: '1', TICKET_QR_KEYS: KEYS, TICKET_QR_ACTIVE_KEY_ID: '1' });
    clock = app.get(Clock) as TestClock;
    qr = app.get(QrService);
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
    clock.set(cairoInstant(TODAY, '12:00'));
    for (const [k, e] of [['staff', 'staff@azharpark.test'], ['ops', 'operations@azharpark.test'], ['analyst', 'analyst@azharpark.test'], ['content', 'content@azharpark.test'], ['admin', 'admin@azharpark.test']] as const) {
      tokens[k] = (await login(app, e)).accessToken;
    }
    gates = Object.fromEntries((await prisma.gate.findMany()).map((g) => [g.code, { id: g.id }]));
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────── who may scan ─────────────────────────────

  describe('access', () => {
    it('refuses an unauthenticated request and a user without the scan permission (fail closed)', async () => {
      const { payloads, tickets } = await paidTickets();
      await call('post', '/scans', undefined, { qr: payloads[0], gateId: gates.MAIN.id }).expect(401);
      await call('get', '/scans/gates').expect(401);
      for (const who of ['analyst', 'content']) {
        await scan(payloads[0], who).expect(403);
        await call('get', '/scans/gates', who).expect(403);
      }
      expect((await reload(tickets[0].id)).status).toBe('VALID');
      expect(await prisma.ticketScan.count()).toBe(0);
    });

    it('lets people who hold scans:create scan: ticket staff, operations, administrators (permissions, not role names)', async () => {
      const { payloads } = await paidTickets(TODAY, 3);
      for (const [i, who] of (['staff', 'ops', 'admin'] as const).entries()) expect((await scan(payloads[i], who).expect(200)).body.data.result).toBe('ACCESS_GRANTED');
    });

    it('a custom role with only scans:create can scan, and one without it cannot', async () => {
      const role = await prisma.role.create({ data: { code: 'GATE_ONLY', name: 'Gate only' } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: (await prisma.permission.findUniqueOrThrow({ where: { code: 'scans:create' } })).id } });
      const user = await createUser(prisma, { role: 'GATE_ONLY' });
      tokens.gateonly = (await login(app, user.email)).accessToken;
      const { payloads } = await paidTickets();
      expect((await call('get', '/scans/gates', 'gateonly').expect(200)).body.data).toHaveLength(2);
      expect((await scan(payloads[0], 'gateonly').expect(200)).body.data.granted).toBe(true);
    });

    it('lists only active gates', async () => {
      expect((await call('get', '/scans/gates', 'staff').expect(200)).body.data.map((g: { code: string }) => g.code)).toEqual(['DARASSA', 'MAIN']);
      await prisma.gate.update({ where: { code: 'DARASSA' }, data: { isActive: false } });
      const list = (await call('get', '/scans/gates', 'staff').expect(200)).body.data;
      expect(list.map((g: { code: string }) => g.code)).toEqual(['MAIN']);
      expect(list[0]).toEqual({ id: gates.MAIN.id, code: 'MAIN', nameEn: expect.any(String), nameAr: expect.any(String) });
    });
  });

  // ───────────────────────────── gates ─────────────────────────────

  describe('gate', () => {
    it('refuses an unknown, inactive or malformed gate without consuming the ticket or recording a scan', async () => {
      const { payloads, tickets } = await paidTickets();
      const post = (gateId: unknown) => call('post', '/scans', 'staff', { qr: payloads[0], gateId });
      expect((await post('7b9d8c6e-1b0d-4f4a-9a2e-0f0b6c6d5a11').expect(404)).body.error.code).toBe('GATE_NOT_FOUND');
      await prisma.gate.update({ where: { code: 'DARASSA' }, data: { isActive: false } });
      expect((await post(gates.DARASSA.id).expect(422)).body.error.code).toBe('GATE_INACTIVE');
      for (const bad of ['MAIN', '', null, 5, undefined]) expect((await post(bad).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      expect((await reload(tickets[0].id)).status).toBe('VALID');
      expect(await prisma.ticketScan.count()).toBe(0);
    });

    it('records which gate admitted the visitor', async () => {
      const { payloads } = await paidTickets(TODAY, 2);
      const a = (await scan(payloads[0], 'staff', 'MAIN').expect(200)).body.data;
      const b = (await scan(payloads[1], 'staff', 'DARASSA').expect(200)).body.data;
      expect(a.gate.code).toBe('MAIN');
      expect(b.gate.code).toBe('DARASSA');
      const rows = await prisma.ticketScan.findMany({ orderBy: { scannedAt: 'asc' }, include: { gate: true } });
      expect(rows.map((r) => r.gate?.code).sort()).toEqual(['DARASSA', 'MAIN']);
    });
  });

  // ───────────────────────────── a good ticket ─────────────────────────────

  describe('a valid ticket for today', () => {
    it('is admitted once: the ticket is used, the scan recorded, nothing private returned', async () => {
      const { payloads, tickets } = await paidTickets();
      const before = await reload(tickets[0].id);
      const res = await scan(payloads[0]).expect(200);
      expect(res.body.data).toMatchObject({
        result: 'ACCESS_GRANTED', granted: true, message: 'Access granted.', gate: { code: 'MAIN' },
        ticket: { ref: tickets[0].publicRef, visitDate: TODAY, typeNameEn: 'Adult', audienceNameEn: 'Egyptian / resident' },
      });
      expect(new Date(res.body.data.scannedAt).getTime()).toBe(clock.now().getTime());
      const text = JSON.stringify(res.body);
      for (const secret of ['Mona', 'mona@', '2010', 'phone', 'email', 'pricePaid', '5000', 'orderNumber', 'AZP-2026']) expect(text).not.toContain(secret);
      expect(text).not.toContain(payloads[0]);

      const after = await reload(tickets[0].id);
      expect(after).toMatchObject({ status: 'USED' });
      expect(after.usedAt?.getTime()).toBe(clock.now().getTime());
      expect(after.usedById).not.toBeNull();
      // nothing else about the ticket changed
      for (const key of ['publicRef', 'orderId', 'orderItemId', 'ticketTypeId', 'audienceId', 'visitDate', 'pricePaidMinor', 'currency', 'qrKeyId', 'issuedAt', 'customerId'] as const) {
        expect({ key, v: String(after[key]) }).toEqual({ key, v: String(before[key]) });
      }
      const rows = await prisma.ticketScan.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ ticketId: tickets[0].id, result: 'VALID', reason: 'OK', detail: 'ACCESS_GRANTED', gateId: gates.MAIN.id, scannedById: after.usedById, tokenFingerprint: qrFingerprint(payloads[0]) });
      expect(rows[0].id).toBe(res.body.data.scanId);
      const [entry] = await audit('ticket.scanned');
      expect(entry).toMatchObject({ entity: 'ticket', entityId: tickets[0].id, userId: after.usedById });
      expect(JSON.stringify(entry)).not.toContain(payloads[0]);
    });

    it('scanning the QR image of the paid order works: the Phase 7 code is the one the gate reads', async () => {
      const { placed, tickets } = await paidTickets();
      const view = (await call('get', `/public/orders/${placed.order.orderNumber}`, undefined).set('X-Order-Token', placed.accessToken).expect(200)).body.data;
      const png = PNG.sync.read(Buffer.from(view.tickets[0].qr.replace(/^data:image\/png;base64,/, ''), 'base64'));
      const payload = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)!.data;
      expect((await scan(payload).expect(200)).body.data).toMatchObject({ result: 'ACCESS_GRANTED', ticket: { ref: tickets[0].publicRef } });
    });

    it('a repeated scan is refused as ALREADY_USED, with the time of the first use, and admits no one', async () => {
      const { payloads, tickets } = await paidTickets();
      await scan(payloads[0]).expect(200);
      clock.advance(5 * 60_000);
      const again = (await scan(payloads[0], 'ops', 'DARASSA').expect(200)).body.data;
      expect(again).toMatchObject({ result: 'ALREADY_USED', granted: false, message: 'This ticket has already been used.', ticket: { ref: tickets[0].publicRef } });
      expect(new Date(again.usedAt).getTime()).toBe(cairoInstant(TODAY, '12:00').getTime());
      expect(await prisma.ticketScan.count({ where: { result: 'VALID' } })).toBe(1);
      expect(await prisma.ticketScan.count({ where: { detail: 'ALREADY_USED' } })).toBe(1);
      expect((await reload(tickets[0].id)).usedAt?.getTime()).toBe(cairoInstant(TODAY, '12:00').getTime()); // the first use stands
    });

    it('lets exactly one of many simultaneous scans in', async () => {
      const { payloads, tickets } = await paidTickets();
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => scan(payloads[0], i % 2 ? 'ops' : 'staff', i % 3 ? 'MAIN' : 'DARASSA')));
      expect(results.every((r) => r.status === 200)).toBe(true);
      const outcomes = results.map((r) => r.body.data.result as string);
      expect(outcomes.filter((o) => o === 'ACCESS_GRANTED')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'ALREADY_USED')).toHaveLength(11);
      expect(await prisma.ticketScan.count({ where: { result: 'VALID' } })).toBe(1);
      expect(await prisma.ticketScan.count()).toBe(12);
      expect(await audit('ticket.scanned')).toHaveLength(1);
      expect((await reload(tickets[0].id)).status).toBe('USED');
    });

    it('simultaneous scans of different tickets are all admitted', async () => {
      const { payloads } = await paidTickets(TODAY, 6);
      const results = await Promise.all(payloads.map((p) => scan(p)));
      expect(results.map((r) => r.body.data.result)).toEqual(Array(6).fill('ACCESS_GRANTED'));
    });
  });

  // ───────────────────────────── the visit date, in Cairo ─────────────────────────────

  describe('visit date', () => {
    it('refuses tomorrow\'s and yesterday\'s tickets without using them', async () => {
      const tomorrow = await paidTickets('2026-10-08');
      const today = await paidTickets(TODAY);
      expect((await scan(tomorrow.payloads[0]).expect(200)).body.data).toMatchObject({ result: 'WRONG_DATE', granted: false, ticket: { visitDate: '2026-10-08' } });
      expect((await reload(tomorrow.tickets[0].id)).status).toBe('VALID');
      clock.set(cairoInstant('2026-10-08', '10:00')); // the next day: today's ticket is now yesterday's
      expect((await scan(today.payloads[0]).expect(200)).body.data.result).toBe('WRONG_DATE');
      expect((await reload(today.tickets[0].id)).status).toBe('VALID');
      expect((await scan(tomorrow.payloads[0]).expect(200)).body.data.result).toBe('ACCESS_GRANTED'); // and tomorrow's is today's
    });

    it('uses the Cairo calendar day, not UTC: the last second of the day and the first second of the next', async () => {
      const a = await paidTickets(TODAY);
      const b = await paidTickets('2026-10-08');
      clock.set(cairoInstant(TODAY, '23:59:59'));
      expect((await scan(a.payloads[0]).expect(200)).body.data.result).toBe('ACCESS_GRANTED');
      clock.set(cairoInstant('2026-10-08', '00:00:01')); // 21:00:01 UTC on the 7th: UTC still says the 7th
      expect((await scan(b.payloads[0]).expect(200)).body.data.result).toBe('ACCESS_GRANTED');
    });

    it('a ticket for the 7th is refused at 00:30 Cairo on the 8th even though UTC is still the 7th', async () => {
      const a = await paidTickets(TODAY);
      clock.set(cairoInstant('2026-10-08', '00:30:00'));
      expect(clock.now().toISOString().slice(0, 10)).toBe('2026-10-07');
      expect((await scan(a.payloads[0]).expect(200)).body.data.result).toBe('WRONG_DATE');
    });

    it('follows the daylight-saving change (Cairo moves to winter time on the last Friday of October)', async () => {
      clock.set(cairoInstant('2026-10-20', '12:00'));
      const t = await paidTickets('2026-10-30');
      // 30 October 2026 is the last Friday: clocks go back at midnight, so that day has 25 hours
      clock.set(cairoInstant('2026-10-30', '00:30:00'));
      expect((await scan(t.payloads[0]).expect(200)).body.data.result).toBe('ACCESS_GRANTED');
    });
  });

  // ───────────────────────────── other ticket states ─────────────────────────────

  describe('ticket state', () => {
    it('refuses a ticket of an unpaid order (PENDING)', async () => {
      const body = { visitDate: TODAY, audience: 'RESIDENT', items: [{ ticketType: 'ADULT', quantity: 1 }], customer, acceptTerms: true, locale: 'en' };
      await call('post', '/public/orders', undefined, body).expect(201);
      const t = await prisma.ticket.findFirstOrThrow();
      expect(t.status).toBe('PENDING');
      expect((await scan(qr.payloadFor(t)).expect(200)).body.data).toMatchObject({ result: 'TICKET_NOT_VALID', granted: false });
      expect((await reload(t.id)).status).toBe('PENDING');
    });

    it('refuses a cancelled ticket and does not bring it back', async () => {
      const { payloads, tickets, placed } = await paidTickets();
      await call('post', `/orders/${(await prisma.order.findFirstOrThrow({ where: { orderNumber: placed.order.orderNumber } })).id}/tickets/${tickets[0].publicRef}/cancel`, 'ops', { reason: 'Duplicate purchase by mistake' }).expect(200);
      expect((await scan(payloads[0]).expect(200)).body.data).toMatchObject({ result: 'CANCELLED', granted: false });
      expect((await reload(tickets[0].id)).status).toBe('CANCELLED');
    });

    it('refuses a ticket of a cancelled order', async () => {
      const { payloads, placed } = await paidTickets(TODAY, 2);
      await call('post', `/orders/${(await prisma.order.findFirstOrThrow({ where: { orderNumber: placed.order.orderNumber } })).id}/cancel`, 'ops', { reason: 'Park closed for the day' }).expect(200);
      for (const p of payloads) expect((await scan(p).expect(200)).body.data.result).toBe('CANCELLED');
    });

    it('refuses an expired ticket (an unpaid order that ran out of time)', async () => {
      const body = { visitDate: TODAY, audience: 'RESIDENT', items: [{ ticketType: 'ADULT', quantity: 1 }], customer, acceptTerms: true, locale: 'en' };
      await call('post', '/public/orders', undefined, body).expect(201);
      clock.advance(31 * 60_000);
      await app.get(OrderLifecycleService).expireAllDue();
      const t = await prisma.ticket.findFirstOrThrow();
      expect(t.status).toBe('EXPIRED');
      expect((await scan(qr.payloadFor(t)).expect(200)).body.data).toMatchObject({ result: 'EXPIRED', granted: false });
    });

    it('a used ticket can never become valid again, not by a scan and not by hand', async () => {
      const { payloads, tickets } = await paidTickets();
      await scan(payloads[0]).expect(200);
      for (let i = 0; i < 3; i += 1) expect((await scan(payloads[0]).expect(200)).body.data.result).toBe('ALREADY_USED');
      await expect(prisma.ticket.update({ where: { id: tickets[0].id }, data: { status: 'VALID' } })).rejects.toThrow(/illegal ticket status change/);
      await expect(prisma.ticket.update({ where: { id: tickets[0].id }, data: { status: 'CANCELLED' } })).rejects.toThrow(/illegal ticket status change/);
      await expect(prisma.$executeRawUnsafe(`UPDATE tickets SET visit_date = DATE '2030-01-01' WHERE id = '${tickets[0].id}'::uuid`)).rejects.toThrow(/immutable/);
      // and the scan history cannot be rewritten
      await expect(prisma.ticketScan.deleteMany()).rejects.toThrow(/append-only/);
      await expect(prisma.ticketScan.updateMany({ data: { result: 'INVALID' } })).rejects.toThrow(/append-only/);
    });
  });

  // ───────────────────────────── the code itself ─────────────────────────────

  describe('the QR code', () => {
    const lookups = () => {
      const spy = jest.spyOn((app.get(PrismaService) as unknown as { ticket: { findUnique: (...a: unknown[]) => unknown } }).ticket, 'findUnique');
      return spy;
    };

    it('refuses malformed codes without looking up any ticket', async () => {
      const spy = lookups();
      const junk = ['hello', 'AZP1', 'AZP1.TKT-8F3K2LQ7ZP', 'AZP1.TKT-8F3K2LQ7ZP.1', 'A'.repeat(70), 'AZP1.tkt-8f3k2lq7zp.1.' + 'A'.repeat(22), "AZP1.TKT-8F3K2LQ7ZP.1.' OR 1=1 --", '<script>alert(1)</script>', 'AZP1.TKT-8F3K2LQ7ZP.1.' + 'A'.repeat(22) + '.extra', ' ', '\u0000'];
      for (const bad of junk) {
        const res = await call('post', '/scans', 'staff', { qr: bad, gateId: gates.MAIN.id });
        if (res.status === 400) continue; // an empty/blank code is refused before it is even a scan
        expect({ bad, result: res.body.data.result }).toEqual({ bad, result: 'INVALID_QR' });
        expect(res.body.data.granted).toBe(false);
        expect(res.body.data.ticket).toBeUndefined();
      }
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
      expect(await prisma.ticketScan.count({ where: { detail: 'INVALID_QR' } })).toBeGreaterThan(5);
    });

    it('refuses a forged or altered code: another signature, another ticket, an added date', async () => {
      const { payloads, tickets } = await paidTickets(TODAY, 2);
      const [v, ref, key, sig] = payloads[0].split('.');
      const other = payloads[1].split('.');
      const forged = [
        `${v}.${ref}.${key}.${sig.slice(0, 20)}${sig.endsWith('A') ? 'B' : 'A'}${sig.slice(21)}`,
        `${v}.${other[1]}.${key}.${sig}`,
        `${v}.${ref}.${key}.${other[3]}`,
        `${v}.${ref}.${key}.${'A'.repeat(22)}`,
      ];
      for (const f of forged) expect((await scan(f).expect(200)).body.data).toMatchObject({ result: 'INVALID_SIGNATURE', granted: false, message: 'This is not a valid Al-Azhar Park ticket.' });
      // an appended visit date is not a code any more
      expect((await scan(`${payloads[0]}.2026-10-07`).expect(200)).body.data.result).toBe('INVALID_QR');
      for (const t of tickets) expect((await reload(t.id)).status).toBe('VALID');
      // the genuine ones still work afterwards
      expect((await scan(payloads[0]).expect(200)).body.data.result).toBe('ACCESS_GRANTED');
    });

    it('says nothing about how the code is checked', async () => {
      const bad = (await scan(`AZP1.TKT-8F3K2LQ7ZP.1.${'A'.repeat(22)}`).expect(200)).body.data;
      const text = JSON.stringify(bad).toLowerCase();
      for (const leak of ['hmac', 'sha256', 'secret', 'timing', 'prisma', 'sql', 'stack', 'at object', 'key id', 'canonical']) expect(text).not.toContain(leak);
      expect(bad.message).toBe('This is not a valid Al-Azhar Park ticket.');
    });

    it('a code signed with a retired key is refused as RETIRED_KEY', async () => {
      const { tickets } = await paidTickets();
      const retired = qr.payloadFor(tickets[0]).replace('.1.', '.9.');
      expect((await scan(retired).expect(200)).body.data).toMatchObject({ result: 'RETIRED_KEY', granted: false });
      expect((await reload(tickets[0].id)).status).toBe('VALID');
    });

    it('a code signed with another valid key does not open a ticket issued under key 1', async () => {
      const { tickets } = await paidTickets();
      const underKey2 = qr.payloadFor({ publicRef: tickets[0].publicRef, qrKeyId: 2 });
      expect(qr.verify(underKey2).ok).toBe(true); // a genuine signature ...
      expect((await scan(underKey2).expect(200)).body.data.result).toBe('INVALID_SIGNATURE'); // ... but not for this ticket
      expect((await reload(tickets[0].id)).status).toBe('VALID');
    });

    it('a correctly signed code for a ticket that does not exist is TICKET_NOT_FOUND', async () => {
      const ghost = qr.payloadFor({ publicRef: 'TKT-AAAAAAAAAA', qrKeyId: 1 });
      const res = (await scan(ghost).expect(200)).body.data;
      expect(res).toMatchObject({ result: 'TICKET_NOT_FOUND', granted: false });
      expect(res.ticket).toBeUndefined();
      expect(await prisma.ticketScan.count({ where: { detail: 'TICKET_NOT_FOUND', ticketId: null } })).toBe(1);
    });
  });

  // ───────────────────────────── what is stored ─────────────────────────────

  describe('scan records and privacy', () => {
    it('stores a 12-character fingerprint of the code and never the code, in any table', async () => {
      const { payloads, tickets } = await paidTickets(TODAY, 2);
      await scan(payloads[0]).expect(200);
      await scan(payloads[0]).expect(200);
      await scan(`${payloads[1].slice(0, -3)}AAA`).expect(200);
      await scan('not a ticket').expect(200);
      const rows = await prisma.ticketScan.findMany({ orderBy: { scannedAt: 'asc' } });
      expect(rows).toHaveLength(4);
      for (const r of rows) expect(r.tokenFingerprint).toMatch(/^[0-9a-f]{12}$/);
      expect(rows[0].tokenFingerprint).toBe(rows[1].tokenFingerprint); // the same code is recognisable ...
      expect(rows[0].tokenFingerprint).not.toBe(rows[2].tokenFingerprint); // ... a different one is not
      const everything = JSON.stringify({
        scans: rows, audit: await prisma.auditLog.findMany(), notifications: await prisma.notification.findMany(),
        tickets: (await prisma.ticket.findMany()).map((t) => ({ ...t, publicRef: undefined })),
      });
      for (const p of payloads) {
        expect(everything).not.toContain(p);
        expect(everything).not.toContain(p.split('.')[3]); // not even the signature
      }
      expect(everything).not.toContain('not a ticket');
      expect(rows.every((r) => r.ticketId === null || r.ticketId === tickets[0].id || r.ticketId === tickets[1].id)).toBe(true);
    });

    it('records who scanned, from where, and the precise result of every attempt', async () => {
      const { payloads } = await paidTickets();
      await call('post', '/scans', 'staff', { qr: payloads[0], gateId: gates.MAIN.id }, '10.77.0.9').set('User-Agent', 'GateScanner/1.0').expect(200);
      await call('post', '/scans', 'ops', { qr: 'x'.repeat(30), gateId: gates.DARASSA.id }, '10.77.0.10').expect(200);
      const rows = await prisma.ticketScan.findMany({ orderBy: { scannedAt: 'asc' }, include: { scannedBy: true } });
      expect(rows.map((r) => [r.detail, r.result, r.reason, r.scannedBy.email, r.ip])).toEqual([
        ['ACCESS_GRANTED', 'VALID', 'OK', 'staff@azharpark.test', '10.77.0.9'],
        ['INVALID_QR', 'INVALID', 'INVALID_TOKEN', 'operations@azharpark.test', '10.77.0.10'],
      ]);
      expect(rows[0].device).toEqual({ userAgent: 'GateScanner/1.0' });
    });

    it('accepts only the code and the gate: nothing the client claims about the ticket is read', async () => {
      const { payloads } = await paidTickets('2026-10-08');
      for (const extra of [{ visitDate: TODAY }, { status: 'VALID' }, { ticketRef: 'TKT-AAAAAAAAAA' }, { force: true }, { price: 1 }]) {
        expect((await call('post', '/scans', 'staff', { qr: payloads[0], gateId: gates.MAIN.id, ...extra }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      }
      expect((await call('post', '/scans', 'staff', { qr: 'A'.repeat(513), gateId: gates.MAIN.id }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      expect((await call('post', '/scans', 'staff', { gateId: gates.MAIN.id }).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
      expect((await scan(payloads[0]).expect(200)).body.data.result).toBe('WRONG_DATE'); // the date comes from the database
    });
  });
});

describe('gate scan rate limit (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let staff = '';

  beforeAll(async () => {
    prisma = createTestPrisma(5);
    await resetDatabase(prisma);
    await seedAll(prisma);
    app = await createTestApp({ TRUST_PROXY: '1', SCAN_RATE_LIMIT_PER_MINUTE: '6', RATE_LIMIT_MAX: '1000' });
    staff = (await login(app, 'staff@azharpark.test')).accessToken;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('counts scans per address against its own configurable limit, then answers 429', async () => {
    const gate = await prisma.gate.findFirstOrThrow({ where: { code: 'MAIN' } });
    const post = (ip: string) => request(app.getHttpServer()).post(`${API}/scans`).set('X-Forwarded-For', ip).set({ Authorization: `Bearer ${staff}` }).send({ qr: 'AZP1.guess', gateId: gate.id });
    const statuses: number[] = [];
    for (let i = 0; i < 9; i += 1) statuses.push((await post('10.55.0.1')).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429, 429, 429]);
    const limited = await post('10.55.0.1');
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    // another address is not affected, and other routes do not use up the scan allowance
    expect((await post('10.55.0.2')).status).toBe(200);
    const other = await request(app.getHttpServer()).get(`${API}/scans/gates`).set('X-Forwarded-For', '10.55.0.3').set({ Authorization: `Bearer ${staff}` });
    expect(other.status).toBe(200);
  });
});
