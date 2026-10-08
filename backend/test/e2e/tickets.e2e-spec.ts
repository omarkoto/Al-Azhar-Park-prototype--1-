import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import request from 'supertest';
import { Clock } from '../../src/common/clock';
import { QrService } from '../../src/modules/ticketing/qr.service';
import { MAX_EMAIL_ATTEMPTS, TicketDeliveryService } from '../../src/modules/ticketing/ticket-delivery.service';
import { cairoInstant } from '../helpers/cairo';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { CapturingEmail, createTestApp, TestClock } from '../helpers/app';
import { API, login, nextIp } from '../helpers/auth';

const TODAY = '2026-10-07';

describe('tickets, QR codes and delivery (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let clock: TestClock;
  let email: CapturingEmail;
  let qr: QrService;
  let delivery: TicketDeliveryService;
  const tokens: Record<string, string> = {};

  type Method = 'get' | 'post' | 'put' | 'delete';
  const call = (method: Method, path: string, as?: string, body?: object, headers: Record<string, string> = {}) =>
    request(app.getHttpServer())[method](`${API}${path}`).set('X-Forwarded-For', nextIp()).set(as ? { Authorization: `Bearer ${tokens[as]}` } : {}).set(headers).send(body);
  const audit = (action: string) => prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });

  const customer = { fullName: 'Mona Hassan', email: 'mona@example.com', phone: '+201001234567' };
  const orderBody = (over: Record<string, unknown> = {}) => ({
    visitDate: '2026-10-08', audience: 'RESIDENT', items: [{ ticketType: 'ADULT', quantity: 2 }, { ticketType: 'CHILD', quantity: 1 }], customer, acceptTerms: true, locale: 'en', ...over,
  });
  type Placed = { order: { orderNumber: string }; accessToken: string; payment: { providerTxnId: string } };
  const place = async (over: Record<string, unknown> = {}) => (await call('post', '/public/orders', undefined, orderBody(over)).expect(201)).body.data as Placed;
  const pay = (p: Placed, payload: Record<string, unknown> = { outcome: 'SUCCESS' }) => call('post', `/public/payments/mock/${p.payment.providerTxnId}/complete`, undefined, payload);
  const paid = async (over: Record<string, unknown> = {}) => {
    const p = await place(over);
    await pay(p).expect(200);
    return p;
  };
  const view = (p: Placed, token = p.accessToken) => call('get', `/public/orders/${p.order.orderNumber}`, undefined, undefined, { 'X-Order-Token': token });
  const idOf = async (p: Placed) => (await prisma.order.findUniqueOrThrow({ where: { orderNumber: p.order.orderNumber } })).id;

  /** Downloads a PDF the way the website does: with the private key in a header. */
  const pdf = (path: string, token?: string) =>
    request(app.getHttpServer())
      .get(`${API}${path}`)
      .set('X-Forwarded-For', nextIp())
      .set(token ? { 'X-Order-Token': token } : {})
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  const pageCount = (buf: Buffer) => (buf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;
  const decodeQr = (dataUrl: string): string | null => {
    const png = PNG.sync.read(Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
    return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data ?? null;
  };
  const keyFromLink = (message: { text: string }) => /#k=([A-Za-z0-9_-]+)/.exec(message.text)![1];

  beforeAll(async () => {
    prisma = createTestPrisma(8);
    email = new CapturingEmail();
    app = await createTestApp({ TRUST_PROXY: '1' }, undefined, email);
    clock = app.get(Clock) as TestClock;
    qr = app.get(QrService);
    delivery = app.get(TicketDeliveryService);
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
    clock.set(cairoInstant(TODAY, '12:00'));
    email.messages.length = 0;
    email.failWith = null;
    for (const [k, e] of [['admin', 'admin@azharpark.test'], ['ops', 'operations@azharpark.test'], ['analyst', 'analyst@azharpark.test'], ['staff', 'staff@azharpark.test']] as const) {
      tokens[k] = (await login(app, e)).accessToken;
    }
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────────── tickets exist only for a paid order ─────────────────────────────

  describe('finalizing tickets', () => {
    it('an unpaid order has no usable ticket: no QR, no PDF, no e-mail', async () => {
      const p = await place();
      const v = (await view(p).expect(200)).body.data;
      expect(v.status).toBe('PENDING_PAYMENT');
      expect(v.tickets).toEqual([]);
      const rows = await prisma.ticket.findMany({ where: { order: { orderNumber: p.order.orderNumber } } });
      expect(rows).toHaveLength(3);
      expect(rows.every((t) => t.status === 'PENDING' && t.issuedAt === null)).toBe(true);
      const res = await pdf(`/public/orders/${p.order.orderNumber}/tickets/pdf`, p.accessToken);
      expect(res.status).toBe(409);
      expect(email.messages).toHaveLength(0);
    });

    it('paying makes exactly the purchased tickets valid, with the price paid and the visit date', async () => {
      const p = await paid();
      const rows = await prisma.ticket.findMany({ where: { order: { orderNumber: p.order.orderNumber } }, orderBy: { createdAt: 'asc' } });
      expect(rows).toHaveLength(3);
      for (const t of rows) {
        expect(t).toMatchObject({ status: 'VALID', currency: 'EGP', qrKeyId: 1 });
        expect(t.issuedAt).not.toBeNull();
        expect(t.visitDate.toISOString().slice(0, 10)).toBe('2026-10-08');
        expect(t.publicRef).toMatch(/^TKT-[0-9A-Z]{10}$/);
      }
      expect(rows.map((t) => t.pricePaidMinor).sort()).toEqual([3500, 5000, 5000]);
      expect(new Set(rows.map((t) => t.publicRef)).size).toBe(3);
    });

    it('repeating the payment confirmation creates no new ticket and sends no second e-mail', async () => {
      const p = await place();
      await pay(p).expect(200);
      const before = (await prisma.ticket.findMany({ where: { order: { orderNumber: p.order.orderNumber } }, orderBy: { publicRef: 'asc' } })).map((t) => [t.id, t.publicRef, t.issuedAt?.toISOString()]);
      for (let i = 0; i < 3; i += 1) expect((await pay(p).expect(200)).body.data.result).toBe('ALREADY_PAID');
      const after = (await prisma.ticket.findMany({ where: { order: { orderNumber: p.order.orderNumber } }, orderBy: { publicRef: 'asc' } })).map((t) => [t.id, t.publicRef, t.issuedAt?.toISOString()]);
      expect(after).toEqual(before);
      expect(email.messages).toHaveLength(1);
      expect(await prisma.notification.count()).toBe(1);
    });

    it('simultaneous confirmations finalize once: one set of tickets, one e-mail', async () => {
      const p = await place();
      const results = await Promise.all(Array.from({ length: 8 }, () => pay(p)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.filter((r) => r.body.data.result === 'PAID')).toHaveLength(1);
      expect(await prisma.ticket.count({ where: { order: { orderNumber: p.order.orderNumber }, status: 'VALID' } })).toBe(3);
      expect(await prisma.ticket.count()).toBe(3);
      expect(email.messages).toHaveLength(1);
      expect(await prisma.notification.count()).toBe(1);
    });

    it('a failed or expired payment never makes a ticket valid', async () => {
      const failed = await place();
      await pay(failed, { outcome: 'FAILURE' }).expect(200);
      const expired = await place();
      clock.advance(31 * 60_000);
      await pay(expired).expect(409);
      expect(await prisma.ticket.count({ where: { status: 'VALID' } })).toBe(0);
      expect(email.messages).toHaveLength(0);
    });

    it('tickets cannot move backwards: cancelled and used tickets never become valid again', async () => {
      await paid();
      const [a, b] = await prisma.ticket.findMany({ take: 2 });
      await prisma.ticket.update({ where: { id: a.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'test reason' } });
      await prisma.ticket.update({ where: { id: b.id }, data: { status: 'USED', usedAt: new Date() } });
      for (const t of [a, b]) await expect(prisma.ticket.update({ where: { id: t.id }, data: { status: 'VALID' } })).rejects.toThrow(/illegal ticket status change/);
    });
  });

  // ───────────────────────────── QR codes ─────────────────────────────

  describe('QR codes', () => {
    it('shows a signed, scannable QR for every valid ticket of a paid order, and nothing private in it', async () => {
      const p = await paid();
      const v = (await view(p).expect(200)).body.data;
      expect(v.status).toBe('PAID');
      expect(v.tickets).toHaveLength(3);
      const refs = new Set<string>();
      for (const t of v.tickets) {
        expect(t.status).toBe('VALID');
        expect(t.qr).toMatch(/^data:image\/png;base64,/);
        const payload = decodeQr(t.qr)!;
        expect(payload).toMatch(/^AZP1\.TKT-[0-9A-Z]{10}\.1\.[A-Za-z0-9_-]{22}$/);
        expect(qr.verify(payload)).toEqual({ ok: true, ticketRef: t.ref, keyId: 1 });
        for (const secret of ['Mona', 'mona@', '2026-10-08', 'AZP-2026', '5000']) expect(payload).not.toContain(secret);
        refs.add(payload);
      }
      expect(refs.size).toBe(3); // each ticket has its own code
    });

    it('is deterministic: viewing the order again shows the same codes', async () => {
      const p = await paid();
      const first = (await view(p).expect(200)).body.data.tickets.map((t: { qr: string }) => decodeQr(t.qr));
      const second = (await view(p).expect(200)).body.data.tickets.map((t: { qr: string }) => decodeQr(t.qr));
      expect(second).toEqual(first);
    });

    it('lists the tickets in the same order every time, so a ticket never jumps when another is cancelled', async () => {
      const p = await paid({ items: [{ ticketType: 'ADULT', quantity: 6 }] });
      const id = await idOf(p);
      const refs = async () => (await view(p).expect(200)).body.data.tickets.map((t: { ref: string }) => t.ref) as string[];
      const first = await refs();
      for (let i = 0; i < 4; i += 1) expect(await refs()).toEqual(first);
      expect(first).toEqual([...first].sort()); // the tickets were created together, so the reference breaks the tie
      await call('post', `/orders/${id}/tickets/${first[2]}/cancel`, 'ops', { reason: 'Duplicate purchase by mistake' }).expect(200);
      expect(await refs()).toEqual(first);
      const staff = (await call('get', `/orders/${id}`, 'admin').expect(200)).body.data.tickets.map((t: { ref: string }) => t.ref);
      expect(staff).toEqual(first);
    });

    it('a modified code fails: another ticket, another key, another signature, an added date', async () => {
      const p = await paid();
      const [t1, t2] = (await view(p).expect(200)).body.data.tickets as Array<{ ref: string; qr: string }>;
      const [v, ref, key, sig] = decodeQr(t1.qr)!.split('.');
      const other = decodeQr(t2.qr)!.split('.');
      const forged: Array<[string, string]> = [
        ['the ticket id changed', `${v}.${t2.ref}.${key}.${sig}`],
        ['the signature of another ticket replayed', `${v}.${ref}.${key}.${other[3]}`],
        ['the key id changed', `${v}.${ref}.2.${sig}`],
        ['the signature edited', `${v}.${ref}.${key}.${sig.slice(0, 20)}${sig.endsWith('A') ? 'B' : 'A'}${sig.slice(21)}`],
        ['the visit date added', `${v}.${ref}.${key}.${sig}.2026-10-09`],
        ['the visit date appended to the reference', `${v}.${ref}-20261009.${key}.${sig}`],
        ['nothing but the reference', ref],
        ['malformed', 'AZP1..'],
      ];
      for (const [label, payload] of forged) expect({ label, ok: qr.verify(payload).ok }).toEqual({ label, ok: false });
      expect(qr.verify(decodeQr(t1.qr)!).ok).toBe(true);
    });

    it('signs with the active key, and keeps old tickets valid for verification after a key change', async () => {
      const p = await paid();
      const ticket = await prisma.ticket.findFirstOrThrow({ where: { order: { orderNumber: p.order.orderNumber } } });
      expect(ticket.qrKeyId).toBe(1);
      const payload = qr.payloadFor(ticket);
      // an unknown key id cannot be verified
      expect(qr.verify(payload.replace('.1.', '.7.'))).toEqual({ ok: false, reason: 'UNKNOWN_KEY' });
    });

    it('no code is shown for a cancelled ticket, an unpaid order or a cancelled order', async () => {
      const p = await paid();
      const id = await idOf(p);
      const ref = (await prisma.ticket.findFirstOrThrow({ where: { orderId: id } })).publicRef;
      await call('post', `/orders/${id}/tickets/${ref}/cancel`, 'ops', { reason: 'Duplicate purchase by mistake' }).expect(200);
      const v = (await view(p).expect(200)).body.data;
      expect(v.tickets.find((t: { ref: string }) => t.ref === ref)).toMatchObject({ status: 'CANCELLED', qr: null });
      expect(v.tickets.filter((t: { qr: string | null }) => t.qr)).toHaveLength(2);
      await call('post', `/orders/${id}/cancel`, 'ops', { reason: 'Park closed for the day' }).expect(200);
      const after = (await view(p).expect(200)).body.data;
      expect(after.status).toBe('CANCELLED');
      expect(after.tickets).toEqual([]);
    });
  });

  // ───────────────────────────── PDF ─────────────────────────────

  describe('ticket PDF', () => {
    it('downloads all the tickets of a paid order, built by the server, as a private attachment', async () => {
      const p = await paid();
      const res = await pdf(`/public/orders/${p.order.orderNumber}/tickets/pdf`, p.accessToken);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="al-azhar-park-${p.order.orderNumber}.pdf"`);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      const body = res.body as Buffer;
      expect(body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pageCount(body)).toBe(3);
      expect(body.toString('latin1')).toContain('/Subtype /Image'); // the QR code
    });

    it('downloads one ticket, and Arabic on request or by the order language', async () => {
      const p = await paid({ locale: 'ar' });
      const ref = (await prisma.ticket.findFirstOrThrow({ where: { order: { orderNumber: p.order.orderNumber } } })).publicRef;
      const one = await pdf(`/public/orders/${p.order.orderNumber}/tickets/${ref}/pdf`, p.accessToken);
      expect(one.status).toBe(200);
      expect(one.headers['content-disposition']).toContain(`${ref}.pdf`);
      expect(pageCount(one.body as Buffer)).toBe(1);
      expect((one.body as Buffer).toString('latin1')).toMatch(/Cairo/);
      const en = await pdf(`/public/orders/${p.order.orderNumber}/tickets/${ref}/pdf?lang=en`, p.accessToken);
      expect((en.body as Buffer).length).not.toBe((one.body as Buffer).length); // a different language, a different document
      expect((await pdf(`/public/orders/${p.order.orderNumber}/tickets/${ref}/pdf?lang=fr`, p.accessToken)).status).toBe(400);
    });

    it('needs the order\'s private key, and another customer\'s key does not work', async () => {
      const a = await paid();
      const b = await paid({ customer: { ...customer, fullName: 'Omar Said', email: 'omar@example.com' } });
      const refB = (await prisma.ticket.findFirstOrThrow({ where: { order: { orderNumber: b.order.orderNumber } } })).publicRef;
      const urlA = `/public/orders/${a.order.orderNumber}/tickets/pdf`;
      expect((await pdf(urlA)).status).toBe(404); // no key
      expect((await pdf(urlA, 'x'.repeat(43))).status).toBe(404); // made-up key
      expect((await pdf(urlA, b.accessToken)).status).toBe(404); // someone else's key
      expect((await pdf(`/public/orders/${b.order.orderNumber}/tickets/pdf`, a.accessToken)).status).toBe(404);
      // a ticket of another order, asked for through my own order
      expect((await pdf(`/public/orders/${a.order.orderNumber}/tickets/${refB}/pdf`, a.accessToken)).status).toBe(404);
      // guessed references and malformed ones
      expect((await pdf(`/public/orders/${a.order.orderNumber}/tickets/TKT-AAAAAAAAAA/pdf`, a.accessToken)).status).toBe(404);
      expect((await pdf(`/public/orders/${a.order.orderNumber}/tickets/..%2F..%2Fetc/pdf`, a.accessToken)).status).toBe(404);
      // and the key never works as a query parameter
      expect((await request(app.getHttpServer()).get(`${API}${urlA}?token=${a.accessToken}&k=${a.accessToken}`).set('X-Forwarded-For', nextIp())).status).toBe(404);
      expect((await pdf(urlA, a.accessToken)).status).toBe(200);
    });

    it('does not guess: order ids and numbers get the same 404 as a wrong key', async () => {
      const p = await paid();
      const id = await idOf(p);
      expect((await call('get', `/public/orders/${id}`, undefined, undefined, { 'X-Order-Token': p.accessToken })).status).toBe(404);
      expect((await call('get', `/public/orders/AZP-2026-999999`, undefined, undefined, { 'X-Order-Token': p.accessToken })).status).toBe(404);
      await call('get', `/orders/${id}`).expect(401); // the staff route is not the customer route
      await call('post', `/orders/${id}/resend-email`).expect(401);
    });

    it('lists only valid tickets; a cancelled ticket or a cancelled order has no PDF', async () => {
      const p = await paid();
      const id = await idOf(p);
      const refs = (await prisma.ticket.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } })).map((t) => t.publicRef);
      await call('post', `/orders/${id}/tickets/${refs[0]}/cancel`, 'ops', { reason: 'Duplicate purchase by mistake' }).expect(200);
      expect(pageCount((await pdf(`/public/orders/${p.order.orderNumber}/tickets/pdf`, p.accessToken)).body as Buffer)).toBe(2);
      expect((await pdf(`/public/orders/${p.order.orderNumber}/tickets/${refs[0]}/pdf`, p.accessToken)).status).toBe(404);
      await call('post', `/orders/${id}/cancel`, 'ops', { reason: 'Park closed for the day' }).expect(200);
      expect((await pdf(`/public/orders/${p.order.orderNumber}/tickets/pdf`, p.accessToken)).status).toBe(409);
    });

    it('is never stored as public media', async () => {
      const p = await paid();
      await pdf(`/public/orders/${p.order.orderNumber}/tickets/pdf`, p.accessToken);
      expect(await prisma.media.count()).toBe(0);
    });
  });

  // ───────────────────────────── e-mail ─────────────────────────────

  describe('confirmation e-mail', () => {
    it('is sent once when the order is paid, with the private link, and the link works', async () => {
      const p = await paid();
      expect(email.messages).toHaveLength(1);
      const m = email.messages[0];
      expect(m.to).toBe('mona@example.com');
      expect(m.subject).toContain(p.order.orderNumber);
      expect(m.text).toContain('Thursday, October 8, 2026');
      expect(m.text).toContain('135 EGP');
      expect(`${m.text}${m.html}`).not.toMatch(/AZP1\.|TKT-|data:image/);
      expect(m.text).toContain(`http://localhost:5173/orders/${p.order.orderNumber}#k=`);
      // the link's key opens the order and its tickets, and is not the key shown at checkout
      const key = keyFromLink(m);
      expect(key).not.toBe(p.accessToken);
      const opened = (await view(p, key).expect(200)).body.data;
      expect(opened.tickets).toHaveLength(3);
      expect((await pdf(`/public/orders/${p.order.orderNumber}/tickets/pdf`, key)).status).toBe(200);
      const row = await prisma.notification.findFirstOrThrow();
      expect(row).toMatchObject({ status: 'SENT', attempts: 1, channel: 'EMAIL', template: 'order_confirmation', recipient: 'mona@example.com' });
      expect(row.sentAt).not.toBeNull();
      expect(JSON.stringify(row.payload)).not.toContain(key); // the outbox holds no secret
    });

    it('is written in Arabic for an Arabic order', async () => {
      await paid({ locale: 'ar' });
      expect(email.messages[0].subject).toContain('تذاكرك');
      expect(email.messages[0].html).toContain('dir="rtl"');
    });

    it('does not send anything when there is no unpaid-to-paid change', async () => {
      await place();
      await place({ customer: { ...customer, email: 'other@example.com' } });
      expect(email.messages).toHaveLength(0);
      expect(await prisma.notification.count()).toBe(0);
    });

    it('a failing mail service never undoes the payment or the tickets; the failure is recorded for a retry', async () => {
      email.failWith = 'connection refused to smtps://park:s3cret@mail.example.com:465';
      const p = await place();
      expect((await pay(p).expect(200)).body.data.result).toBe('PAID');
      const order = await prisma.order.findUniqueOrThrow({ where: { orderNumber: p.order.orderNumber }, include: { tickets: true } });
      expect(order.status).toBe('PAID');
      expect(order.tickets.every((t) => t.status === 'VALID')).toBe(true);
      const row = await prisma.notification.findFirstOrThrow();
      expect(row).toMatchObject({ status: 'FAILED', attempts: 1 });
      expect(row.lastError).toBe('connection refused to [url]');
      expect(row.lastError).not.toContain('s3cret');
      expect(row.nextAttemptAt?.getTime()).toBe(clock.now().getTime() + 2 * 60_000);
      // the customer can still get to the tickets
      expect((await view(p).expect(200)).body.data.tickets).toHaveLength(3);
      expect((await pdf(`/public/orders/${p.order.orderNumber}/tickets/pdf`, p.accessToken)).status).toBe(200);
      // staff with notification access can see the failure
      const detail = (await call('get', `/orders/${await idOf(p)}`, 'admin').expect(200)).body.data;
      expect(detail.emails[0]).toMatchObject({ status: 'FAILED', attempts: 1, lastError: 'connection refused to [url]' });
    });

    it('retries after the delay, once, and then stops', async () => {
      email.failWith = 'mail service is down';
      await paid();
      expect(await delivery.retryDue()).toBe(0); // not yet
      clock.advance(2 * 60_000 + 1000);
      email.failWith = null;
      expect(await delivery.retryDue()).toBe(1);
      expect(email.messages).toHaveLength(1);
      expect(await prisma.notification.findFirstOrThrow()).toMatchObject({ status: 'SENT', attempts: 2, lastError: null, nextAttemptAt: null });
      clock.advance(10 * 60_000);
      expect(await delivery.retryDue()).toBe(0);
      expect(email.messages).toHaveLength(1); // no duplicate
    });

    it('gives up after the maximum number of attempts, keeps the order intact, and can be resent by staff', async () => {
      email.failWith = 'mail service is down';
      const p = await paid();
      for (let i = 1; i < MAX_EMAIL_ATTEMPTS; i += 1) {
        clock.advance(60 * 60_000);
        expect(await delivery.retryDue()).toBe(1);
      }
      const row = await prisma.notification.findFirstOrThrow();
      expect(row).toMatchObject({ status: 'FAILED', attempts: MAX_EMAIL_ATTEMPTS, nextAttemptAt: null });
      clock.advance(24 * 60 * 60_000);
      expect(await delivery.retryDue()).toBe(0);
      expect((await prisma.order.findUniqueOrThrow({ where: { orderNumber: p.order.orderNumber } })).status).toBe('PAID');
      email.failWith = null;
      const resent = await call('post', `/orders/${await idOf(p)}/resend-email`, 'ops').expect(200);
      expect(resent.body.data).toMatchObject({ status: 'SENT', attempts: 1 });
      expect(email.messages).toHaveLength(1);
    });

    it('two workers cannot send the same attempt', async () => {
      email.failWith = 'mail service is down';
      await paid();
      email.failWith = null;
      clock.advance(3 * 60_000);
      const id = (await prisma.notification.findFirstOrThrow()).id;
      await Promise.all([delivery.attempt(id), delivery.attempt(id), delivery.attempt(id), delivery.attempt(id)]);
      expect(email.messages).toHaveLength(1);
      expect((await prisma.notification.findFirstOrThrow()).attempts).toBe(2);
    });

    it('never sends tickets for an order that was cancelled while the e-mail waited', async () => {
      email.failWith = 'mail service is down';
      const p = await paid();
      await call('post', `/orders/${await idOf(p)}/cancel`, 'ops', { reason: 'Park closed for the day' }).expect(200);
      email.failWith = null;
      clock.advance(3 * 60_000);
      await delivery.retryDue();
      expect(email.messages).toHaveLength(0);
      const row = await prisma.notification.findFirstOrThrow();
      expect(row).toMatchObject({ status: 'FAILED', nextAttemptAt: null });
      expect(row.lastError).toMatch(/cancelled/);
    });

    it('an order without an e-mail address is simply not e-mailed', async () => {
      const p = await place();
      await prisma.customer.updateMany({ data: { email: null } });
      await pay(p).expect(200);
      expect(email.messages).toHaveLength(0);
      expect(await prisma.notification.count()).toBe(0);
    });
  });

  // ───────────────────────────── staff: resend and ticket cancellation ─────────────────────────────

  describe('staff', () => {
    it('resends the e-mail on purpose: a new message, audited, with a fresh private link', async () => {
      const p = await paid();
      const id = await idOf(p);
      const res = await call('post', `/orders/${id}/resend-email`, 'ops').expect(200);
      expect(res.body.data).toMatchObject({ status: 'SENT', recipient: 'mona@example.com' });
      expect(email.messages).toHaveLength(2);
      expect(keyFromLink(email.messages[1])).not.toBe(keyFromLink(email.messages[0]));
      const [entry] = await audit('order.email_resent');
      expect(entry).toMatchObject({ entity: 'order', entityId: id });
      expect(entry.userId).not.toBeNull();
      expect(JSON.stringify(entry)).not.toMatch(/#k=|AZP1\./);
      expect(await prisma.notification.count()).toBe(2);
      const detail = (await call('get', `/orders/${id}`, 'admin').expect(200)).body.data;
      expect(detail.emails).toHaveLength(2);
    });

    it('only people with tickets:resend can resend, and only for a paid order', async () => {
      const p = await paid();
      const id = await idOf(p);
      await call('post', `/orders/${id}/resend-email`, 'analyst').expect(403);
      await call('post', `/orders/${id}/resend-email`, 'staff').expect(403);
      const unpaid = await place();
      const res = await call('post', `/orders/${await idOf(unpaid)}/resend-email`, 'ops').expect(409);
      expect(res.body.error.code).toBe('ORDER_NOT_PAID');
      await call('post', `/orders/7b9d8c6e-1b0d-4f4a-9a2e-0f0b6c6d5a11/resend-email`, 'ops').expect(404);
      expect(email.messages).toHaveLength(1);
    });

    it('shows e-mail status only to people allowed to see notifications', async () => {
      const p = await paid();
      const id = await idOf(p);
      expect((await call('get', `/orders/${id}`, 'admin').expect(200)).body.data.emails).toHaveLength(1);
      expect((await call('get', `/orders/${id}`, 'ops').expect(200)).body.data.emails).toBeUndefined();
    });

    it('cancels one ticket for a reason, audited, leaving the order and the payment as they were', async () => {
      const p = await paid();
      const id = await idOf(p);
      const [a, b] = await prisma.ticket.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } });
      await call('post', `/orders/${id}/tickets/${a.publicRef}/cancel`, 'ops', {}).expect(400);
      await call('post', `/orders/${id}/tickets/${a.publicRef}/cancel`, 'ops', { reason: 'hey' }).expect(400);
      await call('post', `/orders/${id}/tickets/${a.publicRef}/cancel`, 'analyst', { reason: 'Duplicate purchase by mistake' }).expect(403);
      await call('post', `/orders/${id}/tickets/${a.publicRef}/cancel`, 'ops', { reason: 'Duplicate purchase by mistake' }).expect(200);
      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: a.id } });
      expect(row).toMatchObject({ status: 'CANCELLED', cancelReason: 'Duplicate purchase by mistake' });
      expect(row.cancelledAt).not.toBeNull();
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('VALID');
      const order = await prisma.order.findUniqueOrThrow({ where: { id }, include: { payments: true } });
      expect(order.status).toBe('PAID');
      expect(order.payments.map((x) => x.status)).toEqual(['PAID']);
      const [entry] = await audit('ticket.cancelled');
      expect(entry).toMatchObject({ entity: 'ticket', entityId: a.id });
      expect(entry.newValue).toMatchObject({ reason: 'Duplicate purchase by mistake', ref: a.publicRef });
      expect((await call('post', `/orders/${id}/tickets/${a.publicRef}/cancel`, 'ops', { reason: 'Again please' }).expect(409)).body.error.code).toBe('TICKET_ALREADY_CANCELLED');
      expect((await audit('order.refunded')).length).toBe(0);
    });

    it('cannot cancel a used ticket, a ticket of another order, or an unknown one', async () => {
      const p = await paid();
      const other = await paid();
      const id = await idOf(p);
      const [a] = await prisma.ticket.findMany({ where: { orderId: id } });
      await prisma.ticket.update({ where: { id: a.id }, data: { status: 'USED', usedAt: new Date() } });
      expect((await call('post', `/orders/${id}/tickets/${a.publicRef}/cancel`, 'ops', { reason: 'Changed our mind' }).expect(409)).body.error.code).toBe('TICKET_NOT_CANCELLABLE');
      const foreign = (await prisma.ticket.findFirstOrThrow({ where: { order: { orderNumber: other.order.orderNumber } } })).publicRef;
      await call('post', `/orders/${id}/tickets/${foreign}/cancel`, 'ops', { reason: 'Changed our mind' }).expect(404);
      await call('post', `/orders/${id}/tickets/TKT-AAAAAAAAAA/cancel`, 'ops', { reason: 'Changed our mind' }).expect(404);
    });

    it('cannot change a ticket\'s price, date or reference after payment, even by hand', async () => {
      const p = await paid();
      const t = await prisma.ticket.findFirstOrThrow({ where: { order: { orderNumber: p.order.orderNumber } } });
      for (const data of [{ pricePaidMinor: 1 }, { visitDate: new Date('2026-12-01') }, { publicRef: 'TKT-AAAAAAAAAA' }, { ticketTypeId: (await prisma.ticketType.findFirstOrThrow({ where: { code: 'CHILD' } })).id }]) {
        await expect(prisma.ticket.update({ where: { id: t.id }, data })).rejects.toThrow(/immutable/);
      }
      expect((await call('put', `/orders/${await idOf(p)}`, 'admin', { totalMinor: 1 })).status).toBe(404); // there is no edit route
    });
  });
});
