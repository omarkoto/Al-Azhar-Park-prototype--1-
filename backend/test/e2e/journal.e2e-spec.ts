import { rmSync } from 'node:fs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { createTestApp } from '../helpers/app';
import { API, createUser, login, nextIp } from '../helpers/auth';
import { samples } from '../helpers/files';

describe('Journal articles (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};

  type Method = 'get' | 'post' | 'put' | 'delete';
  const call = (method: Method, path: string, as?: string, body?: object) =>
    request(app.getHttpServer())[method](`${API}${path}`).set('X-Forwarded-For', nextIp()).set(as ? { Authorization: `Bearer ${tokens[as]}` } : {}).send(body);
  const audit = (action: string) => prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });
  const upload = async (file: Buffer, name: string, type: string) =>
    (await request(app.getHttpServer()).post(`${API}/media`).set('X-Forwarded-For', nextIp()).set({ Authorization: `Bearer ${tokens.content}` }).attach('file', file, { filename: name, contentType: type }).expect(201)).body.data as { id: string; url: string };
  const png = (name = 'cover.png') => upload(samples.png(800, 600), name, 'image/png');
  const pdf = () => upload(samples.pdf(), 'a.pdf', 'application/pdf');

  const valid = (over: Record<string, unknown> = {}) => ({
    slug: 'a-royal-welcome',
    titleEn: 'A royal welcome', titleAr: 'استقبال ملكي',
    tagEn: 'History', tagAr: 'تاريخ',
    shortDescriptionEn: 'In 2006 the park welcomed royal guests.', shortDescriptionAr: 'في عام ٢٠٠٦ استقبلت الحديقة ضيوفاً ملكيين.',
    bodyEn: 'First paragraph of the story.\n\nSecond paragraph of the story.', bodyAr: 'الفقرة الأولى من القصة.\n\nالفقرة الثانية من القصة.',
    ...over,
  });
  const create = async (over: Record<string, unknown> = {}) => (await call('post', '/journal', 'content', valid(over)).expect(201)).body.data;
  const setStatus = (id: string, status: string, as = 'content') => call('put', `/journal/${id}/status`, as, { status });
  const publicSlugs = async () => (await call('get', '/public/journal').expect(200)).body.data.map((a: { slug: string }) => a.slug) as string[];

  beforeAll(async () => {
    prisma = createTestPrisma(5);
    app = await createTestApp({ TRUST_PROXY: '1' });
  });
  beforeEach(async () => {
    rmSync(process.env.MEDIA_DIR as string, { recursive: true, force: true });
    await resetDatabase(prisma);
    await seedAll(prisma);
    await prisma.journalArticle.deleteMany(); // the development seed publishes sample articles; these tests start from none
    for (const [k, e] of [['content', 'content@azharpark.test'], ['ops', 'operations@azharpark.test'], ['staff', 'staff@azharpark.test'], ['analyst', 'analyst@azharpark.test'], ['admin', 'admin@azharpark.test'], ['super', 'superadmin@azharpark.test']] as const) {
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
    it('lets content managers and administrators do everything', async () => {
      for (const who of ['content', 'admin', 'super']) {
        const slug = `by-${who}`;
        const id = (await call('post', '/journal', who, valid({ slug })).expect(201)).body.data.id;
        await call('get', '/journal', who).expect(200);
        await call('get', `/journal/${id}`, who).expect(200);
        await call('put', `/journal/${id}`, who, valid({ slug, titleEn: 'Edited' })).expect(200);
        await call('put', `/journal/${id}/gallery`, who, { items: [] }).expect(200);
        await setStatus(id, 'PUBLISHED', who).expect(200);
      }
    });

    it('lets an analyst read but never change, publish or edit photos', async () => {
      const id = (await create()).id;
      await call('get', '/journal', 'analyst').expect(200);
      await call('get', `/journal/${id}`, 'analyst').expect(200);
      await call('post', '/journal', 'analyst', valid({ slug: 'x-article' })).expect(403);
      await call('put', `/journal/${id}`, 'analyst', valid()).expect(403);
      await setStatus(id, 'PUBLISHED', 'analyst').expect(403);
      await call('put', `/journal/${id}/gallery`, 'analyst', { items: [] }).expect(403);
    });

    it('gives operations and ticket staff nothing (they hold no journal permission)', async () => {
      const id = (await create()).id;
      for (const who of ['ops', 'staff']) {
        await call('get', '/journal', who).expect(403);
        await call('get', `/journal/${id}`, who).expect(403);
        await call('post', '/journal', who, valid({ slug: 'x-article' })).expect(403);
        await call('put', `/journal/${id}`, who, valid()).expect(403);
        await setStatus(id, 'PUBLISHED', who).expect(403);
        await call('put', `/journal/${id}/gallery`, who, { items: [] }).expect(403);
      }
    });

    it('keeps publishing separate from writing: journal:write alone can draft and edit but not change the status', async () => {
      await prisma.role.create({ data: { code: 'WRITER', name: 'Writer' } });
      const perms = await prisma.permission.findMany({ where: { code: { in: ['journal:read', 'journal:write', 'media:read'] } } });
      expect(perms).toHaveLength(3);
      for (const p of perms) await prisma.rolePermission.create({ data: { roleId: (await prisma.role.findUniqueOrThrow({ where: { code: 'WRITER' } })).id, permissionId: p.id } });
      const writer = await createUser(prisma, { role: 'WRITER' });
      tokens.writer = (await login(app, writer.email)).accessToken;
      const id = (await call('post', '/journal', 'writer', valid()).expect(201)).body.data.id;
      await call('put', `/journal/${id}`, 'writer', valid({ titleEn: 'Better title' })).expect(200);
      await call('put', `/journal/${id}/gallery`, 'writer', { items: [] }).expect(200);
      await setStatus(id, 'PUBLISHED', 'writer').expect(403);
      expect((await call('get', `/journal/${id}`, 'writer').expect(200)).body.data.status).toBe('DRAFT');
    });

    it('needs a sign-in for every portal route, and none for the public ones', async () => {
      const id = (await create()).id;
      await call('get', '/journal').expect(401);
      await call('get', `/journal/${id}`).expect(401);
      await call('post', '/journal', undefined, valid({ slug: 'y-article' })).expect(401);
      await call('put', `/journal/${id}`, undefined, valid()).expect(401);
      await call('put', `/journal/${id}/status`, undefined, { status: 'PUBLISHED' }).expect(401);
      await call('put', `/journal/${id}/gallery`, undefined, { items: [] }).expect(401);
      await call('get', '/public/journal').expect(200);
    });

    it('the seeded roles hold exactly the journal permissions intended', async () => {
      const held = async (role: string) => (await prisma.rolePermission.findMany({ where: { role: { code: role }, permission: { code: { startsWith: 'journal:' } } }, include: { permission: true } })).map((r) => r.permission.code).sort();
      expect(await held('ADMIN')).toEqual(['journal:publish', 'journal:read', 'journal:write']);
      expect(await held('CONTENT_MANAGER')).toEqual(['journal:publish', 'journal:read', 'journal:write']);
      expect(await held('ANALYST')).toEqual(['journal:read']);
      expect(await held('OPERATIONS')).toEqual([]);
      expect(await held('TICKET_STAFF')).toEqual([]);
    });
  });

  // ───────────────────────── creating and editing ─────────────────────────
  describe('writing an article', () => {
    it('starts as a draft with every field the card and the article page need, and keeps what was typed', async () => {
      const a = await create({ dateLabelEn: '2006', dateLabelAr: '٢٠٠٦', isFeatured: true });
      expect(a).toMatchObject({
        slug: 'a-royal-welcome', status: 'DRAFT', titleEn: 'A royal welcome', titleAr: 'استقبال ملكي', tagEn: 'History', tagAr: 'تاريخ',
        shortDescriptionEn: 'In 2006 the park welcomed royal guests.', dateLabelEn: '2006', dateLabelAr: '٢٠٠٦', isFeatured: true, cover: null, gallery: [], publishedAt: null,
      });
      expect(a.bodyEn).toBe('First paragraph of the story.\n\nSecond paragraph of the story.');
      expect(a.bodyAr).toContain('الفقرة الثانية');
      const read = (await call('get', `/journal/${a.id}`, 'content').expect(200)).body.data;
      expect(read.bodyEn).toBe(a.bodyEn);
    });

    it('stores the article text as plain text: markup is kept as typed, never interpreted, and Windows line breaks become new lines', async () => {
      const a = await create({ bodyEn: 'Line one\r\n\r\n<script>alert(1)</script> & <b>bold</b>', shortDescriptionEn: 'A short text with <i>tags</i> in it.' });
      expect(a.bodyEn).toBe('Line one\n\n<script>alert(1)</script> & <b>bold</b>');
      expect(a.shortDescriptionEn).toBe('A short text with <i>tags</i> in it.');
    });

    it.each([
      ['a missing title', { titleEn: undefined }],
      ['a title that is too short', { titleEn: 'A' }],
      ['an empty tag', { tagEn: '   ' }],
      ['a tag that is too long', { tagAr: 'ت'.repeat(41) }],
      ['a tag with a line break', { tagEn: 'His\ntory' }],
      ['a short description that is too short', { shortDescriptionEn: 'Too short' }],
      ['a short description that is too long', { shortDescriptionAr: 'ن'.repeat(301) }],
      ['an empty article text', { bodyEn: '' }],
      ['an article text that is too long', { bodyAr: 'ب'.repeat(20001) }],
      ['a control character in the text', { bodyEn: 'Hidden \u0007 bell character in the text' }],
      ['an address with capitals and spaces', { slug: 'Not A Valid Address' }],
      ['an address that is too short', { slug: 'a' }],
      ['a date wording that is too long', { dateLabelEn: 'x'.repeat(61) }],
      ['a cover that is not an id', { coverMediaId: 'not-a-uuid' }],
    ])('refuses %s', async (_label, over) => {
      const res = await call('post', '/journal', 'content', valid(over as Record<string, unknown>)).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await prisma.journalArticle.count()).toBe(0);
    });

    it('needs both languages: an Arabic-only or English-only article is refused', async () => {
      await call('post', '/journal', 'content', valid({ titleAr: undefined })).expect(400);
      await call('post', '/journal', 'content', valid({ bodyEn: undefined })).expect(400);
    });

    it('gives every article its own address, and locks the address once the article has been public', async () => {
      const a = await create();
      expect((await call('post', '/journal', 'content', valid({ titleEn: 'Another' })).expect(409)).body.error.code).toBe('SLUG_TAKEN');
      // while it is a draft the address can change
      const moved = (await call('put', `/journal/${a.id}`, 'content', valid({ slug: 'new-address' })).expect(200)).body.data;
      expect(moved.slug).toBe('new-address');
      const other = await create({ slug: 'second-article' });
      expect((await call('put', `/journal/${other.id}`, 'content', valid({ slug: 'new-address' })).expect(409)).body.error.code).toBe('SLUG_TAKEN');
      // once public it is fixed (links to it would break)
      await setStatus(a.id, 'PUBLISHED').expect(200);
      expect((await call('put', `/journal/${a.id}`, 'content', valid({ slug: 'yet-another' })).expect(409)).body.error.code).toBe('SLUG_LOCKED');
      await call('put', `/journal/${a.id}`, 'content', valid({ slug: 'new-address', titleEn: 'Same address, new title' })).expect(200);
    });

    it('edits the content without touching the status', async () => {
      const a = await create();
      await setStatus(a.id, 'PUBLISHED').expect(200);
      const edited = (await call('put', `/journal/${a.id}`, 'content', valid({ titleEn: 'Edited title', tagEn: 'Heritage' })).expect(200)).body.data;
      expect(edited).toMatchObject({ status: 'PUBLISHED', titleEn: 'Edited title', tagEn: 'Heritage' });
      expect((await call('get', '/public/journal/a-royal-welcome').expect(200)).body.data).toMatchObject({ titleEn: 'Edited title', tagEn: 'Heritage' });
    });

    it('answers 404 for an article that does not exist and 400 for an id that is not one', async () => {
      await call('get', '/journal/00000000-0000-4000-8000-000000000000', 'content').expect(404);
      await call('put', '/journal/00000000-0000-4000-8000-000000000000', 'content', valid()).expect(404);
      await call('get', '/journal/not-an-id', 'content').expect(400);
    });
  });

  // ───────────────────────── publishing ─────────────────────────
  describe('publishing', () => {
    it('shows only published articles to visitors, and hides drafts and archived ones with the same plain 404', async () => {
      const a = await create();
      expect(await publicSlugs()).toEqual([]);
      const draft = await call('get', '/public/journal/a-royal-welcome').expect(404);
      await setStatus(a.id, 'PUBLISHED').expect(200);
      expect(await publicSlugs()).toEqual(['a-royal-welcome']);
      expect((await call('get', '/public/journal/a-royal-welcome').expect(200)).body.data.titleEn).toBe('A royal welcome');
      await setStatus(a.id, 'DRAFT').expect(200);
      expect(await publicSlugs()).toEqual([]);
      await setStatus(a.id, 'PUBLISHED').expect(200);
      await setStatus(a.id, 'ARCHIVED').expect(200);
      expect(await publicSlugs()).toEqual([]);
      const archived = await call('get', '/public/journal/a-royal-welcome').expect(404);
      const never = await call('get', '/public/journal/never-existed').expect(404);
      expect(archived.body.error.code).toBe(draft.body.error.code);
      expect(never.body.error.code).toBe(draft.body.error.code);
      expect(archived.body.error.message).toBe(never.body.error.message);
    });

    it('follows the lifecycle: draft ⇄ published, either to archived, archived back only to draft', async () => {
      const a = await create();
      const ok: Array<[string, string]> = [['PUBLISHED', 'PUBLISHED'], ['DRAFT', 'DRAFT'], ['ARCHIVED', 'ARCHIVED'], ['DRAFT', 'DRAFT'], ['PUBLISHED', 'PUBLISHED'], ['ARCHIVED', 'ARCHIVED']];
      for (const [to, expected] of ok) expect((await setStatus(a.id, to).expect(200)).body.data.status).toBe(expected);
      // refused changes
      expect((await setStatus(a.id, 'PUBLISHED').expect(409)).body.error.code).toBe('INVALID_STATUS_CHANGE'); // archived never goes straight to public
      expect((await setStatus(a.id, 'ARCHIVED').expect(409)).body.error.code).toBe('INVALID_STATUS_CHANGE');
      await setStatus(a.id, 'DRAFT').expect(200);
      expect((await setStatus(a.id, 'DRAFT').expect(409)).body.error.code).toBe('INVALID_STATUS_CHANGE');
      await call('put', `/journal/${a.id}/status`, 'content', { status: 'COMING_SOON' }).expect(400); // not a journal status
      await call('put', `/journal/${a.id}/status`, 'content', {}).expect(400);
    });

    it('records when it first went public, and keeps that moment when it is published again', async () => {
      const a = await create();
      expect(a.publishedAt).toBeNull();
      const first = (await setStatus(a.id, 'PUBLISHED').expect(200)).body.data.publishedAt as string;
      expect(first).toBeTruthy();
      await setStatus(a.id, 'DRAFT').expect(200);
      expect((await call('get', `/journal/${a.id}`, 'content').expect(200)).body.data.publishedAt).toBe(first);
      expect((await setStatus(a.id, 'PUBLISHED').expect(200)).body.data.publishedAt).toBe(first);
    });

    it('lists the newest published article first', async () => {
      const first = await create({ slug: 'first-story' });
      const second = await create({ slug: 'second-story' });
      const third = await create({ slug: 'third-story' });
      await setStatus(second.id, 'PUBLISHED').expect(200);
      await setStatus(first.id, 'PUBLISHED').expect(200);
      await setStatus(third.id, 'PUBLISHED').expect(200);
      expect(await publicSlugs()).toEqual(['third-story', 'first-story', 'second-story']);
    });

    it('what a visitor receives holds no ids, status, editor identities or timestamps of editing', async () => {
      const cover = await png();
      const a = await create({ coverMediaId: cover.id });
      await setStatus(a.id, 'PUBLISHED').expect(200);
      const res = await call('get', '/public/journal').expect(200);
      expect(res.headers['cache-control']).toMatch(/public, max-age=60/);
      const [item] = res.body.data;
      expect(Object.keys(item).sort()).toEqual(['bodyAr', 'bodyEn', 'cover', 'dateLabelAr', 'dateLabelEn', 'gallery', 'isFeatured', 'publishedAt', 'shortDescriptionAr', 'shortDescriptionEn', 'slug', 'tagAr', 'tagEn', 'titleAr', 'titleEn']);
      expect(Object.keys(item.cover).sort()).toEqual(['altAr', 'altEn', 'height', 'url', 'width']);
      const text = JSON.stringify(res.body);
      for (const secret of [a.id, 'createdBy', 'status', 'updatedAt', 'DRAFT', 'storageKey', 'uploadedBy']) expect(text).not.toContain(secret);
    });
  });

  // ───────────────────────── photos ─────────────────────────
  describe('cover photo and gallery', () => {
    it('sets and replaces the cover from the media library, and shows it on the public article', async () => {
      const one = await png('one.png');
      const two = await png('two.png');
      const a = await create({ coverMediaId: one.id });
      expect(a.cover.id).toBe(one.id);
      await setStatus(a.id, 'PUBLISHED').expect(200);
      expect((await call('get', '/public/journal/a-royal-welcome').expect(200)).body.data.cover.url).toBe(one.url);
      const changed = (await call('put', `/journal/${a.id}`, 'content', valid({ coverMediaId: two.id })).expect(200)).body.data;
      expect(changed.cover.id).toBe(two.id);
      const removed = (await call('put', `/journal/${a.id}`, 'content', valid({ coverMediaId: null })).expect(200)).body.data;
      expect(removed.cover).toBeNull();
      expect((await call('get', '/public/journal/a-royal-welcome').expect(200)).body.data.cover).toBeNull();
    });

    it('refuses a cover that is not an image or does not exist', async () => {
      const doc = await pdf();
      expect((await call('post', '/journal', 'content', valid({ coverMediaId: doc.id })).expect(422)).body.error.code).toBe('MEDIA_NOT_IMAGE');
      expect((await call('post', '/journal', 'content', valid({ coverMediaId: '00000000-0000-4000-8000-000000000000' })).expect(422)).body.error.code).toBe('MEDIA_NOT_FOUND');
      expect(await prisma.journalArticle.count()).toBe(0);
    });

    it('keeps a gallery in the order it was given, with captions in both languages', async () => {
      const [p1, p2, p3] = [await png('a.png'), await png('b.png'), await png('c.png')];
      const a = await create();
      const res = (await call('put', `/journal/${a.id}/gallery`, 'content', {
        items: [{ mediaId: p3.id, captionEn: 'Third', captionAr: 'ثالث' }, { mediaId: p1.id, captionEn: null, captionAr: null }, { mediaId: p2.id, captionEn: 'Second', captionAr: '' }],
      }).expect(200)).body.data;
      expect(res.gallery.map((g: { media: { id: string } }) => g.media.id)).toEqual([p3.id, p1.id, p2.id]);
      expect(res.gallery[0]).toMatchObject({ captionEn: 'Third', captionAr: 'ثالث' });
      expect(res.gallery[2]).toMatchObject({ captionEn: 'Second', captionAr: null });
      await setStatus(a.id, 'PUBLISHED').expect(200);
      const pub = (await call('get', '/public/journal/a-royal-welcome').expect(200)).body.data;
      expect(pub.gallery.map((g: { url: string }) => g.url)).toEqual([p3.url, p1.url, p2.url]);
      // replacing it replaces all of it
      expect((await call('put', `/journal/${a.id}/gallery`, 'content', { items: [{ mediaId: p2.id }] }).expect(200)).body.data.gallery).toHaveLength(1);
      expect((await call('put', `/journal/${a.id}/gallery`, 'content', { items: [] }).expect(200)).body.data.gallery).toEqual([]);
    });

    it('refuses a gallery with a duplicate photo, more than 30 photos, a PDF, or a photo that does not exist', async () => {
      const p = await png();
      const doc = await pdf();
      const a = await create();
      await call('put', `/journal/${a.id}/gallery`, 'content', { items: [{ mediaId: p.id }, { mediaId: p.id }] }).expect(400);
      await call('put', `/journal/${a.id}/gallery`, 'content', { items: Array.from({ length: 31 }, (_, i) => ({ mediaId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` })) }).expect(400);
      expect((await call('put', `/journal/${a.id}/gallery`, 'content', { items: [{ mediaId: doc.id }] }).expect(422)).body.error.code).toBe('MEDIA_NOT_IMAGE');
      expect((await call('put', `/journal/${a.id}/gallery`, 'content', { items: [{ mediaId: '00000000-0000-4000-8000-000000000000' }] }).expect(422)).body.error.code).toBe('MEDIA_NOT_FOUND');
      expect((await call('get', `/journal/${a.id}`, 'content').expect(200)).body.data.gallery).toEqual([]);
    });

    it('does not let a cover or gallery photo that is in use be deleted from the media library', async () => {
      const p = await png();
      const a = await create({ coverMediaId: p.id });
      const res = await call('delete', `/media/${p.id}`, 'content').expect(409);
      expect(res.body.error.code).toBe('MEDIA_IN_USE');
      expect(res.body.error.message).toContain('cover of Journal article A royal welcome');
      expect((await call('get', `/media/${p.id}`, 'content').expect(200)).body.data.usage).toEqual(['cover of Journal article A royal welcome']);
      expect((await call('get', `/journal/${a.id}`, 'content').expect(200)).body.data.cover.id).toBe(p.id);
      // and a photo that is only in a gallery is protected too
      const g = await png('gallery.png');
      await call('put', `/journal/${a.id}/gallery`, 'content', { items: [{ mediaId: g.id }] }).expect(200);
      expect((await call('delete', `/media/${g.id}`, 'content').expect(409)).body.error.message).toContain('1 Journal gallery place(s)');
      // once it is taken off the article it can be deleted
      await call('put', `/journal/${a.id}/gallery`, 'content', { items: [] }).expect(200);
      await call('delete', `/media/${g.id}`, 'content').expect(200);
    });
  });

  // ───────────────────────── finding articles in the portal ─────────────────────────
  describe('the portal list', () => {
    it('shows every status, newest first, and filters by status and by title, tag or address', async () => {
      const a = await create({ slug: 'history-one', titleEn: 'The old wall', tagEn: 'History' });
      const b = await create({ slug: 'dining-one', titleEn: 'Three tables', tagEn: 'Dining', titleAr: 'ثلاث طاولات', tagAr: 'المطاعم' });
      await create({ slug: 'draft-one', titleEn: 'Still a draft' });
      await setStatus(a.id, 'PUBLISHED').expect(200);
      await setStatus(b.id, 'ARCHIVED').expect(200);
      const all = (await call('get', '/journal', 'content').expect(200)).body;
      expect(all.data).toHaveLength(3);
      expect(all.meta.total).toBe(3);
      const slugsOf = async (q: string) => (await call('get', `/journal${q}`, 'content').expect(200)).body.data.map((x: { slug: string }) => x.slug).sort();
      expect(await slugsOf('?status=PUBLISHED')).toEqual(['history-one']);
      expect(await slugsOf('?status=ARCHIVED')).toEqual(['dining-one']);
      expect(await slugsOf('?status=DRAFT')).toEqual(['draft-one']);
      expect(await slugsOf('?search=wall')).toEqual(['history-one']);
      expect(await slugsOf('?search=dining')).toEqual(['dining-one']); // by tag and address
      expect(await slugsOf('?search=ثلاث')).toEqual(['dining-one']);
      expect(await slugsOf('?search=nothing-matches')).toEqual([]);
      await call('get', '/journal?status=COMING_SOON', 'content').expect(400);
      await call('get', '/journal?limit=101', 'content').expect(400);
      expect((await call('get', '/journal?limit=2&page=2', 'content').expect(200)).body.data).toHaveLength(1);
    });
  });

  // ───────────────────────── audit ─────────────────────────
  describe('audit', () => {
    it('records who created, edited, published, unpublished, archived and restored an article, and what changed', async () => {
      const cover = await png();
      const a = await create({ coverMediaId: cover.id });
      await call('put', `/journal/${a.id}`, 'admin', valid({ titleEn: 'New title', coverMediaId: null })).expect(200);
      await setStatus(a.id, 'PUBLISHED', 'admin').expect(200);
      await setStatus(a.id, 'DRAFT', 'admin').expect(200);
      await setStatus(a.id, 'ARCHIVED', 'admin').expect(200);
      await setStatus(a.id, 'DRAFT', 'admin').expect(200);
      await call('put', `/journal/${a.id}/gallery`, 'admin', { items: [{ mediaId: cover.id }] }).expect(200);

      const content = await prisma.user.findUniqueOrThrow({ where: { email: 'content@azharpark.test' } });
      const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@azharpark.test' } });
      const [created] = await audit('journal.created');
      expect(created).toMatchObject({ userId: content.id, entity: 'journal_article', entityId: a.id });
      const [updated] = await audit('journal.updated');
      expect(updated).toMatchObject({ userId: admin.id, entityId: a.id });
      expect((updated.oldValue as { titleEn: string }).titleEn).toBe('A royal welcome');
      expect((updated.newValue as { titleEn: string }).titleEn).toBe('New title');
      expect((await audit('journal.cover_changed'))[0]).toMatchObject({ userId: admin.id });
      for (const action of ['journal.published', 'journal.unpublished', 'journal.archived', 'journal.restored', 'journal.gallery_updated']) {
        const rows = await audit(action);
        expect({ action, count: rows.length, actor: rows[0]?.userId }).toEqual({ action, count: 1, actor: admin.id });
      }
    });

    it('keeps the article text out of the audit trail, and records nothing for a refused change', async () => {
      const a = await create({ bodyEn: 'A secret draft sentence that must not be copied into the audit log.' });
      const rows = await prisma.auditLog.findMany({ where: { entityId: a.id } });
      expect(JSON.stringify(rows)).not.toContain('secret draft sentence');
      const before = await prisma.auditLog.count();
      await call('post', '/journal', 'content', valid({ titleEn: undefined })).expect(400);
      await call('post', '/journal', 'analyst', valid({ slug: 'z-article' })).expect(403);
      await setStatus(a.id, 'ARCHIVED', 'analyst').expect(403);
      await setStatus(a.id, 'DRAFT', 'content').expect(409);
      expect(await prisma.auditLog.count()).toBe(before);
    });
  });

  // ───────────────────────── the development seed ─────────────────────────
  describe('the development seed', () => {
    it('publishes the six stories the website has built in, newest first, and never overwrites an editor\'s change', async () => {
      await resetDatabase(prisma);
      await seedAll(prisma);
      const list = (await call('get', '/public/journal').expect(200)).body.data as Array<{ slug: string; tagEn: string; titleEn: string; bodyAr: string }>;
      expect(list.map((a) => a.slug)).toEqual(['khayamiya-market-restoration-begins', 'a-royal-welcome-at-al-azhar-park', 'the-wall-beneath-the-garden', 'al-darb-al-ahmar-restored', 'three-tables-three-views', 'one-of-the-worlds-great-public-spaces']);
      expect(list.map((a) => a.tagEn)).toEqual(['Heritage', 'History', 'History', 'History', 'Dining', 'Recognition']);
      expect(list.every((a) => a.bodyAr.length > 100)).toBe(true);
      // an editor changes one, the seed runs again, the change stays
      const tokenAdmin = (await login(app, 'content@azharpark.test')).accessToken;
      tokens.content = tokenAdmin;
      const row = await prisma.journalArticle.findUniqueOrThrow({ where: { slug: 'the-wall-beneath-the-garden' } });
      await prisma.journalArticle.update({ where: { id: row.id }, data: { titleEn: 'Changed by an editor' } });
      await seedAll(prisma);
      expect((await prisma.journalArticle.findUniqueOrThrow({ where: { slug: 'the-wall-beneath-the-garden' } })).titleEn).toBe('Changed by an editor');
      expect(await prisma.journalArticle.count()).toBe(6);
    });
  });
});
