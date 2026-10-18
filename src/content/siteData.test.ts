import { describe, expect, it } from 'vitest'
import { en } from './en'
import { ar } from './ar'
import {
  applySiteData,
  formatDateRange,
  formatTime,
  groupWeekly,
  siteLinks,
  specialRows,
  todayValue,
  weeklyRows,
  weeklySummary,
  type PublicSite,
} from './siteData'

const day = (dayOfWeek: number, opens = '09:00', closes = '22:00', isClosed = false) => ({
  dayOfWeek,
  isClosed,
  opens: isClosed ? null : opens,
  closes: isClosed ? null : closes,
})
const everyDay = [0, 1, 2, 3, 4, 5, 6].map((d) => day(d))

const site = (over: Partial<PublicSite> = {}): PublicSite => ({
  park: {
    nameEn: 'Al-Azhar Park', nameAr: 'حديقة الأزهر', taglineEn: null, taglineAr: null, descriptionEn: null, descriptionAr: null,
    stats: [{ value: '99', labelEn: 'Feddans', labelAr: 'فدانًا' }],
  },
  contact: {
    addressEn: 'Salah Salem Street', addressAr: 'شارع صلاح سالم', phones: ['0100 111 2222'], fax: null, email: 'hello@alazharpark.com',
    mapsUrl: 'https://maps.app.goo.gl/xyz', latitude: 30.04, longitude: 31.26, socialLinks: { facebook: 'https://facebook.com/azhar' },
  },
  hours: { weekly: everyDay, special: [], today: { date: '2026-10-05', isClosed: false, opens: '09:00', closes: '22:00', special: null } },
  updatedAt: '2026-10-05T00:00:00Z',
  ...over,
})

describe('time and date formatting', () => {
  it('formats the park wall-clock time in English and Arabic', () => {
    expect(formatTime('09:00', 'en').replace(/\s/g, ' ')).toBe('9:00 AM')
    expect(formatTime('22:00', 'en').replace(/\s/g, ' ')).toBe('10:00 PM')
    expect(formatTime('09:00', 'ar')).toMatch(/٩:٠٠/)
    expect(formatTime('22:00', 'ar')).toMatch(/١٠:٠٠/)
    expect(formatTime('00:30', 'en').replace(/\s/g, ' ')).toBe('12:30 AM')
  })

  it('does not shift with the visitor\'s own time zone', () => {
    // 09:00 is 09:00 wherever the browser is: no Date-in-local-time conversion happens
    expect(formatTime('09:00', 'en')).toContain('9:00')
  })

  it('formats single days and ranges', () => {
    expect(formatDateRange('2027-03-10', '2027-03-10', 'en')).toContain('10')
    expect(formatDateRange('2027-03-10', '2027-03-12', 'en')).toMatch(/10.*Mar.*12 .*Mar.*2027|Mar 10.*Mar 12, 2027/)
    expect(formatDateRange('2027-03-10', '2027-03-12', 'ar')).toMatch(/[٠-٩]/)
  })
})

describe('weekly hours display', () => {
  it('shows one "Daily" row when every day is the same', () => {
    expect(weeklyRows(everyDay, 'en')).toEqual([{ label: 'Daily', value: expect.stringMatching(/9:00.*AM.*10:00.*PM/) }])
    expect(weeklyRows(everyDay, 'ar')[0].label).toBe('يوميًا')
  })

  it('groups consecutive days that share hours, and shows differing days separately', () => {
    const weekly = everyDay.map((d) => (d.dayOfWeek === 5 ? day(5, '10:00', '23:00') : d.dayOfWeek === 6 ? day(6, '10:00', '23:00') : d))
    const rows = weeklyRows(weekly, 'en')
    expect(rows).toHaveLength(2)
    expect(rows[0].label).toBe('Sunday – Thursday')
    expect(rows[1].label).toBe('Friday – Saturday')
    expect(rows[1].value).toMatch(/10:00.*AM.*11:00.*PM/)
  })

  it('shows a closed day as Closed, in either language', () => {
    const weekly = everyDay.map((d) => (d.dayOfWeek === 2 ? day(2, '', '', true) : d))
    const en_ = weeklyRows(weekly, 'en')
    expect(en_.find((r) => r.label === 'Tuesday')?.value).toBe('Closed')
    expect(weeklyRows(weekly, 'ar').find((r) => r.value === 'مغلق')).toBeDefined()
    expect(groupWeekly(weekly)).toHaveLength(3) // Sun–Mon, Tue (closed), Wed–Sat
  })

  it('does not group days that are not next to each other', () => {
    const weekly = everyDay.map((d) => (d.dayOfWeek === 3 ? day(3, '10:00', '20:00') : d))
    expect(groupWeekly(weekly).map((g) => g.days)).toEqual([[0, 1, 2], [3], [4, 5, 6]])
  })

  it('summarises on one line', () => {
    expect(weeklySummary(everyDay, 'en')).toMatch(/^Daily, 9:00.*10:00/)
    expect(weeklySummary(everyDay, 'ar')).toMatch(/^يوميًا، /)
  })
})

describe('special hours and today', () => {
  const special: PublicSite['hours']['special'] = [
    { kind: 'HOLIDAY', dateFrom: '2026-10-10', dateTo: '2026-10-12', isClosed: false, opens: '08:00', closes: '23:30', labelEn: 'Holiday', labelAr: 'إجازة', noteEn: null, noteAr: null },
    { kind: 'TEMPORARY_CLOSURE', dateFrom: '2026-11-01', dateTo: '2026-11-01', isClosed: true, opens: null, closes: null, labelEn: 'Maintenance', labelAr: 'صيانة', noteEn: null, noteAr: null },
    { kind: 'HOLIDAY', dateFrom: '2020-01-01', dateTo: '2020-01-02', isClosed: false, opens: '08:00', closes: '23:30', labelEn: 'Past', labelAr: 'ماضي', noteEn: null, noteAr: null },
  ]

  it('lists upcoming periods with their dates and hours, in the right language, skipping past ones', () => {
    const rows = specialRows(special, '2026-10-05', 'en')
    expect(rows).toHaveLength(2)
    expect(rows[0].label).toMatch(/^Holiday · /)
    expect(rows[0].value).toMatch(/8:00.*AM.*11:30.*PM/)
    expect(rows[1].value).toBe('Closed')
    expect(specialRows(special, '2026-10-05', 'ar')[0].label).toMatch(/^إجازة · /)
    expect(specialRows(special, '2026-10-05', 'en', 1)).toHaveLength(1)
  })

  it('shows today as open hours or closed', () => {
    expect(todayValue(site(), 'en')).toMatch(/9:00.*10:00/)
    const closed = site({ hours: { ...site().hours, today: { date: '2026-10-05', isClosed: true, opens: null, closes: null, special: null } } })
    expect(todayValue(closed, 'en')).toBe('Closed today')
    expect(todayValue(closed, 'ar')).toBe('مغلقة اليوم')
  })
})

describe('applySiteData', () => {
  it('returns the built-in content untouched when there is no live data', () => {
    expect(applySiteData(en, null, 'en')).toBe(en)
    expect(applySiteData(ar, null, 'ar')).toBe(ar)
  })

  it('overlays statistics, contact details and hours in the chosen language', () => {
    const out = applySiteData(en, site(), 'en')
    expect(out.stats).toEqual([{ value: '99', label: 'Feddans' }])
    expect(out.contact.address).toBe('Salah Salem Street')
    expect(out.contact.phones).toEqual(['0100 111 2222'])
    expect(out.contact.email).toBe('hello@alazharpark.com')
    expect(out.contact.fax).toBe('') // the portal cleared it: the page hides the row
    expect(out.visitTeaser.address).toBe('Salah Salem Street')
    expect(out.visitTeaser.hours).toMatch(/^Daily, /)
    expect(out.visitorBar.hoursValue).toMatch(/9:00.*10:00/)
    expect(out.visit.hours[0].label).toBe('Daily')

    const arabic = applySiteData(ar, site(), 'ar')
    expect(arabic.contact.address).toBe('شارع صلاح سالم')
    expect(arabic.stats[0].label).toBe('فدانًا')
  })

  it('keeps everything it was not given, so a half-filled portal never blanks a page', () => {
    const empty = site({ park: { ...site().park, stats: [] }, contact: { ...site().contact, addressEn: '', phones: [] }, hours: { ...site().hours, weekly: [] } })
    const out = applySiteData(en, empty, 'en')
    expect(out.stats).toEqual(en.stats)
    expect(out.contact.address).toBe(en.contact.address)
    expect(out.contact.phones).toEqual(en.contact.phones)
    expect(out.visit.hours).toEqual(en.visit.hours)
    expect(out.visitorBar.hoursValue).toBe(en.visitorBar.hoursValue)
    expect(out.hero).toBe(en.hero) // unrelated content is the same object
  })

  it('appends upcoming special hours under the weekly hours on the tickets page', () => {
    const withSpecial = site({
      hours: {
        ...site().hours,
        special: [{ kind: 'HOLIDAY', dateFrom: '2026-10-10', dateTo: '2026-10-12', isClosed: false, opens: '08:00', closes: '23:30', labelEn: 'Holiday', labelAr: 'إجازة', noteEn: null, noteAr: null }],
      },
    })
    const rows = applySiteData(en, withSpecial, 'en').visit.hours
    expect(rows).toHaveLength(2)
    expect(rows[1].label).toMatch(/^Holiday · /)
  })
})

describe('map links', () => {
  it('uses exact coordinates when the portal has them', () => {
    const links = siteLinks(site())
    expect(links.mapsUrl).toBe('https://maps.app.goo.gl/xyz')
    expect(links.directionsUrl).toContain('destination=30.04,31.26')
    expect(links.embedUrl('ar')).toContain('q=30.04,31.26')
    expect(links.embedUrl('ar')).toContain('hl=ar')
  })

  it('falls back to the address, then to the built-in listing', () => {
    const noCoords = siteLinks(site({ contact: { ...site().contact, latitude: null, longitude: null, mapsUrl: null } }))
    expect(noCoords.directionsUrl).toContain(encodeURIComponent('Al-Azhar Park, Salah Salem Street'))
    expect(noCoords.mapsUrl).toContain('google.com/maps?cid=')
    const none = siteLinks(null)
    expect(none.directionsUrl).toContain('Salah%20Salem')
  })
})
