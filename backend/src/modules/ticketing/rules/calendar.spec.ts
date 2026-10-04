import { cairoInstant } from '../../../../test/helpers/cairo';
import { addDays, dayOfWeekOf, hhmmToMinutes, minutesToHhmm, parkDateOf, parkMoment } from './calendar';

describe('park calendar (Africa/Cairo)', () => {
  it('reads the Cairo clock in summer time (UTC+3) and winter time (UTC+2)', () => {
    expect(parkMoment(new Date('2026-07-01T12:00:00Z'))).toMatchObject({ date: '2026-07-01', secondsOfDay: 15 * 3600 });
    expect(parkMoment(new Date('2026-12-01T12:00:00Z'))).toMatchObject({ date: '2026-12-01', secondsOfDay: 14 * 3600 });
  });

  it('moves to the next day at Cairo midnight, not UTC midnight', () => {
    // 21:30 UTC on 9 Oct is 00:30 on 10 Oct in Cairo (summer time)
    expect(parkDateOf(new Date('2026-10-09T21:30:00Z'))).toBe('2026-10-10');
    // 21:30 UTC on 1 Dec is 23:30 on 1 Dec (winter time)
    expect(parkDateOf(new Date('2026-12-01T21:30:00Z'))).toBe('2026-12-01');
    expect(parkDateOf(new Date('2026-12-01T22:00:01Z'))).toBe('2026-12-02');
  });

  it('builds exact Cairo instants for tests', () => {
    expect(parkMoment(cairoInstant('2026-10-10', '23:59:59'))).toMatchObject({ date: '2026-10-10', secondsOfDay: 86399 });
    expect(parkMoment(cairoInstant('2026-12-02', '00:00:00'))).toMatchObject({ date: '2026-12-02', secondsOfDay: 0 });
  });

  it('computes weekdays (0 = Sunday)', () => {
    expect(dayOfWeekOf('2026-10-04')).toBe(0); // Sunday
    expect(dayOfWeekOf('2026-10-09')).toBe(5); // Friday
    expect(dayOfWeekOf('2026-10-10')).toBe(6); // Saturday
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('converts HH:MM', () => {
    expect(hhmmToMinutes('22:00')).toBe(1320);
    expect(minutesToHhmm(1260)).toBe('21:00');
  });
});
