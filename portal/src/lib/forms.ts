export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

// ───────────────────────────── contact ─────────────────────────────

export interface ContactData {
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

export const SOCIAL_KEYS = ['facebook', 'instagram', 'x', 'youtube', 'tiktok', 'linkedin'] as const

export interface ContactForm {
  addressEn: string
  addressAr: string
  phones: string // one per line
  fax: string
  email: string
  mapsUrl: string
  latitude: string
  longitude: string
  social: Record<string, string>
}

export function contactToForm(c: ContactData): ContactForm {
  return {
    addressEn: c.addressEn, addressAr: c.addressAr, phones: c.phones.join('\n'), fax: c.fax ?? '', email: c.email ?? '', mapsUrl: c.mapsUrl ?? '',
    latitude: c.latitude === null ? '' : String(c.latitude), longitude: c.longitude === null ? '' : String(c.longitude),
    social: Object.fromEntries(SOCIAL_KEYS.map((k) => [k, c.socialLinks[k] ?? ''])),
  }
}

const num = (v: string): number | null => {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : Number.NaN
}

export function formToContact(f: ContactForm) {
  return {
    addressEn: f.addressEn.trim(),
    addressAr: f.addressAr.trim(),
    phones: f.phones.split('\n').map((p) => p.trim()).filter(Boolean),
    fax: f.fax.trim() || null,
    email: f.email.trim() || null,
    mapsUrl: f.mapsUrl.trim() || null,
    latitude: num(f.latitude),
    longitude: num(f.longitude),
    socialLinks: Object.fromEntries(SOCIAL_KEYS.map((k) => [k, f.social[k]?.trim() || null])),
  }
}

// ───────────────────────────── park information ─────────────────────────────

export interface Stat {
  value: string
  labelEn: string
  labelAr: string
}

export interface ParkData {
  nameEn: string
  nameAr: string
  taglineEn: string | null
  taglineAr: string | null
  descriptionEn: string | null
  descriptionAr: string | null
  stats: Stat[]
}

export function formToPark(f: { [K in keyof ParkData]: ParkData[K] extends string | null ? string : ParkData[K] }) {
  return {
    nameEn: f.nameEn.trim(), nameAr: f.nameAr.trim(),
    taglineEn: f.taglineEn.trim() || null, taglineAr: f.taglineAr.trim() || null,
    descriptionEn: f.descriptionEn.trim() || null, descriptionAr: f.descriptionAr.trim() || null,
    stats: f.stats.map((s) => ({ value: s.value.trim(), labelEn: s.labelEn.trim(), labelAr: s.labelAr.trim() })),
  }
}

// ───────────────────────────── opening hours ─────────────────────────────

export interface WeeklyDay {
  dayOfWeek: number
  isClosed: boolean
  opens: string | null
  closes: string | null
}

export function weeklyPayload(days: WeeklyDay[]) {
  return {
    days: days.map((d) => ({ dayOfWeek: d.dayOfWeek, isClosed: d.isClosed, opens: d.isClosed ? null : d.opens || null, closes: d.isClosed ? null : d.closes || null })),
  }
}

/** Copies one day's hours onto the chosen days (the common "same every day" case). */
export function copyDay(days: WeeklyDay[], from: number, to: number[]): WeeklyDay[] {
  const src = days.find((d) => d.dayOfWeek === from)
  if (!src) return days
  return days.map((d) => (to.includes(d.dayOfWeek) ? { ...d, isClosed: src.isClosed, opens: src.opens, closes: src.closes } : d))
}

export type SpecialKind = 'HOLIDAY' | 'TEMPORARY_CLOSURE' | 'SPECIAL_HOURS'

export interface SpecialData {
  id: string
  kind: SpecialKind
  dateFrom: string
  dateTo: string
  isClosed: boolean
  opens: string | null
  closes: string | null
  labelEn: string
  labelAr: string
  noteEn: string | null
  noteAr: string | null
  priority: number
  isActive: boolean
}

export const KIND_LABELS: Record<SpecialKind, string> = {
  HOLIDAY: 'Holiday',
  SPECIAL_HOURS: 'Special hours (e.g. Ramadan)',
  TEMPORARY_CLOSURE: 'Temporary closure',
}

export function emptySpecial(today: string): Omit<SpecialData, 'id'> {
  return {
    kind: 'HOLIDAY', dateFrom: today, dateTo: today, isClosed: false, opens: '09:00', closes: '22:00',
    labelEn: '', labelAr: '', noteEn: '', noteAr: '', priority: 10, isActive: true,
  }
}

export function specialPayload(s: Omit<SpecialData, 'id'>) {
  const closed = s.kind === 'TEMPORARY_CLOSURE' || s.isClosed
  return {
    kind: s.kind, dateFrom: s.dateFrom, dateTo: s.dateTo, isClosed: closed,
    opens: closed ? null : s.opens || null, closes: closed ? null : s.closes || null,
    labelEn: s.labelEn.trim(), labelAr: s.labelAr.trim(), noteEn: s.noteEn?.trim() || null, noteAr: s.noteAr?.trim() || null,
    priority: Number(s.priority), isActive: s.isActive,
  }
}

/** The park's calendar day in Cairo, as YYYY-MM-DD (so "today" is right even if the editor's laptop is elsewhere). */
export function cairoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
