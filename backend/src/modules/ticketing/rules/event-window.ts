import { addDays, hhmmToMinutes, parkMoment } from './calendar';

/**
 * The exact instant at which the clocks in Cairo read `date` + `hhmm`. Works in summer (UTC+3) and winter (UTC+2)
 * time. Two edge cases of daylight-saving changes:
 *  - a wall-clock time that is skipped (the hour lost when clocks go forward) does not exist: this throws;
 *  - a wall-clock time that happens twice (the hour repeated when clocks go back) resolves to its FIRST occurrence.
 */
export function parkInstant(date: string, hhmm: string): Date {
  for (const offsetHours of [3, 2]) {
    const candidate = new Date(new Date(`${date}T${hhmm}:00Z`).getTime() - offsetHours * 3_600_000);
    const m = parkMoment(candidate);
    const minutes = Math.floor(m.secondsOfDay / 60);
    if (m.date === date && minutes === hhmmToMinutes(hhmm) && m.secondsOfDay % 60 === 0) return candidate;
  }
  throw new Error(`The time ${hhmm} does not exist in Cairo on ${date} (clocks change that night).`);
}

/**
 * The first instant of a Cairo calendar day. Normally that is 00:00, but on the last Friday of April the clocks go from
 * 00:00 straight to 01:00, so that day has no midnight and starts at 01:00 (`parkInstant(date, '00:00')` throws there).
 * Use this for "from the start of the day" boundaries; the end of a day is the start of the next one.
 */
export function parkDayStart(date: string): Date {
  try {
    return parkInstant(date, '00:00');
  } catch {
    return parkInstant(date, '01:00');
  }
}

export interface EventWindow {
  startsAt: Date;
  endsAt: Date;
  /** the event ends on the day after it starts (for example 20:00 – 01:00) */
  crossesMidnight: boolean;
}

/**
 * An event is stored as two full timestamps, so it can end after midnight without any special case in the
 * database. This turns what an editor types ("on 10 Oct, from 20:00 to 01:00") into those timestamps: when the
 * end time is not later than the start time, the event ends the next day. An event is at most 24 hours long this
 * way; longer or multi-day events give the end date explicitly.
 *
 * The event still BELONGS to the day it starts on (the Cairo date of `startsAt`), even after midnight.
 */
export function eventWindow(date: string, startHhmm: string, endHhmm: string): EventWindow {
  const crossesMidnight = hhmmToMinutes(endHhmm) <= hhmmToMinutes(startHhmm);
  return {
    startsAt: parkInstant(date, startHhmm),
    endsAt: parkInstant(crossesMidnight ? addDays(date, 1) : date, endHhmm),
    crossesMidnight,
  };
}
