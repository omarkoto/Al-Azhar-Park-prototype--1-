import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { expectDbError } from '../helpers/fixtures';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';

// The rules the database keeps for Journal articles whatever writes to it (the API checks them first; these are the backstop).
describe('Journal articles (database level)', () => {
  const prisma: PrismaClient = createTestPrisma();

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
    await prisma.journalArticle.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const article = (over: Record<string, unknown> = {}) => ({
    slug: 'a-story', titleEn: 'A story', titleAr: 'قصة', tagEn: 'History', tagAr: 'تاريخ',
    shortDescriptionEn: 'Short text', shortDescriptionAr: 'نص قصير', bodyEn: 'Body text', bodyAr: 'نص المقال',
    ...over,
  });
  const photo = (name: string) =>
    prisma.media.create({ data: { storageKey: `${randomUUID()}.png`, url: `/api/v1/media/file/${name}.png`, fileName: `${name}.png`, mimeType: 'image/png', sizeBytes: 100 } });

  it('starts every article as a draft that is not featured and has no date wording', async () => {
    const a = await prisma.journalArticle.create({ data: article() });
    expect(a).toMatchObject({ status: 'DRAFT', isFeatured: false, dateLabelEn: null, dateLabelAr: null, publishedAt: null, coverMediaId: null, deletedAt: null });
  });

  it('keeps addresses unique and well formed', async () => {
    await prisma.journalArticle.create({ data: article() });
    await expectDbError(prisma.journalArticle.create({ data: article() }), /Unique constraint|journal_articles_slug_key|slug/);
    for (const slug of ['Has Capitals', 'under_score', '-leading', 'trailing-', 'double--hyphen', 'x'.repeat(81), '']) {
      await expectDbError(prisma.journalArticle.create({ data: article({ slug }) }), /ck_journal_slug/);
    }
    await prisma.journalArticle.create({ data: article({ slug: 'a'.repeat(80) }) });
  });

  it('refuses an article with a blank title, tag, short description or text in either language', async () => {
    for (const field of ['titleEn', 'titleAr', 'tagEn', 'tagAr', 'shortDescriptionEn', 'shortDescriptionAr', 'bodyEn', 'bodyAr']) {
      await expectDbError(prisma.journalArticle.create({ data: article({ slug: `blank-${field.toLowerCase()}`, [field]: '   ' }) }), /ck_journal_texts/);
    }
    expect(await prisma.journalArticle.count()).toBe(0);
  });

  it('refuses a published article that has no published moment', async () => {
    await expectDbError(prisma.journalArticle.create({ data: article({ status: 'PUBLISHED' }) }), /ck_journal_published_at/);
    await prisma.journalArticle.create({ data: article({ status: 'PUBLISHED', publishedAt: new Date() }) });
    const draft = await prisma.journalArticle.create({ data: article({ slug: 'another-story' }) });
    await expectDbError(prisma.journalArticle.update({ where: { id: draft.id }, data: { status: 'PUBLISHED' } }), /ck_journal_published_at/);
    await prisma.journalArticle.update({ where: { id: draft.id }, data: { status: 'ARCHIVED' } }); // an archived article needs no moment
  });

  it('only knows the three statuses', async () => {
    await expect(prisma.$executeRawUnsafe("INSERT INTO journal_articles (id, slug, title_en, title_ar, tag_en, tag_ar, short_description_en, short_description_ar, body_en, body_ar, status, updated_at) VALUES (gen_random_uuid(), 'bad-status', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'COMING_SOON', now())")).rejects.toThrow(/journal_status|invalid input value for enum/);
  });

  it('removes an article\'s gallery rows with the article, and keeps the photos in the library', async () => {
    const [p1, p2] = [await photo('one'), await photo('two')];
    const a = await prisma.journalArticle.create({ data: article() });
    await prisma.journalArticleMedia.createMany({ data: [{ articleId: a.id, mediaId: p1.id, sortOrder: 0 }, { articleId: a.id, mediaId: p2.id, sortOrder: 1 }] });
    expect(await prisma.journalArticleMedia.count()).toBe(2);
    await prisma.journalArticle.delete({ where: { id: a.id } });
    expect(await prisma.journalArticleMedia.count()).toBe(0);
    expect(await prisma.media.count({ where: { id: { in: [p1.id, p2.id] } } })).toBe(2);
  });

  it('lists a photo once per article, and refuses to erase a photo that is in a gallery', async () => {
    const p = await photo('shared');
    const a = await prisma.journalArticle.create({ data: article() });
    const b = await prisma.journalArticle.create({ data: article({ slug: 'second-story' }) });
    await prisma.journalArticleMedia.create({ data: { articleId: a.id, mediaId: p.id } });
    await prisma.journalArticleMedia.create({ data: { articleId: b.id, mediaId: p.id } }); // the same photo may illustrate two articles
    await expectDbError(prisma.journalArticleMedia.create({ data: { articleId: a.id, mediaId: p.id } }), /Unique constraint|journal_article_media/);
    await expectDbError(prisma.media.delete({ where: { id: p.id } }), /Foreign key constraint|journal_article_media/);
  });

  it('lets a cover go quietly if its photo is erased for good (the article stays, without a cover)', async () => {
    const p = await photo('cover');
    const a = await prisma.journalArticle.create({ data: article({ coverMediaId: p.id }) });
    await prisma.media.delete({ where: { id: p.id } });
    expect((await prisma.journalArticle.findUniqueOrThrow({ where: { id: a.id } })).coverMediaId).toBeNull();
  });

  it('is not one of the guarded history tables: articles can be edited and removed by the database owner', async () => {
    const a = await prisma.journalArticle.create({ data: article() });
    await prisma.journalArticle.update({ where: { id: a.id }, data: { titleEn: 'Edited' } });
    await prisma.journalArticle.delete({ where: { id: a.id } });
    expect(await prisma.journalArticle.count()).toBe(0);
  });
});
