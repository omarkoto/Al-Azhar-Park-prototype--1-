import { hhmmToMinutes, parkMoment } from '../ticketing/rules/calendar';
import { eventWindow, parkInstant } from '../ticketing/rules/event-window';

/** An event lasts at most this long (also a database CHECK). Longer or multi-day events use a date label. */
export const MAX_EVENT_HOURS = 18;

export type EventTimeProblem =
  | 'TIMES_TOGETHER' // only one of start / end was given
  | 'SAME_TIME' // start and end are the same minute
  | 'TOO_LONG' // longer than 18 hours
  | 'NONEXISTENT_TIME'; // a clock time skipped by a daylight-saving change

export interface ResolvedTimes {
  startsAt: Date;
  /** null for a date-only event (no times given) */
  endsAt: Date | null;
  crossesMidnight: boolean;
}

export class EventTimeError extends Error {
  constructor(
    readonly problem: EventTimeProblem,
    message: string,
  ) {
    super(message);
  }
}

/**
 * What an editor types ("on 20 Nov, from 20:00 to 01:00") → the two timestamps stored in the database.
 *  - Times are Cairo wall-clock times; the stored instants are DST-correct.
 *  - An end time earlier than the start time means the event runs past midnight and ends the next day.
 *  - Start and end come together. With neither, the event is date-only: it starts at midnight and has no end.
 *  - Equal times, or more than 18 hours, are refused.
 */
export function resolveEventTimes(input: { date: string; startTime?: string | null; endTime?: string | null }): ResolvedTimes {
  const { date, startTime, endTime } = input;
  if (Boolean(startTime) !== Boolean(endTime)) {
    throw new EventTimeError('TIMES_TOGETHER', 'Give both the start time and the end time, or neither.');
  }
  try {
    if (!startTime || !endTime) return { startsAt: parkInstant(date, '00:00'), endsAt: null, crossesMidnight: false };
    if (hhmmToMinutes(startTime) === hhmmToMinutes(endTime)) {
      throw new EventTimeError('SAME_TIME', 'The end time must differ from the start time.');
    }
    const w = eventWindow(date, startTime, endTime);
    if (w.endsAt.getTime() - w.startsAt.getTime() > MAX_EVENT_HOURS * 3_600_000) {
      throw new EventTimeError('TOO_LONG', `An event can last at most ${MAX_EVENT_HOURS} hours. For longer or multi-day events, use a date label.`);
    }
    return { startsAt: w.startsAt, endsAt: w.endsAt, crossesMidnight: w.crossesMidnight };
  } catch (e) {
    if (e instanceof EventTimeError) throw e;
    throw new EventTimeError('NONEXISTENT_TIME', (e as Error).message);
  }
}

export interface DescribedTimes {
  /** the Cairo calendar day the event starts on (an event after midnight still belongs to this day) */
  date: string;
  startTime: string | null;
  endTime: string | null;
  crossesMidnight: boolean;
}

const hhmm = (d: Date) => {
  const m = parkMoment(d);
  return `${String(Math.floor(m.secondsOfDay / 3600)).padStart(2, '0')}:${String(Math.floor((m.secondsOfDay % 3600) / 60)).padStart(2, '0')}`;
};

/** The inverse of resolveEventTimes: stored timestamps → date and Cairo wall-clock times. */
export function describeEventTimes(startsAt: Date, endsAt: Date | null): DescribedTimes {
  const start = parkMoment(startsAt);
  if (!endsAt) return { date: start.date, startTime: null, endTime: null, crossesMidnight: false };
  return { date: start.date, startTime: hhmm(startsAt), endTime: hhmm(endsAt), crossesMidnight: parkMoment(endsAt).date !== start.date };
}
