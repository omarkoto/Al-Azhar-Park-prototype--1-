import { existsSync, readdirSync, rmSync } from 'node:fs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { createTestApp } from '../helpers/app';
import { API, login, nextIp } from '../helpers/auth';
import { pngOfSize, samples } from '../helpers/files';

describe('media library (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};
  const mediaDir = () => process.env.MEDIA_DIR as string;

  const auth = (as?: string) => (as ? { Authorization: `Bearer ${tokens[as]}` } : {});
  const upload = (as: string | undefined, file: Buffer, opts: { name?: string; type?: string; altEn?: string; altAr?: string } = {}) => {
    const req = request(app.getHttpServer()).post(`${API}/media`).set('X-Forwarded-For', nextIp()).set(auth(as));
    if (opts.altEn !== undefined) req.field('altEn', opts.altEn);
    if (opts.altAr !== undefined) req.field('altAr', opts.altAr);
    return req.attach('file', file, { filename: opts.name ?? 'photo.png', contentType: opts.type ?? 'image/png' });
  };
  const get = (path: string, as?: string) => request(app.getHttpServer()).get(`${API}${path}`).set('X-Forwarded-For', nextIp()).set(auth(as));
  const send = (method: 'patch' | 'delete', path: string, as: string, body?: object) =>
    request(app.getHttpServer())[method](`${API}${path}`).set('X-Forwarded-For', nextIp()).set(auth(as)).send(body);
  const files = () => (existsSync(mediaDir()) ? readdirSync(mediaDir()) : []);
  const audit = (action: string) => prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    prisma = createTestPrisma(5);
    app = await createTestApp({ TRUST_PROXY: '1' });
  });
  beforeEach(async () => {
    rmSync(mediaDir(), { recursive: true, force: true });
    await resetDatabase(prisma);
    await seedAll(prisma);
    for (const [k, e] of [['content', 'content@azharpark.test'], ['staff', 'staff@azharpark.test'], ['analyst', 'analyst@azharpark.test'], ['admin', 'admin@azharpark.test']] as const) {
      tokens[k] = (await login(app, e)).accessToken;
    }
  });
  afterAll(async () => {
    rmSync(mediaDir(), { recursive: true, force: true });
    await app.close();
    await prisma.$disconnect();
  });

  describe('uploading', () => {
    it('stores an image and returns its details; the file name on disk is random, not the uploaded name', async () => {
      const before = files().length;
      const res = await upload('content', samples.png(640, 480), { name: 'My Lunch.png', altEn: 'A table', altAr: 'طاولة' }).expect(201);
      expect(res.body.data).toMatchObject({ kind: 'image', mimeType: 'image/png', width: 640, height: 480, fileName: 'My Lunch.png', altEn: 'A table', altAr: 'طاولة' });
      expect(res.body.data.url).toMatch(/^\/api\/v1\/media\/file\/[0-9a-f-]{36}\.png$/);
      expect(files()).toHaveLength(before + 1);
      expect(files().some((f) => f.includes('Lunch'))).toBe(false);
      const [entry] = await audit('media.uploaded');
      expect(entry.newValue).toMatchObject({ mimeType: 'image/png' });
    });

    it.each([
      ['JPEG', () => samples.jpeg(800, 600), 'image/jpeg', 'a.jpg', 'jpg'],
      ['WebP', () => samples.webpLossy(1024, 768), 'image/webp', 'a.webp', 'webp'],
      ['PDF', () => samples.pdf(), 'application/pdf', 'menu.pdf', 'pdf'],
    ])('accepts a %s', async (_n, make, type, name, ext) => {
      const res = await upload('content', make(), { name, type }).expect(201);
      expect(res.body.data.url).toMatch(new RegExp(`\\.${ext}$`));
      expect(res.body.data.kind).toBe(ext === 'pdf' ? 'pdf' : 'image');
    });

    it('decides the type from the bytes: a script named .png is refused, and so is SVG', async () => {
      const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(60));
      expect((await upload('content', html, { name: 'evil.png', type: 'image/png' }).expect(415)).body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'.padEnd(60));
      await upload('content', svg, { name: 'logo.svg', type: 'image/svg+xml' }).expect(415);
      await upload('content', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(30)]), { name: 'a.gif', type: 'image/gif' }).expect(415);
      expect(files()).toHaveLength(0);
    });

    it('refuses a file whose declared type disagrees with its bytes', async () => {
      const res = await upload('content', samples.png(), { name: 'a.jpg', type: 'image/jpeg' }).expect(415);
      expect(res.body.error.code).toBe('FILE_TYPE_MISMATCH');
      await upload('content', samples.png(), { name: 'a.png', type: 'text/html' }).expect(415);
    });

    it('enforces the size limit per type (8 MB images)', async () => {
      const res = await upload('content', pngOfSize(8 * 1024 * 1024 + 1)).expect(413);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
      await upload('content', pngOfSize(1024 * 1024)).expect(201);
    });

    it('refuses absurd pixel dimensions, active PDFs, empty files and a missing file', async () => {
      expect((await upload('content', samples.png(13_000, 100)).expect(422)).body.error.code).toBe('IMAGE_DIMENSIONS');
      expect((await upload('content', samples.pdf('<< /S /JavaScript /JS (x) >>'), { name: 'm.pdf', type: 'application/pdf' }).expect(422)).body.error.code).toBe('UNSAFE_PDF');
      // the same features spelled with PDF name escapes (/J#61vaScript is /JavaScript to a PDF reader) are refused too
      for (const spelling of ['/S /J#61vaScript /J#53 (x)', '/S /L#61unch /F (cmd.exe)', '/Names << /Embedd#65dFiles 2 0 R >> /Type /Embedd#65dFile']) {
        expect((await upload('content', samples.pdf(`<< ${spelling} >>`), { name: 'm.pdf', type: 'application/pdf' }).expect(422)).body.error.code).toBe('UNSAFE_PDF');
      }
      expect(files()).toHaveLength(0);
      await upload('content', Buffer.alloc(0)).expect(400);
      const none = await request(app.getHttpServer()).post(`${API}/media`).set('X-Forwarded-For', nextIp()).set(auth('content')).field('altEn', 'x').expect(400);
      expect(none.body.error.code).toBe('FILE_REQUIRED');
    });

    it('cleans the display name: no path, no markup, never used on disk', async () => {
      const res = await upload('content', samples.png(), { name: '../../evil<script>.png' }).expect(201);
      expect(res.body.data.fileName).toBe('evilscript.png');
      expect(files().every((f) => /^[0-9a-f-]{36}\.png$/.test(f))).toBe(true);
    });

    it('requires media:write: ticket staff, analysts and anonymous users are refused', async () => {
      await upload('staff', samples.png()).expect(403);
      await upload('analyst', samples.png()).expect(403);
      await upload(undefined, samples.png()).expect(401);
      expect(files()).toHaveLength(0);
    });
  });

  describe('serving files', () => {
    it('serves a stored file to anyone, with headers that make it safe to embed and impossible to run', async () => {
      const key = (await upload('content', samples.png(10, 10), { name: 'café.png' }).expect(201)).body.data.url.split('/').pop();
      const res = await get(`/media/file/${key}`).expect(200);
      expect(res.headers['content-type']).toMatch(/^image\/png/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect(res.headers['content-security-policy']).toMatch(/sandbox/);
      expect(res.headers['cache-control']).toMatch(/immutable/);
      expect(res.headers['content-disposition']).toMatch(/^inline; filename\*=UTF-8''caf%C3%A9\.png$/);
      expect(Buffer.from(res.body).length).toBe(33);
    });

    it('keeps Arabic and accented file names intact', async () => {
      const res = await upload('content', samples.png(), { name: 'مطعم البحيرة.png' }).expect(201);
      expect(res.body.data.fileName).toBe('مطعم البحيرة.png');
    });

    it('serves a PDF as application/pdf', async () => {
      const key = (await upload('content', samples.pdf(), { name: 'menu.pdf', type: 'application/pdf' }).expect(201)).body.data.url.split('/').pop();
      expect((await get(`/media/file/${key}`).expect(200)).headers['content-type']).toMatch(/application\/pdf/);
    });

    it('never reads anything but our own generated keys (no path traversal)', async () => {
      for (const bad of ['..%2F..%2F..%2Fetc%2Fpasswd', '..%5C..%5Cwindows%5Cwin.ini', 'not-a-key.png', '0b9c7a52-6a8e-4b8a-9d27-4f7e1c0d9a11.png', '%2e%2e%2f%2e%2e%2fpackage.json']) {
        await get(`/media/file/${bad}`).expect(404);
      }
    });

    it('stops serving a file once it is deleted', async () => {
      const m = (await upload('content', samples.png()).expect(201)).body.data;
      const key = m.url.split('/').pop();
      await get(`/media/file/${key}`).expect(200);
      await send('delete', `/media/${m.id}`, 'content').expect(200);
      await get(`/media/file/${key}`).expect(404);
      expect(files()).toHaveLength(0);
      expect((await audit('media.deleted')).length).toBe(1);
    });
  });

  describe('managing', () => {
    it('lists newest first with paging, a kind filter and search', async () => {
      await upload('content', samples.png(), { name: 'terrace.png', altEn: 'The terrace' }).expect(201);
      await upload('content', samples.pdf(), { name: 'lake-menu.pdf', type: 'application/pdf' }).expect(201);
      await upload('content', samples.jpeg(), { name: 'garden.jpg', type: 'image/jpeg' }).expect(201);
      const all = (await get('/media', 'content').expect(200)).body;
      expect(all.data.map((m: { fileName: string }) => m.fileName)).toEqual(['garden.jpg', 'lake-menu.pdf', 'terrace.png']);
      expect(all.meta).toMatchObject({ total: 3, page: 1 });
      expect((await get('/media?kind=pdf', 'content')).body.data).toHaveLength(1);
      expect((await get('/media?kind=image', 'content')).body.data).toHaveLength(2);
      expect((await get('/media?search=terrace', 'content')).body.data).toHaveLength(1);
      expect((await get('/media?limit=2&page=2', 'content')).body.data).toHaveLength(1);
    });

    it('lets people with media:read view and people without it see nothing', async () => {
      const m = (await upload('content', samples.png()).expect(201)).body.data;
      await get('/media', 'admin').expect(200);
      await get(`/media/${m.id}`, 'admin').expect(200);
      await get('/media', 'staff').expect(403);
      await get('/media', 'analyst').expect(403);
      await get('/media').expect(401);
    });

    it('changes the descriptions (alt text) and audits it; only media:write may', async () => {
      const m = (await upload('content', samples.png(), { altEn: 'Old' }).expect(201)).body.data;
      const res = await send('patch', `/media/${m.id}`, 'content', { altEn: 'New description', altAr: 'وصف جديد' }).expect(200);
      expect(res.body.data).toMatchObject({ altEn: 'New description', altAr: 'وصف جديد' });
      const [entry] = await audit('media.updated');
      expect(entry.oldValue).toMatchObject({ altEn: 'Old' });
      await send('patch', `/media/${m.id}`, 'analyst', { altEn: 'x' }).expect(403);
    });

    it('refuses to delete a file that is still used and says where', async () => {
      const m = (await upload('content', samples.png()).expect(201)).body.data;
      const restaurant = await prisma.restaurant.findFirstOrThrow({ where: { slug: 'hilltop' } });
      await prisma.restaurant.update({ where: { id: restaurant.id }, data: { heroMediaId: m.id } });
      const info = (await get(`/media/${m.id}`, 'content').expect(200)).body.data;
      expect(info.usage).toEqual(['main photo of Hill-top Restaurant']);
      const res = await send('delete', `/media/${m.id}`, 'content').expect(409);
      expect(res.body.error.code).toBe('MEDIA_IN_USE');
      expect(res.body.error.message).toMatch(/Hill-top/);
      expect(files()).toHaveLength(1);
      await prisma.restaurant.update({ where: { id: restaurant.id }, data: { heroMediaId: null } });
      await send('delete', `/media/${m.id}`, 'content').expect(200);
    });

    it('answers 404 for an unknown id and 400 for a malformed one', async () => {
      await get('/media/00000000-0000-4000-8000-000000000000', 'content').expect(404);
      await get('/media/not-a-uuid', 'content').expect(400);
    });

    it('does not leave a file behind when the database write fails', async () => {
      const failing = jest.spyOn(app.get(PrismaService).media, 'create').mockRejectedValueOnce(new Error('db down'));
      await upload('content', samples.png()).expect(500);
      expect(files()).toHaveLength(0);
      failing.mockRestore();
    });
  });
});
