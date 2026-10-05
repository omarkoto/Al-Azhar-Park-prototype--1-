import { PrismaClient } from '@prisma/client';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { expectDbError } from '../helpers/fixtures';

describe('restaurant and media integrity (database level)', () => {
  const prisma: PrismaClient = createTestPrisma();

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const restaurant = (over: Record<string, unknown> = {}) => ({
    slug: 'test-place', nameEn: 'Test', nameAr: 'تجربة', descriptionEn: 'A description', descriptionAr: 'وصف', ...over,
  });
  const media = (over: Record<string, unknown> = {}) => ({
    storageKey: '0b9c7a52-6a8e-4b8a-9d27-4f7e1c0d9a11.png', url: '/api/v1/media/file/0b9c7a52-6a8e-4b8a-9d27-4f7e1c0d9a11.png',
    fileName: 'a.png', mimeType: 'image/png', sizeBytes: 1000, width: 10, height: 10, ...over,
  });

  describe('restaurants', () => {
    it('only accepts a clean address', async () => {
      for (const slug of ['Upper', 'with space', 'double--hyphen', '-lead', 'trail-', 'a/b', 'x'.repeat(61)]) {
        await expectDbError(prisma.restaurant.create({ data: restaurant({ slug }) }), /ck_restaurants_slug/);
      }
      expect((await prisma.restaurant.create({ data: restaurant({ slug: 'good-name-2' }) })).slug).toBe('good-name-2');
    });

    it('refuses blank names, a lone opening time and too many phones', async () => {
      await expectDbError(prisma.restaurant.create({ data: restaurant({ nameEn: '  ' }) }), /ck_restaurants_names/);
      await expectDbError(prisma.restaurant.create({ data: restaurant({ opensAt: new Date('1970-01-01T12:00:00Z') }) }), /ck_restaurants_hours/);
      await expectDbError(prisma.restaurant.create({ data: restaurant({ phones: ['1', '2', '3', '4', '5', '6', '7'] }) }), /ck_restaurants_phones/);
    });

    it('allows closing after midnight (12:00 – 00:00) and refuses non-https links', async () => {
      const ok = await prisma.restaurant.create({ data: restaurant({ opensAt: new Date('1970-01-01T12:00:00Z'), closesAt: new Date('1970-01-01T00:00:00Z') }) });
      expect(ok.closesAt).not.toBeNull();
      for (const field of ['reservationUrl', 'websiteUrl', 'instagramUrl']) {
        await expectDbError(prisma.restaurant.create({ data: restaurant({ slug: `u-${field.toLowerCase()}`, [field]: 'http://example.com' }) }), /ck_restaurants_urls/);
      }
    });

    it('keeps the address unique', async () => {
      await prisma.restaurant.create({ data: restaurant() });
      await expectDbError(prisma.restaurant.create({ data: restaurant() }), /Unique constraint|unique/i);
    });
  });

  describe('menus', () => {
    it('needs a link or a PDF, https only, and a real name', async () => {
      const r = await prisma.restaurant.findFirstOrThrow();
      await expectDbError(prisma.menu.create({ data: { restaurantId: r.id, nameEn: 'M', nameAr: 'ق' } }), /ck_menus_source/);
      await expectDbError(prisma.menu.create({ data: { restaurantId: r.id, nameEn: 'M', nameAr: 'ق', externalUrl: 'http://x.example/m.pdf' } }), /ck_menus_external_https/);
      await expectDbError(prisma.menu.create({ data: { restaurantId: r.id, nameEn: ' ', nameAr: 'ق', externalUrl: 'https://x.example/m.pdf' } }), /ck_menus_names/);
      expect((await prisma.menu.create({ data: { restaurantId: r.id, nameEn: 'M', nameAr: 'ق', externalUrl: 'https://x.example/m.pdf' } })).id).toBeDefined();
    });
  });

  describe('media', () => {
    it('only records the four allowed types', async () => {
      for (const mimeType of ['image/svg+xml', 'text/html', 'image/gif', 'application/x-msdownload']) {
        await expectDbError(prisma.media.create({ data: media({ mimeType }) }), /ck_media_mime/);
      }
      expect((await prisma.media.create({ data: media() })).mimeType).toBe('image/png');
    });

    it('bounds size and dimensions, and refuses odd keys and absolute URLs', async () => {
      await expectDbError(prisma.media.create({ data: media({ sizeBytes: 0 }) }), /ck_media_size/);
      await expectDbError(prisma.media.create({ data: media({ sizeBytes: 200 * 1024 * 1024 }) }), /ck_media_size/);
      await expectDbError(prisma.media.create({ data: media({ width: 13000 }) }), /ck_media_dimensions/);
      await expectDbError(prisma.media.create({ data: media({ storageKey: '../../etc/passwd.png' }) }), /ck_media_key/);
      await expectDbError(prisma.media.create({ data: media({ url: 'https://evil.example/x.png' }) }), /ck_media_url/);
    });

    it('cannot be removed from the gallery table by deleting the file record while a gallery still uses it', async () => {
      const r = await prisma.restaurant.findFirstOrThrow();
      const m = await prisma.media.create({ data: media() });
      await prisma.restaurantMedia.create({ data: { restaurantId: r.id, mediaId: m.id } });
      await expectDbError(prisma.media.delete({ where: { id: m.id } }), /foreign key|violat/i);
    });
  });
});
