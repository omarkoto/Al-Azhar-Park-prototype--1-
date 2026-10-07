import { describe, expect, it } from 'vitest'
import {
  cartSelection, customerInput, customerProblems, formatCountdown, makeTicketId, newIdempotencyKey, parseTicketId, pounds, problemKey, sanitizeLines, secondsLeft, toAsciiDigits, tokenFromHash,
} from './booking'
import { formatClock, formatDay, nextDay } from './bookingFormat'
import { mergeSelection, type CartLine } from './cart'

const line = (ticketId: string, qty: number, visitDate: string | null = '2026-10-08'): CartLine => ({ ticketId, label: ticketId, unitPrice: 50, qty, visitDate })

describe('cart lines name an audience and a ticket type', () => {
  it('round-trips and rejects anything else', () => {
    expect(makeTicketId('RESIDENT', 'ADULT')).toBe('RESIDENT:ADULT')
    expect(parseTicketId('RESIDENT:ADULT')).toEqual({ audience: 'RESIDENT', ticketType: 'ADULT' })
    for (const bad of ['resident-adult-weekday', 'RESIDENT', 'RESIDENT:', ':ADULT', 'a:b', 'RESIDENT:ADULT:X', '']) expect(parseTicketId(bad)).toBeNull()
  })
})

describe('cartSelection', () => {
  it('turns the cart into one date, one audience and a quantity per ticket type', () => {
    const r = cartSelection([line('RESIDENT:ADULT', 2), line('RESIDENT:CHILD', 1)])
    expect(r).toEqual({ selection: { visitDate: '2026-10-08', audience: 'RESIDENT', items: [{ ticketType: 'ADULT', quantity: 2 }, { ticketType: 'CHILD', quantity: 1 }] } })
  })
  it('adds up two lines for the same ticket type', () => {
    expect(cartSelection([line('RESIDENT:ADULT', 2), line('RESIDENT:ADULT', 3)])).toEqual({ selection: { visitDate: '2026-10-08', audience: 'RESIDENT', items: [{ ticketType: 'ADULT', quantity: 5 }] } })
  })
  it('reports a cart that cannot be bought in one order', () => {
    expect(cartSelection([])).toEqual({ problem: 'EMPTY' })
    expect(cartSelection([line('RESIDENT:ADULT', 1, null)])).toEqual({ problem: 'NO_DATE' })
    expect(cartSelection([line('RESIDENT:ADULT', 1, '2026-10-08'), line('RESIDENT:CHILD', 1, '2026-10-09')])).toEqual({ problem: 'MIXED_DATE' })
    expect(cartSelection([line('RESIDENT:ADULT', 1), line('VISITOR:ADULT', 1)])).toEqual({ problem: 'MIXED_AUDIENCE' })
    expect(cartSelection([line('old-style-id', 1)])).toEqual({ problem: 'INVALID' })
    expect(cartSelection([line('RESIDENT:ADULT', 0)])).toEqual({ problem: 'INVALID' })
    expect(cartSelection([line('RESIDENT:ADULT', 1.5)])).toEqual({ problem: 'INVALID' })
  })
  it('never carries a price: only codes and quantities are sent', () => {
    const r = cartSelection([line('RESIDENT:ADULT', 2)])
    expect(JSON.stringify(r)).not.toMatch(/price|50|total/i)
  })
})

describe('a cart remembered by an older version of the site', () => {
  it('keeps only lines this version understands', () => {
    const stored = [
      { ticketId: 'RESIDENT:ADULT', label: 'x', unitPrice: 50, qty: 2, visitDate: '2026-10-08' },
      { ticketId: 'resident-adult-weekday', label: 'old', unitPrice: 50, qty: 1, visitDate: '2026-10-08' }, // old id
      { ticketId: 'RESIDENT:ADULT', label: 'no date', unitPrice: 50, qty: 1, visitDate: null }, // no date
      { ticketId: 'RESIDENT:CHILD', label: 'bad qty', unitPrice: 50, qty: -2, visitDate: '2026-10-08' },
      { ticketId: 'RESIDENT:CHILD', label: 'huge', unitPrice: 50, qty: 9999, visitDate: '2026-10-08' },
      'garbage',
      null,
    ]
    expect(sanitizeLines(stored)).toHaveLength(1)
    expect(sanitizeLines('not a list')).toEqual([])
    expect(sanitizeLines(null)).toEqual([])
  })
})

describe('adding to the cart', () => {
  it('merges the same date and audience', () => {
    const merged = mergeSelection([line('RESIDENT:ADULT', 2)], [line('RESIDENT:ADULT', 1), line('RESIDENT:CHILD', 3)])
    expect(merged.map((l) => [l.ticketId, l.qty])).toEqual([['RESIDENT:ADULT', 3], ['RESIDENT:CHILD', 3]])
  })
  it('starts a fresh cart for a different date or audience', () => {
    expect(mergeSelection([line('RESIDENT:ADULT', 2, '2026-10-08')], [line('RESIDENT:ADULT', 1, '2026-10-09')]).map((l) => l.visitDate)).toEqual(['2026-10-09'])
    expect(mergeSelection([line('RESIDENT:ADULT', 2)], [line('VISITOR:ADULT', 1)]).map((l) => l.ticketId)).toEqual(['VISITOR:ADULT'])
  })
  it('ignores an empty selection and fills an empty cart', () => {
    const current = [line('RESIDENT:ADULT', 2)]
    expect(mergeSelection(current, [])).toBe(current)
    expect(mergeSelection([], [line('RESIDENT:ADULT', 1)])).toHaveLength(1)
  })
})

describe('messages for the server\'s refusals', () => {
  it('maps every booking rule to its own sentence', () => {
    expect(problemKey('DATE_IN_THE_PAST')).toBe('bookErrPast')
    expect(problemKey('DATE_TOO_FAR_AHEAD')).toBe('bookErrTooFar')
    expect(problemKey('PARK_CLOSED')).toBe('bookErrClosed')
    expect(problemKey('SALES_CLOSED_FOR_TODAY')).toBe('bookErrCutoff')
    expect(problemKey('TOO_MANY_TICKETS')).toBe('bookErrTooMany')
    expect(problemKey('PRICE_NOT_AVAILABLE')).toBe('bookErrPrice')
    expect(problemKey('SOLD_OUT')).toBe('bookErrSoldOut')
    expect(problemKey('NETWORK')).toBe('bookErrNetwork')
    expect(problemKey('UNAVAILABLE')).toBe('bookErrNetwork')
    expect(problemKey('SOMETHING_NEW')).toBe('bookErrGeneric')
  })
})

describe('the payment countdown', () => {
  const now = new Date('2026-10-07T10:00:00Z').getTime()
  it('counts down to the order deadline and never goes below zero', () => {
    expect(secondsLeft('2026-10-07T10:30:00Z', now)).toBe(1800)
    expect(secondsLeft('2026-10-07T10:00:00.400Z', now)).toBe(1)
    expect(secondsLeft('2026-10-07T09:59:00Z', now)).toBe(0)
    expect(secondsLeft(null, now)).toBe(0)
  })
  it('shows minutes and seconds', () => {
    expect(formatCountdown(1800)).toBe('30:00')
    expect(formatCountdown(65)).toBe('01:05')
    expect(formatCountdown(0)).toBe('00:00')
    expect(formatCountdown(-4)).toBe('00:00')
  })
})

describe('order key and idempotency', () => {
  it('reads the private key from the page address', () => {
    expect(tokenFromHash('#k=abcdefghijklmnopqrstuvwxyz0123456789_-AB')).toBe('abcdefghijklmnopqrstuvwxyz0123456789_-AB')
    expect(tokenFromHash('#k=short')).toBeNull()
    expect(tokenFromHash('')).toBeNull()
    expect(tokenFromHash('#other=abcdefghijklmnopqrstuvwxyz0123456789')).toBeNull()
  })
  it('makes a different key every time, in the form the server accepts', () => {
    const a = newIdempotencyKey()
    expect(a).not.toBe(newIdempotencyKey())
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,100}$/)
  })
})

describe('customer details', () => {
  const ok = { fullName: 'Mona Hassan', email: 'Mona@Example.com ', phone: '+20 100 123 4567', accepted: true }
  it('accepts valid details and normalises them', () => {
    expect(customerProblems(ok)).toEqual({})
    expect(customerInput(ok)).toEqual({ fullName: 'Mona Hassan', email: 'mona@example.com', phone: '+20 100 123 4567' })
    expect(customerInput({ ...ok, phone: '  ' }).phone).toBeNull()
  })
  it('requires a name, an e-mail address and the booking terms; the phone is optional', () => {
    expect(customerProblems({ ...ok, fullName: ' ' })).toEqual({ fullName: true })
    expect(customerProblems({ ...ok, email: 'nope' })).toEqual({ email: true })
    expect(customerProblems({ ...ok, email: 'a@b' })).toEqual({ email: true })
    expect(customerProblems({ ...ok, accepted: false })).toEqual({ accepted: true })
    expect(customerProblems({ ...ok, phone: '' })).toEqual({})
    expect(customerProblems({ ...ok, phone: 'abc' })).toEqual({ phone: true })
  })
  it('accepts a phone typed with Arabic digits', () => {
    expect(toAsciiDigits('٠١٠٠١٢٣٤٥٦٧')).toBe('0100123456 7'.replace(' ', ''))
    expect(customerProblems({ ...ok, phone: '٠١٠٠١٢٣٤٥٦٧' })).toEqual({})
    expect(customerInput({ ...ok, phone: '٠١٠٠١٢٣٤٥٦٧' }).phone).toBe('01001234567')
  })
})

describe('amounts', () => {
  it('shows piastres as pounds', () => {
    expect(pounds(5000)).toBe(50)
    expect(pounds(6250)).toBe(62.5)
  })
})

describe('dates and times for the visitor', () => {
  it('writes a calendar day the same way wherever the visitor is', () => {
    expect(formatDay('2026-10-08', 'en-US')).toBe('Thursday, October 8, 2026')
    expect(formatDay('2026-10-08', 'ar-EG')).toMatch(/٢٠٢٦/)
    expect(formatDay('nonsense', 'en-US')).toBe('nonsense')
  })
  it('writes the opening times with the visitor\'s digits', () => {
    expect(formatClock('21:00', 'en-US')).toMatch(/9:00\s?PM/)
    expect(formatClock('21:00', 'ar-EG')).toMatch(/٩:٠٠/)
    expect(formatClock('bad', 'en-US')).toBe('bad')
  })
  it('finds the next day across month and year ends', () => {
    expect(nextDay('2026-10-07')).toBe('2026-10-08')
    expect(nextDay('2026-10-31')).toBe('2026-11-01')
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
  })
})
