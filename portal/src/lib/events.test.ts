import { describe, expect, it } from 'vitest'
import { canReorder, emptyEventForm, eventToForm, formToEvent, statusActions, timeHint, TRANSITIONS, whenText, type EventData } from './events'

const event = (over: Partial<EventData> = {}): EventData => ({
  id: '1', slug: 'night-concert', status: 'DRAFT', titleEn: 'Night Concert', titleAr: 'حفل', shortDescriptionEn: 'short one', shortDescriptionAr: 'قصير', descriptionEn: 'long description',
  descriptionAr: 'وصف طويل', eventDate: '2027-05-14', startTime: '20:00', endTime: '01:00', crossesMidnight: true, venue: { id: 'v1', slug: 'open-area', nameEn: 'Open Area', nameAr: 'مفتوحة', isActive: true },
  locationNameEn: null, locationNameAr: null, dateLabelEn: null, dateLabelAr: null, timeLabelEn: null, timeLabelAr: null, isFeatured: false, sortOrder: 1, hero: null, gallery: [],
  publishedAt: null, updatedAt: '', ...over,
})

describe('event form', () => {
  it('round-trips through the form; blank optional fields become null', () => {
    const body = formToEvent(eventToForm(event()), 'hero-1', true)
    expect(body).toMatchObject({ slug: 'night-concert', eventDate: '2027-05-14', startTime: '20:00', endTime: '01:00', venueId: 'v1', locationNameEn: null, heroMediaId: 'hero-1', isFeatured: false })
  })

  it('leaves the address out when editing and turns empty times into null (a date-only event)', () => {
    const f = { ...emptyEventForm('2027-05-14'), startTime: '', endTime: '', venueId: '' }
    const body = formToEvent(f, null, false)
    expect(body).not.toHaveProperty('slug')
    expect(body).toMatchObject({ startTime: null, endTime: null, venueId: null, heroMediaId: null })
  })

  it('trims text', () => {
    expect(formToEvent({ ...emptyEventForm('2027-05-14'), titleEn: '  Hello  ', slug: ' x-y ' }, null, true)).toMatchObject({ titleEn: 'Hello', slug: 'x-y' })
  })
})

describe('time hints', () => {
  it('explains an event that crosses midnight', () => {
    expect(timeHint('20:00', '01:00')).toEqual({ tone: 'info', text: 'Ends after midnight, at 01:00 the next day (5 hours long).' })
    expect(timeHint('23:30', '00:15')?.text).toMatch(/0\.8 hours|0\.75|0\.8/)
  })
  it('stays quiet for a normal evening and flags the mistakes', () => {
    expect(timeHint('18:00', '21:00')).toBeNull()
    expect(timeHint('20:00', '20:00')?.tone).toBe('error')
    expect(timeHint('20:00', '')?.tone).toBe('error')
    expect(timeHint('06:00', '00:30')?.text).toMatch(/at most 18 hours/)
    expect(timeHint('', '')?.tone).toBe('info')
  })
})

describe('status buttons', () => {
  it('offers exactly the allowed changes, with the main action first', () => {
    expect(statusActions('DRAFT').map((a) => a.to)).toEqual(['PUBLISHED', 'COMING_SOON', 'ARCHIVED'])
    expect(statusActions('PUBLISHED').map((a) => a.to)).toEqual(['COMING_SOON', 'DRAFT', 'CANCELLED', 'ARCHIVED'])
    expect(statusActions('ARCHIVED').map((a) => a.to)).toEqual(['DRAFT'])
  })
  it('labels a restore differently from an unpublish, and asks before hiding a public event', () => {
    expect(statusActions('CANCELLED').find((a) => a.to === 'DRAFT')?.label).toBe('Restore as draft')
    expect(statusActions('PUBLISHED').find((a) => a.to === 'DRAFT')?.label).toBe('Move back to draft')
    expect(statusActions('PUBLISHED').find((a) => a.to === 'CANCELLED')?.confirm).toMatch(/Cancel this event/)
    expect(statusActions('DRAFT').find((a) => a.to === 'PUBLISHED')?.confirm).toBeUndefined()
  })
  it('never offers a no-op or a jump from cancelled/archived straight to the public', () => {
    for (const [from, tos] of Object.entries(TRANSITIONS)) expect(tos).not.toContain(from)
    expect(TRANSITIONS.CANCELLED).not.toContain('PUBLISHED')
    expect(TRANSITIONS.ARCHIVED).not.toContain('COMING_SOON')
  })
})

describe('labels and ordering', () => {
  it('describes when an event happens', () => {
    expect(whenText(event())).toBe('Fri, 14 May 2027 · 20:00 – 01:00 (+1 day)')
    expect(whenText(event({ startTime: null, endTime: null, crossesMidnight: false }))).toBe('Fri, 14 May 2027')
    expect(whenText(event({ dateLabelEn: '8 Feb – 9 Mar 2027', timeLabelEn: 'Nightly' }))).toBe('8 Feb – 9 Mar 2027 · Nightly')
  })
  it('only allows reordering the whole, unfiltered list', () => {
    expect(canReorder({ search: '', status: '' }, 3, 3)).toBe(true)
    expect(canReorder({ search: 'x', status: '' }, 3, 3)).toBe(false)
    expect(canReorder({ search: '', status: 'DRAFT' }, 1, 1)).toBe(false)
    expect(canReorder({ search: '', status: '' }, 100, 140)).toBe(false)
    expect(canReorder({ search: '', status: '' }, 1, 1)).toBe(false)
  })
})
