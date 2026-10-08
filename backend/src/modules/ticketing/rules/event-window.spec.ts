import { parkDateOf, parkMoment } from './calendar';
import { addDays } from './calendar';
import { eventWindow, parkDayStart, parkInstant } from './event-window';

const cairo = (d: Date) => {
  const m = parkMoment(d);
  return `${m.date} ${String(Math.floor(m.secondsOfDay / 3600)).padStart(2, '0')}:${String(Math.floor((m.secondsOfDay % 3600) / 60)).padStart(2, '0')}`;
};

describe('event windows', () => {
  it('keeps an evening event on one day', () => {
    const w = eventWindow('2026-10-10', '18:00', '21:30');
    expect(w.crossesMidnight).toBe(false);
    expect(cairo(w.startsAt)).toBe('2026-10-10 18:00');
    expect(cairo(w.endsAt)).toBe('2026-10-10 21:30');
  });

  it('lets an event run past midnight: 20:00 – 01:00 ends the next morning', () => {
    const w = eventWindow('2026-10-10', '20:00', '01:00');
    expect(w.crossesMidnight).toBe(true);
    expect(cairo(w.startsAt)).toBe('2026-10-10 20:00');
    expect(cairo(w.endsAt)).toBe('2026-10-11 01:00');
    expect(w.endsAt.getTime() - w.startsAt.getTime()).toBe(5 * 3_600_000);
  });

  it('crosses month and year boundaries', () => {
    expect(cairo(eventWindow('2026-12-31', '22:00', '02:00').endsAt)).toBe('2027-01-01 02:00');
    expect(cairo(eventWindow('2027-02-28', '23:00', '00:30').endsAt)).toBe('2027-03-01 00:30');
  });

  it('treats an end equal to the start as a full 24-hour event', () => {
    const w = eventWindow('2026-10-10', '09:00', '09:00');
    expect(w.endsAt.getTime() - w.startsAt.getTime()).toBe(24 * 3_600_000);
  });

  it('belongs to the day it starts on, even after midnight', () => {
    const w = eventWindow('2026-10-10', '20:00', '01:00');
    expect(parkDateOf(w.startsAt)).toBe('2026-10-10');
    expect(parkDateOf(w.endsAt)).toBe('2026-10-11');
  });

  it('is correct across the daylight-saving changes (duration is real elapsed time)', () => {
    // clocks go back at the end of Thursday 29 Oct 2026 (24:00 → 23:00): a 20:00 – 01:00 event lasts 6 real hours
    const back = eventWindow('2026-10-29', '20:00', '01:00');
    expect((back.endsAt.getTime() - back.startsAt.getTime()) / 3_600_000).toBe(6);
    // clocks go forward at the end of Thursday 23 Apr 2026 (24:00 → 01:00): the same event lasts 4 real hours
    const forward = eventWindow('2026-04-23', '20:00', '01:00');
    expect((forward.endsAt.getTime() - forward.startsAt.getTime()) / 3_600_000).toBe(4);
  });

  it('refuses a wall-clock time that does not exist, and uses the first of a time that happens twice', () => {
    expect(() => parkInstant('2026-04-24', '00:30')).toThrow(/does not exist/);
    const first = parkInstant('2026-10-29', '23:30'); // occurs twice that night
    expect(cairo(first)).toBe('2026-10-29 23:30');
    expect(first.toISOString()).toBe('2026-10-29T20:30:00.000Z'); // the UTC+3 (summer) occurrence
  });
});

describe('the start of a Cairo day', () => {
  const day = (iso: string) => parkMoment(parkDayStart(iso));

  it('is midnight on an ordinary day', () => {
    expect(parkDayStart('2026-10-07').toISOString()).toBe('2026-10-06T21:00:00.000Z'); // summer time, UTC+3
    expect(parkDayStart('2026-12-07').toISOString()).toBe('2026-12-06T22:00:00.000Z'); // winter time, UTC+2
    expect(day('2026-10-07')).toMatchObject({ date: '2026-10-07', secondsOfDay: 0 });
  });

  it('is 01:00 on the day clocks skip midnight (the last Friday of April), when parkInstant has no 00:00', () => {
    for (const date of ['2026-04-24', '2027-04-30']) {
      expect(() => parkInstant(date, '00:00')).toThrow();
      expect(day(date)).toMatchObject({ date, secondsOfDay: 3600 });
      // the instant before it still belongs to the previous day, so no moment is in two days and none in neither
      expect(parkDateOf(new Date(parkDayStart(date).getTime() - 1))).not.toBe(date);
    }
  });

  it('the days around a clock change tile time exactly: each day ends where the next begins, and none overlaps', () => {
    for (const [from, days] of [['2026-04-22', 5], ['2026-10-27', 6], ['2027-04-28', 5]] as const) {
      let date: string = from;
      for (let i = 0; i < days; i += 1) {
        const next = addDays(date, 1);
        const start = parkDayStart(date).getTime();
        const end = parkDayStart(next).getTime();
        expect(end).toBeGreaterThan(start);
        expect(parkDateOf(new Date(start))).toBe(date);
        expect(parkDateOf(new Date(end - 1))).toBe(date);
        expect(parkDateOf(new Date(end))).toBe(next);
        date = next;
      }
    }
  });

  it('measures the real length of the days at each change: 23 hours in spring, 25 in autumn', () => {
    const hours = (date: string) => (parkDayStart(addDays(date, 1)).getTime() - parkDayStart(date).getTime()) / 3_600_000;
    expect(hours('2026-04-24')).toBe(23);
    expect(hours('2026-10-29')).toBe(25);
    expect(hours('2026-10-07')).toBe(24);
  });
});
