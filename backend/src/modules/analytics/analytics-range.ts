import { AppException } from '../../common/errors/app-exception';
import { addDays, dayOfWeekOf } from '../ticketing/rules/calendar';
import { parkDayStart } from '../ticketing/rules/event-window';

export const RANGE_PRESETS = ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'lastMonth'] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export type RangeKey = RangePreset | 'custom';
export type Granularity = 'day' | 'week' | 'month';

/**
 * A period of whole Cairo calendar days, both ends included (`from` 1 October and `to` 7 October is seven days).
 * `start` is the first instant of `from` and `end` the first instant AFTER `to` (the start of the next Cairo day), so a
 * timestamp is inside when `start <= t < end`. Those are the only bounds the queries use; the browser never builds them.
 */
export interface ResolvedRange {
  key: RangeKey;
  from: string;
  to: string;
  days: number;
  start: Date;
  end: Date;
  granularity: Granularity;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const invalid = (message: string) => new AppException('INVALID_RANGE', message, 422);

const isRealDate = (v: string) => DATE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const firstOfMonth = (iso: string) => `${iso.slice(0, 8)}01`;
const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1;

/** day for up to about two months, week for up to about six, month beyond that, unless the caller chooses. */
export function autoGranularity(days: number): Granularity {
  return days <= 62 ? 'day' : days <= 183 ? 'week' : 'month';
}

/**
 * Turns "last 7 days", "this month" or an explicit from/to into a validated range, relative to today in Cairo.
 *  - presets are worked out HERE from the park's calendar, never from the visitor's computer;
 *  - a custom range needs both dates, real calendar dates, from not after to, and at most `maxDays` days;
 *  - this month runs from the 1st to today; previous month is the whole of the month before.
 */
export function resolveRange(input: { range?: RangeKey; from?: string; to?: string; groupBy?: Granularity }, today: string, maxDays: number): ResolvedRange {
  let key: RangeKey;
  let from: string;
  let to: string;
  const custom = input.from !== undefined || input.to !== undefined;
  if (custom) {
    if (input.range && input.range !== 'custom') throw invalid('Choose either a ready-made range or a from and to date, not both.');
    if (!input.from || !input.to) throw invalid('A custom range needs both a from date and a to date.');
    if (!isRealDate(input.from) || !isRealDate(input.to)) throw invalid('Dates must be real calendar dates like 2026-10-31.');
    if (input.from < '2000-01-01' || input.to > '2100-12-31') throw invalid('Dates must be between the years 2000 and 2100.');
    if (input.from > input.to) throw invalid('The from date cannot be after the to date.');
    [key, from, to] = ['custom', input.from, input.to];
  } else {
    key = input.range ?? 'last7';
    if (key === 'custom') throw invalid('A custom range needs both a from date and a to date.');
    switch (key) {
      case 'today': [from, to] = [today, today]; break;
      case 'yesterday': [from, to] = [addDays(today, -1), addDays(today, -1)]; break;
      case 'last7': [from, to] = [addDays(today, -6), today]; break;
      case 'last30': [from, to] = [addDays(today, -29), today]; break;
      case 'thisMonth': [from, to] = [firstOfMonth(today), today]; break;
      case 'lastMonth': {
        const lastOfPrevious = addDays(firstOfMonth(today), -1);
        [from, to] = [firstOfMonth(lastOfPrevious), lastOfPrevious];
        break;
      }
    }
  }
  const days = daysBetween(from, to);
  if (days > maxDays) throw invalid(`A report can cover at most ${maxDays} days. Choose a shorter period.`);
  return { key, from, to, days, start: parkDayStart(from), end: parkDayStart(addDays(to, 1)), granularity: input.groupBy ?? autoGranularity(days) };
}

/** The Monday of the week a date falls in (weeks start on Monday, like PostgreSQL's date_trunc). */
export function weekStart(date: string): string {
  const dow = dayOfWeekOf(date); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

/** The first day of the bucket a date falls in. */
export function bucketOf(date: string, g: Granularity): string {
  return g === 'day' ? date : g === 'week' ? weekStart(date) : firstOfMonth(date);
}

/** Every bucket from the start of the range to its end, in order, so a quiet day shows as zero rather than being missing. */
export function bucketsOf(range: Pick<ResolvedRange, 'from' | 'to' | 'granularity'>): string[] {
  const out: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    const b = bucketOf(d, range.granularity);
    if (out[out.length - 1] !== b) out.push(b);
  }
  return out;
}
