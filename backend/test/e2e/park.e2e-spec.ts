import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { addDays, parkDateOf } from '../../src/modules/ticketing/rules/calendar';
import { evaluateSale } from '../../src/modules/ticketing/rules';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { createTestApp } from '../helpers/app';
import { API, login, nextIp } from '../helpers/auth';
import { cairoInstant } from '../helpers/cairo';

describe('park content: contact, information, opening hours (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};

  type Method = 'get' | 'post' | 'put' | 'delete';
  const call = (method: Method, path: string, as?: string, body?: object) =>
    request(app.getHttpServer())[method](`${API}${path}`).set('X-Forwarded-For', nextIp()).set(as ? { Authorization: `Bearer ${tokens[as]}` } : {}).send(body);
  const audit = (action: string) => prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });

  const today = () => parkDateOf(new Date());

  beforeAll(async () => {
    prisma = createTestPrisma(5);
    app = await createTestApp({ TRUST_PROXY: '1' });
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
    for (const [key, email] of [['admin', 'admin@azharpark.test'], ['content', 'content@azharpark.test'], ['ops', 'operations@azharpark.test'], ['staff', 'staff@azharpark.test'], ['analyst', 'analyst@azharpark.test']] as const) {
      tokens[key] = (await login(app, email)).accessToken;
    }
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const validPark = {
    nameEn: 'Al-Azhar Park', nameAr: 'حديقة الأزهر', taglineEn: 'The green heart of Cairo', taglineAr: 'القلب الأخضر للقاهرة',
    descriptionEn: 'A park.', descriptionAr: 'حديقة.',
    stats: [{ value: '72', labelEn: 'Acres', labelAr: 'فدانًا' }],
  };
  const validContact = {
    addressEn: 'Salah Salem Street, Cairo', addressAr: 'شارع صلاح سالم، القاهرة', phones: ['(202) 2510 3868'], fax: null, email: 'info@alazharpark.com',
    mapsUrl: 'https://www.google.com/maps?cid=13021591783999119538', latitude: 30.0405, longitude: 31.2655, socialLinks: {},
  };
  const week = (over: Record<number, object> = {}) => ({
    days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, isClosed: false, opens: '09:00', closes: '22:00', ...(over[d] ?? {}) })),
  });
  const special = (over: object = {}) => ({
    kind: 'HOLIDAY', dateFrom: '2027-03-10', dateTo: '2027-03-12', isClosed: false, opens: '08:00', closes: '23:30',
    labelEn: 'Eid', labelAr: 'العيد', priority: 10, ...over,
  });

  // ───────────────────────── public site data ─────────────────────────
  describe('public site data', () => {
    it('needs no login and returns the seeded park, contact and hours with a short cache', async () => {
      const res = await call('get', '/public/site').expect(200);
      expect(res.headers['cache-control']).toMatch(/public, max-age=60/);
      const d = res.body.data;
      expect(d.park).toMatchObject({ nameEn: 'Al-Azhar Park', nameAr: 'حديقة الأزهر' });
      expect(d.park.stats).toHaveLength(4);
      expect(d.contact).toMatchObject({ phones: ['(202) 2510 3868', '(202) 2510 7338'], email: 'info@alazharpark.com' });
      expect(d.hours.weekly).toHaveLength(7);
      expect(d.hours.weekly.every((w: { opens: string; closes: string }) => w.opens === '09:00' && w.closes === '22:00')).toBe(true);
      expect(d.hours.today).toMatchObject({ date: today(), isClosed: false, opens: '09:00', closes: '22:00', special: null });
    });

    it('exposes only public fields (no ids, audit data or editor identity)', async () => {
      await call('put', '/special-hours/' + (await call('post', '/special-hours', 'content', special()).expect(201)).body.data.id, 'content', special()).expect(200);
      const text = JSON.stringify((await call('get', '/public/site').expect(200)).body);
      expect(text).not.toMatch(/updatedById|passwordHash|"id"|priority|isActive/);
    });

    it('shows today as closed, with the reason, during a temporary closure — and as special hours during a holiday', async () => {
      await call('post', '/special-hours', 'content', special({ kind: 'TEMPORARY_CLOSURE', dateFrom: today(), dateTo: today(), isClosed: true, opens: null, closes: null, labelEn: 'Maintenance day', labelAr: 'يوم صيانة', priority: 20 })).expect(201);
      let site = (await call('get', '/public/site').expect(200)).body.data;
      expect(site.hours.today).toMatchObject({ isClosed: true, opens: null, special: { kind: 'TEMPORARY_CLOSURE', labelEn: 'Maintenance day', labelAr: 'يوم صيانة' } });

      await call('post', '/special-hours', 'content', special({ dateFrom: today(), dateTo: today(), labelEn: 'Feast', labelAr: 'العيد', priority: 30, opens: '07:00', closes: '23:59' })).expect(201);
      site = (await call('get', '/public/site').expect(200)).body.data;
      expect(site.hours.today).toMatchObject({ isClosed: false, opens: '07:00', closes: '23:59', special: { labelEn: 'Feast' } }); // higher priority wins
    });

    it('lists upcoming active special hours only, soonest first', async () => {
      await call('post', '/special-hours', 'content', special({ dateFrom: '2027-06-01', dateTo: '2027-06-03', labelEn: 'Later', priority: 5 })).expect(201);
      await call('post', '/special-hours', 'content', special({ dateFrom: '2027-01-01', dateTo: '2027-01-02', labelEn: 'Sooner', priority: 6 })).expect(201);
      await call('post', '/special-hours', 'content', special({ dateFrom: '2027-02-01', dateTo: '2027-02-02', labelEn: 'Hidden', isActive: false, priority: 7 })).expect(201);
      await call('post', '/special-hours', 'content', special({ dateFrom: '2020-01-01', dateTo: '2020-01-02', labelEn: 'Ancient', priority: 8 })).expect(201);
      const labels = (await call('get', '/public/site').expect(200)).body.data.hours.special.map((s: { labelEn: string }) => s.labelEn);
      expect(labels).toEqual(['Sooner', 'Later']);
    });

    it('publishes periods however far ahead they start (there is no look-ahead limit)', async () => {
      await call('post', '/special-hours', 'content', special({ dateFrom: '2031-12-24', dateTo: '2031-12-26', labelEn: 'Five years away', priority: 5 })).expect(201);
      await call('post', '/special-hours', 'content', special({ dateFrom: '2040-01-01', dateTo: '2040-01-02', labelEn: 'Fourteen years away', priority: 6 })).expect(201);
      const labels = (await call('get', '/public/site').expect(200)).body.data.hours.special.map((s: { labelEn: string }) => s.labelEn);
      expect(labels).toEqual(['Five years away', 'Fourteen years away']);
    });

    it('reflects an edit straight away', async () => {
      await call('put', '/park', 'content', { ...validPark, taglineEn: 'A brand new tagline' }).expect(200);
      expect((await call('get', '/public/site').expect(200)).body.data.park.taglineEn).toBe('A brand new tagline');
    });
  });

  // ───────────────────────── who may do what ─────────────────────────
  describe('permissions', () => {
    it('lets a content manager read and edit all four areas', async () => {
      await call('get', '/park', 'content').expect(200);
      await call('put', '/park', 'content', validPark).expect(200);
      await call('get', '/contact', 'content').expect(200);
      await call('put', '/contact', 'content', validContact).expect(200);
      await call('get', '/opening-hours', 'content').expect(200);
      await call('put', '/opening-hours', 'content', week()).expect(200);
      await call('get', '/special-hours', 'content').expect(200);
    });

    it('lets operations change hours but not park information or contact details', async () => {
      await call('put', '/opening-hours', 'ops', week({ 5: { closes: '23:00' } })).expect(200);
      await call('put', '/park', 'ops', validPark).expect(403);
      await call('get', '/park', 'ops').expect(200); // park:read
    });

    it('keeps an analyst read-only and ticket staff out entirely', async () => {
      await call('get', '/park', 'analyst').expect(200);
      await call('put', '/park', 'analyst', validPark).expect(403);
      await call('get', '/contact', 'analyst').expect(403);
      await call('post', '/special-hours', 'analyst', special()).expect(403);
      for (const p of ['/park', '/contact', '/opening-hours', '/special-hours']) await call('get', p, 'staff').expect(403);
      await call('put', '/opening-hours', 'staff', week()).expect(403);
    });

    it('requires a login for every portal route', async () => {
      for (const p of ['/park', '/contact', '/opening-hours', '/special-hours']) await call('get', p).expect(401);
      await call('put', '/park', undefined, validPark).expect(401);
    });
  });

  // ───────────────────────── park information ─────────────────────────
  describe('park information', () => {
    it('stores English and Arabic content exactly, including Arabic digits and diacritics', async () => {
      const arabic = { ...validPark, taglineAr: 'القَلْبُ الأخضر للقاهرة التاريخية ٢٠٢٦', stats: [{ value: '٧٢', labelEn: 'Acres', labelAr: 'فدانًا من الحدائق' }] };
      const res = await call('put', '/park', 'content', arabic).expect(200);
      expect(res.body.data.taglineAr).toBe(arabic.taglineAr);
      const stored = await prisma.parkSettings.findUniqueOrThrow({ where: { id: 1 } });
      expect(stored.taglineAr).toBe(arabic.taglineAr);
      expect((stored.stats as Array<{ value: string }>)[0].value).toBe('٧٢');
    });

    it.each([
      ['a missing Arabic name', { nameAr: '' }],
      ['a missing English name', { nameEn: undefined }],
      ['more than 8 statistics', { stats: Array.from({ length: 9 }, () => ({ value: '1', labelEn: 'a', labelAr: 'ب' })) }],
      ['a statistic without an Arabic label', { stats: [{ value: '1', labelEn: 'a', labelAr: '' }] }],
      ['an over-long value', { stats: [{ value: 'x'.repeat(21), labelEn: 'a', labelAr: 'ب' }] }],
      ['control characters', { nameEn: 'Bad\u0000Name' }],
      ['an over-long description', { descriptionEn: 'x'.repeat(2001) }],
    ])('rejects %s and changes nothing', async (_label, override) => {
      const before = await prisma.parkSettings.findUniqueOrThrow({ where: { id: 1 } });
      const res = await call('put', '/park', 'content', { ...validPark, ...override }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect((await prisma.parkSettings.findUniqueOrThrow({ where: { id: 1 } })).updatedAt).toEqual(before.updatedAt);
      expect(await audit('park.updated')).toHaveLength(0);
    });

    it('writes an audit entry with who, the old and the new content', async () => {
      await call('put', '/park', 'content', { ...validPark, taglineEn: 'Changed' }).expect(200);
      const [entry] = await audit('park.updated');
      const actor = await prisma.user.findUniqueOrThrow({ where: { email: 'content@azharpark.test' } });
      expect(entry.userId).toBe(actor.id);
      expect((entry.oldValue as { taglineEn: string }).taglineEn).toBe('The green heart of historic Cairo');
      expect((entry.newValue as { taglineEn: string }).taglineEn).toBe('Changed');
      expect(entry.requestId).toBeTruthy();
      expect((await prisma.parkSettings.findUniqueOrThrow({ where: { id: 1 } })).updatedById).toBe(actor.id);
    });
  });

  // ───────────────────────── contact ─────────────────────────
  describe('contact details', () => {
    it('saves address, phones, e-mail, map link, coordinates and social links, and normalises empty values to null', async () => {
      const res = await call('put', '/contact', 'content', {
        ...validContact, fax: '', email: 'INFO@AlAzharPark.com', phones: ['0100 123 4567', '+20 2 2510 7338'],
        socialLinks: { facebook: 'https://www.facebook.com/alazharpark', instagram: 'https://instagram.com/alazharpark' },
      }).expect(200);
      expect(res.body.data).toMatchObject({ fax: null, email: 'info@alazharpark.com', latitude: 30.0405, longitude: 31.2655 });
      expect(res.body.data.socialLinks).toEqual({ facebook: 'https://www.facebook.com/alazharpark', instagram: 'https://instagram.com/alazharpark' });
    });

    it.each([
      ['a non-phone value', { phones: ['call me maybe'] }],
      ['a too-short phone', { phones: ['123'] }],
      ['the same phone twice', { phones: ['0100 123 4567', '01001234567'] }],
      ['more than 6 phones', { phones: Array.from({ length: 7 }, (_, i) => `0100123456${i}`) }],
      ['a bad e-mail', { email: 'not-an-email' }],
      ['an http (not https) map link', { mapsUrl: 'http://www.google.com/maps?cid=1' }],
      ['a map link on another site', { mapsUrl: 'https://evil.example/maps' }],
      ['a javascript: map link', { mapsUrl: 'javascript:alert(1)' }],
      ['a latitude without a longitude', { latitude: 30, longitude: null }],
      ['an impossible latitude', { latitude: 91, longitude: 31 }],
      ['an impossible longitude', { latitude: 30, longitude: 181 }],
      ['a non-https social link', { socialLinks: { facebook: 'http://facebook.com/x' } }],
      ['a missing Arabic address', { addressAr: '' }],
    ])('rejects %s', async (_label, override) => {
      await call('put', '/contact', 'content', { ...validContact, ...override }).expect(400);
      expect(await audit('contact.updated')).toHaveLength(0);
    });

    it('accepts a short Google Maps link and clears optional fields', async () => {
      await call('put', '/contact', 'content', { ...validContact, mapsUrl: 'https://maps.app.goo.gl/abc123', latitude: null, longitude: null, email: null }).expect(200);
      const stored = await prisma.contactInformation.findUniqueOrThrow({ where: { id: 1 } });
      expect(stored).toMatchObject({ mapsUrl: 'https://maps.app.goo.gl/abc123', latitude: null, longitude: null, email: null });
    });

    it('audits the change with old and new values', async () => {
      await call('put', '/contact', 'content', { ...validContact, phones: ['0100 123 4567'] }).expect(200);
      const [entry] = await audit('contact.updated');
      expect((entry.oldValue as { phones: string[] }).phones).toEqual(['(202) 2510 3868', '(202) 2510 7338']);
      expect((entry.newValue as { phones: string[] }).phones).toEqual(['0100 123 4567']);
    });
  });

  // ───────────────────────── weekly hours ─────────────────────────
  describe('weekly opening hours', () => {
    it('returns the seven seeded days', async () => {
      const res = await call('get', '/opening-hours', 'content').expect(200);
      expect(res.body.data.days).toHaveLength(7);
      expect(res.body.data.days[0]).toEqual({ dayOfWeek: 0, isClosed: false, opens: '09:00', closes: '22:00' });
    });

    it('changes one day (Friday) and closes another (Tuesday), leaving the rest alone', async () => {
      await call('put', '/opening-hours', 'content', week({ 5: { opens: '10:00', closes: '23:00' }, 2: { isClosed: true, opens: null, closes: null } })).expect(200);
      const days = (await call('get', '/opening-hours', 'content').expect(200)).body.data.days;
      expect(days[5]).toMatchObject({ opens: '10:00', closes: '23:00' });
      expect(days[2]).toMatchObject({ isClosed: true, opens: null, closes: null });
      expect(days[1]).toMatchObject({ opens: '09:00', closes: '22:00' });
      const [entry] = await audit('hours.weekly_updated');
      expect((entry.oldValue as Array<{ closes: string }>)[5].closes).toBe('22:00');
      expect((entry.newValue as Array<{ closes: string }>)[5].closes).toBe('23:00');
    });

    it.each([
      ['closing before opening', week({ 1: { opens: '18:00', closes: '09:00' } })],
      ['closing at the opening time', week({ 1: { opens: '09:00', closes: '09:00' } })],
      ['an open day without times', week({ 1: { opens: null, closes: null } })],
      ['a closed day that still has times', week({ 1: { isClosed: true } })],
      ['a time without leading zero', week({ 1: { opens: '9:00' } })],
      ['hour 24', week({ 1: { closes: '24:00' } })],
      ['minute 60', week({ 1: { closes: '22:60' } })],
      ['six days instead of seven', { days: week().days.slice(0, 6) }],
      ['a duplicated weekday', { days: week().days.map((d, i) => (i === 6 ? { ...d, dayOfWeek: 5 } : d)) }],
      ['weekday 7', week({ 6: { dayOfWeek: 7 } })],
    ])('rejects %s and changes nothing', async (_label, body) => {
      await call('put', '/opening-hours', 'content', body).expect(400);
      expect(await audit('hours.weekly_updated')).toHaveLength(0);
      expect((await call('get', '/opening-hours', 'content')).body.data.days.every((d: { closes: string }) => d.closes === '22:00')).toBe(true);
    });

    it('moves the same-day ticket cut-off: the sales rules read exactly these hours', async () => {
      const policy = { sameDayCutoffMinutesBeforeClose: 60, maxAdvanceDays: 90 };
      const sellable = async (date: string, time: string) => {
        const { days } = (await call('get', '/opening-hours', 'content').expect(200)).body.data;
        return evaluateSale({ now: cairoInstant(date, time), visitDate: date, weekly: days, special: [], policy });
      };
      const friday = '2026-10-09';
      expect(await sellable(friday, '20:59:59')).toMatchObject({ allowed: true });
      expect(await sellable(friday, '21:00:00')).toMatchObject({ allowed: false });

      await call('put', '/opening-hours', 'content', week({ 5: { closes: '23:30' } })).expect(200);
      expect(await sellable(friday, '22:29:59')).toMatchObject({ allowed: true });
      expect(await sellable(friday, '22:30:00')).toMatchObject({ allowed: false });
    });
  });

  // ───────────────────────── special hours ─────────────────────────
  describe('special hours and closures', () => {
    it('creates, lists, updates and deletes a holiday, auditing each step', async () => {
      const created = (await call('post', '/special-hours', 'content', special()).expect(201)).body.data;
      expect(created).toMatchObject({ kind: 'HOLIDAY', dateFrom: '2027-03-10', dateTo: '2027-03-12', opens: '08:00', closes: '23:30', labelAr: 'العيد' });

      const listed = (await call('get', '/special-hours?when=all', 'content').expect(200)).body.data;
      expect(listed.map((s: { id: string }) => s.id)).toContain(created.id);

      const updated = (await call('put', `/special-hours/${created.id}`, 'content', special({ closes: '23:00', labelEn: 'Eid al-Fitr' })).expect(200)).body.data;
      expect(updated).toMatchObject({ closes: '23:00', labelEn: 'Eid al-Fitr' });

      await call('delete', `/special-hours/${created.id}`, 'content').expect(200);
      expect((await call('get', '/special-hours?when=all', 'content')).body.data).toHaveLength(0);
      await call('delete', `/special-hours/${created.id}`, 'content').expect(404);

      expect((await audit('hours.special_created')).length).toBe(1);
      const [upd] = await audit('hours.special_updated');
      expect((upd.oldValue as { closes: string }).closes).toBe('23:30');
      expect((upd.newValue as { closes: string }).closes).toBe('23:00');
      const [del] = await audit('hours.special_deleted');
      expect((del.oldValue as { labelEn: string }).labelEn).toBe('Eid al-Fitr');
    });

    it('treats a temporary closure as closed whatever times were sent', async () => {
      const res = await call('post', '/special-hours', 'content', special({ kind: 'TEMPORARY_CLOSURE', isClosed: false, opens: '09:00', closes: '10:00' })).expect(201);
      expect(res.body.data).toMatchObject({ isClosed: true, opens: null, closes: null });
    });

    it('filters by upcoming / past / all', async () => {
      await call('post', '/special-hours', 'content', special({ dateFrom: '2020-05-01', dateTo: '2020-05-02', labelEn: 'Old', priority: 1 })).expect(201);
      await call('post', '/special-hours', 'content', special({ dateFrom: '2031-05-01', dateTo: '2031-05-02', labelEn: 'New', priority: 2 })).expect(201);
      const labels = async (when: string) => (await call('get', `/special-hours?when=${when}`, 'content')).body.data.map((s: { labelEn: string }) => s.labelEn);
      expect(await labels('upcoming')).toEqual(['New']);
      expect(await labels('past')).toEqual(['Old']);
      expect((await labels('all')).sort()).toEqual(['New', 'Old']);
      await call('get', '/special-hours?when=nonsense', 'content').expect(400);
    });

    it.each([
      ['an end before the start', { dateFrom: '2027-03-12', dateTo: '2027-03-10' }],
      ['a period over a year long', { dateFrom: '2027-01-01', dateTo: '2028-03-01' }],
      ['an impossible date', { dateFrom: '2027-02-30' }],
      ['a malformed date', { dateFrom: '10/03/2027' }],
      ['special hours without times', { opens: null, closes: null }],
      ['closing before opening', { opens: '20:00', closes: '08:00' }],
      ['an empty English label', { labelEn: '' }],
      ['an empty Arabic label', { labelAr: ' ' }],
      ['a priority above 100', { priority: 101 }],
      ['an unknown kind', { kind: 'PARTY' }],
    ])('rejects %s', async (_label, override) => {
      await call('post', '/special-hours', 'content', special(override)).expect(400);
      expect(await prisma.specialHours.count()).toBe(0);
    });

    it('refuses two active periods with the same priority on the same days — but allows other priorities, adjacent days and inactive entries', async () => {
      await call('post', '/special-hours', 'content', special({ dateFrom: '2027-03-10', dateTo: '2027-03-12' })).expect(201);
      const clash = await call('post', '/special-hours', 'content', special({ dateFrom: '2027-03-12', dateTo: '2027-03-14', labelEn: 'Clash' })).expect(409);
      expect(clash.body.error.code).toBe('SPECIAL_HOURS_OVERLAP');
      expect(clash.body.error.message).toMatch(/Eid/);

      await call('post', '/special-hours', 'content', special({ dateFrom: '2027-03-12', dateTo: '2027-03-14', priority: 20, labelEn: 'Higher priority' })).expect(201);
      await call('post', '/special-hours', 'content', special({ dateFrom: '2027-03-13', dateTo: '2027-03-14', labelEn: 'Next day' })).expect(201);
      await call('post', '/special-hours', 'content', special({ dateFrom: '2027-03-10', dateTo: '2027-03-12', isActive: false, labelEn: 'Draft' })).expect(201);
    });

    it('lets an entry be edited without clashing with itself, but not moved onto another one', async () => {
      const a = (await call('post', '/special-hours', 'content', special({ dateFrom: '2027-03-10', dateTo: '2027-03-12' })).expect(201)).body.data;
      const b = (await call('post', '/special-hours', 'content', special({ dateFrom: '2027-04-10', dateTo: '2027-04-12', labelEn: 'Bravo' })).expect(201)).body.data;
      await call('put', `/special-hours/${a.id}`, 'content', special({ dateFrom: '2027-03-11', dateTo: '2027-03-12' })).expect(200);
      await call('put', `/special-hours/${b.id}`, 'content', special({ dateFrom: '2027-03-11', dateTo: '2027-03-15', labelEn: 'Bravo' })).expect(409);
    });

    it('makes two simultaneous conflicting creations safe: exactly one succeeds', async () => {
      const results = await Promise.all(
        [1, 2, 3, 4].map((i) => call('post', '/special-hours', 'content', special({ dateFrom: '2027-07-01', dateTo: '2027-07-05', labelEn: `Race ${i}` }))),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
      expect(await prisma.specialHours.count()).toBe(1);
    });

    it('drives the ticket-sales rules: a closure day cannot be booked, and a later date still can', async () => {
      await call('post', '/special-hours', 'content', special({ kind: 'TEMPORARY_CLOSURE', dateFrom: '2026-10-20', dateTo: '2026-10-20', isClosed: true, opens: null, closes: null, labelEn: 'Closed', labelAr: 'مغلق' })).expect(201);
      const { weekly, special: sp } = await (async () => ({
        weekly: (await call('get', '/opening-hours', 'content')).body.data.days,
        special: (await call('get', '/special-hours?when=all', 'content')).body.data,
      }))();
      const policy = { sameDayCutoffMinutesBeforeClose: 60, maxAdvanceDays: 90 };
      const now = cairoInstant(addDays('2026-10-20', -3), '10:00');
      expect(evaluateSale({ now, visitDate: '2026-10-20', weekly, special: sp, policy })).toEqual({ allowed: false, reason: 'PARK_CLOSED' });
      expect(evaluateSale({ now, visitDate: '2026-10-21', weekly, special: sp, policy })).toMatchObject({ allowed: true });
    });
  });
});
