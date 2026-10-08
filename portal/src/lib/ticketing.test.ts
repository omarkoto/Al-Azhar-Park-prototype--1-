import { describe, expect, it } from 'vitest'
import { ageRange, canCancelOrder, canCancelTicket, canResendTickets, emailSummary, dayBefore, emptyTypeForm, formatDay, money, parseEgp, priceProblems, reasonProblem, typeProblems } from './ticketing'

describe('money', () => {
  it('shows whole pounds without decimals and keeps piastres', () => {
    expect(money(5000)).toBe('50 EGP')
    expect(money(12550)).toBe('125.50 EGP')
    expect(money(150000)).toBe('1,500 EGP')
    expect(money(null)).toBe('—')
  })
})

describe('parseEgp', () => {
  it('turns a price in pounds into piastres', () => {
    expect(parseEgp('50')).toBe(5000)
    expect(parseEgp('62.5')).toBe(6250)
    expect(parseEgp(' 62.50 ')).toBe(6250)
    expect(parseEgp('1,250')).toBe(125000)
    expect(parseEgp('0.01')).toBe(1)
  })
  it('refuses zero, negative, free, fractional piastres, text and absurd amounts', () => {
    for (const bad of ['', '0', '0.00', '-5', '50.001', 'abc', '1e3', '5 0', '.5', '100001', '99999999']) expect(parseEgp(bad)).toBeNull()
  })
})

describe('cancellation reason', () => {
  it('needs a real reason', () => {
    expect(reasonProblem('')).toMatch(/why/i)
    expect(reasonProblem('   ')).toMatch(/why/i)
    expect(reasonProblem('abc')).toMatch(/more detail/i)
    expect(reasonProblem('Park closed by the governor')).toBeNull()
    expect(reasonProblem('x'.repeat(501))).toMatch(/500/)
  })
  it('allows cancelling only an unpaid or paid order', () => {
    expect(canCancelOrder('PENDING_PAYMENT')).toBe(true)
    expect(canCancelOrder('PAID')).toBe(true)
    expect(canCancelOrder('CANCELLED')).toBe(false)
    expect(canCancelOrder('EXPIRED')).toBe(false)
  })
})

describe('tickets and e-mail', () => {
  const at = (iso: string | null) => (iso ? 'T' : '—')
  it('lets staff cancel only a waiting or valid ticket', () => {
    expect(canCancelTicket('VALID')).toBe(true)
    expect(canCancelTicket('PENDING')).toBe(true)
    for (const s of ['USED', 'CANCELLED', 'EXPIRED']) expect(canCancelTicket(s)).toBe(false)
  })
  it('offers a resend only for a paid order', () => {
    expect(canResendTickets('PAID')).toBe(true)
    for (const s of ['PENDING_PAYMENT', 'CANCELLED', 'EXPIRED'] as const) expect(canResendTickets(s)).toBe(false)
  })
  it('says what happened to an e-mail and what comes next', () => {
    expect(emailSummary({ status: 'SENT', attempts: 1, nextAttemptAt: null, sentAt: 'x' }, at)).toBe('Sent T')
    expect(emailSummary({ status: 'PENDING', attempts: 0, nextAttemptAt: null, sentAt: null }, at)).toMatch(/Waiting/)
    expect(emailSummary({ status: 'FAILED', attempts: 2, nextAttemptAt: 'x', sentAt: null }, at)).toMatch(/attempt 2 of 5\); next try T/)
    expect(emailSummary({ status: 'FAILED', attempts: 5, nextAttemptAt: null, sentAt: null }, at)).toMatch(/will not be tried again.*Resend/)
    expect(emailSummary({ status: 'FAILED', attempts: 1, nextAttemptAt: null, sentAt: null }, at)).toMatch(/after 1 attempt;/)
  })
})

describe('ticket type form', () => {
  const ok = { ...emptyTypeForm(), code: 'SENIOR', nameEn: 'Senior', nameAr: 'كبار السن', minAge: '60' }
  it('accepts a valid type with no upper age', () => {
    expect(typeProblems(ok, true)).toEqual({})
    expect(ageRange({ minAge: 60, maxAge: null })).toBe('60+')
    expect(ageRange({ minAge: 2, maxAge: 8 })).toBe('2–8')
  })
  it('never allows a ticket for children under 2', () => {
    for (const minAge of ['0', '1', '-3']) expect(typeProblems({ ...ok, minAge }, true).minAge).toMatch(/under 2/)
    expect(typeProblems({ ...ok, minAge: '2' }, true)).toEqual({})
  })
  it('checks the code, names and the age range', () => {
    expect(typeProblems({ ...ok, code: 'a b' }, true).code).toBeDefined()
    expect(typeProblems({ ...ok, code: 'a b' }, false).code).toBeUndefined() // the code is fixed after creation
    expect(typeProblems({ ...ok, nameEn: '', nameAr: ' ' }, true)).toMatchObject({ nameEn: expect.any(String), nameAr: expect.any(String) })
    expect(typeProblems({ ...ok, minAge: '9', maxAge: '5' }, true).maxAge).toMatch(/below/)
    expect(typeProblems({ ...ok, minAge: 'x' }, true).minAge).toBeDefined()
    expect(typeProblems({ ...ok, maxAge: '4.5' }, true).maxAge).toBeDefined()
  })
})

describe('price form', () => {
  const ok = { ticketTypeId: 't', audienceId: 'a', days: 'WEEKDAY' as const, amount: '75', validFrom: '2026-10-20', notes: '' }
  it('accepts a future price and refuses a past start', () => {
    expect(priceProblems(ok, '2026-10-07')).toEqual({})
    expect(priceProblems({ ...ok, validFrom: '2026-10-07' }, '2026-10-07')).toEqual({})
    expect(priceProblems({ ...ok, validFrom: '2026-10-06' }, '2026-10-07').validFrom).toMatch(/today or later/)
  })
  it('refuses a missing choice or a zero price', () => {
    expect(priceProblems({ ...ok, ticketTypeId: '', audienceId: '' }, '2026-10-07')).toMatchObject({ ticketTypeId: expect.any(String), audienceId: expect.any(String) })
    expect(priceProblems({ ...ok, amount: '0' }, '2026-10-07').amount).toBeDefined()
    expect(priceProblems({ ...ok, validFrom: '' }, '2026-10-07').validFrom).toBeDefined()
  })
})

describe('dates', () => {
  it('finds the day before, across month and year ends', () => {
    expect(dayBefore('2026-10-20')).toBe('2026-10-19')
    expect(dayBefore('2026-11-01')).toBe('2026-10-31')
    expect(dayBefore('2027-01-01')).toBe('2026-12-31')
  })
  it('formats a calendar day without any time-zone shift', () => {
    expect(formatDay('2026-10-08')).toBe('8 Oct 2026')
    expect(formatDay('2027-01-01')).toBe('1 Jan 2027')
    expect(formatDay(null)).toBe('—')
  })
})
