// Calendar helpers: a Google Calendar template link and a downloadable .ics file
// (opens in Apple/iOS Calendar, Outlook and most other calendar apps).

export interface CalendarEntry {
  title: string
  description?: string
  location?: string
  /** ISO 8601 with offset, e.g. 2026-11-20T20:00:00+02:00 */
  start: string
  end: string
}

const pad = (n: number) => String(n).padStart(2, '0')

function toUtcStamp(iso: string) {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function escapeIcs(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
}

/** UTC offset of Cairo on a `YYYY-MM-DD` date, in minutes (Egypt observes DST). */
export function cairoOffsetMinutes(dateStr: string): number {
  try {
    const label =
      new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', timeZoneName: 'longOffset' })
        .formatToParts(new Date(`${dateStr}T12:00:00Z`))
        .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+02:00'
    const m = label.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
    if (!m) return 120
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
  } catch {
    return 120
  }
}

/** ISO 8601 string for a Cairo-local time on `dateStr` (minutes after midnight), with the right DST offset. */
export function cairoIso(dateStr: string, minutes: number): string {
  const offset = cairoOffsetMinutes(dateStr)
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  const clamped = Math.min(Math.max(minutes, 0), 1439)
  return `${dateStr}T${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

export function googleCalendarUrl(entry: CalendarEntry) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: entry.title,
    dates: `${toUtcStamp(entry.start)}/${toUtcStamp(entry.end)}`,
    details: entry.description ?? '',
    location: entry.location ?? '',
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function buildIcs(entry: CalendarEntry) {
  const uid = `${toUtcStamp(entry.start)}-${entry.title.replace(/\W+/g, '-').toLowerCase()}@azharpark.com`
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Al-Azhar Park//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toUtcStamp(new Date().toISOString())}`,
    `DTSTART:${toUtcStamp(entry.start)}`,
    `DTEND:${toUtcStamp(entry.end)}`,
    `SUMMARY:${escapeIcs(entry.title)}`,
    entry.description ? `DESCRIPTION:${escapeIcs(entry.description)}` : '',
    entry.location ? `LOCATION:${escapeIcs(entry.location)}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n')
}

export function downloadIcs(entry: CalendarEntry, filename = 'event') {
  const blob = new Blob([buildIcs(entry)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  // iOS Safari only offers "Add to Calendar" when it navigates to the .ics itself;
  // a download attribute would just save the file to the Files app.
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (isIos) {
    window.location.href = url
    return
  }

  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
