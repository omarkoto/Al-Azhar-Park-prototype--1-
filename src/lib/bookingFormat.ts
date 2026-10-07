import { useLanguage } from './language'

type Named = { nameEn: string; nameAr: string }

/** How booking information is written for the visitor: their language, their digits, the park's clock. */
export function useBookingFormat() {
  const { lang } = useLanguage()
  const locale = lang === 'ar' ? 'ar-EG' : 'en-US'
  return {
    lang,
    /** the English or Arabic name of a ticket type, audience or order line */
    name: (item: Named) => (lang === 'ar' ? item.nameAr : item.nameEn),
    /** 2 → "2" or "٢" */
    digits: (n: number) => (lang === 'ar' ? n.toLocaleString('ar-EG') : String(n)),
    /** "21:00" → "9:00 PM" / "٩:٠٠ م" */
    clock: (hhmm: string | null) => (hhmm ? formatClock(hhmm, locale) : ''),
    /** "2026-10-08" → "Thursday, October 8, 2026" (a calendar day, shown the same wherever the visitor is) */
    day: (iso: string) => formatDay(iso, locale),
  }
}

export function formatClock(hhmm: string, locale: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) return hhmm
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(Date.UTC(1970, 0, 1, Number(m[1]), Number(m[2]))))
}

export function formatDay(iso: string, locale: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  return new Intl.DateTimeFormat(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`))
}

/** The calendar day after an ISO date. */
export function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
