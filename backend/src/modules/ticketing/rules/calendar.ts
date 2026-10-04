/**
 * The park's calendar. Everything that depends on "today", "this hour" or "which day is it" is evaluated in
 * Africa/Cairo (Egypt observes daylight-saving time), never in the server's or the browser's time zone.
 */
export const PARK_TIME_ZONE = 'Africa/Cairo';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: PARK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export interface ParkMoment {
  /** YYYY-MM-DD in Cairo */
  date: string;
  /** seconds since Cairo midnight (0 – 86399) */
  secondsOfDay: number;
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
}

export function parkMoment(instant: Date): ParkMoment {
  const p: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) p[part.type] = part.value;
  const date = `${p.year}-${p.month}-${p.day}`;
  return {
    date,
    secondsOfDay: Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second),
    dayOfWeek: dayOfWeekOf(date),
  };
}

/** The Cairo calendar day an instant falls on. */
export const parkDateOf = (instant: Date): string => parkMoment(instant).date;

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD calendar date. */
export function dayOfWeekOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 'HH:MM' → minutes since midnight. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** PostgreSQL `time` / `date` columns reach us as Date objects pinned to UTC. */
export const timeToHhmm = (d: Date): string => d.toISOString().slice(11, 16);
export const dateToIso = (d: Date): string => d.toISOString().slice(0, 10);
