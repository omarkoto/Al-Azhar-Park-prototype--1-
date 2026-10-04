import { cairoInstant } from '../../../../test/helpers/cairo';
import { SpecialHours, WeeklyHours } from './opening-hours';
import { evaluateSale, SalesPolicy } from './sales-window';

const weekly = (opens = '09:00', closes = '22:00'): WeeklyHours[] =>
  [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, opens, closes, isClosed: false }));
const policy: SalesPolicy = { sameDayCutoffMinutesBeforeClose: 60, maxAdvanceDays: 90 };

const sale = (now: Date, visitDate: string, over: Partial<{ weekly: WeeklyHours[]; special: SpecialHours[]; policy: SalesPolicy }> = {}) =>
  evaluateSale({ now, visitDate, weekly: over.weekly ?? weekly(), special: over.special ?? [], policy: over.policy ?? policy });

describe('same-day ticket sales stop exactly 1 hour before closing', () => {
  const day = '2026-10-04'; // a Sunday, summer time

  it('is open all morning and afternoon', () => {
    expect(sale(cairoInstant(day, '07:00'), day)).toMatchObject({ allowed: true }); // even before opening
    expect(sale(cairoInstant(day, '12:00'), day)).toMatchObject({ allowed: true });
  });

  it('closes at 21:00 for a 22:00 closing time — 20:59:59 still sells, 21:00:00 does not', () => {
    expect(sale(cairoInstant(day, '20:59:59'), day)).toEqual({ allowed: true, salesCloseAtMinutes: 21 * 60 });
    expect(sale(cairoInstant(day, '21:00:00'), day)).toEqual({ allowed: false, reason: 'SALES_CLOSED_FOR_TODAY' });
    expect(sale(cairoInstant(day, '21:30'), day)).toEqual({ allowed: false, reason: 'SALES_CLOSED_FOR_TODAY' });
    expect(sale(cairoInstant(day, '23:59:59'), day)).toEqual({ allowed: false, reason: 'SALES_CLOSED_FOR_TODAY' });
  });

  it('uses winter time correctly too (UTC+2)', () => {
    const winter = '2026-12-06';
    expect(sale(cairoInstant(winter, '20:59:59'), winter)).toMatchObject({ allowed: true });
    expect(sale(cairoInstant(winter, '21:00:00'), winter)).toMatchObject({ allowed: false });
  });

  it('takes the closing time from the configured hours, not from a constant', () => {
    const friday = '2026-10-09';
    const lateFridays = weekly().map((w) => (w.dayOfWeek === 5 ? { ...w, closes: '23:30' } : w));
    // Friday closes at 23:30 → sales stop at 22:30
    expect(sale(cairoInstant(friday, '22:29:59'), friday, { weekly: lateFridays })).toMatchObject({ allowed: true });
    expect(sale(cairoInstant(friday, '22:30:00'), friday, { weekly: lateFridays })).toMatchObject({ allowed: false });
    // the same moment on a normal day is long closed
    expect(sale(cairoInstant('2026-10-08', '22:30'), '2026-10-08', { weekly: lateFridays })).toMatchObject({ allowed: false });
  });

  it('follows special opening hours (Ramadan, events)', () => {
    const ramadan: SpecialHours = {
      dateFrom: '2027-02-08', dateTo: '2027-03-09', opens: '10:00', closes: '23:59', isClosed: false, priority: 0, isActive: true,
    };
    const d = '2027-02-20';
    expect(sale(cairoInstant(d, '22:58:59'), d, { special: [ramadan] })).toMatchObject({ allowed: true });
    expect(sale(cairoInstant(d, '22:59:00'), d, { special: [ramadan] })).toMatchObject({ allowed: false });
  });

  it('honours the configurable cut-off setting (the rule is 60 minutes today)', () => {
    const p = { ...policy, sameDayCutoffMinutesBeforeClose: 30 };
    expect(sale(cairoInstant(day, '21:29:59'), day, { policy: p })).toMatchObject({ allowed: true });
    expect(sale(cairoInstant(day, '21:30:00'), day, { policy: p })).toMatchObject({ allowed: false });
  });
});

describe('other sales limits', () => {
  const now = cairoInstant('2026-10-04', '10:00');

  it('sells future dates freely, even late at night, while the park is open that day', () => {
    expect(sale(cairoInstant('2026-10-04', '23:30'), '2026-10-05')).toEqual({ allowed: true, salesCloseAtMinutes: null });
  });

  it('never sells a date that has passed', () => {
    expect(sale(now, '2026-10-03')).toEqual({ allowed: false, reason: 'PAST_DATE' });
  });

  it('does not sell a day the park is closed (holiday, closure, closed weekday)', () => {
    const closure: SpecialHours = {
      dateFrom: '2026-10-10', dateTo: '2026-10-10', opens: null, closes: null, isClosed: true, priority: 0, isActive: true,
    };
    expect(sale(now, '2026-10-10', { special: [closure] })).toEqual({ allowed: false, reason: 'PARK_CLOSED' });
    expect(sale(now, '2026-10-11', { special: [closure] })).toMatchObject({ allowed: true });
  });

  it('does not sell beyond the advance-booking window', () => {
    expect(sale(now, '2027-01-02')).toMatchObject({ allowed: true }); // exactly 90 days ahead
    expect(sale(now, '2027-01-03')).toEqual({ allowed: false, reason: 'TOO_FAR_AHEAD' });
  });

  it('refuses everything when no hours are configured at all', () => {
    expect(sale(now, '2026-10-05', { weekly: [] })).toEqual({ allowed: false, reason: 'PARK_CLOSED' });
  });
});
