import { parkMoment } from '../../src/modules/ticketing/rules/calendar';

/**
 * The exact instant at which the clocks in Cairo read `date` + `time` ('HH:MM' or 'HH:MM:SS').
 * Works in summer (UTC+3) and winter (UTC+2) time, so tests can say "20:59:59 in Cairo on 1 July".
 */
export function cairoInstant(date: string, time: string): Date {
  const t = time.length === 5 ? `${time}:00` : time;
  for (const offsetHours of [3, 2]) {
    const candidate = new Date(new Date(`${date}T${t}Z`).getTime() - offsetHours * 3_600_000);
    const m = parkMoment(candidate);
    const hh = String(Math.floor(m.secondsOfDay / 3600)).padStart(2, '0');
    const mm = String(Math.floor((m.secondsOfDay % 3600) / 60)).padStart(2, '0');
    const ss = String(m.secondsOfDay % 60).padStart(2, '0');
    if (m.date === date && `${hh}:${mm}:${ss}` === t) return candidate;
  }
  throw new Error(`Cannot build a Cairo instant for ${date} ${time} (non-existent local time?)`);
}
