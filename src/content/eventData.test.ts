import { describe, expect, it } from 'vitest'
import { en } from './en'
import { ar } from './ar'
import { applyEvents, eventDateText, eventTimeText, eventWhere, toSiteEvent, type PublicEvent } from './eventData'

const api = (over: Partial<PublicEvent> = {}): PublicEvent => ({
  slug: 'cairo-jazz-nights', status: 'COMING_SOON', titleEn: 'Cairo Jazz Nights', titleAr: 'ليالي الجاز بالقاهرة', shortDescriptionEn: 'Live jazz on the lawn.', shortDescriptionAr: 'جاز حي على العشب.',
  descriptionEn: 'Long English description.\n\nSecond paragraph.', descriptionAr: 'وصف عربي طويل.', eventDate: '2026-11-20', startTime: '20:00', endTime: '23:00', crossesMidnight: false,
  startsAt: '2026-11-20T18:00:00.000Z', endsAt: '2026-11-20T21:00:00.000Z', dateLabelEn: null, dateLabelAr: null, timeLabelEn: null, timeLabelAr: null,
  venue: { slug: 'open-area', nameEn: 'Open Area', nameAr: 'المساحة المفتوحة', addressEn: null, addressAr: null }, locationNameEn: null, locationNameAr: null,
  isFeatured: false, hero: null, gallery: [], ...over,
})

describe('event date and time text', () => {
  it('writes the date as a calendar day in either language', () => {
    expect(eventDateText('2026-11-20', 'en')).toBe('Fri 20 November 2026')
    expect(eventDateText('2026-11-20', 'ar')).toMatch(/٢٠/)
    expect(eventDateText('2026-11-20', 'ar')).toMatch(/٢٠٢٦/)
  })

  it('does not move the date with the visitor’s own time zone (it is a calendar day, not an instant)', () => {
    expect(eventDateText('2026-01-01', 'en')).toBe('Thu 1 January 2026')
    expect(eventDateText('2026-12-31', 'en')).toBe('Thu 31 December 2026')
  })

  it('writes times in 12-hour style, with Arabic digits in Arabic, including past midnight', () => {
    expect(eventTimeText({ startTime: '20:00', endTime: '23:00' }, 'en').replace(/\s/g, ' ')).toBe('8:00 PM – 11:00 PM')
    expect(eventTimeText({ startTime: '20:00', endTime: '01:00' }, 'en').replace(/\s/g, ' ')).toBe('8:00 PM – 1:00 AM')
    expect(eventTimeText({ startTime: '20:00', endTime: '01:00' }, 'ar')).toMatch(/٨:٠٠.*١:٠٠/)
    expect(eventTimeText({ startTime: null, endTime: null }, 'en')).toBe('')
  })

  it('names the venue, else the free-text location', () => {
    expect(eventWhere(api(), 'en')).toBe('Open Area')
    expect(eventWhere(api(), 'ar')).toBe('المساحة المفتوحة')
    expect(eventWhere(api({ venue: null, locationNameEn: 'Colonnade', locationNameAr: 'الرواق' }), 'ar')).toBe('الرواق')
    expect(eventWhere(api({ venue: null }), 'en')).toBe('')
  })
})

describe('toSiteEvent', () => {
  it('maps an API event to the card and page shape in each language', () => {
    const e = toSiteEvent(api(), 'en', 'Coming soon')
    expect(e).toMatchObject({ id: 'cairo-jazz-nights', slug: 'cairo-jazz-nights', title: 'Cairo Jazz Nights', description: 'Live jazz on the lawn.', status: 'Coming soon', location: 'Open Area', startsAt: '2026-11-20T18:00:00.000Z', endsAt: '2026-11-20T21:00:00.000Z' })
    expect(e.body).toContain('Second paragraph.')
    expect(e.date).toBe('Fri 20 November 2026')
    expect(toSiteEvent(api(), 'ar', 'قريبًا')).toMatchObject({ title: 'ليالي الجاز بالقاهرة', body: 'وصف عربي طويل.', location: 'المساحة المفتوحة', status: 'قريبًا' })
  })

  it('lets the editors’ own wording replace the computed date and time (multi-day events)', () => {
    const e = toSiteEvent(api({ dateLabelEn: '8 Feb – 9 Mar 2027', timeLabelEn: 'Nightly, 8:00 PM – 1:00 AM' }), 'en', 'x')
    expect(e.date).toBe('8 Feb – 9 Mar 2027')
    expect(e.time).toBe('Nightly, 8:00 PM – 1:00 AM')
    // Arabic has no wording of its own here, so it falls back to the computed Arabic date, never to English
    expect(toSiteEvent(api({ dateLabelEn: '8 Feb – 9 Mar 2027' }), 'ar', 'x').date).toMatch(/٢٠٢٦/)
  })

  it('keeps a built-in photo for the same address, uses uploaded photos otherwise, and a neutral picture as a last resort', () => {
    const builtIn = en.comingSoon.events[0]
    expect(toSiteEvent(api(), 'en', 'x', builtIn).image).toBe(builtIn.image)
    const withPhotos = toSiteEvent(api({ hero: { url: '/api/v1/media/file/h.webp', width: 1, height: 1, altEn: null, altAr: null }, gallery: [{ url: '/api/v1/media/file/g.webp', width: 1, height: 1, altEn: null, altAr: null, captionEn: null, captionAr: null }] }), 'en', 'x', builtIn)
    expect(withPhotos.image).toContain('/api/v1/media/file/h.webp')
    expect(withPhotos.gallery).toEqual([expect.stringContaining('/api/v1/media/file/g.webp')])
    expect(toSiteEvent(api(), 'en', 'x').image).toBe('events-hero.webp')
  })

  it('gives a date-only event a calendar entry of one day, and no time text', () => {
    const e = toSiteEvent(api({ startTime: null, endTime: null, endsAt: null, startsAt: '2026-12-03T22:00:00.000Z' }), 'en', 'x')
    expect(e.time).toBe('')
    expect(new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()).toBe(24 * 3_600_000)
  })

  it('marks a featured event', () => {
    expect(toSiteEvent(api({ isFeatured: true }), 'en', 'x').featured).toBe(true)
    expect(toSiteEvent(api(), 'en', 'x').featured).toBeUndefined()
  })
})

describe('applyEvents', () => {
  it('keeps the built-in events when the API did not answer', () => {
    expect(applyEvents(en, null, 'en')).toBe(en)
    expect(applyEvents(ar, null, 'ar')).toBe(ar)
  })

  it('makes the API’s coming-soon list the whole list, in its order', () => {
    const out = applyEvents(en, [api({ slug: 'b-event', titleEn: 'B' }), api({ slug: 'a-event', titleEn: 'A' })], 'en').comingSoon
    expect(out.events.map((e) => e.slug)).toEqual(['b-event', 'a-event'])
    expect(out.events[0].status).toBe(en.comingSoon.badge)
    expect(out.title).toBe(en.comingSoon.title) // the section's own wording is untouched
  })

  it('shows nothing when the API says nothing is coming soon (the strip hides itself)', () => {
    expect(applyEvents(en, [], 'en').comingSoon.events).toEqual([])
  })

  it('reuses the built-in photo for an event with the same address', () => {
    const slug = en.comingSoon.events[0].slug
    expect(applyEvents(en, [api({ slug })], 'en').comingSoon.events[0].image).toBe(en.comingSoon.events[0].image)
  })

  it('works in Arabic and leaves the rest of the page alone', () => {
    const out = applyEvents(ar, [api()], 'ar')
    expect(out.comingSoon.events[0]).toMatchObject({ title: 'ليالي الجاز بالقاهرة', status: ar.comingSoon.badge })
    expect(out.hero).toBe(ar.hero)
  })
})
