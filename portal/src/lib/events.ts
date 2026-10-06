import type { MediaItem } from './restaurants'

export const STATUSES = ['DRAFT', 'COMING_SOON', 'PUBLISHED', 'CANCELLED', 'ARCHIVED'] as const
export type EventStatus = (typeof STATUSES)[number]

export const STATUS_LABEL: Record<EventStatus, string> = {
  DRAFT: 'Draft',
  COMING_SOON: 'Coming soon',
  PUBLISHED: 'Published',
  CANCELLED: 'Cancelled',
  ARCHIVED: 'Archived',
}

export const STATUS_HELP: Record<EventStatus, string> = {
  DRAFT: 'Only visible in this portal.',
  COMING_SOON: 'Shown publicly in the “Coming soon” section.',
  PUBLISHED: 'Shown publicly in the events listing, with its own page.',
  CANCELLED: 'Hidden from the public.',
  ARCHIVED: 'Hidden from the public.',
}

/** The same table as the server's. A hint for which buttons to show; the server decides what is allowed. */
export const TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  DRAFT: ['COMING_SOON', 'PUBLISHED', 'ARCHIVED'],
  COMING_SOON: ['PUBLISHED', 'DRAFT', 'CANCELLED', 'ARCHIVED'],
  PUBLISHED: ['COMING_SOON', 'DRAFT', 'CANCELLED', 'ARCHIVED'],
  CANCELLED: ['DRAFT', 'ARCHIVED'],
  ARCHIVED: ['DRAFT'],
}

export interface StatusAction {
  to: EventStatus
  label: string
  /** needs a confirmation: it hides a public event, or is hard to notice later */
  confirm?: string
  tone: 'primary' | 'secondary' | 'danger'
}

/** The buttons for an event's status panel, in the order they should appear. */
export function statusActions(from: EventStatus): StatusAction[] {
  const labels: Record<EventStatus, (f: EventStatus) => Omit<StatusAction, 'to'>> = {
    COMING_SOON: () => ({ label: 'Mark as coming soon', tone: 'secondary' }),
    PUBLISHED: () => ({ label: 'Publish', tone: 'primary' }),
    DRAFT: (f) => (f === 'CANCELLED' || f === 'ARCHIVED' ? { label: 'Restore as draft', tone: 'secondary' } : { label: 'Move back to draft', tone: 'secondary', confirm: 'Hide this event from the website and make it a draft?' }),
    CANCELLED: () => ({ label: 'Cancel event', tone: 'danger', confirm: 'Cancel this event? It disappears from the website.' }),
    ARCHIVED: () => ({ label: 'Archive', tone: 'secondary', confirm: 'Archive this event? It disappears from the website.' }),
  }
  const order: EventStatus[] = ['PUBLISHED', 'COMING_SOON', 'DRAFT', 'CANCELLED', 'ARCHIVED']
  return order.filter((to) => TRANSITIONS[from].includes(to)).map((to) => ({ to, ...labels[to](from) }))
}

export interface VenueRef {
  id: string
  slug: string
  nameEn: string
  nameAr: string
  isActive: boolean
}

export interface VenueData extends VenueRef {
  descriptionEn: string | null
  descriptionAr: string | null
  addressEn: string | null
  addressAr: string | null
  capacity: number | null
  sortOrder: number
  eventCount: number
}

export interface EventData {
  id: string
  slug: string
  status: EventStatus
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
  venue: VenueRef | null
  locationNameEn: string | null
  locationNameAr: string | null
  dateLabelEn: string | null
  dateLabelAr: string | null
  timeLabelEn: string | null
  timeLabelAr: string | null
  isFeatured: boolean
  sortOrder: number
  hero: MediaItem | null
  gallery: Array<{ media: MediaItem; captionEn: string | null; captionAr: string | null }>
  publishedAt: string | null
  updatedAt: string
}

export interface EventForm {
  slug: string
  titleEn: string
  titleAr: string
  shortDescriptionEn: string
  shortDescriptionAr: string
  descriptionEn: string
  descriptionAr: string
  eventDate: string
  startTime: string
  endTime: string
  venueId: string
  locationNameEn: string
  locationNameAr: string
  dateLabelEn: string
  dateLabelAr: string
  timeLabelEn: string
  timeLabelAr: string
  isFeatured: boolean
}

export const emptyEventForm = (today: string): EventForm => ({
  slug: '', titleEn: '', titleAr: '', shortDescriptionEn: '', shortDescriptionAr: '', descriptionEn: '', descriptionAr: '', eventDate: today,
  startTime: '20:00', endTime: '23:00', venueId: '', locationNameEn: '', locationNameAr: '', dateLabelEn: '', dateLabelAr: '', timeLabelEn: '', timeLabelAr: '', isFeatured: false,
})

export function eventToForm(e: EventData): EventForm {
  return {
    slug: e.slug, titleEn: e.titleEn, titleAr: e.titleAr, shortDescriptionEn: e.shortDescriptionEn, shortDescriptionAr: e.shortDescriptionAr,
    descriptionEn: e.descriptionEn, descriptionAr: e.descriptionAr, eventDate: e.eventDate, startTime: e.startTime ?? '', endTime: e.endTime ?? '',
    venueId: e.venue?.id ?? '', locationNameEn: e.locationNameEn ?? '', locationNameAr: e.locationNameAr ?? '', dateLabelEn: e.dateLabelEn ?? '',
    dateLabelAr: e.dateLabelAr ?? '', timeLabelEn: e.timeLabelEn ?? '', timeLabelAr: e.timeLabelAr ?? '', isFeatured: e.isFeatured,
  }
}

const blank = (v: string) => v.trim() || null

/** The body for POST/PUT /events. The main photo is kept as it is (it is changed in the Photos tab). */
export function formToEvent(f: EventForm, heroMediaId: string | null, includeSlug: boolean) {
  return {
    ...(includeSlug ? { slug: f.slug.trim() } : {}),
    titleEn: f.titleEn.trim(), titleAr: f.titleAr.trim(), shortDescriptionEn: f.shortDescriptionEn.trim(), shortDescriptionAr: f.shortDescriptionAr.trim(),
    descriptionEn: f.descriptionEn.trim(), descriptionAr: f.descriptionAr.trim(), eventDate: f.eventDate, startTime: blank(f.startTime), endTime: blank(f.endTime),
    venueId: blank(f.venueId), locationNameEn: blank(f.locationNameEn), locationNameAr: blank(f.locationNameAr), dateLabelEn: blank(f.dateLabelEn),
    dateLabelAr: blank(f.dateLabelAr), timeLabelEn: blank(f.timeLabelEn), timeLabelAr: blank(f.timeLabelAr), isFeatured: f.isFeatured, heroMediaId,
  }
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Hints shown under the time fields while typing (the server does the real checking). */
export function timeHint(start: string, end: string): { tone: 'info' | 'error'; text: string } | null {
  if (!start && !end) return { tone: 'info', text: 'No times: the event is shown by date only.' }
  if (!start || !end) return { tone: 'error', text: 'Give both a start and an end time, or leave both empty.' }
  const s = toMinutes(start)
  const e = toMinutes(end)
  if (s === e) return { tone: 'error', text: 'The end time must differ from the start time.' }
  if (e < s) {
    const hours = (24 * 60 - s + e) / 60
    if (hours > 18) return { tone: 'error', text: 'An event can last at most 18 hours.' }
    return { tone: 'info', text: `Ends after midnight, at ${end} the next day (${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours long).` }
  }
  return null
}

/** "Fri 20 Nov 2026 · 20:00 – 23:00" for the lists (labels typed by an editor win over the computed text). */
export function whenText(e: Pick<EventData, 'eventDate' | 'startTime' | 'endTime' | 'crossesMidnight' | 'dateLabelEn' | 'timeLabelEn'>): string {
  const [y, m, d] = e.eventDate.split('-').map(Number)
  const date = e.dateLabelEn || new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
  const time = e.timeLabelEn || (e.startTime && e.endTime ? `${e.startTime} – ${e.endTime}${e.crossesMidnight ? ' (+1 day)' : ''}` : '')
  return time ? `${date} · ${time}` : date
}

/** The list in its editors' order; reordering is only offered when the whole list is on screen. */
export function canReorder(filters: { search: string; status: string }, shown: number, total: number): boolean {
  return !filters.search.trim() && !filters.status && shown === total && total > 1
}
