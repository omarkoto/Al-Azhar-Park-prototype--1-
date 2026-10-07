import { useTranslation } from 'react-i18next'
import { useBookingFormat } from '../lib/bookingFormat'
import type { Catalog } from '../lib/booking'

/** The rules a visitor should know before paying: free under 2, valid only on the chosen date, no refunds, the payment window. */
export function BookingNotes({ catalog, className }: { catalog: Catalog | null; className?: string }) {
  const { t } = useTranslation()
  const f = useBookingFormat()
  return (
    <ul className={`space-y-1.5 text-xs leading-relaxed text-ink-900/65 ${className ?? ''}`} data-testid="booking-notes">
      <li>• {t('bookUnder2', { age: f.digits(catalog?.freeUnderAge ?? 2) })}</li>
      <li>• {t('bookValidOnly')}</li>
      <li>• {t('bookNoRefunds')}</li>
      {catalog ? <li>• {t('bookHold', { minutes: f.digits(catalog.policy.pendingExpiryMinutes) })}</li> : null}
    </ul>
  )
}

/** Why a date cannot be booked, or when today's online sales stop. */
export function DayNotice({ day }: { day: { sale: { allowed: boolean; reason?: string; salesCloseAt?: string | null }; opens: string | null; closes: string | null } }) {
  const { t } = useTranslation()
  const f = useBookingFormat()
  if (!day.sale.allowed) {
    const key = ({ DATE_IN_THE_PAST: 'bookErrPast', DATE_TOO_FAR_AHEAD: 'bookErrTooFar', PARK_CLOSED: 'bookErrClosed', SALES_CLOSED_FOR_TODAY: 'bookErrCutoff' } as Record<string, string>)[day.sale.reason ?? ''] ?? 'bookErrGeneric'
    return (
      <p role="alert" data-testid="day-problem" className="mt-3 rounded-xl border border-red-700/20 bg-red-50 px-4 py-3 text-sm text-red-900">
        {t(key)}
      </p>
    )
  }
  return (
    <div className="mt-3 space-y-1 text-sm text-ink-900/65" data-testid="day-info">
      {day.opens && day.closes ? <p>{t('bookHours', { opens: f.clock(day.opens), closes: f.clock(day.closes) })}</p> : null}
      {day.sale.salesCloseAt ? <p className="font-medium text-gold-700">{t('bookCutoffToday', { time: f.clock(day.sale.salesCloseAt) })}</p> : null}
    </div>
  )
}
