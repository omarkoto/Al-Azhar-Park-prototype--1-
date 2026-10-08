export type RangeKey = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth' | 'custom'
export type Basis = 'sale' | 'visit'
export type Granularity = 'day' | 'week' | 'month'
export type DayType = 'WEEKDAY' | 'WEEKEND'

export const RANGE_LABEL: Record<RangeKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  thisMonth: 'This month',
  lastMonth: 'Previous month',
  custom: 'Custom range',
}
export const RANGE_KEYS = Object.keys(RANGE_LABEL) as RangeKey[]
export const BASIS_LABEL: Record<Basis, string> = { sale: 'Sale date', visit: 'Visit date' }
export const BASIS_HINT: Record<Basis, string> = {
  sale: 'Counted on the day the order was placed.',
  visit: 'Counted on the day the visitor is admitted (the ticket’s visit date).',
}

/** What the person chose on the screen. It is kept in the address bar so a report can be bookmarked or shared. */
export interface AnalyticsFilters {
  range: RangeKey
  from: string
  to: string
  basis: Basis
  ticketType: string
  audience: string
  dayType: '' | DayType
  gateId: string
}

export const DEFAULT_FILTERS: AnalyticsFilters = { range: 'last7', from: '', to: '', basis: 'sale', ticketType: '', audience: '', dayType: '', gateId: '' }

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function filtersFromParams(params: URLSearchParams): AnalyticsFilters {
  const range = params.get('range') as RangeKey | null
  const basis = params.get('basis')
  const dayType = params.get('dayType')
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const custom = ISO_DAY.test(from) && ISO_DAY.test(to)
  return {
    range: range && RANGE_KEYS.includes(range) ? range : custom ? 'custom' : DEFAULT_FILTERS.range,
    from: ISO_DAY.test(from) ? from : '',
    to: ISO_DAY.test(to) ? to : '',
    basis: basis === 'visit' ? 'visit' : 'sale',
    ticketType: (params.get('ticketType') ?? '').toUpperCase(),
    audience: (params.get('audience') ?? '').toUpperCase(),
    dayType: dayType === 'WEEKDAY' || dayType === 'WEEKEND' ? dayType : '',
    gateId: params.get('gateId') ?? '',
  }
}

/** The query string for the server. A ready-made range sends its name (the server works out Cairo days); a custom one sends dates. */
export function queryOf(f: AnalyticsFilters, keep: Array<keyof AnalyticsFilters> = ['basis', 'ticketType', 'audience', 'dayType', 'gateId']): URLSearchParams {
  const p = new URLSearchParams()
  if (f.range === 'custom') {
    if (f.from) p.set('from', f.from)
    if (f.to) p.set('to', f.to)
  } else {
    p.set('range', f.range)
  }
  for (const k of keep) {
    const v = f[k]
    if (v) p.set(k, String(v))
  }
  return p
}

/** The same choices as an address-bar query (kept short: defaults are left out). */
export function paramsOf(f: AnalyticsFilters): URLSearchParams {
  const p = queryOf(f)
  if (f.range === DEFAULT_FILTERS.range) p.delete('range')
  if (f.range === 'custom') p.set('range', 'custom') // so choosing "Custom range" stays chosen before any date is typed
  if (f.basis === 'sale') p.delete('basis')
  return p
}

/** A problem with a custom range that can be told before asking the server, or null. */
export function rangeProblem(f: Pick<AnalyticsFilters, 'range' | 'from' | 'to'>, maxDays = 366): string | null {
  if (f.range !== 'custom') return null
  if (!f.from || !f.to) return 'Choose both a start date and an end date.'
  if (!ISO_DAY.test(f.from) || !ISO_DAY.test(f.to)) return 'Enter the dates as day, month and year.'
  if (f.from > f.to) return 'The start date must not be after the end date.'
  const days = (Date.parse(`${f.to}T00:00:00Z`) - Date.parse(`${f.from}T00:00:00Z`)) / 86_400_000 + 1
  if (days > maxDays) return `A report can cover at most ${maxDays} days. Choose a shorter period.`
  return null
}

const NUMBER = new Intl.NumberFormat('en-US')
export const count = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : NUMBER.format(n))
export const percent = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : `${NUMBER.format(n)}%`)

/** EGP with two decimals, from piastres. */
export function egp(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '—'
  return `EGP ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100)}`
}

/** The file name the server gives an export, so the browser saves the same name. */
export function exportFilename(report: string, range: { from: string; to: string }, basis: Basis): string {
  const suffix = report === 'sales' || report === 'tickets' ? `-${basis}` : ''
  return `azharpark-${report}-${range.from}_${range.to}${suffix}.csv`
}

/** The label of one bar or point on a time axis: the day, or "week of ..." / the month. */
export function bucketLabel(bucket: string, granularity: Granularity): string {
  const [y, m, d] = bucket.split('-').map(Number)
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]
  if (granularity === 'month') return `${month} ${y}`
  return granularity === 'week' ? `Week of ${d} ${month}` : `${d} ${month}`
}

// ───────────────────────────── chart geometry ─────────────────────────────

/** A round top for an axis so the gridlines fall on friendly numbers: 7 → 8, 130 → 150, 0 → 1. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(value)))
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (value <= step * exp) return step * exp
  return 10 * exp
}

/** Gridline values from 0 to the top, at most `lines` + 1 of them. */
export function ticksOf(top: number, lines = 4): number[] {
  return Array.from({ length: lines + 1 }, (_, i) => (top / lines) * i)
}

export interface Bar {
  x: number
  y: number
  width: number
  height: number
}

/** Bars for one series in a plot `width` × `height` (zero at the bottom). A zero value is a zero-height bar, never hidden or negative. */
export function barsOf(values: number[], top: number, width: number, height: number, gap = 0.25): Bar[] {
  if (values.length === 0) return []
  const slot = width / values.length
  const bar = slot * (1 - gap)
  return values.map((v, i) => {
    const h = top > 0 ? (Math.max(0, v) / top) * height : 0
    return { x: i * slot + (slot - bar) / 2, y: height - h, width: bar, height: h }
  })
}

/** Points of a line through the series, one per slot centre. */
export function pointsOf(values: number[], top: number, width: number, height: number): Array<{ x: number; y: number }> {
  if (values.length === 0) return []
  const slot = width / values.length
  return values.map((v, i) => ({ x: i * slot + slot / 2, y: top > 0 ? height - (Math.max(0, v) / top) * height : height }))
}

/** Which labels on a crowded axis to print: every n-th, always including the first. */
export function labelEvery(total: number, fit = 10): number {
  return Math.max(1, Math.ceil(total / fit))
}

// ───────────────────────────── response shapes ─────────────────────────────

export interface RangeView {
  key: RangeKey
  from: string
  to: string
  days: number
  granularity: Granularity
}

export interface Named {
  id: string
  code: string
  nameEn: string
  nameAr: string
}

export interface SalesReport {
  range: RangeView
  basis: Basis
  filtered: boolean
  currency: string
  kpis: {
    paidOrders: number
    ticketsSold: number
    ticketsCancelledInPaidOrders: number
    paidSalesMinor: number
    averagePaidOrderMinor: number | null
    cancelledAfterPayment: { orders: number; tickets: number; valueMinor: number }
  }
  ordersPlaced: { total: number; paid: number; unpaid: number; expired: number; cancelled: number } | null
  series: Array<{ bucket: string; paidOrders: number; tickets: number; cancelledTickets: number; paidSalesMinor: number }>
  byTicketType: SalesSlice[]
  byAudience: SalesSlice[]
  byDayType: SalesSlice[]
  byTicketTypeAndAudience: Array<{ ticketTypeCode: string; ticketTypeNameEn: string; audienceCode: string; audienceNameEn: string; tickets: number; cancelled: number; valueMinor: number }>
}

export interface SalesSlice extends Named {
  tickets: number
  cancelled: number
  valueMinor: number
  shareOfTicketsPercent: number | null
  shareOfValuePercent?: number | null
}

export interface AttendanceReport {
  range: RangeView
  kpis: { entries: number; refusedScans: number; totalScans: number; refusedSharePercent: number | null; busiestGate: { code: string; nameEn: string; entries: number } | null }
  series: Array<{ bucket: string; entries: number; refused: number }>
  results: Array<{ code: string; granted: boolean; scans: number; sharePercent: number | null }>
  byGate: Array<{ id: string | null; code: string; nameEn: string; nameAr: string; entries: number; refused: number; scans: number; shareOfEntriesPercent: number | null }>
  entriesByTicketType: Array<Named & { entries: number; shareOfEntriesPercent: number | null }>
  entriesByAudience: Array<Named & { entries: number; shareOfEntriesPercent: number | null }>
}

export interface TicketsReport {
  range: RangeView
  basis: Basis
  asOf: string
  kpis: { total: number; valid: number; used: number; cancelled: number; pending: number; expired: number; usedAfterVisitDate: number; validButDatePassed: number; usedSharePercentOfPastValid: number | null }
  series: Array<{ bucket: string; valid: number; used: number; cancelled: number; notPaid: number }>
  byTypeAudienceStatus: Array<{ status: string; ticketTypeCode: string; ticketTypeNameEn: string; audienceCode: string; audienceNameEn: string; tickets: number; valueMinor?: number }>
}

export interface EventsReport {
  range: RangeView
  kpis: {
    inPeriod: number
    publishedInPeriod: number
    comingSoonInPeriod: number
    draftInPeriod: number
    cancelledInPeriod: number
    archivedInPeriod: number
    allTime: { draft: number; comingSoon: number; published: number; cancelled: number; archived: number }
  }
  series: Array<{ bucket: string; events: number }>
  byVenue: Array<{ venueEn: string; venueAr: string; events: number }>
  list: Array<{ id: string; titleEn: string; titleAr: string; status: string; date: string; venueEn: string | null; venueAr: string | null }>
  listTruncated: boolean
}

export interface Overview {
  range: RangeView
  basis: Basis
  sales?: Pick<SalesReport, 'kpis' | 'ordersPlaced' | 'series' | 'byTicketType' | 'byAudience'>
  attendance?: Pick<AttendanceReport, 'kpis' | 'series' | 'results'>
  tickets?: Pick<TicketsReport, 'kpis'>
  events?: Pick<EventsReport, 'kpis'>
}

export const SCAN_RESULT_LABEL: Record<string, string> = {
  ACCESS_GRANTED: 'Let in',
  ALREADY_USED: 'Already used',
  WRONG_DATE: 'Wrong date',
  CANCELLED: 'Cancelled ticket',
  EXPIRED: 'Expired ticket',
  TICKET_NOT_VALID: 'Ticket not valid',
  TICKET_NOT_FOUND: 'Ticket not found',
  INVALID_QR: 'Unreadable code',
  INVALID_SIGNATURE: 'Forged or altered code',
  RETIRED_KEY: 'Retired code key',
}
export const scanResultLabel = (code: string): string => SCAN_RESULT_LABEL[code] ?? code

export const TICKET_STATE_LABEL: Record<string, string> = { VALID: 'Valid', USED: 'Used', CANCELLED: 'Cancelled', PENDING: 'Awaiting payment', EXPIRED: 'Expired' }

export type ExportReportKey = 'sales' | 'attendance' | 'tickets' | 'gates' | 'scans' | 'events'

export interface ExportDef {
  key: ExportReportKey
  label: string
  description: string
  /** shown when the person holds any of these */
  anyOf: string[]
  basis: boolean
}

export const EXPORTS: ExportDef[] = [
  { key: 'sales', label: 'Sales', description: 'Paid tickets and their value by day, ticket type, audience and weekday / weekend.', anyOf: ['analytics:read'], basis: true },
  { key: 'attendance', label: 'Attendance', description: 'Visitors let in at the gates, by day, ticket type and audience.', anyOf: ['analytics:read', 'analytics:operations'], basis: false },
  { key: 'tickets', label: 'Ticket states', description: 'What the tickets are now (valid, used, cancelled …) by type and audience.', anyOf: ['analytics:read', 'analytics:operations'], basis: true },
  { key: 'gates', label: 'Gates', description: 'Entries and refused scans for each gate.', anyOf: ['analytics:read', 'analytics:operations'], basis: false },
  { key: 'scans', label: 'Scan results', description: 'Every scan result by day and gate (let in, already used, wrong date …).', anyOf: ['analytics:read', 'analytics:operations'], basis: false },
  { key: 'events', label: 'Events', description: 'Events in the period with status and venue.', anyOf: ['analytics:read', 'analytics:content'], basis: false },
]

/** What the person holds, in the analytics sense, worked out from permission codes only. */
export function analyticsAccess(can: (p: string) => boolean) {
  const read = can('analytics:read')
  return { money: read, operations: read || can('analytics:operations'), content: read || can('analytics:content') }
}
