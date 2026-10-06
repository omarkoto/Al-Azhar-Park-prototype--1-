import { assetUrl } from '../lib/api'
import { formatTime } from './siteData'
import type { ComingSoonEvent, Lang, SiteContent } from './types'

/** One entry of GET /public/events, /public/events/coming-soon or /public/events/:slug. */
export interface PublicEvent {
  slug: string
  status: 'COMING_SOON' | 'PUBLISHED'
  titleEn: string
  titleAr: string
  shortDescriptionEn: string
  shortDescriptionAr: string
  descriptionEn: string
  descriptionAr: string
  eventDate: string
  startTime: string | null
  endTime: string | null
  crossesMidnight: boolean
  startsAt: string
  endsAt: string | null
  dateLabelEn: string | null
  dateLabelAr: string | null
  timeLabelEn: string | null
  timeLabelAr: string | null
  venue: { slug: string; nameEn: string; nameAr: string; addressEn: string | null; addressAr: string | null } | null
  locationNameEn: string | null
  locationNameAr: string | null
  isFeatured: boolean
  hero: { url: string; width: number | null; height: number | null; altEn: string | null; altAr: string | null } | null
  gallery: Array<{ url: string; width: number | null; height: number | null; altEn: string | null; altAr: string | null; captionEn: string | null; captionAr: string | null }>
}

/** Shown when an event has no main photo and the site has no built-in picture for it. */
const PLACEHOLDER_IMAGE = 'events-hero.webp'

const locale = (lang: Lang) => (lang === 'ar' ? 'ar-EG' : 'en-GB')

/** "Fri 20 November 2026" / "الجمعة ٢٠ نوفمبر ٢٠٢٦" — the date as a calendar day, never shifted by the visitor's time zone. */
export function eventDateText(isoDate: string, lang: Lang): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat(locale(lang), { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}

/** "8:00 PM – 1:00 AM", or "" for a date-only event. */
export function eventTimeText(e: Pick<PublicEvent, 'startTime' | 'endTime'>, lang: Lang): string {
  return e.startTime && e.endTime ? `${formatTime(e.startTime, lang)} – ${formatTime(e.endTime, lang)}` : ''
}

/** Where: the venue (a place in the park), else the free-text location. */
export function eventWhere(e: PublicEvent, lang: Lang): string {
  const ar = lang === 'ar'
  return (e.venue ? (ar ? e.venue.nameAr : e.venue.nameEn) : ar ? e.locationNameAr : e.locationNameEn) || ''
}

/** End of the calendar entry: the real end, or one day after a date-only event's start. */
const calendarEnd = (e: PublicEvent) => e.endsAt ?? new Date(new Date(e.startsAt).getTime() + 24 * 3_600_000).toISOString()

/**
 * An API event in the shape the website's cards and detail page already use. Photos, wording and labels typed in the
 * portal win; a built-in photo for the same address is kept when no photo was uploaded.
 */
export function toSiteEvent(e: PublicEvent, lang: Lang, statusLabel: string, builtIn?: ComingSoonEvent): ComingSoonEvent {
  const ar = lang === 'ar'
  return {
    id: e.slug,
    slug: e.slug,
    title: ar ? e.titleAr : e.titleEn,
    description: ar ? e.shortDescriptionAr : e.shortDescriptionEn,
    body: ar ? e.descriptionAr : e.descriptionEn,
    image: e.hero ? assetUrl(e.hero.url) : (builtIn?.image ?? PLACEHOLDER_IMAGE),
    date: (ar ? e.dateLabelAr : e.dateLabelEn) || eventDateText(e.eventDate, lang),
    time: (ar ? e.timeLabelAr : e.timeLabelEn) || eventTimeText(e, lang),
    startsAt: e.startsAt,
    endsAt: calendarEnd(e),
    location: eventWhere(e, lang),
    status: statusLabel,
    featured: e.isFeatured || undefined,
    gallery: e.gallery.map((g) => assetUrl(g.url)),
  }
}

/**
 * The backend is the source of truth for event records. When the API answered, its coming-soon list IS the site's
 * "Coming soon" list (an event switched to draft, cancelled or archived disappears; an empty list hides the strip).
 * When the API is not configured or not reachable (null), the built-in list stays, so the page never breaks.
 */
export function applyEvents(content: SiteContent, comingSoon: PublicEvent[] | null, lang: Lang): SiteContent {
  if (!comingSoon) return content
  const builtIn = new Map(content.comingSoon.events.map((e) => [e.slug, e]))
  return {
    ...content,
    comingSoon: { ...content.comingSoon, events: comingSoon.map((e) => toSiteEvent(e, lang, content.comingSoon.badge, builtIn.get(e.slug))) },
  }
}
