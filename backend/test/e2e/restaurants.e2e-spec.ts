import { rmSync } from 'node:fs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { createTestApp } from '../helpers/app';
import { API, login, nextIp } from '../helpers/auth';
import { samples } from '../helpers/files';

describe('restaurants, menus and photos (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};

  type Method = 'get' | 'post' | 'put' | 'delete';
  const call = (method: Method, path: string, as?: string, body?: object) =>
    request(app.getHttpServer())[method](`${API}${path}`).set('X-Forwarded-For', nextIp()).set(as ? { Authorization: `Bearer ${tokens[as]}` } : {}).send(body);
  const audit = (action: string) => prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });
  const upload = async (file: Buffer, name: string, type: string) =>
    (await request(app.getHttpServer()).post(`${API}/media`).set('X-Forwarded-For', nextIp()).set({ Authorization: `Bearer ${tokens.content}` }).attach('file', file, { filename: name, contentType: type }).expect(201)).body.data;
  const png = (name = 'photo.png') => upload(samples.png(800, 600), name, 'image/png');
  const pdf = (name = 'menu.pdf') => upload(samples.pdf(), name, 'application/pdf');

  const valid = (over: Record<string, unknown> = {}) => ({
    slug: 'rooftop', nameEn: 'Rooftop Grill', nameAr: 'شواء الأسطح', taglineEn: 'Grills above the city', taglineAr: 'مشويات فوق المدينة',
    descriptionEn: 'Charcoal grills with a view of the Citadel.', descriptionAr: 'مشويات على الفحم مع إطلالة على القلعة.',
    opensAt: '12:00', closesAt: '23:00', phones: ['0100 123 4567'], isActive: true, ...over,
  });
  const create = async (over: Record<string, unknown> = {}) => (await call('post', '/restaurants', 'content', valid(over)).expect(201)).body.data;
  const slugs = (list: Array<{ slug: string }>) => list.map((r) => r.slug);

  beforeAll(async () => {
    prisma = createTestPrisma(5);
    app = await createTestApp({ TRUST_PROXY: '1' });
  });
  beforeEach(async () => {
    rmSync(process.env.MEDIA_DIR as string, { recursive: true, force: true });
    await resetDatabase(prisma);
    await seedAll(prisma);
    for (const [k, e] of [['content', 'content@azharpark.test'], ['ops', 'operations@azharpark.test'], ['staff', 'staff@azharpark.test'], ['analyst', 'analyst@azharpark.test']] as const) {
      tokens[k] = (await login(app, e)).accessToken;
    }
  });
  afterAll(async () => {
    rmSync(process.env.MEDIA_DIR as string, { recursive: true, force: true });
    await app.close();
    await prisma.$disconnect();
  });

  describe('permissions', () => {
    it('lets a content manager read and write; operations and analysts only read; ticket staff nothing', async () => {
      const id = (await create()).id;
      await call('get', '/restaurants', 'content').expect(200);
      await call('put', `/restaurants/${id}`, 'content', { ...valid(), nameEn: 'Rooftop Grill 2' }).expect(200);

      for (const who of ['ops', 'analyst']) {
        await call('get', '/restaurants', who).expect(200);
        await call('get', `/restaurants/${id}`, who).expect(200);
        await call('post', '/restaurants', who, valid({ slug: 'other' })).expect(403);
        await call('put', `/restaurants/${id}`, who, valid()).expect(403);
        await call('delete', `/restaurants/${id}`, who).expect(403);
        await call('post', `/restaurants/${id}/menus`, who, { nameEn: 'Menu', nameAr: 'قائمة', externalUrl: 'https://example.com/m.pdf' }).expect(403);
      }
      await call('get', '/restaurants', 'staff').expect(403);
      await call('get', '/restaurants').expect(401);
    });
  });

  describe('creating and editing', () => {
    it('creates a restaurant with bilingual content and hours; closing at midnight is flagged as after midnight', async () => {
      const r = await create({ opensAt: '12:00', closesAt: '00:00' });
      expect(r).toMatchObject({ slug: 'rooftop', nameAr: 'شواء الأسطح', opensAt: '12:00', closesAt: '00:00', closesAfterMidnight: true, isActive: true, hero: null, gallery: [], menus: [] });
      const late = await create({ slug: 'night-owl', opensAt: '18:00', closesAt: '01:00' });
      expect(late.closesAfterMidnight).toBe(true);
      expect((await create({ slug: 'lunch-only', opensAt: '11:00', closesAt: '16:00' })).closesAfterMidnight).toBe(false);
      expect((await create({ slug: 'no-hours', opensAt: null, closesAt: null })).closesAfterMidnight).toBe(false);
      const [entry] = await audit('restaurant.created');
      expect(entry.newValue).toMatchObject({ slug: 'rooftop' });
    });

    it('puts a new restaurant last in the display order', async () => {
      await create();
      const list = (await call('get', '/restaurants', 'content').expect(200)).body.data;
      expect(slugs(list)).toEqual(['hilltop', 'lakeside', 'masrawya', 'rooftop']);
    });

    it('rejects a duplicate address, including one used by a deleted restaurant', async () => {
      const r = await create();
      expect((await call('post', '/restaurants', 'content', valid()).expect(409)).body.error.code).toBe('SLUG_TAKEN');
      await call('delete', `/restaurants/${r.id}`, 'content').expect(200);
      await call('post', '/restaurants', 'content', valid()).expect(409);
    });

    it.each([
      ['an upper-case address', { slug: 'Rooftop' }, 'normalised'],
      ['an address with spaces', { slug: 'roof top' }, 400],
      ['an address with a double hyphen', { slug: 'roof--top' }, 400],
      ['an address that is too short', { slug: 'a' }, 400],
      ['a missing English name', { nameEn: '' }, 400],
      ['a missing Arabic name', { nameAr: '  ' }, 400],
      ['a too-short description', { descriptionEn: 'short' }, 400],
      ['control characters', { nameEn: 'Bad\u0000Name' }, 400],
      ['opening time without closing time', { opensAt: '12:00', closesAt: null }, 400],
      ['a malformed time', { opensAt: '9:00', closesAt: '22:00' }, 400],
      ['a non-phone', { phones: ['call me'] }, 400],
      ['a duplicated phone', { phones: ['0100 123 4567', '01001234567'] }, 400],
      ['more than 6 phones', { phones: Array.from({ length: 7 }, (_, i) => `0100123456${i}`) }, 400],
      ['an http reservation link', { reservationUrl: 'http://example.com' }, 400],
      ['a javascript: website link', { websiteUrl: 'javascript:alert(1)' }, 400],
      ['a bad Instagram link', { instagramUrl: 'not a url' }, 400],
    ])('handles %s', async (_label, override, expected) => {
      const res = await call('post', '/restaurants', 'content', valid(override));
      if (expected === 'normalised') {
        expect(res.status).toBe(201);
        expect(res.body.data.slug).toBe('rooftop'); // lower-cased
      } else {
        expect(res.status).toBe(expected);
        expect(await prisma.restaurant.count({ where: { slug: 'rooftop' } })).toBe(0);
      }
    });

    it('updates content but never the address; stores empty optional fields as null; audits old and new', async () => {
      const r = await create({ slug: 'to-edit' });
      const res = await call('put', `/restaurants/${r.id}`, 'content', { ...valid(), slug: 'hacked', nameEn: 'Renamed', taglineEn: '', phones: [], websiteUrl: 'https://rooftop.example' }).expect(200);
      expect(res.body.data).toMatchObject({ slug: 'to-edit', nameEn: 'Renamed', taglineEn: null, phones: [], websiteUrl: 'https://rooftop.example' });
      const [entry] = await audit('restaurant.updated');
      expect(entry.oldValue).toMatchObject({ nameEn: 'Rooftop Grill' });
      expect(entry.newValue).toMatchObject({ nameEn: 'Renamed' });
      const actor = await prisma.user.findUniqueOrThrow({ where: { email: 'content@azharpark.test' } });
      expect(entry.userId).toBe(actor.id);
    });

    it('stores Arabic text exactly', async () => {
      const arabic = 'مَطْعَمُ القِمَّةِ — تجربة طعام بطراز فاطمي ٢٠٢٦';
      const r = await create({ slug: 'arabic', nameAr: arabic });
      expect((await call('get', `/restaurants/${r.id}`, 'content')).body.data.nameAr).toBe(arabic);
    });

    it('answers 404 for unknown ids and 400 for malformed ones', async () => {
      await call('get', '/restaurants/00000000-0000-4000-8000-000000000000', 'content').expect(404);
      await call('put', '/restaurants/00000000-0000-4000-8000-000000000000', 'content', valid()).expect(404);
      await call('get', '/restaurants/nope', 'content').expect(400);
    });
  });

  describe('visibility and order', () => {
    it('hides an inactive restaurant from the website but keeps it in the portal', async () => {
      const r = await create();
      expect(slugs((await call('get', '/public/restaurants').expect(200)).body.data)).toContain('rooftop');
      await call('put', `/restaurants/${r.id}`, 'content', valid({ isActive: false })).expect(200);
      expect(slugs((await call('get', '/public/restaurants').expect(200)).body.data)).not.toContain('rooftop');
      await call('get', '/public/restaurants/rooftop').expect(404);
      expect(slugs((await call('get', '/restaurants', 'content')).body.data)).toContain('rooftop');
    });

    it('deleting removes it from the website and the portal list, keeps the record, and hides its menus', async () => {
      const r = await create();
      await call('post', `/restaurants/${r.id}/menus`, 'content', { nameEn: 'Dinner', nameAr: 'العشاء', externalUrl: 'https://example.com/dinner.pdf' }).expect(201);
      await call('delete', `/restaurants/${r.id}`, 'content').expect(200);
      expect(slugs((await call('get', '/restaurants', 'content')).body.data)).not.toContain('rooftop');
      await call('get', '/public/restaurants/rooftop').expect(404);
      await call('get', `/restaurants/${r.id}`, 'content').expect(404);
      const row = await prisma.restaurant.findUniqueOrThrow({ where: { id: r.id } });
      expect(row.deletedAt).not.toBeNull();
      expect(row.isActive).toBe(false);
      expect(await prisma.menu.count({ where: { restaurantId: r.id, deletedAt: null } })).toBe(0);
      expect((await audit('restaurant.deleted')).length).toBe(1);
    });

    it('reorders: every restaurant exactly once; the website follows', async () => {
      const list = (await call('get', '/restaurants', 'content')).body.data as Array<{ id: string; slug: string }>;
      const reversed = [...list].reverse().map((r) => r.id);
      const res = await call('put', '/restaurants/order', 'content', { ids: reversed }).expect(200);
      expect(slugs(res.body.data)).toEqual(['masrawya', 'lakeside', 'hilltop']);
      expect(slugs((await call('get', '/public/restaurants')).body.data)).toEqual(['masrawya', 'lakeside', 'hilltop']);
      expect((await call('put', '/restaurants/order', 'content', { ids: reversed.slice(1) }).expect(422)).body.error.code).toBe('ORDER_MISMATCH');
      await call('put', '/restaurants/order', 'content', { ids: [reversed[0], reversed[0], reversed[1]] }).expect(400);
      await call('put', '/restaurants/order', 'ops', { ids: reversed }).expect(403);
      expect((await audit('restaurant.reordered')).length).toBe(1);
    });
  });

  describe('photos', () => {
    it('sets the main photo, which must be an existing image', async () => {
      const r = await create();
      const photo = await png('main.png');
      const res = await call('put', `/restaurants/${r.id}`, 'content', valid({ heroMediaId: photo.id })).expect(200);
      expect(res.body.data.hero).toMatchObject({ id: photo.id, kind: 'image' });
      const doc = await pdf();
      expect((await call('put', `/restaurants/${r.id}`, 'content', valid({ heroMediaId: doc.id })).expect(422)).body.error.code).toBe('MEDIA_NOT_IMAGE');
      expect((await call('put', `/restaurants/${r.id}`, 'content', valid({ heroMediaId: '00000000-0000-4000-8000-000000000000' })).expect(422)).body.error.code).toBe('MEDIA_NOT_FOUND');
      await call('put', `/restaurants/${r.id}`, 'content', valid({ heroMediaId: null })).expect(200);
    });

    it('manages an ordered gallery with captions; replacing it replaces everything', async () => {
      const r = await create();
      const [a, b, c] = [await png('a.png'), await png('b.png'), await png('c.png')];
      const set = await call('put', `/restaurants/${r.id}/gallery`, 'content', {
        items: [{ mediaId: b.id, captionEn: 'Terrace', captionAr: 'التراس' }, { mediaId: a.id }, { mediaId: c.id, captionEn: '' }],
      }).expect(200);
      expect(set.body.data.gallery.map((g: { media: { id: string } }) => g.media.id)).toEqual([b.id, a.id, c.id]);
      expect(set.body.data.gallery[0]).toMatchObject({ captionEn: 'Terrace', captionAr: 'التراس' });
      expect(set.body.data.gallery[2].captionEn).toBeNull();

      const second = await call('put', `/restaurants/${r.id}/gallery`, 'content', { items: [{ mediaId: c.id }] }).expect(200);
      expect(second.body.data.gallery).toHaveLength(1);
      expect((await call('put', `/restaurants/${r.id}/gallery`, 'content', { items: [] }).expect(200)).body.data.gallery).toEqual([]);
      expect((await audit('restaurant.gallery_updated')).length).toBe(3);
    });

    it('rejects a PDF, a duplicate, more than 20 photos and unknown media in the gallery', async () => {
      const r = await create();
      const a = await png();
      const doc = await pdf();
      await call('put', `/restaurants/${r.id}/gallery`, 'content', { items: [{ mediaId: doc.id }] }).expect(422);
      await call('put', `/restaurants/${r.id}/gallery`, 'content', { items: [{ mediaId: a.id }, { mediaId: a.id }] }).expect(400);
      await call('put', `/restaurants/${r.id}/gallery`, 'content', { items: Array.from({ length: 21 }, () => ({ mediaId: a.id })) }).expect(400);
      await call('put', `/restaurants/${r.id}/gallery`, 'content', { items: [{ mediaId: '00000000-0000-4000-8000-000000000000' }] }).expect(422);
    });

    it('protects photos in use: they cannot be deleted from the library until removed here', async () => {
      const r = await create();
      const a = await png('keep.png');
      await call('put', `/restaurants/${r.id}/gallery`, 'content', { items: [{ mediaId: a.id }] }).expect(200);
      const res = await call('delete', `/media/${a.id}`, 'content').expect(409);
      expect(res.body.error.message).toMatch(/gallery of Rooftop Grill/);
      await call('put', `/restaurants/${r.id}/gallery`, 'content', { items: [] }).expect(200);
      await call('delete', `/media/${a.id}`, 'content').expect(200);
    });
  });

  describe('menus', () => {
    it('adds a menu as an external https link or as an uploaded PDF', async () => {
      const r = await create();
      const link = (await call('post', `/restaurants/${r.id}/menus`, 'content', { nameEn: 'Dinner', nameAr: 'العشاء', externalUrl: 'https://example.com/dinner.pdf' }).expect(201)).body.data;
      expect(link).toMatchObject({ kind: 'link', url: 'https://example.com/dinner.pdf', isActive: true });
      const doc = await pdf('lunch.pdf');
      const stored = (await call('post', `/restaurants/${r.id}/menus`, 'content', { nameEn: 'Lunch', nameAr: 'الغداء', pdfMediaId: doc.id }).expect(201)).body.data;
      expect(stored).toMatchObject({ kind: 'pdf', url: doc.url });
      expect((await call('get', `/restaurants/${r.id}`, 'content')).body.data.menus.map((m: { nameEn: string }) => m.nameEn)).toEqual(['Dinner', 'Lunch']);
      expect((await audit('menu.created')).length).toBe(2);
    });

    it.each([
      ['both a link and a PDF', 'both'],
      ['neither', 'none'],
      ['an http link', 'http'],
      ['a non-https scheme', 'js'],
      ['a missing name', 'noname'],
    ])('rejects %s', async (_l, kind) => {
      const r = await create();
      const doc = await pdf();
      const body: Record<string, unknown> = { nameEn: 'Menu', nameAr: 'قائمة' };
      if (kind === 'both') Object.assign(body, { externalUrl: 'https://example.com/m.pdf', pdfMediaId: doc.id });
      if (kind === 'http') body.externalUrl = 'http://example.com/m.pdf';
      if (kind === 'js') body.externalUrl = 'javascript:alert(1)';
      if (kind === 'noname') Object.assign(body, { nameEn: '', externalUrl: 'https://example.com/m.pdf' });
      await call('post', `/restaurants/${r.id}/menus`, 'content', body).expect(400);
      expect(await prisma.menu.count({ where: { restaurantId: r.id, deletedAt: null } })).toBe(0);
    });

    it('requires the uploaded file to be a PDF that exists', async () => {
      const r = await create();
      const img = await png();
      expect((await call('post', `/restaurants/${r.id}/menus`, 'content', { nameEn: 'Menu', nameAr: 'قائمة', pdfMediaId: img.id }).expect(422)).body.error.code).toBe('MEDIA_NOT_PDF');
      await call('post', `/restaurants/${r.id}/menus`, 'content', { nameEn: 'Menu', nameAr: 'قائمة', pdfMediaId: '00000000-0000-4000-8000-000000000000' }).expect(422);
    });

    it('edits, switches between link and PDF, hides and deletes a menu — each audited', async () => {
      const r = await create();
      const m = (await call('post', `/restaurants/${r.id}/menus`, 'content', { nameEn: 'Dinner', nameAr: 'العشاء', externalUrl: 'https://example.com/d.pdf' }).expect(201)).body.data;
      const doc = await pdf();
      const up = await call('put', `/menus/${m.id}`, 'content', { nameEn: 'Dinner (new)', nameAr: 'العشاء', pdfMediaId: doc.id, isActive: false }).expect(200);
      expect(up.body.data).toMatchObject({ kind: 'pdf', nameEn: 'Dinner (new)', isActive: false, externalUrl: null });
      expect((await audit('menu.updated')).length).toBe(1);
      await call('delete', `/menus/${m.id}`, 'content').expect(200);
      await call('delete', `/menus/${m.id}`, 'content').expect(404);
      expect((await call('get', `/restaurants/${r.id}`, 'content')).body.data.menus).toEqual([]);
      expect((await audit('menu.deleted')).length).toBe(1);
      await call('put', `/menus/${m.id}`, 'ops', { nameEn: 'x', nameAr: 'y', externalUrl: 'https://example.com' }).expect(403);
    });

    it('replaces an uploaded menu PDF with another one, and the old file can then be deleted', async () => {
      const r = await create();
      const first = await pdf('old.pdf');
      const second = await pdf('new.pdf');
      const m = (await call('post', `/restaurants/${r.id}/menus`, 'content', { nameEn: 'Menu', nameAr: 'قائمة', pdfMediaId: first.id }).expect(201)).body.data;
      const res = await call('put', `/menus/${m.id}`, 'content', { nameEn: 'Menu', nameAr: 'قائمة', pdfMediaId: second.id }).expect(200);
      expect(res.body.data.url).toBe(second.url);
      expect((await call('get', '/public/restaurants/rooftop').expect(200)).body.data.menus[0].url).toBe(second.url);
      await call('delete', `/media/${first.id}`, 'content').expect(200);
      await call('delete', `/media/${second.id}`, 'content').expect(409);
    });

    it("stores each restaurant's own Instagram address (https only), which the website uses for 'Reserve a table'", async () => {
      const r = await create({ instagramUrl: 'https://www.instagram.com/rooftop.grill/' });
      expect(r.instagramUrl).toBe('https://www.instagram.com/rooftop.grill/');
      expect((await call('get', '/public/restaurants/rooftop').expect(200)).body.data.instagramUrl).toBe('https://www.instagram.com/rooftop.grill/');
      await call('put', `/restaurants/${r.id}`, 'content', valid({ instagramUrl: 'http://instagram.com/x' })).expect(400);
      expect((await call('put', `/restaurants/${r.id}`, 'content', valid({ instagramUrl: '' })).expect(200)).body.data.instagramUrl).toBeNull();
    });

    it('reorders menus; the website shows only active menus, in that order', async () => {
      const r = await create();
      const add = async (nameEn: string, isActive = true) =>
        (await call('post', `/restaurants/${r.id}/menus`, 'content', { nameEn, nameAr: 'قائمة', externalUrl: `https://example.com/${nameEn}.pdf`, isActive }).expect(201)).body.data;
      const [a, b, hidden] = [await add('Breakfast'), await add('Dinner'), await add('Secret', false)];
      await call('put', `/restaurants/${r.id}/menus/order`, 'content', { ids: [b.id, hidden.id, a.id] }).expect(200);
      expect((await call('put', `/restaurants/${r.id}/menus/order`, 'content', { ids: [a.id] }).expect(422)).body.error.code).toBe('ORDER_MISMATCH');
      const pub = (await call('get', '/public/restaurants/rooftop').expect(200)).body.data;
      expect(pub.menus.map((m: { nameEn: string }) => m.nameEn)).toEqual(['Dinner', 'Breakfast']);
    });

    it('a PDF used by a menu cannot be deleted from the library', async () => {
      const r = await create();
      const doc = await pdf();
      const m = (await call('post', `/restaurants/${r.id}/menus`, 'content', { nameEn: 'Lunch', nameAr: 'الغداء', pdfMediaId: doc.id }).expect(201)).body.data;
      expect((await call('delete', `/media/${doc.id}`, 'content').expect(409)).body.error.message).toMatch(/menu “Lunch” of Rooftop Grill/);
      await call('delete', `/menus/${m.id}`, 'content').expect(200);
      await call('delete', `/media/${doc.id}`, 'content').expect(200);
    });
  });

  describe('public API', () => {
    it('lists the seeded restaurants in order, with menus, hours and no internal fields', async () => {
      const res = await call('get', '/public/restaurants').expect(200);
      expect(res.headers['cache-control']).toMatch(/public, max-age=60/);
      const list = res.body.data;
      expect(slugs(list)).toEqual(['hilltop', 'lakeside', 'masrawya']);
      expect(list[0]).toMatchObject({ nameEn: 'Hill-Top Restaurant', nameAr: 'مطعم القلعة', opensAt: '12:00', closesAt: '00:00', closesAfterMidnight: true, instagramUrl: null, hero: null, gallery: [] }); // no Instagram address is built in: it comes from the portal
      expect(list[0].menus[0]).toMatchObject({ kind: 'link', url: expect.stringMatching(/^https:\/\//) });
      expect(JSON.stringify(list)).not.toMatch(/"id"|updatedAt|isActive|sortOrder|deletedAt/);
    });

    it('includes the main photo, gallery and uploaded PDF with site-relative URLs', async () => {
      const r = await create();
      const hero = await png('hero.png');
      const photo = await png('g.png');
      const doc = await pdf();
      await call('put', `/restaurants/${r.id}`, 'content', valid({ heroMediaId: hero.id })).expect(200);
      await call('put', `/restaurants/${r.id}/gallery`, 'content', { items: [{ mediaId: photo.id, captionEn: 'Cap' }] }).expect(200);
      await call('post', `/restaurants/${r.id}/menus`, 'content', { nameEn: 'Menu', nameAr: 'قائمة', pdfMediaId: doc.id }).expect(201);
      const pub = (await call('get', '/public/restaurants/rooftop').expect(200)).body.data;
      expect(pub.hero.url).toMatch(/^\/api\/v1\/media\/file\/.+\.png$/);
      expect(pub.gallery[0]).toMatchObject({ captionEn: 'Cap', width: 800, height: 600 });
      expect(pub.menus[0]).toMatchObject({ kind: 'pdf', url: doc.url });
      // and the URLs actually work without logging in
      await request(app.getHttpServer()).get(pub.hero.url).expect(200);
      await request(app.getHttpServer()).get(pub.menus[0].url).expect(200);
    });

    it('answers 404 for an unknown restaurant', async () => {
      await call('get', '/public/restaurants/nope').expect(404);
    });
  });
});
