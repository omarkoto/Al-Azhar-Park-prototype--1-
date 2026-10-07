import { dayOfWeekOf } from './calendar';

export interface PriceRow {
  id: string;
  ticketTypeId: string;
  audienceId: string;
  kind: 'STANDARD' | 'SPECIAL' | 'PROMOTIONAL';
  amountMinor: number;
  currency: string;
  priority: number;
  /** Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32, Sat=64 */
  dowMask: number;
  /** YYYY-MM-DD; when not empty the row applies ONLY on these dates */
  specialDates: readonly string[];
  validFrom: string;
  /** null = open ended */
  validTo: string | null;
  isActive: boolean;
  /** milliseconds since the epoch; breaks the last tie so the choice is always the same */
  createdAt: number;
}

export const DOW_WEEKDAY = 31; // Sun–Thu
export const DOW_WEEKEND = 96; // Fri–Sat
export const DOW_EVERY_DAY = 127;

/** The bit for a calendar day in a weekday mask (Sunday = 1 … Saturday = 64). */
export const dowBit = (date: string): number => 1 << dayOfWeekOf(date);

/** Sun–Thu are weekdays, Fri–Sat the weekend (the park's own split). */
export const dayTypeOf = (date: string): 'WEEKDAY' | 'WEEKEND' => ((dowBit(date) & DOW_WEEKEND) !== 0 ? 'WEEKEND' : 'WEEKDAY');

/**
 * The price that applies to one ticket type and audience on a visit date, from the price rows in the database.
 *
 *  - only active rows, inside their validity dates, on a weekday their mask includes, and — for a special-date
 *    row — only on one of its dates;
 *  - promotional rows (they need a promo code) are never chosen by an ordinary purchase;
 *  - if several rows match, the highest priority wins, then the latest start date, then the newest row, then the
 *    id, so the answer is always the same.
 * Returns null when no price is configured: such a ticket cannot be sold (it is never sold for 0).
 */
export function selectPrice(rows: readonly PriceRow[], query: { ticketTypeId: string; audienceId: string; date: string }): PriceRow | null {
  const bit = dowBit(query.date);
  const matching = rows.filter(
    (r) =>
      r.isActive &&
      r.kind !== 'PROMOTIONAL' &&
      r.ticketTypeId === query.ticketTypeId &&
      r.audienceId === query.audienceId &&
      r.validFrom <= query.date &&
      (r.validTo === null || query.date <= r.validTo) &&
      (r.dowMask & bit) !== 0 &&
      (r.specialDates.length === 0 || r.specialDates.includes(query.date)),
  );
  matching.sort((a, b) => b.priority - a.priority || (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0) || b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
  return matching[0] ?? null;
}
