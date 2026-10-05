import { parkDateOf, parkMoment } from './calendar';
import { eventWindow, parkInstant } from './event-window';

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
