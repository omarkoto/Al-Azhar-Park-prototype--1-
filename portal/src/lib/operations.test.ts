import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, visibleNav } from './navigation'
import { activityLabel, deactivationWarning, gateProblems, onlineSalesText, parkBanner, scanLabel, TICKET_STATUSES, TICKET_STATUS_LABEL, TICKET_STATUS_TONE } from './operations'

const canOnly = (...codes: string[]) => (p: string) => codes.includes(p)
const labels = (groups: ReturnType<typeof visibleNav>) => groups.flatMap((g) => g.items.map((i) => i.label))

describe('the menu', () => {
  it('shows each person only what their permissions allow, and no empty group', () => {
    expect(visibleNav(canOnly())).toEqual([])
    const staff = visibleNav(canOnly('scans:create', 'scans:read_own', 'gates:read', 'tickets:read_entry', 'ticket-types:read'))
    expect(labels(staff)).toEqual(['Gate scanner', 'Scans', 'Gates', 'Ticket types'])
    expect(staff.map((g) => g.title)).toEqual(['Operations', 'Tickets & pricing'])
    const content = visibleNav(canOnly('park:read', 'events:read', 'media:read'))
    expect(content.map((g) => g.title)).toEqual(['Park & content'])
    expect(labels(content)).toEqual(['Park information', 'Events', 'Media library'])
  })

  it('shows the scan list to someone who may read only their own scans', () => {
    expect(labels(visibleNav(canOnly('scans:read_own')))).toEqual(['Scans'])
    expect(labels(visibleNav(canOnly('scans:read')))).toEqual(['Scans'])
  })

  it('shows everything to someone who holds every permission, once each, in five groups', () => {
    const all = visibleNav(() => true)
    expect(all.map((g) => g.title)).toEqual(['Operations', 'Analytics', 'Park & content', 'Tickets & pricing', 'Administration'])
    const routes = labels(all)
    expect(new Set(routes).size).toBe(routes.length)
    expect(NAV_GROUPS.flatMap((g) => g.items).every((i) => i.to.startsWith('/') && i.anyOf.length > 0)).toBe(true)
  })

  it('never decides by a role name: only permission codes appear', () => {
    for (const code of NAV_GROUPS.flatMap((g) => g.items.flatMap((i) => i.anyOf))) expect(code).toMatch(/^[a-z-]+:[a-z_]+$/)
  })
})

describe('the park banner', () => {
  const base = { opens: '09:00', closes: '22:00', special: null }
  it('says open, not yet open, closed for the day and closed today', () => {
    expect(parkBanner({ ...base, status: 'OPEN' })).toMatchObject({ headline: 'The park is open', tone: 'open', detail: "Today's hours: 09:00 – 22:00" })
    expect(parkBanner({ ...base, status: 'BEFORE_OPENING' })).toMatchObject({ headline: 'Not open yet', tone: 'waiting' })
    expect(parkBanner({ ...base, status: 'AFTER_CLOSING' })).toMatchObject({ headline: 'Closed for today', tone: 'closed' })
    expect(parkBanner({ opens: null, closes: null, special: null, status: 'CLOSED_TODAY' })).toMatchObject({ headline: 'The park is closed today', tone: 'closed' })
  })
  it('names the special entry that changed today', () => {
    const special = { labelEn: 'Short day', labelAr: 'x', kind: 'SPECIAL_HOURS', noteEn: null, noteAr: null }
    expect(parkBanner({ opens: '10:00', closes: '16:00', special, status: 'OPEN' }).detail).toContain('Short day')
    expect(parkBanner({ opens: null, closes: null, special: { ...special, labelEn: 'Maintenance' }, status: 'CLOSED_TODAY' }).detail).toBe('Maintenance')
  })
  it('says when online sales stop', () => {
    expect(onlineSalesText({ open: true, closesAt: '21:00' })).toBe('Online tickets for today are on sale until 21:00.')
    expect(onlineSalesText({ open: false, closesAt: null })).toMatch(/no longer on sale/)
  })
})

describe('scans and tickets', () => {
  it('describes every result code and the older reasons', () => {
    expect(scanLabel('ACCESS_GRANTED')).toBe('Let in')
    expect(scanLabel('ALREADY_USED')).toBe('Refused: already used')
    expect(scanLabel('INVALID_QR')).toBe('Refused: not a ticket')
    expect(scanLabel('OK')).toBe('Let in')
    expect(scanLabel('SOMETHING_NEW')).toBe('Refused')
  })
  it('has a label and a tone for every ticket state', () => {
    for (const s of TICKET_STATUSES) {
      expect(TICKET_STATUS_LABEL[s]).toBeTruthy()
      expect(TICKET_STATUS_TONE[s]).toBeTruthy()
    }
    expect(TICKET_STATUS_TONE.VALID).toBe('teal')
    expect(TICKET_STATUS_TONE.CANCELLED).toBe('red')
  })
  it('turns an audit action into a sentence', () => {
    expect(activityLabel('ticket.cancelled')).toBe('Ticket cancelled')
    expect(activityLabel('order.email_resent')).toBe('Order email resent')
  })
})

describe('gates', () => {
  it('checks the form: a code only when creating, and both names', () => {
    expect(gateProblems({ code: 'NORTH', nameEn: 'North gate', nameAr: 'الشمالية' }, true)).toEqual({})
    expect(gateProblems({ code: 'north_2', nameEn: 'North', nameAr: 'شمال' }, true)).toEqual({})
    expect(gateProblems({ code: 'a b', nameEn: '', nameAr: ' ' }, true)).toMatchObject({ code: expect.any(String), nameEn: expect.any(String), nameAr: expect.any(String) })
    expect(gateProblems({ code: 'a b', nameEn: 'North', nameAr: 'شمال' }, false)).toEqual({})
  })
  it('warns before the last active gate is switched off', () => {
    expect(deactivationWarning({ nameEn: 'Main entrance' }, 2)).not.toMatch(/last active gate/)
    expect(deactivationWarning({ nameEn: 'Main entrance' }, 1)).toMatch(/last active gate/)
    expect(deactivationWarning({ nameEn: 'Main entrance' }, 2)).toMatch(/Scans already made there are kept/)
  })
})
