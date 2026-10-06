import { rmSync } from 'node:fs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { createTestApp } from '../helpers/app';
import { API, createUser, login, nextIp } from '../helpers/auth';
import { samples } from '../helpers/files';

describe('events and coming soon (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};

  type Method = 'get' | 'post' | 'put' | 'delete';
  const call = (method: Method, path: string, as?: string, body?: object) =>
    request(app.getHttpServer())[method](`${API}${path}`).set('X-Forwarded-For', nextIp()).set(as ? { Authorization: `Bearer ${tokens[as]}` } : {}).send(body);
  const audit = (action: string) => prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });
  const png = async (name = 'photo.png') =>
    (await request(app.getHttpServer()).post(`${API}/media`).set('X-Forwarded-For', nextIp()).set({ Authorization: `Bearer ${tokens.content}` }).attach('file', samples.png(800, 600), { filename: name, contentType: 'image/png' }).expect(201)).body.data;
  const pdf = async () =>
    (await request(app.getHttpServer()).post(`${API}/media`).set('X-Forwarded-For', nextIp()).set({ Authorization: `Bearer ${tokens.content}` }).attach('file', samples.pdf(), { filename: 'a.pdf', contentType: 'application/pdf' }).expect(201)).body.data;

  const valid = (over: Record<string, unknown> = {}) => ({
    slug: 'night-concert', titleEn: 'Night Concert', titleAr: 'حفل ليلي', shortDescriptionEn: 'An evening of live music on the lawn.', shortDescriptionAr: 'أمسية موسيقى حية على العشب.',
    descriptionEn: 'Live music under the Citadel skyline, with food stalls and seating.', descriptionAr: 'موسيقى حية تحت أفق القلعة، مع أكشاك طعام ومقاعد.',
    eventDate: '2027-05-14', startTime: '20:00', endTime: '23:00', ...over,
  });
  const create = async (over: Record<string, unknown> = {}) => (await call('post', '/events', 'content', valid(over)).expect(201)).body.data;
  const setStatus = (id: string, status: string, as = 'content') => call('put', `/events/${id}/status`, as, { status });
  const slugs = (list: Array<{ slug: string }>) => list.map((e) => e.slug);
  const publicSlugs = async (path: string) => slugs((await call('get', path).expect(200)).body.data);
  const venueIdOf = async (slug: string) => (await prisma.venue.findUniqueOrThrow({ where: { slug } })).id;

  beforeAll(async () => {
    prisma = createTestPrisma(5);
    app = await createTestApp({ TRUST_PROXY: '1' });
  });
  beforeEach(async () => {
    rmSync(process.env.MEDIA_DIR as string, { recursive: true, force: true });
    await resetDatabase(prisma);
    await seedAll(prisma);
    for (const [k, e] of [['content', 'content@azharpark.test'], ['ops', 'operations@azharpark.test'], ['staff', 'staff@azharpark.test'], ['analyst', 'analyst@azharpark.test'], ['admin', 'admin@azharpark.test']] as const) {
      tokens[k] = (await login(app, e)).accessToken;
    }
  });
  afterAll(async () => {
    rmSync(process.env.MEDIA_DIR as string, { recursive: true, force: true });
    await app.close();
    await prisma.$disconnect();
  });

  // ───────────────────────── permissions ─────────────────────────
  describe('permissions', () => {
    it('lets a content manager do everything; operations edits but cannot change status; analysts only read; ticket staff nothing', async () => {
      const id = (await create()).id;
      await call('get', '/events', 'content').expect(200);
      await setStatus(id, 'PUBLISHED').expect(200);

      // operations: events:read + events:write, but not events:publish
      await call('get', '/events', 'ops').expect(200);
      await call('put', `/events/${id}`, 'ops', valid({ titleEn: 'Edited by operations' })).expect(200);
      await call('post', '/events', 'ops', valid({ slug: 'ops-event' })).expect(201);
      await setStatus(id, 'ARCHIVED', 'ops').expect(403);

      for (const who of ['analyst']) {
        await call('get', '/events', who).expect(200);
        await call('get', `/events/${id}`, who).expect(200);
        await call('post', '/events', who, valid({ slug: 'x-event' })).expect(403);
        await call('put', `/events/${id}`, who, valid()).expect(403);
        await setStatus(id, 'ARCHIVED', who).expect(403);
        await call('put', '/events/order', who, { ids: [id] }).expect(403);
        await call('put', `/events/${id}/gallery`, who, { items: [] }).expect(403);
      }
      await call('get', '/events', 'staff').expect(403);
      await call('get', '/events').expect(401);
      await call('post', '/events', undefined, valid()).expect(401);
    });

    it('uses permissions, not role names: a custom role with only events:read can list but not change', async () => {
      const role = await prisma.role.create({ data: { code: 'EVENT_VIEWER', name: 'Event viewer' } });
      const perm = await prisma.permission.findUniqueOrThrow({ where: { code: 'events:read' } });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
      const user = await createUser(prisma, { role: 'EVENT_VIEWER' });
      tokens.viewer = (await login(app, user.email)).accessToken;
      await call('get', '/events', 'viewer').expect(200);
      await call('post', '/events', 'viewer', valid()).expect(403);
      await call('get', '/venues', 'viewer').expect(403);
    });

    it('venue management needs venues:write; reading venues needs venues:read', async () => {
      await call('get', '/venues', 'content').expect(200);
      await call('get', '/venues', 'ops').expect(200);
      await call('post', '/venues', 'ops', { slug: 'new-place', nameEn: 'New Place', nameAr: 'مكان جديد' }).expect(403);
      await call('post', '/venues', 'content', { slug: 'new-place', nameEn: 'New Place', nameAr: 'مكان جديد' }).expect(201);
      await call('get', '/venues', 'staff').expect(403);
    });
  });

  // ───────────────────────── create / read / update ─────────────────────────
  describe('creating and editing', () => {
    it('creates a DRAFT with bilingual content, a date, times and a venue; audits it', async () => {
      const venue = await venueIdOf('open-area');
      const e = await create({ venueId: venue });
      expect(e).toMatchObject({
        slug: 'night-concert', status: 'DRAFT', titleAr: 'حفل ليلي', eventDate: '2027-05-14', startTime: '20:00', endTime: '23:00', crossesMidnight: false,
        venue: { slug: 'open-area' }, hero: null, gallery: [], isFeatured: false, publishedAt: null,
      });
      const [entry] = await audit('event.created');
      expect(entry.newValue).toMatchObject({ slug: 'night-concert', status: 'DRAFT' });
      const actor = await prisma.user.findUniqueOrThrow({ where: { email: 'content@azharpark.test' } });
      expect(entry.userId).toBe(actor.id);
      expect(entry.requestId).toBeTruthy();
    });

    it('stores Arabic text exactly', async () => {
      const arabic = 'مَهرجانُ الفوانيسِ — ٢٠٢٧';
      const e = await create({ titleAr: arabic });
      expect((await call('get', `/events/${e.id}`, 'content')).body.data.titleAr).toBe(arabic);
    });

    it('puts a new event last in the display order', async () => {
      await create();
      const list = (await call('get', '/events', 'content').expect(200)).body.data;
      expect(slugs(list)).toEqual(['ramadan-nights-in-the-garden', 'cairo-jazz-nights', 'artisan-market-days', 'night-concert']);
    });

    it('rejects a duplicate address', async () => {
      await create();
      expect((await call('post', '/events', 'content', valid()).expect(409)).body.error.code).toBe('SLUG_TAKEN');
      expect((await call('post', '/events', 'content', valid({ slug: 'cairo-jazz-nights' })).expect(409)).body.error.code).toBe('SLUG_TAKEN');
    });

    it.each([
      ['an upper-case address (normalised)', { slug: 'Night-Concert' }, 'ok'],
      ['an address with spaces', { slug: 'night concert' }, 400],
      ['a double hyphen', { slug: 'night--concert' }, 400],
      ['a one-letter address', { slug: 'a' }, 400],
      ['a missing English title', { titleEn: '' }, 400],
      ['a missing Arabic title', { titleAr: '  ' }, 400],
      ['a too-short short description', { shortDescriptionEn: 'short' }, 400],
      ['a missing Arabic description', { descriptionAr: '' }, 400],
      ['control characters in the title', { titleEn: 'Bad\u0000Title' }, 400],
      ['a missing date', { eventDate: undefined }, 400],
      ['an impossible date', { eventDate: '2027-02-30' }, 400],
      ['a malformed date', { eventDate: '14/05/2027' }, 400],
      ['a start time without an end time', { startTime: '20:00', endTime: null }, 400],
      ['an end time without a start time', { startTime: null, endTime: '23:00' }, 400],
      ['a malformed time', { startTime: '8pm', endTime: '23:00' }, 400],
      ['equal start and end times', { startTime: '20:00', endTime: '20:00' }, 422],
      ['an event longer than 18 hours', { startTime: '06:00', endTime: '00:30' }, 422],
      ['a time that does not exist (clocks go forward)', { eventDate: '2027-04-23', startTime: '00:30', endTime: '02:00' }, 'check'],
      ['an unknown venue', { venueId: '00000000-0000-4000-8000-000000000000' }, 422],
      ['an unknown hero image', { heroMediaId: '00000000-0000-4000-8000-000000000000' }, 422],
      ['a malformed venue id', { venueId: 'nope' }, 400],
    ])('handles %s', async (_label, override, expected) => {
      const res = await call('post', '/events', 'content', valid(override));
      if (expected === 'ok') {
        expect(res.status).toBe(201);
        expect(res.body.data.slug).toBe('night-concert');
      } else if (expected === 'check') {
        // Egypt's clocks go forward on the last Friday of April; whether 00:30 exists that night is date-specific
        expect([201, 422]).toContain(res.status);
      } else {
        expect(res.status).toBe(expected);
        expect(await prisma.event.count({ where: { slug: 'night-concert' } })).toBe(0);
      }
    });

    it('refuses a time that does not exist because of daylight saving, with a clear message', async () => {
      const res = await call('post', '/events', 'content', valid({ eventDate: '2027-04-30', startTime: '00:30', endTime: '02:00' }));
      // 2027: Egypt moves clocks forward at 00:00 on the last Friday of April (30 Apr 2027): 00:00–00:59 does not exist
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_EVENT_TIMES');
      expect(res.body.error.message).toMatch(/does not exist/);
    });

    it('updates content (not status), keeps old and new values in the audit log', async () => {
      const e = await create();
      const res = await call('put', `/events/${e.id}`, 'content', valid({ titleEn: 'Renamed Concert', isFeatured: true })).expect(200);
      expect(res.body.data).toMatchObject({ titleEn: 'Renamed Concert', isFeatured: true, status: 'DRAFT' });
      const [entry] = await audit('event.updated');
      expect(entry.oldValue).toMatchObject({ titleEn: 'Night Concert' });
      expect(entry.newValue).toMatchObject({ titleEn: 'Renamed Concert', isFeatured: true });
    });

    it('ignores a status sent with the content: only the status endpoint changes it', async () => {
      const e = await create();
      await call('put', `/events/${e.id}`, 'content', { ...valid(), status: 'PUBLISHED' }).expect(200);
      expect((await call('get', `/events/${e.id}`, 'content')).body.data.status).toBe('DRAFT');
      await call('get', '/public/events/night-concert').expect(404);
    });

    it('answers 404 for unknown ids and 400 for malformed ones', async () => {
      await call('get', '/events/00000000-0000-4000-8000-000000000000', 'content').expect(404);
      await call('put', '/events/00000000-0000-4000-8000-000000000000', 'content', valid()).expect(404);
      await call('get', '/events/nope', 'content').expect(400);
    });
  });

  // ───────────────────────── date and time ─────────────────────────
  describe('date and time', () => {
    it('stores a normal evening and reads it back as Cairo wall-clock times', async () => {
      const e = await create({ eventDate: '2027-01-15', startTime: '18:00', endTime: '21:30' });
      expect(e).toMatchObject({ eventDate: '2027-01-15', startTime: '18:00', endTime: '21:30', crossesMidnight: false });
      expect(e.startsAt).toBe('2027-01-15T16:00:00.000Z'); // winter: Cairo is UTC+2
      expect(e.endsAt).toBe('2027-01-15T19:30:00.000Z');
    });

    it('supports an event that crosses midnight: 20:00 – 01:00 belongs to the day it starts', async () => {
      const e = await create({ eventDate: '2027-01-15', startTime: '20:00', endTime: '01:00' });
      expect(e).toMatchObject({ eventDate: '2027-01-15', startTime: '20:00', endTime: '01:00', crossesMidnight: true });
      expect(e.startsAt).toBe('2027-01-15T18:00:00.000Z');
      expect(e.endsAt).toBe('2027-01-15T23:00:00.000Z'); // 01:00 on the 16th in Cairo
      const row = await prisma.event.findUniqueOrThrow({ where: { id: e.id } });
      const [days] = await prisma.$queryRaw<Array<{ s: string; e: string }>>`SELECT azharpark_date_of(starts_at)::text AS s, azharpark_date_of(ends_at)::text AS e FROM events WHERE id = ${row.id}::uuid`;
      expect(days).toEqual({ s: '2027-01-15', e: '2027-01-16' });
    });

    it('is correct in summer time (UTC+3) and across the autumn clock change', async () => {
      const summer = await create({ slug: 'summer-night', eventDate: '2027-07-10', startTime: '21:00', endTime: '00:30' });
      expect(summer.startsAt).toBe('2027-07-10T18:00:00.000Z');
      expect(summer.crossesMidnight).toBe(true);
      // clocks go back at the end of Thursday 28 Oct 2027: the same wall-clock evening is an hour longer in real time
      const autumn = await create({ slug: 'autumn-night', eventDate: '2027-10-28', startTime: '20:00', endTime: '01:00' });
      expect((new Date(autumn.endsAt).getTime() - new Date(autumn.startsAt).getTime()) / 3_600_000).toBe(6);
    });

    it('accepts a date-only event (no times) and returns null times', async () => {
      const e = await create({ slug: 'all-day-market', startTime: null, endTime: null });
      expect(e).toMatchObject({ eventDate: '2027-05-14', startTime: null, endTime: null, crossesMidnight: false, endsAt: null });
    });

    it('keeps the date and times when other fields are edited', async () => {
      const e = await create({ startTime: '20:00', endTime: '01:00' });
      const res = await call('put', `/events/${e.id}`, 'content', valid({ startTime: '20:00', endTime: '01:00', titleEn: 'Same night, new title' })).expect(200);
      expect(res.body.data).toMatchObject({ eventDate: '2027-05-14', startTime: '20:00', endTime: '01:00', crossesMidnight: true });
    });

    it('lets the display wording override the computed date and time (multi-day events)', async () => {
      const e = await create({ dateLabelEn: '8 Feb – 9 Mar 2027', dateLabelAr: 'من ٨ فبراير إلى ٩ مارس ٢٠٢٧', timeLabelEn: 'Nightly, 8:00 PM – 1:00 AM', timeLabelAr: 'يوميًا', startTime: '20:00', endTime: '01:00' });
      await setStatus(e.id, 'PUBLISHED').expect(200);
      const pub = (await call('get', '/public/events/night-concert').expect(200)).body.data;
      expect(pub).toMatchObject({ dateLabelEn: '8 Feb – 9 Mar 2027', timeLabelAr: 'يوميًا', startTime: '20:00', crossesMidnight: true });
    });
  });

  // ───────────────────────── status lifecycle ─────────────────────────
  describe('status changes', () => {
    it('follows the allowed lifecycle and audits each step with an action named after it', async () => {
      const e = await create();
      const path: Array<[string, string]> = [
        ['COMING_SOON', 'event.coming_soon'], ['PUBLISHED', 'event.published'], ['COMING_SOON', 'event.coming_soon'], ['PUBLISHED', 'event.published'],
        ['CANCELLED', 'event.cancelled'], ['DRAFT', 'event.restored'], ['ARCHIVED', 'event.archived'], ['DRAFT', 'event.restored'], ['PUBLISHED', 'event.published'], ['DRAFT', 'event.unpublished'],
      ];
      for (const [status, action] of path) {
        const res = await setStatus(e.id, status).expect(200);
        expect(res.body.data.status).toBe(status);
        const entries = await audit(action);
        expect(entries.length).toBeGreaterThan(0);
        expect(entries[entries.length - 1].newValue).toEqual({ status });
      }
    });

    it.each([
      ['DRAFT', 'CANCELLED'], ['DRAFT', 'DRAFT'], ['ARCHIVED', 'PUBLISHED'], ['ARCHIVED', 'COMING_SOON'], ['ARCHIVED', 'CANCELLED'], ['CANCELLED', 'PUBLISHED'],
      ['CANCELLED', 'COMING_SOON'], ['PUBLISHED', 'PUBLISHED'],
    ])('refuses %s → %s', async (from, to) => {
      const e = await create({ slug: `from-${from.toLowerCase()}-to-${to.toLowerCase()}`.replace('_', '-') });
      await prisma.event.update({ where: { id: e.id }, data: { status: from as 'DRAFT' } });
      const res = await setStatus(e.id, to).expect(409);
      expect(res.body.error.code).toBe('INVALID_STATUS_CHANGE');
      expect((await prisma.event.findUniqueOrThrow({ where: { id: e.id } })).status).toBe(from);
    });

    it('rejects an unknown status and requires events:publish', async () => {
      const e = await create();
      await setStatus(e.id, 'LIVE').expect(400);
      await setStatus(e.id, 'PUBLISHED', 'ops').expect(403);
      await setStatus(e.id, 'PUBLISHED', 'analyst').expect(403);
      await call('put', `/events/${e.id}/status`, undefined, { status: 'PUBLISHED' }).expect(401);
      expect((await call('get', `/events/${e.id}`, 'content')).body.data.status).toBe('DRAFT');
    });

    it('records when an event first went public, and keeps that moment', async () => {
      const e = await create();
      expect(e.publishedAt).toBeNull();
      const first = (await setStatus(e.id, 'COMING_SOON').expect(200)).body.data.publishedAt;
      expect(first).not.toBeNull();
      await setStatus(e.id, 'PUBLISHED').expect(200);
      expect((await call('get', `/events/${e.id}`, 'content')).body.data.publishedAt).toBe(first);
    });

    it('locks the address once an event has been public (links to it would break), but not before', async () => {
      const e = await create();
      await call('put', `/events/${e.id}`, 'content', valid({ slug: 'renamed-before-publishing' })).expect(200);
      await setStatus(e.id, 'PUBLISHED').expect(200);
      const res = await call('put', `/events/${e.id}`, 'content', valid({ slug: 'renamed-after-publishing' })).expect(409);
      expect(res.body.error.code).toBe('SLUG_LOCKED');
      await call('put', `/events/${e.id}`, 'content', valid({ slug: 'renamed-before-publishing', titleEn: 'Still editable' })).expect(200); // same address: fine
    });
  });

  // ───────────────────────── public visibility ─────────────────────────
  describe('public visibility (enforced by the API)', () => {
    it('shows each status exactly where it belongs: DRAFT nowhere, COMING_SOON in coming soon, PUBLISHED in the listing, CANCELLED and ARCHIVED nowhere', async () => {
      const mk = async (slug: string, status: string) => {
        const e = await create({ slug });
        if (status !== 'DRAFT') {
          await prisma.event.update({ where: { id: e.id }, data: { status: status as 'DRAFT' } });
        }
        return e;
      };
      await prisma.event.deleteMany(); // start from nothing but these five
      await mk('ev-draft', 'DRAFT');
      await mk('ev-soon', 'COMING_SOON');
      await mk('ev-published', 'PUBLISHED');
      await mk('ev-cancelled', 'CANCELLED');
      await mk('ev-archived', 'ARCHIVED');

      expect(await publicSlugs('/public/events')).toEqual(['ev-published']);
      expect(await publicSlugs('/public/events/coming-soon')).toEqual(['ev-soon']);

      await call('get', '/public/events/ev-published').expect(200);
      await call('get', '/public/events/ev-soon').expect(200);
      for (const hidden of ['ev-draft', 'ev-cancelled', 'ev-archived']) await call('get', `/public/events/${hidden}`).expect(404);

      // the portal still sees everything
      expect(slugs((await call('get', '/events', 'content')).body.data).sort()).toEqual(['ev-archived', 'ev-cancelled', 'ev-draft', 'ev-published', 'ev-soon']);
    });

    it('hides an event the moment it is cancelled or archived and brings it back as a draft, then public again only when republished', async () => {
      const e = await create();
      await setStatus(e.id, 'PUBLISHED').expect(200);
      expect(await publicSlugs('/public/events')).toContain('night-concert');
      await setStatus(e.id, 'CANCELLED').expect(200);
      expect(await publicSlugs('/public/events')).not.toContain('night-concert');
      await call('get', '/public/events/night-concert').expect(404);
      await setStatus(e.id, 'DRAFT').expect(200);
      await call('get', '/public/events/night-concert').expect(404);
      await setStatus(e.id, 'COMING_SOON').expect(200);
      expect(await publicSlugs('/public/events/coming-soon')).toContain('night-concert');
      expect(await publicSlugs('/public/events')).not.toContain('night-concert');
    });

    it('serves the seeded events by status: Ramadan and the market coming soon, jazz published', async () => {
      expect(await publicSlugs('/public/events/coming-soon')).toEqual(['ramadan-nights-in-the-garden', 'artisan-market-days']);
      expect(await publicSlugs('/public/events?when=all')).toEqual(['cairo-jazz-nights']);
    });

    it('exposes no internal fields: ids, status history, audit, editors', async () => {
      const e = await create();
      await setStatus(e.id, 'PUBLISHED').expect(200);
      const text = JSON.stringify((await call('get', '/public/events/night-concert').expect(200)).body);
      expect(text).not.toMatch(/"id"|createdAt|updatedAt|publishedAt|createdById|sortOrder|deletedAt|passwordHash|email/);
      const list = JSON.stringify((await call('get', '/public/events').expect(200)).body);
      expect(list).not.toMatch(/"id"|createdAt|updatedAt|publishedAt|createdById|sortOrder|deletedAt/);
    });

    it('lists only upcoming published events by default; past ones with ?when=past or all', async () => {
      const past = await create({ slug: 'old-concert', eventDate: '2020-05-14' });
      const future = await create({ slug: 'new-concert', eventDate: '2031-05-14' });
      for (const e of [past, future]) await setStatus(e.id, 'PUBLISHED').expect(200);
      expect(await publicSlugs('/public/events')).toEqual(expect.arrayContaining(['new-concert']));
      expect(await publicSlugs('/public/events')).not.toContain('old-concert');
      expect(await publicSlugs('/public/events?when=past')).toEqual(['old-concert']);
      expect(await publicSlugs('/public/events?when=all')).toEqual(expect.arrayContaining(['old-concert', 'new-concert']));
      await call('get', '/public/events/old-concert').expect(200); // its own page still works
      await call('get', '/public/events?when=nonsense').expect(400);
    });

    it('treats an event that crosses midnight as still running until it ends', async () => {
      // today in Cairo at 22:00 → tomorrow 03:00 is not finished even after midnight has passed
      const e = await create({ slug: 'running-now', eventDate: '2031-01-01', startTime: '22:00', endTime: '03:00' });
      await setStatus(e.id, 'PUBLISHED').expect(200);
      expect(await publicSlugs('/public/events')).toContain('running-now');
    });

    it('sends public lists with a short cache and needs no login', async () => {
      const res = await call('get', '/public/events/coming-soon').expect(200);
      expect(res.headers['cache-control']).toMatch(/public, max-age=60/);
    });

    it('returns Arabic and English fields for the website to choose from, and the venue', async () => {
      const e = await create({ venueId: await venueIdOf('open-area'), locationNameEn: 'Ignored text' });
      await setStatus(e.id, 'PUBLISHED').expect(200);
      const pub = (await call('get', '/public/events/night-concert').expect(200)).body.data;
      expect(pub).toMatchObject({ titleEn: 'Night Concert', titleAr: 'حفل ليلي', descriptionAr: expect.stringContaining('موسيقى'), venue: { slug: 'open-area', nameEn: 'Open Area', nameAr: 'المساحة المفتوحة' } });
    });
  });

  // ───────────────────────── ordering ─────────────────────────
  describe('ordering', () => {
    it('reorders every event exactly once; the public lists follow', async () => {
      const list = (await call('get', '/events', 'content')).body.data as Array<{ id: string; slug: string }>;
      const reversed = [...list].reverse().map((x) => x.id);
      const res = await call('put', '/events/order', 'content', { ids: reversed }).expect(200);
      expect(slugs(res.body.data)).toEqual(['artisan-market-days', 'cairo-jazz-nights', 'ramadan-nights-in-the-garden']);
      expect(await publicSlugs('/public/events/coming-soon')).toEqual(['artisan-market-days', 'ramadan-nights-in-the-garden']);
      expect((await call('put', '/events/order', 'content', { ids: reversed.slice(1) }).expect(422)).body.error.code).toBe('ORDER_MISMATCH');
      await call('put', '/events/order', 'content', { ids: [reversed[0], reversed[0], reversed[1]] }).expect(400);
      await call('put', '/events/order', 'ops', { ids: reversed }).expect(200); // operations may edit
      await call('put', '/events/order', 'analyst', { ids: reversed }).expect(403);
      expect((await audit('event.reordered')).length).toBe(2);
    });

    it('breaks ties by date, then creation, so the order is deterministic', async () => {
      await prisma.event.updateMany({ data: { sortOrder: 0 } });
      const a = await create({ slug: 'tie-b', eventDate: '2027-06-02' });
      const b = await create({ slug: 'tie-a', eventDate: '2027-06-01' });
      await prisma.event.updateMany({ where: { id: { in: [a.id, b.id] } }, data: { sortOrder: 0 } });
      const first = slugs((await call('get', '/events', 'content')).body.data);
      const second = slugs((await call('get', '/events', 'content')).body.data);
      expect(first).toEqual(second);
      expect(first.indexOf('tie-a')).toBeLessThan(first.indexOf('tie-b')); // same sortOrder: the earlier date first
    });
  });

  // ───────────────────────── list filters ─────────────────────────
  describe('portal list', () => {
    it('filters by status and searches English titles, Arabic titles and addresses; pages the results', async () => {
      const all = (await call('get', '/events', 'content').expect(200)).body;
      expect(all.meta).toMatchObject({ total: 3, page: 1 });
      expect(slugs((await call('get', '/events?status=PUBLISHED', 'content')).body.data)).toEqual(['cairo-jazz-nights']);
      expect(slugs((await call('get', '/events?status=COMING_SOON', 'content')).body.data)).toHaveLength(2);
      expect((await call('get', '/events?status=DRAFT', 'content')).body.data).toEqual([]);
      expect(slugs((await call('get', '/events?search=JAZZ', 'content')).body.data)).toEqual(['cairo-jazz-nights']);
      expect(slugs((await call('get', `/events?search=${encodeURIComponent('رمضان')}`, 'content')).body.data)).toEqual(['ramadan-nights-in-the-garden']);
      expect(slugs((await call('get', '/events?search=market-days', 'content')).body.data)).toEqual(['artisan-market-days']);
      expect((await call('get', '/events?limit=2&page=2', 'content')).body.data).toHaveLength(1);
      await call('get', '/events?status=NOPE', 'content').expect(400);
    });
  });

  // ───────────────────────── venues ─────────────────────────
  describe('venues', () => {
    it('lists the seeded venues in order with how many events use each', async () => {
      const list = (await call('get', '/venues', 'content').expect(200)).body.data;
      expect(list.map((v: { slug: string }) => v.slug)).toEqual(['sunken-garden', 'open-area', 'lake-side-restaurant']);
      expect(list.find((v: { slug: string }) => v.slug === 'open-area')).toMatchObject({ eventCount: 1, isActive: true });
    });

    it('creates, edits and audits venues; the address is fixed after creation', async () => {
      const v = (await call('post', '/venues', 'content', { slug: 'rose-garden', nameEn: 'Rose Garden', nameAr: 'حديقة الورد', addressEn: 'North terrace', capacity: 120 }).expect(201)).body.data;
      expect(v).toMatchObject({ slug: 'rose-garden', isActive: true, capacity: 120, eventCount: 0 });
      const up = await call('put', `/venues/${v.id}`, 'content', { slug: 'hacked', nameEn: 'Rose Garden Terrace', nameAr: 'حديقة الورد', isActive: true }).expect(200);
      expect(up.body.data).toMatchObject({ slug: 'rose-garden', nameEn: 'Rose Garden Terrace' });
      expect((await audit('venue.created')).length).toBe(1);
      expect((await audit('venue.updated'))[0].oldValue).toMatchObject({ nameEn: 'Rose Garden' });
      expect((await call('post', '/venues', 'content', { slug: 'rose-garden', nameEn: 'Dup', nameAr: 'مكرر' }).expect(409)).body.error.code).toBe('SLUG_TAKEN');
      await call('post', '/venues', 'content', { slug: 'Bad Slug', nameEn: 'Bad', nameAr: 'سيئ' }).expect(400);
      await call('post', '/venues', 'content', { slug: 'no-name', nameEn: '', nameAr: 'x' }).expect(400);
    });

    it('switches a venue off: new events cannot use it, existing events keep it', async () => {
      const open = await venueIdOf('open-area');
      const jazz = await prisma.event.findUniqueOrThrow({ where: { slug: 'cairo-jazz-nights' } });
      const off = await call('put', `/venues/${open}`, 'content', { nameEn: 'Open Area', nameAr: 'المساحة المفتوحة', isActive: false }).expect(200);
      expect(off.body.data.isActive).toBe(false);
      expect((await audit('venue.deactivated')).length).toBe(1);

      expect((await call('post', '/events', 'content', valid({ venueId: open })).expect(422)).body.error.code).toBe('VENUE_INACTIVE');
      // the event that already used it can be edited and keeps it
      const keep = await call('put', `/events/${jazz.id}`, 'content', valid({ slug: 'cairo-jazz-nights', venueId: open, titleEn: 'Cairo Jazz Nights!' })).expect(200);
      expect(keep.body.data.venue).toMatchObject({ slug: 'open-area', isActive: false });
      await call('put', `/venues/${open}`, 'content', { nameEn: 'Open Area', nameAr: 'المساحة المفتوحة', isActive: true }).expect(200);
      expect((await audit('venue.activated')).length).toBe(1);
      await call('post', '/events', 'content', valid({ venueId: open })).expect(201);
    });

    it('refuses to delete a venue that events use, and deletes an unused one', async () => {
      const open = await venueIdOf('open-area');
      const res = await call('delete', `/venues/${open}`, 'content').expect(409);
      expect(res.body.error.code).toBe('VENUE_IN_USE');
      expect(res.body.error.message).toMatch(/1 event/);
      const free = (await call('post', '/venues', 'content', { slug: 'temp-place', nameEn: 'Temp', nameAr: 'مؤقت' }).expect(201)).body.data;
      await call('delete', `/venues/${free.id}`, 'content').expect(200);
      await call('get', `/venues/${free.id}`, 'content').expect(404);
      expect((await call('get', '/venues', 'content')).body.data.map((v: { id: string }) => v.id)).not.toContain(free.id);
      expect((await audit('venue.deleted')).length).toBe(1);
    });

    it('moves an event to another venue (audited), removes its venue, and then the old venue can be deleted', async () => {
      const a = await venueIdOf('sunken-garden');
      const b = await venueIdOf('lake-side-restaurant');
      const e = await create({ venueId: a });
      await call('delete', `/venues/${a}`, 'content').expect(409);
      await call('put', `/events/${e.id}`, 'content', valid({ venueId: b })).expect(200);
      const [change] = await audit('event.venue_changed');
      expect(change.oldValue).toEqual({ venueId: a });
      expect(change.newValue).toEqual({ venueId: b });
      await call('delete', `/venues/${a}`, 'content').expect(200);
      await call('put', `/events/${e.id}`, 'content', valid({ venueId: null })).expect(200);
      expect((await call('get', `/events/${e.id}`, 'content')).body.data.venue).toBeNull();
    });

    it('reorders venues', async () => {
      const list = (await call('get', '/venues', 'content')).body.data as Array<{ id: string; slug: string }>;
      const res = await call('put', '/venues/order', 'content', { ids: [...list].reverse().map((v) => v.id) }).expect(200);
      expect(res.body.data.map((v: { slug: string }) => v.slug)).toEqual(['lake-side-restaurant', 'open-area', 'sunken-garden']);
      expect((await call('put', '/venues/order', 'content', { ids: [list[0].id] }).expect(422)).body.error.code).toBe('ORDER_MISMATCH');
      expect((await audit('venue.reordered')).length).toBe(1);
    });
  });

  // ───────────────────────── media ─────────────────────────
  describe('photos', () => {
    it('sets a hero image (an existing photo only) and audits the change', async () => {
      const e = await create();
      const photo = await png('hero.png');
      const res = await call('put', `/events/${e.id}`, 'content', valid({ heroMediaId: photo.id })).expect(200);
      expect(res.body.data.hero).toMatchObject({ id: photo.id, kind: 'image' });
      const [change] = await audit('event.hero_changed');
      expect(change.newValue).toEqual({ heroMediaId: photo.id });
      const doc = await pdf();
      expect((await call('put', `/events/${e.id}`, 'content', valid({ heroMediaId: doc.id })).expect(422)).body.error.code).toBe('MEDIA_NOT_IMAGE');
      await call('put', `/events/${e.id}`, 'content', valid({ heroMediaId: '00000000-0000-4000-8000-000000000000' })).expect(422);
      await call('put', `/events/${e.id}`, 'content', valid({ heroMediaId: null })).expect(200);
      expect((await audit('event.hero_changed')).length).toBe(2);
    });

    it('manages an ordered gallery with bilingual captions; replacing it replaces everything', async () => {
      const e = await create();
      const [a, b, c] = [await png('a.png'), await png('b.png'), await png('c.png')];
      const set = await call('put', `/events/${e.id}/gallery`, 'content', { items: [{ mediaId: b.id, captionEn: 'Stage', captionAr: 'المسرح' }, { mediaId: a.id }, { mediaId: c.id, captionEn: '' }] }).expect(200);
      expect(set.body.data.gallery.map((g: { media: { id: string } }) => g.media.id)).toEqual([b.id, a.id, c.id]);
      expect(set.body.data.gallery[0]).toMatchObject({ captionEn: 'Stage', captionAr: 'المسرح' });
      expect(set.body.data.gallery[2].captionEn).toBeNull();
      expect((await call('put', `/events/${e.id}/gallery`, 'content', { items: [{ mediaId: c.id }] }).expect(200)).body.data.gallery).toHaveLength(1);
      expect((await call('put', `/events/${e.id}/gallery`, 'content', { items: [] }).expect(200)).body.data.gallery).toEqual([]);
      expect((await audit('event.gallery_updated')).length).toBe(3);
    });

    it('rejects a PDF, a duplicate, too many photos and unknown media in the gallery', async () => {
      const e = await create();
      const a = await png();
      const doc = await pdf();
      await call('put', `/events/${e.id}/gallery`, 'content', { items: [{ mediaId: doc.id }] }).expect(422);
      await call('put', `/events/${e.id}/gallery`, 'content', { items: [{ mediaId: a.id }, { mediaId: a.id }] }).expect(400);
      await call('put', `/events/${e.id}/gallery`, 'content', { items: Array.from({ length: 31 }, () => ({ mediaId: a.id })) }).expect(400);
      await call('put', `/events/${e.id}/gallery`, 'content', { items: [{ mediaId: '00000000-0000-4000-8000-000000000000' }] }).expect(422);
    });

    it('protects photos in use through the existing media rules, and names the event', async () => {
      const e = await create();
      const hero = await png('hero.png');
      const shot = await png('shot.png');
      await call('put', `/events/${e.id}`, 'content', valid({ heroMediaId: hero.id })).expect(200);
      await call('put', `/events/${e.id}/gallery`, 'content', { items: [{ mediaId: shot.id }] }).expect(200);
      expect((await call('delete', `/media/${hero.id}`, 'content').expect(409)).body.error.message).toMatch(/main photo of event Night Concert/);
      expect((await call('delete', `/media/${shot.id}`, 'content').expect(409)).body.error.code).toBe('MEDIA_IN_USE');
      await call('put', `/events/${e.id}`, 'content', valid({ heroMediaId: null })).expect(200);
      await call('put', `/events/${e.id}/gallery`, 'content', { items: [] }).expect(200);
      await call('delete', `/media/${hero.id}`, 'content').expect(200);
      await call('delete', `/media/${shot.id}`, 'content').expect(200);
    });

    it('shows hero and gallery URLs to the public, and the files actually load', async () => {
      const e = await create();
      const hero = await png('hero.png');
      const shot = await png('shot.png');
      await call('put', `/events/${e.id}`, 'content', valid({ heroMediaId: hero.id })).expect(200);
      await call('put', `/events/${e.id}/gallery`, 'content', { items: [{ mediaId: shot.id, captionEn: 'Backstage', captionAr: 'الكواليس' }] }).expect(200);
      await setStatus(e.id, 'PUBLISHED').expect(200);
      const pub = (await call('get', '/public/events/night-concert').expect(200)).body.data;
      expect(pub.hero.url).toMatch(/^\/api\/v1\/media\/file\/.+\.png$/);
      expect(pub.gallery[0]).toMatchObject({ captionEn: 'Backstage', captionAr: 'الكواليس', width: 800, height: 600 });
      await request(app.getHttpServer()).get(pub.hero.url).expect(200);
    });
  });
});
