import { existsSync, readdirSync, rmSync } from 'node:fs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { createTestApp } from '../helpers/app';
import { API, login, nextIp } from '../helpers/auth';
import { pngOfSize, samples } from '../helpers/files';

// The upload size limits follow MEDIA_MAX_IMAGE_MB and MEDIA_MAX_PDF_MB and are applied while the file arrives.
// Here: images 0.2 MB (209,715 bytes), PDFs 0.5 MB (524,288 bytes).
const IMAGE_LIMIT = 209_715;
const PDF_LIMIT = 524_288;
const pdfOfSize = (bytes: number) => Buffer.concat([samples.pdf(), Buffer.alloc(Math.max(0, bytes - samples.pdf().length), 32)]);

describe('media upload limits (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let token = '';
  const mediaDir = () => process.env.MEDIA_DIR as string;
  const files = () => (existsSync(mediaDir()) ? readdirSync(mediaDir()) : []);

  const upload = (file: Buffer, opts: { name?: string; type?: string; field?: string } = {}) =>
    request(app.getHttpServer())
      .post(`${API}/media`)
      .set('X-Forwarded-For', nextIp())
      .set({ Authorization: `Bearer ${token}` })
      .attach(opts.field ?? 'file', file, { filename: opts.name ?? 'photo.png', contentType: opts.type ?? 'image/png' });

  beforeAll(async () => {
    prisma = createTestPrisma(5);
    app = await createTestApp({ TRUST_PROXY: '1', MEDIA_MAX_IMAGE_MB: '0.2', MEDIA_MAX_PDF_MB: '0.5' });
  });
  beforeEach(async () => {
    rmSync(mediaDir(), { recursive: true, force: true });
    await resetDatabase(prisma);
    await seedAll(prisma);
    token = (await login(app, 'content@azharpark.test')).accessToken;
  });
  afterAll(async () => {
    rmSync(mediaDir(), { recursive: true, force: true });
    await app.close();
    await prisma.$disconnect();
  });

  it('accepts an image of exactly the configured size and refuses one more byte, storing nothing for the refused one', async () => {
    await upload(pngOfSize(IMAGE_LIMIT)).expect(201);
    expect(files()).toHaveLength(1);
    const over = await upload(pngOfSize(IMAGE_LIMIT + 1)).expect(413);
    expect(over.body.error.code).toBe('FILE_TOO_LARGE');
    expect(files()).toHaveLength(1);
    expect(await prisma.media.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'media.uploaded' } })).toBe(1);
  });

  it('holds JPEG and WebP images to the image limit as well', async () => {
    const jpeg = (bytes: number) => Buffer.concat([samples.jpeg(800, 600), Buffer.alloc(Math.max(0, bytes - samples.jpeg(800, 600).length), 1)]);
    await upload(jpeg(IMAGE_LIMIT), { name: 'a.jpg', type: 'image/jpeg' }).expect(201);
    expect((await upload(jpeg(IMAGE_LIMIT + 1), { name: 'b.jpg', type: 'image/jpeg' }).expect(413)).body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('lets a PDF be larger than an image, up to its own limit, and refuses one more byte', async () => {
    await upload(pdfOfSize(IMAGE_LIMIT + 50_000), { name: 'menu.pdf', type: 'application/pdf' }).expect(201);
    await upload(pdfOfSize(PDF_LIMIT), { name: 'menu2.pdf', type: 'application/pdf' }).expect(201);
    const over = await upload(pdfOfSize(PDF_LIMIT + 1), { name: 'menu3.pdf', type: 'application/pdf' }).expect(413);
    expect(over.body.error.code).toBe('FILE_TOO_LARGE');
    expect(over.body.error.message).toContain('PDF files');
    expect(files()).toHaveLength(2);
    expect(await prisma.media.count()).toBe(2);
  });

  it('refuses an upload that declares more than the largest limit before reading it, whatever it is called', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 65);
    const res = await upload(big, { name: 'big.txt', type: 'text/plain' }).expect(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(res.body.error.message).toMatch(/limit is 0 MB for images and 1 MB for PDF files/);
    expect(files()).toHaveLength(0);
    expect(await prisma.media.count()).toBe(0);
  });

  it('holds a file of unknown type to the smaller limit; a small one is refused for its type as before', async () => {
    const text = (bytes: number) => Buffer.alloc(bytes, 65);
    expect((await upload(text(IMAGE_LIMIT + 1), { name: 'x.png', type: 'image/png' }).expect(413)).body.error.code).toBe('FILE_TOO_LARGE');
    expect((await upload(text(5000), { name: 'x.png', type: 'image/png' }).expect(415)).body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('still checks what the file really is: a PDF under the PDF limit is not accepted as an image', async () => {
    const res = await upload(pdfOfSize(IMAGE_LIMIT + 1000), { name: 'x.png', type: 'image/png' });
    expect(res.status).toBe(415); // declared as an image, but the bytes are a PDF
    expect(files()).toHaveLength(0);
  });

  it('answers a clear 400 for a wrong form field or no file, not a server error', async () => {
    expect((await upload(pngOfSize(1000), { field: 'photo' }).expect(400)).body.error.code).toBe('BAD_UPLOAD');
    const none = await request(app.getHttpServer()).post(`${API}/media`).set('X-Forwarded-For', nextIp()).set({ Authorization: `Bearer ${token}` }).field('altEn', 'no file');
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('FILE_REQUIRED');
  });

  it('keeps the permission rules: no token is 401, a user without media:write is 403, before any file is read', async () => {
    await request(app.getHttpServer()).post(`${API}/media`).set('X-Forwarded-For', nextIp()).attach('file', pngOfSize(1000), 'a.png').expect(401);
    const staff = (await login(app, 'staff@azharpark.test')).accessToken;
    await request(app.getHttpServer()).post(`${API}/media`).set('X-Forwarded-For', nextIp()).set({ Authorization: `Bearer ${staff}` }).attach('file', pngOfSize(1000), 'a.png').expect(403);
    expect(files()).toHaveLength(0);
  });
});
