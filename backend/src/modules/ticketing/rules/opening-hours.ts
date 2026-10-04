import { dayOfWeekOf, hhmmToMinutes } from './calendar';

/** One row of `opening_hours`: the regular hours for a weekday (0 = Sunday … 6 = Saturday). */
export interface WeeklyHours {
  dayOfWeek: number;
  opens: string | null; // 'HH:MM'
  closes: string | null;
  isClosed: boolean;
}

/** One row of `special_hours`: an exception (holiday, Ramadan, closure, event) over a date range. */
export interface SpecialHours {
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;
  opens: string | null;
  closes: string | null;
  isClosed: boolean;
  priority: number;
  isActive: boolean;
}

export interface DayHours {
  isClosed: boolean;
  opensMinutes: number | null;
  closesMinutes: number | null;
  source: 'WEEKLY' | 'SPECIAL' | 'NONE';
}

/**
 * The hours that apply on a date: the highest-priority active special-hours row covering the date wins
 * (a later start date breaks ties); otherwise the weekday's regular hours. No row at all means closed —
 * the safe default, so a missing configuration can never sell tickets for a day nobody planned to open.
 */
export function resolveHours(date: string, weekly: readonly WeeklyHours[], special: readonly SpecialHours[]): DayHours {
  const covering = special
    .filter((s) => s.isActive && s.dateFrom <= date && date <= s.dateTo)
    .sort((a, b) => b.priority - a.priority || (a.dateFrom < b.dateFrom ? 1 : a.dateFrom > b.dateFrom ? -1 : 0))[0];

  const row = covering ?? weekly.find((w) => w.dayOfWeek === dayOfWeekOf(date));
  const source: DayHours['source'] = covering ? 'SPECIAL' : row ? 'WEEKLY' : 'NONE';

  if (!row || row.isClosed || !row.opens || !row.closes) {
    return { isClosed: true, opensMinutes: null, closesMinutes: null, source };
  }
  return { isClosed: false, opensMinutes: hhmmToMinutes(row.opens), closesMinutes: hhmmToMinutes(row.closes), source };
}
