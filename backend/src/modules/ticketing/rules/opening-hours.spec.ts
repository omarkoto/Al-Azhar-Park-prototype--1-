import { resolveHours, SpecialHours, WeeklyHours } from './opening-hours';

const week = (opens = '09:00', closes = '22:00'): WeeklyHours[] =>
  [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, opens, closes, isClosed: false }));

const special = (over: Partial<SpecialHours>): SpecialHours => ({
  dateFrom: '2027-02-08', dateTo: '2027-03-09', opens: '10:00', closes: '23:00', isClosed: false, priority: 0, isActive: true, ...over,
});

describe('opening hours', () => {
  it('uses 09:00–22:00 every day by default', () => {
    for (const date of ['2026-10-04', '2026-10-05', '2026-10-09', '2026-10-10']) {
      expect(resolveHours(date, week(), [])).toEqual({ isClosed: false, opensMinutes: 540, closesMinutes: 1320, source: 'WEEKLY' });
    }
  });

  it('lets any single weekday differ', () => {
    const weekly = week().map((w) => (w.dayOfWeek === 5 ? { ...w, opens: '10:00', closes: '23:00' } : w));
    expect(resolveHours('2026-10-09', weekly, []).closesMinutes).toBe(23 * 60); // Friday
    expect(resolveHours('2026-10-08', weekly, []).closesMinutes).toBe(22 * 60); // Thursday
  });

  it('lets a weekday be closed', () => {
    const weekly = week().map((w) => (w.dayOfWeek === 1 ? { ...w, isClosed: true, opens: null, closes: null } : w));
    expect(resolveHours('2026-10-05', weekly, []).isClosed).toBe(true); // Monday
  });

  it('applies special dates (Ramadan, holidays) over the weekly hours, only inside their range', () => {
    const ramadan = special({});
    expect(resolveHours('2027-02-20', week(), [ramadan])).toMatchObject({ closesMinutes: 23 * 60, source: 'SPECIAL' });
    expect(resolveHours('2027-02-07', week(), [ramadan])).toMatchObject({ closesMinutes: 22 * 60, source: 'WEEKLY' });
    expect(resolveHours('2027-03-09', week(), [ramadan]).source).toBe('SPECIAL'); // last day is included
    expect(resolveHours('2027-03-10', week(), [ramadan]).source).toBe('WEEKLY');
  });

  it('closes the park on a temporary closure', () => {
    const closure = special({ dateFrom: '2026-11-01', dateTo: '2026-11-01', isClosed: true, opens: null, closes: null });
    expect(resolveHours('2026-11-01', week(), [closure]).isClosed).toBe(true);
    expect(resolveHours('2026-11-02', week(), [closure]).isClosed).toBe(false);
  });

  it('lets the higher-priority exception win when two overlap (a holiday inside Ramadan)', () => {
    const ramadan = special({ priority: 0 });
    const eid = special({ dateFrom: '2027-03-09', dateTo: '2027-03-09', priority: 10, opens: '08:00', closes: '23:59' });
    expect(resolveHours('2027-03-09', week(), [ramadan, eid])).toMatchObject({ opensMinutes: 480, closesMinutes: 1439 });
    expect(resolveHours('2027-03-09', week(), [eid, ramadan]).opensMinutes).toBe(480); // order does not matter
  });

  it('ignores inactive exceptions', () => {
    expect(resolveHours('2027-02-20', week(), [special({ isActive: false })]).source).toBe('WEEKLY');
  });

  it('treats a day with no configuration as closed (never sells for an unplanned day)', () => {
    expect(resolveHours('2026-10-04', [], [])).toEqual({ isClosed: true, opensMinutes: null, closesMinutes: null, source: 'NONE' });
  });
});
