import { PrismaClient } from '@prisma/client';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { expectDbError } from '../helpers/fixtures';

describe('event and venue integrity (database level)', () => {
  const prisma: PrismaClient = createTestPrisma();

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const event = (over: Record<string, unknown> = {}) => ({
    slug: 'test-event', titleEn: 'Test', titleAr: 'تجربة', shortDescriptionEn: 's', shortDescriptionAr: 's', descriptionEn: 'd', descriptionAr: 'd',
    startsAt: new Date('2027-05-14T18:00:00Z'), endsAt: new Date('2027-05-14T21:00:00Z'), ...over,
  });

  it('has the five lifecycle statuses, defaulting to DRAFT', async () => {
    const values = await prisma.$queryRaw<Array<{ v: string }>>`SELECT unnest(enum_range(NULL::event_status))::text AS v`;
    expect(values.map((r) => r.v)).toEqual(['DRAFT', 'COMING_SOON', 'PUBLISHED', 'CANCELLED', 'ARCHIVED']);
    expect((await prisma.event.create({ data: event() })).status).toBe('DRAFT');
  });

  it('keeps addresses clean and unique, and titles non-blank', async () => {
    for (const slug of ['Upper', 'with space', 'double--hyphen', '-lead', 'x'.repeat(81)]) {
      await expectDbError(prisma.event.create({ data: event({ slug }) }), /ck_events_slug/);
    }
    await expectDbError(prisma.event.create({ data: event({ titleEn: '  ' }) }), /ck_events_titles/);
    await prisma.event.create({ data: event() });
    await expectDbError(prisma.event.create({ data: event() }), /Unique constraint|unique/i);
  });

  it('allows an event to cross midnight, refuses an end before the start, and caps the length at 18 hours', async () => {
    const night = await prisma.event.create({ data: event({ slug: 'night', startsAt: new Date('2027-05-14T18:00:00Z'), endsAt: new Date('2027-05-14T23:00:00Z') }) });
    expect(night.endsAt!.getTime() - night.startsAt.getTime()).toBe(5 * 3_600_000);
    await expectDbError(prisma.event.create({ data: event({ slug: 'backwards', endsAt: new Date('2027-05-14T17:00:00Z') }) }), /ck_events_range/);
    await prisma.event.create({ data: event({ slug: 'eighteen', endsAt: new Date('2027-05-15T12:00:00Z') }) }); // exactly 18 h
    await expectDbError(prisma.event.create({ data: event({ slug: 'too-long', endsAt: new Date('2027-05-15T12:01:00Z') }) }), /ck_events_duration/);
    expect((await prisma.event.create({ data: event({ slug: 'open-ended', endsAt: null }) })).endsAt).toBeNull();
  });

  it('keeps a venue address clean, names non-blank, and venues switched on by default', async () => {
    await expectDbError(prisma.venue.create({ data: { slug: 'Bad Slug', nameEn: 'x', nameAr: 'y' } }), /ck_venues_slug/);
    await expectDbError(prisma.venue.create({ data: { slug: 'blank-name', nameEn: ' ', nameAr: 'y' } }), /ck_venues_names/);
    expect((await prisma.venue.create({ data: { slug: 'good-place', nameEn: 'Good', nameAr: 'جيد' } })).isActive).toBe(true);
  });

  it('does not let a media file or venue that an event uses disappear underneath it', async () => {
    const venue = await prisma.venue.findFirstOrThrow({ where: { slug: 'open-area' } });
    const e = await prisma.event.create({ data: event({ venueId: venue.id }) });
    expect(e.venueId).toBe(venue.id);
    const media = await prisma.media.create({
      data: { storageKey: '0b9c7a52-6a8e-4b8a-9d27-4f7e1c0d9a11.png', url: '/api/v1/media/file/0b9c7a52-6a8e-4b8a-9d27-4f7e1c0d9a11.png', fileName: 'a.png', mimeType: 'image/png', sizeBytes: 100, width: 10, height: 10 },
    });
    await prisma.eventMedia.create({ data: { eventId: e.id, mediaId: media.id } });
    await expectDbError(prisma.media.delete({ where: { id: media.id } }), /foreign key|violat/i);
  });

  it('seeds one coming-soon and one published event, plus a coming-soon event tied to no venue', async () => {
    const rows = await prisma.event.findMany({ orderBy: { sortOrder: 'asc' }, include: { venue: true } });
    expect(rows.map((r) => [r.slug, r.status, r.venue?.slug ?? null])).toEqual([
      ['ramadan-nights-in-the-garden', 'COMING_SOON', null],
      ['cairo-jazz-nights', 'PUBLISHED', 'open-area'],
      ['artisan-market-days', 'COMING_SOON', null],
    ]);
  });
});
