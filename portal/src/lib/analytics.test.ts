import { describe, expect, it } from 'vitest'
import { NAV_GROUPS, visibleNav } from './navigation'
import {
  analyticsAccess, barsOf, bucketLabel, count, DEFAULT_FILTERS, egp, EXPORTS, exportFilename, filtersFromParams, labelEvery, niceMax, paramsOf, percent, pointsOf, queryOf, rangeProblem, scanResultLabel, ticksOf,
} from './analytics'

const canOnly = (...codes: string[]) => (p: string) => codes.includes(p)

describe('the period and filters in the address bar', () => {
  it('starts on the last 7 days by sale date with no filters', () => {
    expect(filtersFromParams(new URLSearchParams(''))).toEqual(DEFAULT_FILTERS)
  })

  it('reads a ready-made range, a custom range and the filters back', () => {
    expect(filtersFromParams(new URLSearchParams('range=thisMonth&basis=visit&ticketType=adult&audience=visitor&dayType=WEEKEND&gateId=g1'))).toMatchObject({
      range: 'thisMonth', basis: 'visit', ticketType: 'ADULT', audience: 'VISITOR', dayType: 'WEEKEND', gateId: 'g1',
    })
    expect(filtersFromParams(new URLSearchParams('from=2026-10-03&to=2026-10-05'))).toMatchObject({ range: 'custom', from: '2026-10-03', to: '2026-10-05' })
  })

  it('ignores nonsense instead of passing it on', () => {
    expect(filtersFromParams(new URLSearchParams('range=forever&basis=payment&dayType=SOMEDAY&from=yesterday&to=tomorrow'))).toEqual(DEFAULT_FILTERS)
  })

  it('asks the server by name for a ready-made range and by dates for a custom one', () => {
    expect(queryOf({ ...DEFAULT_FILTERS, range: 'today' }).toString()).toBe('range=today&basis=sale')
    const custom = queryOf({ ...DEFAULT_FILTERS, range: 'custom', from: '2026-10-03', to: '2026-10-05', basis: 'visit', ticketType: 'CHILD' })
    expect(custom.get('range')).toBeNull()
    expect(custom.get('from')).toBe('2026-10-03')
    expect(custom.get('to')).toBe('2026-10-05')
    expect(custom.get('basis')).toBe('visit')
    expect(custom.get('ticketType')).toBe('CHILD')
  })

  it('can leave out filters a report does not use', () => {
    const q = queryOf({ ...DEFAULT_FILTERS, range: 'today', ticketType: 'CHILD', gateId: 'g1' }, ['gateId'])
    expect(q.toString()).toBe('range=today&gateId=g1')
  })

  it('keeps the address short: defaults are not written', () => {
    expect(paramsOf(DEFAULT_FILTERS).toString()).toBe('')
    expect(paramsOf({ ...DEFAULT_FILTERS, range: 'last30', basis: 'visit' }).toString()).toBe('range=last30&basis=visit')
    const round = filtersFromParams(paramsOf({ ...DEFAULT_FILTERS, range: 'custom', from: '2026-10-01', to: '2026-10-07', dayType: 'WEEKDAY' }))
    expect(round).toMatchObject({ range: 'custom', from: '2026-10-01', to: '2026-10-07', dayType: 'WEEKDAY' })
  })

  it('keeps "Custom range" chosen while the dates are still being typed', () => {
    const chosen = filtersFromParams(paramsOf({ ...DEFAULT_FILTERS, range: 'custom' }))
    expect(chosen).toMatchObject({ range: 'custom', from: '', to: '' })
    const half = filtersFromParams(paramsOf({ ...DEFAULT_FILTERS, range: 'custom', from: '2026-10-01' }))
    expect(half).toMatchObject({ range: 'custom', from: '2026-10-01', to: '' })
    expect(queryOf({ ...DEFAULT_FILTERS, range: 'custom', from: '2026-10-01', to: '2026-10-07' }).get('range')).toBeNull() // the server is asked by dates
  })
})

describe('checking a custom range before asking', () => {
  const custom = (from: string, to: string) => ({ range: 'custom' as const, from, to })
  it('accepts a ready-made range and a sensible custom one', () => {
    expect(rangeProblem({ range: 'today', from: '', to: '' })).toBeNull()
    expect(rangeProblem(custom('2026-10-01', '2026-10-07'))).toBeNull()
    expect(rangeProblem(custom('2026-10-07', '2026-10-07'))).toBeNull()
  })
  it('explains each problem', () => {
    expect(rangeProblem(custom('', '2026-10-07'))).toMatch(/both/)
    expect(rangeProblem(custom('2026-10-08', '2026-10-07'))).toMatch(/not be after/)
    expect(rangeProblem(custom('2026-01-01', '2027-01-02'))).toMatch(/at most 366 days/)
  })
  it('allows exactly the maximum and follows a configured one', () => {
    expect(rangeProblem(custom('2026-01-01', '2027-01-01'))).toBeNull() // 366 days
    expect(rangeProblem(custom('2026-10-01', '2026-11-01'), 31)).toMatch(/at most 31 days/)
    expect(rangeProblem(custom('2026-10-01', '2026-10-31'), 31)).toBeNull()
  })
})

describe('numbers and money', () => {
  it('shows counts with separators and a dash for "no figure"', () => {
    expect(count(1234567)).toBe('1,234,567')
    expect(count(0)).toBe('0')
    expect(count(null)).toBe('—')
    expect(percent(66.7)).toBe('66.7%')
    expect(percent(null)).toBe('—')
  })
  it('shows piastres as pounds with two decimals, exactly', () => {
    expect(egp(15400)).toBe('EGP 154.00')
    expect(egp(5)).toBe('EGP 0.05')
    expect(egp(123456789)).toBe('EGP 1,234,567.89')
    expect(egp(0)).toBe('EGP 0.00')
    expect(egp(null)).toBe('—')
  })
  it('names an export file the way the server does', () => {
    expect(exportFilename('sales', { from: '2026-10-01', to: '2026-10-07' }, 'visit')).toBe('azharpark-sales-2026-10-01_2026-10-07-visit.csv')
    expect(exportFilename('tickets', { from: '2026-10-01', to: '2026-10-07' }, 'sale')).toBe('azharpark-tickets-2026-10-01_2026-10-07-sale.csv')
    expect(exportFilename('gates', { from: '2026-10-01', to: '2026-10-07' }, 'visit')).toBe('azharpark-gates-2026-10-01_2026-10-07.csv')
  })
  it('labels the axis by day, week or month', () => {
    expect(bucketLabel('2026-10-07', 'day')).toBe('7 Oct')
    expect(bucketLabel('2026-10-05', 'week')).toBe('Week of 5 Oct')
    expect(bucketLabel('2026-10-01', 'month')).toBe('Oct 2026')
  })
  it('gives every scan result a readable name', () => {
    expect(scanResultLabel('ACCESS_GRANTED')).toBe('Let in')
    expect(scanResultLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })
})

describe('chart geometry', () => {
  it('rounds the top of an axis to a friendly number that is never below the data', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(7)).toBe(8)
    expect(niceMax(130)).toBe(150)
    expect(niceMax(1000)).toBe(1000)
    expect(niceMax(1001)).toBe(1500)
    for (const v of [1, 3, 9, 11, 49, 51, 99, 101, 12345, 987654]) expect(niceMax(v)).toBeGreaterThanOrEqual(v)
  })
  it('puts gridlines from zero to the top', () => {
    expect(ticksOf(8, 4)).toEqual([0, 2, 4, 6, 8])
  })
  it('scales bars to the plot, zero at the bottom, and a zero is a flat bar', () => {
    const bars = barsOf([0, 5, 10], 10, 300, 100)
    expect(bars.map((b) => b.height)).toEqual([0, 50, 100])
    expect(bars.map((b) => b.y)).toEqual([100, 50, 0])
    expect(bars[0].x).toBeLessThan(bars[1].x)
    expect(bars.every((b) => b.x >= 0 && b.x + b.width <= 300)).toBe(true)
    expect(barsOf([], 10, 300, 100)).toEqual([])
    expect(barsOf([3], 0, 300, 100)[0].height).toBe(0) // no data at all: nothing divides by zero
    expect(barsOf([-4], 10, 300, 100)[0].height).toBe(0) // never negative
  })
  it('puts a line point in the middle of each slot', () => {
    expect(pointsOf([0, 10], 10, 200, 100)).toEqual([{ x: 50, y: 100 }, { x: 150, y: 0 }])
  })
  it('thins crowded axis labels', () => {
    expect(labelEvery(7)).toBe(1)
    expect(labelEvery(30)).toBe(3)
    expect(labelEvery(366)).toBe(37)
  })
})

describe('what each person may open', () => {
  it('works out access from the analytics permissions only', () => {
    expect(analyticsAccess(canOnly('analytics:read'))).toEqual({ money: true, operations: true, content: true })
    expect(analyticsAccess(canOnly('analytics:operations'))).toEqual({ money: false, operations: true, content: false })
    expect(analyticsAccess(canOnly('analytics:content'))).toEqual({ money: false, operations: false, content: true })
    expect(analyticsAccess(canOnly('orders:read', 'payments:read', 'scans:read'))).toEqual({ money: false, operations: false, content: false })
  })

  it('offers each report only to someone who may read it', () => {
    const open = (p: (c: string) => boolean) => EXPORTS.filter((e) => e.anyOf.some(p)).map((e) => e.key)
    expect(open(canOnly('analytics:read'))).toEqual(['sales', 'attendance', 'tickets', 'gates', 'scans', 'events'])
    expect(open(canOnly('analytics:operations'))).toEqual(['attendance', 'tickets', 'gates', 'scans'])
    expect(open(canOnly('analytics:content'))).toEqual(['events'])
    expect(open(canOnly())).toEqual([])
  })

  it('adds an Analytics menu group that follows those permissions', () => {
    const titles = (p: (c: string) => boolean) => visibleNav(p).map((g) => g.title)
    const items = (p: (c: string) => boolean) => visibleNav(p).filter((g) => g.title === 'Analytics').flatMap((g) => g.items.map((i) => i.label))
    expect(titles(canOnly())).toEqual([])
    expect(items(canOnly('orders:read'))).toEqual([])
    expect(items(canOnly('analytics:read'))).toEqual(['Overview', 'Sales', 'Attendance', 'Ticket states', 'Event statistics', 'Reports'])
    expect(items(canOnly('analytics:operations'))).toEqual(['Overview', 'Attendance', 'Ticket states', 'Reports'])
    expect(items(canOnly('analytics:content'))).toEqual(['Overview', 'Event statistics', 'Reports'])
    expect(NAV_GROUPS.some((g) => g.title === 'Analytics')).toBe(true)
  })
})
