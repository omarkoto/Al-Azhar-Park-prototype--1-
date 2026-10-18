import { describe, expect, it } from 'vitest'
import { cairoToday, contactToForm, copyDay, emptySpecial, formToContact, formToPark, specialPayload, weeklyPayload } from './forms'
import { diffPermissions, groupPermissions, sameSet, toggleGroup } from './permissions'

describe('contact form', () => {
  const contact = {
    addressEn: 'Salah Salem', addressAr: 'صلاح سالم', phones: ['0100 1', '0100 2'], fax: null, email: null, mapsUrl: null,
    latitude: 30.04, longitude: 31.26, socialLinks: { facebook: 'https://facebook.com/x' },
  }

  it('round-trips through the form', () => {
    const payload = formToContact(contactToForm(contact))
    expect(payload).toMatchObject({ addressEn: 'Salah Salem', phones: ['0100 1', '0100 2'], fax: null, email: null, latitude: 30.04, longitude: 31.26 })
    expect(payload.socialLinks).toMatchObject({ facebook: 'https://facebook.com/x', instagram: null })
  })

  it('turns blank lines and spaces into nothing, and empty fields into null', () => {
    const form = { ...contactToForm(contact), phones: ' 0100 1 \n\n  \n0100 2\n', fax: '  ', email: '', latitude: '', longitude: '' }
    expect(formToContact(form)).toMatchObject({ phones: ['0100 1', '0100 2'], fax: null, email: null, latitude: null, longitude: null })
  })

  it('keeps a non-numeric coordinate invalid (NaN) so the server rejects it instead of it becoming 0', () => {
    expect(Number.isNaN(formToContact({ ...contactToForm(contact), latitude: 'abc' }).latitude as number)).toBe(true)
  })
})

describe('park form', () => {
  it('trims text and maps empty optional fields to null', () => {
    const out = formToPark({
      nameEn: ' Al-Azhar Park ', nameAr: 'حديقة الأزهر', taglineEn: '  ', taglineAr: '', descriptionEn: 'x', descriptionAr: '',
      stats: [{ value: ' 71 ', labelEn: ' Feddans ', labelAr: 'فدان' }],
    })
    expect(out).toMatchObject({ nameEn: 'Al-Azhar Park', taglineEn: null, taglineAr: null, descriptionEn: 'x', descriptionAr: null })
    expect(out.stats).toEqual([{ value: '71', labelEn: 'Feddans', labelAr: 'فدان' }])
  })
})

describe('weekly hours form', () => {
  const days = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, isClosed: false, opens: '09:00', closes: '22:00' }))

  it('sends no times for a closed day', () => {
    const out = weeklyPayload(days.map((d) => (d.dayOfWeek === 2 ? { ...d, isClosed: true } : d)))
    expect(out.days[2]).toEqual({ dayOfWeek: 2, isClosed: true, opens: null, closes: null })
    expect(out.days[1]).toEqual({ dayOfWeek: 1, isClosed: false, opens: '09:00', closes: '22:00' })
  })

  it('copies one day onto others', () => {
    const edited = days.map((d) => (d.dayOfWeek === 5 ? { ...d, opens: '10:00', closes: '23:00' } : d))
    const out = copyDay(edited, 5, [6, 0])
    expect(out[6]).toMatchObject({ opens: '10:00', closes: '23:00' })
    expect(out[0]).toMatchObject({ opens: '10:00', closes: '23:00' })
    expect(out[1]).toMatchObject({ opens: '09:00' })
  })
})

describe('special hours form', () => {
  it('a temporary closure is always sent closed, with no times', () => {
    const s = { ...emptySpecial('2026-10-05'), kind: 'TEMPORARY_CLOSURE' as const, labelEn: ' Maintenance ', labelAr: 'صيانة' }
    expect(specialPayload(s)).toMatchObject({ isClosed: true, opens: null, closes: null, labelEn: 'Maintenance' })
  })
  it('a holiday keeps its hours unless marked closed', () => {
    const s = { ...emptySpecial('2026-10-05'), labelEn: 'Eid', labelAr: 'العيد', opens: '08:00', closes: '23:30' }
    expect(specialPayload(s)).toMatchObject({ isClosed: false, opens: '08:00', closes: '23:30', priority: 10, noteEn: null })
    expect(specialPayload({ ...s, isClosed: true })).toMatchObject({ opens: null, closes: null })
  })
  it('knows today in Cairo even near midnight UTC', () => {
    expect(cairoToday(new Date('2026-10-04T22:30:00Z'))).toBe('2026-10-05') // 01:30 in Cairo (UTC+3)
    expect(cairoToday(new Date('2026-12-04T21:30:00Z'))).toBe('2026-12-04') // 23:30 in Cairo (UTC+2)
  })
})

describe('permission helpers', () => {
  const catalogue = [
    { code: 'tickets:read', description: 'View tickets' },
    { code: 'tickets:cancel', description: 'Cancel tickets' },
    { code: 'events:write', description: null },
    { code: 'pricing:read', description: 'x' },
  ]

  it('groups the catalogue by resource, sorted, straight from what the backend returned', () => {
    const groups = groupPermissions(catalogue)
    expect(groups.map((g) => g.resource)).toEqual(['events', 'pricing', 'tickets'])
    expect(groups[2].items.map((i) => i.action)).toEqual(['cancel', 'read'])
    expect(groups[0].items[0].description).toBe('') // missing description is tolerated
  })

  it('shows what a save would add and remove', () => {
    expect(diffPermissions(['a:b', 'c:d'], ['c:d', 'e:f'])).toEqual({ added: ['e:f'], removed: ['a:b'] })
    expect(sameSet(['a:b', 'c:d'], ['c:d', 'a:b'])).toBe(true)
    expect(sameSet(['a:b'], ['a:b', 'c:d'])).toBe(false)
  })

  it('selects and clears a whole group without touching others', () => {
    const [events, , tickets] = groupPermissions(catalogue)
    const start = new Set(['events:write'])
    const on = toggleGroup(start, tickets, true)
    expect([...on].sort()).toEqual(['events:write', 'tickets:cancel', 'tickets:read'])
    expect([...toggleGroup(on, events, false)].sort()).toEqual(['tickets:cancel', 'tickets:read'])
    expect(start.size).toBe(1) // the original is not mutated
  })
})
