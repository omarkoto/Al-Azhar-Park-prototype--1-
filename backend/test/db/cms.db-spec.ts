import { PrismaClient } from '@prisma/client';
import { createTestPrisma, resetDatabase, seedAll } from '../helpers/db';
import { eventWindow } from '../../src/modules/ticketing/rules';
import { expectDbError } from '../helpers/fixtures';

describe('park content integrity (database level)', () => {
  const prisma: PrismaClient = createTestPrisma();

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedAll(prisma);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const sp = (over: Record<string, unknown> = {}) => ({
    kind: 'HOLIDAY' as const, dateFrom: new Date('2027-03-10'), dateTo: new Date('2027-03-12'), opens: new Date('1970-01-01T08:00:00Z'),
    closes: new Date('1970-01-01T23:00:00Z'), labelEn: 'Eid', labelAr: 'العيد', priority: 10, ...over,
  });

  describe('contact information', () => {
    it('keeps coordinates valid and together', async () => {
      await expectDbError(prisma.contactInformation.update({ where: { id: 1 }, data: { latitude: 91, longitude: 10 } }), /ck_contact_coordinates|numeric field overflow/i);
      await expectDbError(prisma.contactInformation.update({ where: { id: 1 }, data: { latitude: 30, longitude: null } }), /ck_contact_coordinates/);
      await expectDbError(prisma.contactInformation.update({ where: { id: 1 }, data: { latitude: 30, longitude: 181 } }), /ck_contact_coordinates/);
      expect((await prisma.contactInformation.update({ where: { id: 1 }, data: { latitude: 30.04, longitude: 31.26 } })).latitude).not.toBeNull();
    });

    it('allows at most six phones and only an https map link', async () => {
      await expectDbError(prisma.contactInformation.update({ where: { id: 1 }, data: { phones: ['1', '2', '3', '4', '5', '6', '7'] } }), /ck_contact_phones_count/);
      await expectDbError(prisma.contactInformation.update({ where: { id: 1 }, data: { mapsUrl: 'http://maps.example' } }), /ck_contact_maps_https/);
      await expectDbError(prisma.contactInformation.update({ where: { id: 1 }, data: { mapsUrl: 'javascript:alert(1)' } }), /ck_contact_maps_https/);
    });

    it('stays a single row', async () => {
      await expectDbError(prisma.contactInformation.create({ data: { id: 2, addressEn: 'x', addressAr: 'y' } }), /ck_contact_information_singleton/);
    });
  });

  describe('park settings', () => {
    it('keeps statistics a JSON array and the table a single row', async () => {
      await expectDbError(prisma.parkSettings.update({ where: { id: 1 }, data: { stats: { not: 'an array' } } }), /ck_park_settings_stats_array/);
      await expectDbError(prisma.parkSettings.create({ data: { id: 2, nameEn: 'x', nameAr: 'y' } }), /ck_park_settings_singleton/);
    });
  });

  describe('opening hours', () => {
    it('refuses nonsense times and weekdays', async () => {
      await expectDbError(prisma.openingHour.update({ where: { dayOfWeek: 1 }, data: { opens: new Date('1970-01-01T22:00:00Z'), closes: new Date('1970-01-01T09:00:00Z') } }), /ck_opening_hours_times/);
      await expectDbError(prisma.openingHour.update({ where: { dayOfWeek: 1 }, data: { opens: null } }), /ck_opening_hours_times/);
      await expectDbError(prisma.openingHour.create({ data: { dayOfWeek: 7, opens: new Date('1970-01-01T09:00:00Z'), closes: new Date('1970-01-01T10:00:00Z') } }), /ck_opening_hours_day|Unique/);
    });
  });

  describe('special hours', () => {
    it('refuses blank labels, out-of-range priority, reversed dates and open-without-times', async () => {
      await expectDbError(prisma.specialHours.create({ data: sp({ labelEn: '  ' }) }), /ck_special_hours_labels/);
      await expectDbError(prisma.specialHours.create({ data: sp({ labelAr: '' }) }), /ck_special_hours_labels/);
      await expectDbError(prisma.specialHours.create({ data: sp({ priority: 101 }) }), /ck_special_hours_priority/);
      await expectDbError(prisma.specialHours.create({ data: sp({ priority: -1 }) }), /ck_special_hours_priority/);
      await expectDbError(prisma.specialHours.create({ data: sp({ dateFrom: new Date('2027-03-12'), dateTo: new Date('2027-03-10') }) }), /ck_special_hours_range/);
      await expectDbError(prisma.specialHours.create({ data: sp({ opens: null }) }), /ck_special_hours_times/);
    });

    it('does not let a temporary closure be marked open', async () => {
      await expectDbError(prisma.specialHours.create({ data: sp({ kind: 'TEMPORARY_CLOSURE', isClosed: false }) }), /ck_special_hours_closure/);
      expect((await prisma.specialHours.create({ data: sp({ kind: 'TEMPORARY_CLOSURE', isClosed: true, opens: null, closes: null }) })).isClosed).toBe(true);
    });

    it('refuses two ACTIVE periods with the same priority that share a day, even from simultaneous writers', async () => {
      await prisma.specialHours.create({ data: sp() });
      await expectDbError(prisma.specialHours.create({ data: sp({ dateFrom: new Date('2027-03-12'), dateTo: new Date('2027-03-14') }) }), /ex_special_hours_no_overlap/);

      const results = await Promise.allSettled(
        [1, 2, 3, 4, 5].map((i) => prisma.specialHours.create({ data: sp({ dateFrom: new Date('2027-08-01'), dateTo: new Date('2027-08-03'), labelEn: `Race ${i}` }) })),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });

    it('allows adjacent days, different priorities and inactive entries to coexist', async () => {
      await prisma.specialHours.create({ data: sp() });
      await prisma.specialHours.create({ data: sp({ dateFrom: new Date('2027-03-13'), dateTo: new Date('2027-03-14') }) }); // adjacent
      await prisma.specialHours.create({ data: sp({ priority: 50 }) }); // same days, higher priority
      await prisma.specialHours.create({ data: sp({ isActive: false }) }); // inactive draft
      expect(await prisma.specialHours.count()).toBe(4);
    });
  });

  describe('events can cross midnight', () => {
    const base = { slug: 'night-concert', titleEn: 'Night concert', titleAr: 'حفل ليلي', shortDescriptionEn: 's', shortDescriptionAr: 's', descriptionEn: 'd', descriptionAr: 'd' };

    it('stores an event from 20:00 to 01:00 the next day and keeps it on the day it starts', async () => {
      const w = eventWindow('2026-10-10', '20:00', '01:00');
      const e = await prisma.event.create({ data: { ...base, startsAt: w.startsAt, endsAt: w.endsAt } });
      expect(e.endsAt!.getTime() - e.startsAt.getTime()).toBe(5 * 3_600_000);
      const [row] = await prisma.$queryRaw<Array<{ starts: string; ends: string }>>`
        SELECT azharpark_date_of(starts_at)::text AS starts, azharpark_date_of(ends_at)::text AS ends FROM events WHERE id = ${e.id}::uuid`;
      expect(row).toEqual({ starts: '2026-10-10', ends: '2026-10-11' });
    });

    it('refuses an end that is not after the start, and allows an open-ended event', async () => {
      const w = eventWindow('2026-10-10', '20:00', '22:00');
      await expectDbError(prisma.event.create({ data: { ...base, startsAt: w.startsAt, endsAt: w.startsAt } }), /ck_events_range/);
      await expectDbError(prisma.event.create({ data: { ...base, startsAt: w.endsAt, endsAt: w.startsAt } }), /ck_events_range/);
      expect((await prisma.event.create({ data: { ...base, startsAt: w.startsAt, endsAt: null } })).endsAt).toBeNull();
    });
  });
});
