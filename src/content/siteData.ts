import type { Lang, SiteContent } from './types'

/** The response of GET /public/site (see docs/park-cms.md). */
export interface PublicSite {
  park: {
    nameEn: string
    nameAr: string
    taglineEn: string | null
    taglineAr: string | null
    descriptionEn: string | null
    descriptionAr: string | null
    stats: Array<{ value: string; labelEn: string; labelAr: string }>
  }
  contact: {
    addressEn: string
    addressAr: string
    phones: string[]
    fax: string | null
    email: string | null
    mapsUrl: string | null
    latitude: number | null
    longitude: number | null
    socialLinks: Record<string, string>
  }
  hours: {
    weekly: Array<{ dayOfWeek: number; isClosed: boolean; opens: string | null; closes: string | null }>
    special: Array<{
      kind: 'HOLIDAY' | 'TEMPORARY_CLOSURE' | 'SPECIAL_HOURS'
      dateFrom: string
      dateTo: string
      isClosed: boolean
      opens: string | null
      closes: string | null
      labelEn: string
      labelAr: string
      noteEn: string | null
      noteAr: string | null
    }>
    today: {
      date: string
      isClosed: boolean
      opens: string | null
      closes: string | null
      special: { kind: string; labelEn: string; labelAr: string } | null
    }
  }
  updatedAt: string
}

const WORDS = {
  en: { daily: 'Daily', closed: 'Closed', closedToday: 'Closed today', to: '–', dash: ' – ' },
  ar: { daily: 'يوميًا', closed: 'مغلق', closedToday: 'مغلقة اليوم', to: '–', dash: ' – ' },
} as const

const locale = (lang: Lang) => (lang === 'ar' ? 'ar-EG' : 'en-US')

/** '09:00' → '9:00 AM' / '٩:٠٠ ص' (always the park's own wall-clock time; no time-zone conversion). */
export function formatTime(hhmm: string, lang: Lang): string {
  const [h, m] = hhmm.split(':').map(Number)
  return new Intl.DateTimeFormat(locale(lang), { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, 0, 1, h, m)),
  )
}

export function formatRange(opens: string, closes: string, lang: Lang): string {
  return `${formatTime(opens, lang)}${WORDS[lang].dash}${formatTime(closes, lang)}`
}

/** 'Sunday' / 'الأحد' for dayOfWeek 0–6 (0 = Sunday). */
function dayName(dayOfWeek: number, lang: Lang): string {
  // 2023-01-01 was a Sunday
  return new Intl.DateTimeFormat(locale(lang), { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + dayOfWeek)))
}

/** '2027-03-10' → '10 Mar 2027' / '١٠ مارس ٢٠٢٧'. */
export function formatDate(iso: string, lang: Lang, withYear = true): string {
  const [y, mo, d] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, mo - 1, d)),
  )
}

export function formatDateRange(from: string, to: string, lang: Lang): string {
  return from === to ? formatDate(from, lang) : `${formatDate(from, lang, from.slice(0, 4) !== to.slice(0, 4))}${WORDS[lang].dash}${formatDate(to, lang)}`
}

interface HoursGroup {
  days: number[]
  closed: boolean
  opens: string | null
  closes: string | null
}

/** Consecutive weekdays with identical hours are shown together ("Sunday – Thursday"). */
export function groupWeekly(weekly: PublicSite['hours']['weekly']): HoursGroup[] {
  const sorted = [...weekly].sort((a, b) => a.dayOfWeek - b.dayOfWeek)
  const groups: HoursGroup[] = []
  for (const d of sorted) {
    const last = groups[groups.length - 1]
    const same = last && last.closed === d.isClosed && last.opens === d.opens && last.closes === d.closes && last.days[last.days.length - 1] === d.dayOfWeek - 1
    if (same) last.days.push(d.dayOfWeek)
    else groups.push({ days: [d.dayOfWeek], closed: d.isClosed, opens: d.opens, closes: d.closes })
  }
  return groups
}

function groupValue(g: HoursGroup, lang: Lang): string {
  return g.closed || !g.opens || !g.closes ? WORDS[lang].closed : formatRange(g.opens, g.closes, lang)
}

/** The weekly hours as display rows: one row ("Daily") when every day is the same, otherwise one per group of days. */
export function weeklyRows(weekly: PublicSite['hours']['weekly'], lang: Lang): Array<{ label: string; value: string }> {
  const groups = groupWeekly(weekly)
  if (groups.length === 1 && groups[0].days.length === 7) return [{ label: WORDS[lang].daily, value: groupValue(groups[0], lang) }]
  return groups.map((g) => ({
    label: g.days.length === 1 ? dayName(g.days[0], lang) : `${dayName(g.days[0], lang)}${WORDS[lang].dash}${dayName(g.days[g.days.length - 1], lang)}`,
    value: groupValue(g, lang),
  }))
}

/** Special periods as display rows: "Eid al-Fitr · 10 Mar – 12 Mar 2027" → hours or "Closed". */
export function specialRows(special: PublicSite['hours']['special'], today: string, lang: Lang, limit = 5): Array<{ label: string; value: string }> {
  return special
    .filter((s) => s.dateTo >= today)
    .slice(0, limit)
    .map((s) => ({
      label: `${lang === 'ar' ? s.labelAr : s.labelEn} · ${formatDateRange(s.dateFrom, s.dateTo, lang)}`,
      value: s.isClosed || !s.opens || !s.closes ? WORDS[lang].closed : formatRange(s.opens, s.closes, lang),
    }))
}

/** One-line summary: "Daily, 9:00 AM – 10:00 PM" or, when days differ, the rows joined with "·". */
export function weeklySummary(weekly: PublicSite['hours']['weekly'], lang: Lang): string {
  const rows = weeklyRows(weekly, lang)
  return rows.length === 1 ? `${rows[0].label}${lang === 'ar' ? '، ' : ', '}${rows[0].value}` : rows.map((r) => `${r.label}: ${r.value}`).join(' · ')
}

export function todayValue(site: PublicSite, lang: Lang): string {
  const t = site.hours.today
  if (t.isClosed || !t.opens || !t.closes) return WORDS[lang].closedToday
  return formatRange(t.opens, t.closes, lang)
}

/**
 * Lays the live values over the built-in content. Anything the API does not provide (or provides empty) keeps
 * the built-in text, so a half-filled portal can never blank out a page.
 */
export function applySiteData(content: SiteContent, site: PublicSite | null, lang: Lang): SiteContent {
  if (!site) return content
  const { park, contact, hours } = site
  const ar = lang === 'ar'

  const stats = park.stats.length > 0 ? park.stats.map((s) => ({ value: s.value, label: ar ? s.labelAr : s.labelEn })) : content.stats
  const address = (ar ? contact.addressAr : contact.addressEn) || content.contact.address
  const phones = contact.phones.length > 0 ? contact.phones : content.contact.phones
  const email = contact.email ?? ''
  const fax = contact.fax ?? ''
  const summary = hours.weekly.length === 7 ? weeklySummary(hours.weekly, lang) : content.visitTeaser.hours
  const rows = hours.weekly.length === 7 ? [...weeklyRows(hours.weekly, lang), ...specialRows(hours.special, hours.today.date, lang)] : content.visit.hours

  return {
    ...content,
    stats,
    visitorBar: { ...content.visitorBar, hoursValue: hours.weekly.length === 7 ? todayValue(site, lang) : content.visitorBar.hoursValue },
    visitTeaser: { ...content.visitTeaser, hours: summary, address },
    visit: { ...content.visit, hours: rows },
    contact: { ...content.contact, address, phones, email, fax },
  }
}

const FALLBACK_PLACE = 'Al-Azhar Park, Salah Salem Street, Cairo, Egypt'
const FALLBACK_MAPS_URL = 'https://www.google.com/maps?cid=13021591783999119538'

export interface SiteLinks {
  mapsUrl: string
  directionsUrl: string
  embedUrl: (lang: Lang) => string
}

/** Map links: exact coordinates when the portal has them, otherwise the address, otherwise the built-in listing. */
export function siteLinks(site: PublicSite | null): SiteLinks {
  const c = site?.contact
  const point = c && c.latitude !== null && c.longitude !== null ? `${c.latitude},${c.longitude}` : null
  const place = point ?? encodeURIComponent(c?.addressEn ? `Al-Azhar Park, ${c.addressEn}` : FALLBACK_PLACE)
  return {
    mapsUrl: c?.mapsUrl || FALLBACK_MAPS_URL,
    directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${place}`,
    embedUrl: (lang) => `https://www.google.com/maps?q=${place}&hl=${lang}&z=15&output=embed`,
  }
}
