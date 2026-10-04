import { addDays, parkMoment } from './calendar';
import { resolveHours, SpecialHours, WeeklyHours } from './opening-hours';

export interface SalesPolicy {
  /** system setting `booking.sameDayCutoffMinutesBeforeClose` (the park's rule: 60) */
  sameDayCutoffMinutesBeforeClose: number;
  /** system setting `booking.maxAdvanceDays` */
  maxAdvanceDays: number;
}

export type SaleDecision =
  | { allowed: true; salesCloseAtMinutes: number | null }
  | { allowed: false; reason: 'PAST_DATE' | 'TOO_FAR_AHEAD' | 'PARK_CLOSED' | 'SALES_CLOSED_FOR_TODAY' };

/**
 * Can a ticket for `visitDate` be sold at instant `now`?
 *
 *  • a past date can never be sold;
 *  • a future date can be sold, up to `maxAdvanceDays` ahead, if the park is open that day;
 *  • TODAY can be sold until exactly `sameDayCutoffMinutesBeforeClose` before the closing time of today —
 *    the closing time comes from the opening-hours configuration (weekly hours and special dates), so
 *    "22:00 → stop at 21:00" is a consequence of the data, not a constant.
 *    The cut-off is exclusive: at 21:00:00 sales are already closed, at 20:59:59 they are open.
 */
export function evaluateSale(input: {
  now: Date;
  visitDate: string;
  weekly: readonly WeeklyHours[];
  special: readonly SpecialHours[];
  policy: SalesPolicy;
}): SaleDecision {
  const { now, visitDate, weekly, special, policy } = input;
  const today = parkMoment(now);

  if (visitDate < today.date) return { allowed: false, reason: 'PAST_DATE' };
  if (visitDate > addDays(today.date, policy.maxAdvanceDays)) return { allowed: false, reason: 'TOO_FAR_AHEAD' };

  const hours = resolveHours(visitDate, weekly, special);
  if (hours.isClosed || hours.closesMinutes === null) return { allowed: false, reason: 'PARK_CLOSED' };

  if (visitDate === today.date) {
    const cutoffMinutes = hours.closesMinutes - policy.sameDayCutoffMinutesBeforeClose;
    if (today.secondsOfDay >= cutoffMinutes * 60) return { allowed: false, reason: 'SALES_CLOSED_FOR_TODAY' };
    return { allowed: true, salesCloseAtMinutes: cutoffMinutes };
  }
  return { allowed: true, salesCloseAtMinutes: null };
}
