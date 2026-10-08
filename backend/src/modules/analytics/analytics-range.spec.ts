import { AppException } from '../../common/errors/app-exception';
import { bucketOf, bucketsOf, resolveRange, weekStart } from './analytics-range';

const TODAY = '2026-10-07'; // a Wednesday
const resolve = (input: Parameters<typeof resolveRange>[0], today = TODAY, max = 366) => resolveRange(input, today, max);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as AppException).code;
  }
  return null;
};

describe('ready-made ranges (worked out from the Cairo calendar)', () => {
  it('today, yesterday, last 7 days, last 30 days', () => {
    expect(resolve({ range: 'today' })).toMatchObject({ key: 'today', from: '2026-10-07', to: '2026-10-07', days: 1 });
    expect(resolve({ range: 'yesterday' })).toMatchObject({ from: '2026-10-06', to: '2026-10-06', days: 1 });
    expect(resolve({ range: 'last7' })).toMatchObject({ from: '2026-10-01', to: '2026-10-07', days: 7 });
    expect(resolve({ range: 'last30' })).toMatchObject({ from: '2026-09-08', to: '2026-10-07', days: 30 });
  });

  it('this month runs from the 1st to today; previous month is the whole month before', () => {
    expect(resolve({ range: 'thisMonth' })).toMatchObject({ from: '2026-10-01', to: '2026-10-07', days: 7 });
    expect(resolve({ range: 'lastMonth' })).toMatchObject({ from: '2026-09-01', to: '2026-09-30', days: 30 });
    expect(resolve({ range: 'thisMonth' }, '2026-10-01')).toMatchObject({ from: '2026-10-01', to: '2026-10-01', days: 1 });
  });

  it('crosses month and year boundaries correctly', () => {
    expect(resolve({ range: 'lastMonth' }, '2027-01-15')).toMatchObject({ from: '2026-12-01', to: '2026-12-31', days: 31 });
    expect(resolve({ range: 'lastMonth' }, '2026-03-02')).toMatchObject({ from: '2026-02-01', to: '2026-02-28', days: 28 });
    expect(resolve({ range: 'lastMonth' }, '2028-03-02')).toMatchObject({ from: '2028-02-01', to: '2028-02-29', days: 29 }); // a leap year
    expect(resolve({ range: 'last7' }, '2027-01-03')).toMatchObject({ from: '2026-12-28', to: '2027-01-03' });
    expect(resolve({ range: 'yesterday' }, '2027-01-01')).toMatchObject({ from: '2026-12-31', to: '2026-12-31' });
  });

  it('defaults to the last 7 days', () => {
    expect(resolve({})).toMatchObject({ key: 'last7', days: 7 });
  });
});

describe('the instants a range covers (start included, end excluded)', () => {
  it('runs from Cairo midnight to the next Cairo midnight', () => {
    const r = resolve({ range: 'today' });
    expect(r.start.toISOString()).toBe('2026-10-06T21:00:00.000Z'); // UTC+3
    expect(r.end.toISOString()).toBe('2026-10-07T21:00:00.000Z');
    expect(new Date(r.end.getTime() - 1).toISOString()).toBe('2026-10-07T20:59:59.999Z'); // the last millisecond of the 7th
  });

  it('is in winter time after the October change, and spans the 25-hour day exactly', () => {
    const r = resolve({ from: '2026-10-29', to: '2026-10-29' });
    expect((r.end.getTime() - r.start.getTime()) / 3_600_000).toBe(25);
    expect(resolve({ from: '2026-12-07', to: '2026-12-07' }).start.toISOString()).toBe('2026-12-06T22:00:00.000Z');
  });

  it('spans the 23-hour day in spring, where there is no midnight, without failing', () => {
    for (const date of ['2026-04-24', '2027-04-30']) {
      const r = resolve({ from: date, to: date });
      expect((r.end.getTime() - r.start.getTime()) / 3_600_000).toBe(23);
    }
  });

  it('a multi-day range is exactly the days it names, across the clock change', () => {
    const r = resolve({ from: '2026-10-28', to: '2026-10-31' });
    expect(r.days).toBe(4);
    expect((r.end.getTime() - r.start.getTime()) / 3_600_000).toBe(24 + 25 + 24 + 24);
  });
});

describe('custom ranges', () => {
  it('accepts a valid range, including one in the future (visits can be booked ahead)', () => {
    expect(resolve({ from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ key: 'custom', days: 31 });
    expect(resolve({ from: '2026-11-01', to: '2026-12-31' }).days).toBe(61);
    expect(resolve({ from: '2026-10-07', to: '2026-10-07' }).days).toBe(1);
  });

  it('refuses an incomplete, reversed, impossible or out-of-range request', () => {
    expect(code(() => resolve({ from: '2026-10-01' }))).toBe('INVALID_RANGE');
    expect(code(() => resolve({ to: '2026-10-01' }))).toBe('INVALID_RANGE');
    expect(code(() => resolve({ from: '2026-10-08', to: '2026-10-01' }))).toBe('INVALID_RANGE');
    expect(code(() => resolve({ from: '2026-02-30', to: '2026-03-01' }))).toBe('INVALID_RANGE');
    expect(code(() => resolve({ from: 'yesterday', to: 'today' }))).toBe('INVALID_RANGE');
    expect(code(() => resolve({ from: '1999-12-31', to: '2000-01-02' }))).toBe('INVALID_RANGE');
    expect(code(() => resolve({ from: '2026-01-01', to: '2101-01-01' }))).toBe('INVALID_RANGE');
    expect(code(() => resolve({ range: 'custom' }))).toBe('INVALID_RANGE');
    expect(code(() => resolve({ range: 'last7', from: '2026-10-01', to: '2026-10-02' }))).toBe('INVALID_RANGE');
  });

  it('refuses a range longer than the maximum, and says what the maximum is', () => {
    expect(resolve({ from: '2026-01-01', to: '2026-12-31' }, TODAY, 365).days).toBe(365);
    expect(code(() => resolve({ from: '2026-01-01', to: '2027-01-01' }, TODAY, 365))).toBe('INVALID_RANGE');
    expect(() => resolve({ from: '2026-01-01', to: '2027-01-01' }, TODAY, 365)).toThrow(/at most 365 days/);
    expect(code(() => resolve({ range: 'last30' }, TODAY, 20))).toBe('INVALID_RANGE');
  });
});

describe('grouping over time', () => {
  it('chooses day, week or month by the length of the range, unless told', () => {
    expect(resolve({ range: 'last30' }).granularity).toBe('day');
    expect(resolve({ from: '2026-01-01', to: '2026-03-03' }).granularity).toBe('day'); // 62 days
    expect(resolve({ from: '2026-01-01', to: '2026-03-04' }).granularity).toBe('week'); // 63 days
    expect(resolve({ from: '2026-01-01', to: '2026-12-31' }).granularity).toBe('month');
    expect(resolve({ range: 'last30', groupBy: 'week' }).granularity).toBe('week');
  });

  it('weeks start on Monday and months on the 1st', () => {
    expect(weekStart('2026-10-07')).toBe('2026-10-05'); // Wednesday → Monday
    expect(weekStart('2026-10-05')).toBe('2026-10-05');
    expect(weekStart('2026-10-11')).toBe('2026-10-05'); // Sunday belongs to the week that began on Monday
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
    expect(bucketOf('2026-10-31', 'month')).toBe('2026-10-01');
    expect(bucketOf('2026-10-31', 'day')).toBe('2026-10-31');
  });

  it('lists every bucket in order, so a quiet day is a zero and not a gap', () => {
    expect(bucketsOf(resolve({ range: 'last7' }))).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']);
    expect(bucketsOf(resolve({ from: '2026-10-01', to: '2026-10-20', groupBy: 'week' }))).toEqual(['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
    expect(bucketsOf(resolve({ from: '2026-08-15', to: '2026-10-07', groupBy: 'month' }))).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(bucketsOf(resolve({ from: '2026-12-30', to: '2027-01-02' }))).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
});
