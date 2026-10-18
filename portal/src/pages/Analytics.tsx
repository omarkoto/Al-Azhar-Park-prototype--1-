import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChartCard, DataTable, ShareBars, Stat } from '../components/charts'
import { Badge, Button, Card, Notice, PageHeader, Select, Spinner, TextInput } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import {
  analyticsAccess, BASIS_HINT, BASIS_LABEL, bucketLabel, count, egp, EXPORTS, exportFilename, filtersFromParams, paramsOf, percent, queryOf, RANGE_KEYS, RANGE_LABEL, rangeProblem, scanResultLabel,
  TICKET_STATE_LABEL, type AnalyticsFilters, type AttendanceReport, type Basis, type DayType, type EventsReport, type ExportDef, type Named, type Overview, type RangeView, type SalesReport,
  type TicketsReport,
} from '../lib/analytics'
import { useAuth } from '../lib/auth'
import { formatDay } from '../lib/ticketing'

const TEAL = '#0f766e'
const AMBER = '#d97706'
const RED = '#b91c1c'
const STONE = '#78716c'
const compactMoney = (minor: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(minor / 100)

type Keep = Array<keyof AnalyticsFilters>

/** The period and filters, kept in the address bar so a report can be bookmarked or sent to a colleague. */
function useFilters(): [AnalyticsFilters, (next: Partial<AnalyticsFilters>) => void] {
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => filtersFromParams(params), [params])
  const set = useCallback(
    (next: Partial<AnalyticsFilters>) => {
      setParams(paramsOf({ ...filtersFromParams(params), ...next }), { replace: true })
    },
    [params, setParams],
  )
  return [filters, set]
}

/** One report for the current filters. Nothing is asked of the server while a custom range is incomplete or invalid. */
function useReport<T>(path: string, filters: AnalyticsFilters, keep: Keep) {
  const problem = rangeProblem(filters)
  const query = problem ? null : queryOf(filters, keep).toString()
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const latest = useRef(0)
  const load = useCallback(async () => {
    if (query === null) return
    const mine = ++latest.current
    setLoading(true)
    try {
      const r = await api.get<T>(`/analytics/${path}?${query}`)
      if (mine === latest.current) {
        setData(r)
        setError(null)
      }
    } catch (e) {
      if (mine === latest.current) setError(errorMessage(e))
    } finally {
      if (mine === latest.current) setLoading(false)
    }
  }, [path, query])
  useEffect(() => {
    void load()
  }, [load])
  return { data, error, loading, problem, reload: load }
}

/** Remembers the choices (ticket types, audiences, gates) seen while no filter hid the others. */
function useOptions(items: Named[] | undefined, active: boolean): Named[] {
  const [seen, setSeen] = useState<Named[]>([])
  useEffect(() => {
    if (!active || !items) return
    setSeen((old) => {
      const merged = new Map(old.map((o) => [o.code, o]))
      for (const i of items) merged.set(i.code, i)
      return [...merged.values()].sort((a, b) => a.code.localeCompare(b.code))
    })
  }, [items, active])
  return seen
}

interface BarOptions {
  basis?: boolean
  ticketTypes?: Named[]
  audiences?: Named[]
  dayType?: boolean
  gates?: Named[]
}

function RangeBar({ filters, set, problem, options = {} }: { filters: AnalyticsFilters; set: (n: Partial<AnalyticsFilters>) => void; problem: string | null; options?: BarOptions }) {
  const withCurrent = (list: Named[] | undefined, value: string, by: 'code' | 'id' = 'code'): Named[] => (value && !(list ?? []).some((o) => o[by] === value) ? [...(list ?? []), { id: value, code: value, nameEn: value, nameAr: value }] : (list ?? []))
  const types = withCurrent(options.ticketTypes, filters.ticketType)
  const audiences = withCurrent(options.audiences, filters.audience)
  const gates = withCurrent(options.gates, filters.gateId, 'id')
  const filtered = filters.ticketType || filters.audience || filters.dayType || filters.gateId
  return (
    <Card>
      <form className="space-y-4" onSubmit={(e) => e.preventDefault()} aria-label="Period and filters" data-testid="range-bar">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Period">
          {RANGE_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={filters.range === k}
              data-testid={`range-${k}`}
              onClick={() => set({ range: k })}
              className={`rounded-full border px-3 py-1 text-sm ${filters.range === k ? 'border-teal-700 bg-teal-700 text-white' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'}`}
            >
              {RANGE_LABEL[k]}
            </button>
          ))}
        </div>
        {filters.range === 'custom' && (
          <div className="grid gap-3 sm:grid-cols-2 lg:max-w-xl">
            <TextInput label="From" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} data-testid="range-from" />
            <TextInput label="To" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} data-testid="range-to" />
          </div>
        )}
        {problem && <Notice tone="warn">{problem}</Notice>}
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5 lg:items-end">
          {options.basis && (
            <Select label="Count by" value={filters.basis} onChange={(e) => set({ basis: e.target.value as Basis })} data-testid="filter-basis">
              {(['sale', 'visit'] as Basis[]).map((b) => (
                <option key={b} value={b}>
                  {BASIS_LABEL[b]}
                </option>
              ))}
            </Select>
          )}
          {options.ticketTypes && (
            <Select label="Ticket type" value={filters.ticketType} onChange={(e) => set({ ticketType: e.target.value })} data-testid="filter-type">
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.nameEn}
                </option>
              ))}
            </Select>
          )}
          {options.audiences && (
            <Select label="Audience" value={filters.audience} onChange={(e) => set({ audience: e.target.value })} data-testid="filter-audience">
              <option value="">Everyone</option>
              {audiences.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.nameEn}
                </option>
              ))}
            </Select>
          )}
          {options.dayType && (
            <Select label="Weekday / weekend" value={filters.dayType} onChange={(e) => set({ dayType: e.target.value as '' | DayType })} data-testid="filter-daytype">
              <option value="">Any day</option>
              <option value="WEEKDAY">Weekday (Sun–Thu)</option>
              <option value="WEEKEND">Weekend (Fri–Sat)</option>
            </Select>
          )}
          {options.gates && (
            <Select label="Gate" value={filters.gateId} onChange={(e) => set({ gateId: e.target.value })} data-testid="filter-gate">
              <option value="">All gates</option>
              {gates.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nameEn}
                </option>
              ))}
            </Select>
          )}
        </div>
        {options.basis && <p className="text-xs text-stone-500">{BASIS_HINT[filters.basis]}</p>}
        {filtered && (
          <button type="button" className="text-sm font-medium text-teal-800 hover:underline" onClick={() => set({ ticketType: '', audience: '', dayType: '', gateId: '' })}>
            Clear filters
          </button>
        )}
      </form>
    </Card>
  )
}

function PeriodLine({ range }: { range: RangeView }) {
  const same = range.from === range.to
  return (
    <p className="text-sm text-stone-600" data-testid="period-line">
      {same ? formatDay(range.from) : `${formatDay(range.from)} – ${formatDay(range.to)}`} · {range.days} {range.days === 1 ? 'day' : 'days'} · Cairo time · by {range.granularity}
    </p>
  )
}

function State({ error, problem, reload, loading, hasData }: { error: string | null; problem: string | null; reload: () => void; loading: boolean; hasData: boolean }) {
  if (problem) return null
  if (error)
    return (
      <Notice tone="error">
        {error}{' '}
        <button className="font-semibold underline" onClick={reload}>
          Try again
        </button>
      </Notice>
    )
  if (!hasData && loading) return <Spinner label="Loading the report…" />
  return null
}

const sliceItems = (rows: Array<Named & { tickets: number; shareOfTicketsPercent: number | null }>) => rows.map((r) => ({ label: r.nameEn, value: r.tickets, share: r.shareOfTicketsPercent }))

// ───────────────────────────── overview ─────────────────────────────

export function AnalyticsOverviewPage() {
  const { can } = useAuth()
  const access = analyticsAccess(can)
  const [filters, set] = useFilters()
  const { data, error, loading, problem, reload } = useReport<Overview>('overview', filters, ['basis'])
  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Sales, attendance, tickets and events for one period. Sales, payments and attendance are reported separately." />
      <RangeBar filters={filters} set={set} problem={problem} options={{ basis: access.money }} />
      <State error={error} problem={problem} reload={() => void reload()} loading={loading} hasData={!!data} />
      {data && !problem && (
        <div className={loading ? 'space-y-6 opacity-60' : 'space-y-6'} data-testid="overview">
          <PeriodLine range={data.range} />
          {data.sales && (
            <section aria-labelledby="ov-sales" className="space-y-3">
              <h2 id="ov-sales" className="text-lg font-semibold text-stone-900">
                Sales <span className="text-sm font-normal text-stone-500">({BASIS_LABEL[data.basis].toLowerCase()})</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Paid sales" value={egp(data.sales.kpis.paidSalesMinor)} note="Paid orders only" testId="kpi-sales" />
                <Stat label="Paid orders" value={count(data.sales.kpis.paidOrders)} testId="kpi-orders" />
                <Stat label="Tickets sold" value={count(data.sales.kpis.ticketsSold)} testId="kpi-tickets-sold" />
                <Stat label="Average paid order" value={egp(data.sales.kpis.averagePaidOrderMinor)} testId="kpi-average" />
              </div>
              <ChartCard
                title="Paid sales per period"
                labels={data.sales.series.map((s) => bucketLabel(s.bucket, data.range.granularity))}
                series={[{ name: 'Paid sales', values: data.sales.series.map((s) => s.paidSalesMinor), color: TEAL }]}
                unit="EGP"
                format={egp}
                axisFormat={compactMoney}
              />
            </section>
          )}
          {data.attendance && (
            <section aria-labelledby="ov-att" className="space-y-3">
              <h2 id="ov-att" className="text-lg font-semibold text-stone-900">
                Attendance <span className="text-sm font-normal text-stone-500">(visitors let in at the gates, by day of entry)</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Entries" value={count(data.attendance.kpis.entries)} testId="kpi-entries" />
                <Stat label="Refused scans" value={count(data.attendance.kpis.refusedScans)} testId="kpi-refused" />
                <Stat label="Refused share" value={percent(data.attendance.kpis.refusedSharePercent)} note="Of all scans" />
                <Stat label="Busiest gate" value={data.attendance.kpis.busiestGate?.nameEn ?? '—'} note={data.attendance.kpis.busiestGate ? `${count(data.attendance.kpis.busiestGate.entries)} entries` : undefined} />
              </div>
              <ChartCard
                title="Entries per period"
                labels={data.attendance.series.map((s) => bucketLabel(s.bucket, data.range.granularity))}
                series={[
                  { name: 'Let in', values: data.attendance.series.map((s) => s.entries), color: TEAL },
                  { name: 'Refused', values: data.attendance.series.map((s) => s.refused), color: RED },
                ]}
                unit="scans"
                format={count}
              />
            </section>
          )}
          {data.tickets && (
            <section aria-labelledby="ov-tix" className="space-y-3">
              <h2 id="ov-tix" className="text-lg font-semibold text-stone-900">
                Tickets <span className="text-sm font-normal text-stone-500">(their state now, for visit dates in the period)</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Tickets" value={count(data.tickets.kpis.total)} />
                <Stat label="Valid, not yet used" value={count(data.tickets.kpis.valid)} />
                <Stat label="Used" value={count(data.tickets.kpis.used)} />
                <Stat label="Cancelled" value={count(data.tickets.kpis.cancelled)} />
              </div>
            </section>
          )}
          {data.events && (
            <section aria-labelledby="ov-ev" className="space-y-3">
              <h2 id="ov-ev" className="text-lg font-semibold text-stone-900">
                Events
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Events in the period" value={count(data.events.kpis.inPeriod)} />
                <Stat label="Published" value={count(data.events.kpis.publishedInPeriod)} />
                <Stat label="Coming soon" value={count(data.events.kpis.comingSoonInPeriod)} />
                <Stat label="Cancelled" value={count(data.events.kpis.cancelledInPeriod)} />
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

// ───────────────────────────── sales ─────────────────────────────

export function AnalyticsSalesPage() {
  const [filters, set] = useFilters()
  const keep: Keep = ['basis', 'ticketType', 'audience', 'dayType']
  const { data, error, loading, problem, reload } = useReport<SalesReport>('sales', filters, keep)
  const unfiltered = !filters.ticketType && !filters.audience && !filters.dayType
  const types = useOptions(data?.byTicketType, unfiltered)
  const audiences = useOptions(data?.byAudience, unfiltered)
  return (
    <div className="space-y-6">
      <PageHeader title="Sales" description="Money from paid orders, at the prices the customers actually paid. Pending, expired and unpaid orders are never counted as sales." />
      <RangeBar filters={filters} set={set} problem={problem} options={{ basis: true, ticketTypes: types, audiences, dayType: true }} />
      <State error={error} problem={problem} reload={() => void reload()} loading={loading} hasData={!!data} />
      {data && !problem && (
        <div className={loading ? 'space-y-6 opacity-60' : 'space-y-6'} data-testid="sales-report">
          <PeriodLine range={data.range} />
          {data.filtered && <Notice tone="info">These figures are for the tickets that match your filters, not whole orders.</Notice>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Paid sales" value={egp(data.kpis.paidSalesMinor)} note="Stored order amounts" testId="kpi-sales" />
            <Stat label="Paid orders" value={count(data.kpis.paidOrders)} testId="kpi-orders" />
            <Stat label="Tickets sold" value={count(data.kpis.ticketsSold)} testId="kpi-tickets-sold" />
            <Stat label="Average paid order" value={egp(data.kpis.averagePaidOrderMinor)} testId="kpi-average" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Tickets cancelled inside paid orders" value={count(data.kpis.ticketsCancelledInPaidOrders)} note="Still part of paid sales: the order was paid in full" />
            <Stat
              label="Paid orders cancelled later"
              value={`${count(data.kpis.cancelledAfterPayment.orders)} · ${egp(data.kpis.cancelledAfterPayment.valueMinor)}`}
              note="Shown apart from paid sales. The system does not refund money."
              testId="kpi-cancelled-after-payment"
            />
          </div>
          {data.ordersPlaced && (
            <Card title="Orders placed" description="Every order started in the period, whatever became of it. Only paid orders are sales.">
              <DataTable
                columns={[{ header: 'Outcome' }, { header: 'Orders', align: 'right' }]}
                rows={[
                  ['Paid', count(data.ordersPlaced.paid)],
                  ['Waiting for payment', count(data.ordersPlaced.unpaid)],
                  ['Expired', count(data.ordersPlaced.expired)],
                  ['Cancelled', count(data.ordersPlaced.cancelled)],
                ]}
                totals={['All orders placed', count(data.ordersPlaced.total)]}
                caption="Orders placed by outcome"
                testId="orders-placed"
              />
            </Card>
          )}
          <ChartCard
            title="Paid sales per period"
            labels={data.series.map((s) => bucketLabel(s.bucket, data.range.granularity))}
            series={[{ name: 'Paid sales', values: data.series.map((s) => s.paidSalesMinor), color: TEAL }]}
            unit="EGP"
            format={egp}
            axisFormat={compactMoney}
            actions={<ExportButton report="sales" filters={filters} range={data.range} />}
          />
          <ChartCard
            title="Tickets sold per period"
            labels={data.series.map((s) => bucketLabel(s.bucket, data.range.granularity))}
            series={[{ name: 'Tickets sold', values: data.series.map((s) => s.tickets), color: AMBER }]}
            unit="tickets"
            format={count}
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <ShareBars title="Tickets by type" items={sliceItems(data.byTicketType)} unit="tickets" format={count} />
            <ShareBars title="Tickets by audience" description="Egyptian and Non-Egyptian visitors." items={sliceItems(data.byAudience)} unit="tickets" format={count} />
          </div>
          <Card title="Sales by ticket type, audience and weekday / weekend">
            <DataTable
              testId="sales-breakdown"
              caption="Sales by ticket type and audience"
              columns={[{ header: 'Ticket type' }, { header: 'Audience' }, { header: 'Tickets', align: 'right' }, { header: 'Cancelled', align: 'right' }, { header: 'Value', align: 'right' }]}
              rows={data.byTicketTypeAndAudience.map((r) => [r.ticketTypeNameEn, r.audienceNameEn, count(r.tickets), count(r.cancelled), egp(r.valueMinor)])}
              totals={['Total', '', count(data.kpis.ticketsSold), count(data.kpis.ticketsCancelledInPaidOrders), egp(data.kpis.paidSalesMinor)]}
            />
            <div className="mt-4">
              <DataTable
                caption="Sales on weekdays and weekends"
                columns={[{ header: 'Visit day' }, { header: 'Tickets', align: 'right' }, { header: 'Value', align: 'right' }]}
                rows={data.byDayType.map((r) => [r.nameEn, count(r.tickets), egp(r.valueMinor)])}
              />
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

// ───────────────────────────── attendance ─────────────────────────────

export function AnalyticsAttendancePage() {
  const [filters, set] = useFilters()
  const keep: Keep = ['ticketType', 'audience', 'gateId']
  const { data, error, loading, problem, reload } = useReport<AttendanceReport>('attendance', filters, keep)
  const unfiltered = !filters.ticketType && !filters.audience && !filters.gateId
  const types = useOptions(data?.entriesByTicketType, unfiltered)
  const audiences = useOptions(data?.entriesByAudience, unfiltered)
  const gateItems = useMemo(() => data?.byGate.filter((g) => g.id).map((g) => ({ id: g.id as string, code: g.code, nameEn: g.nameEn, nameAr: g.nameAr })), [data])
  const gates = useOptions(gateItems, unfiltered)
  return (
    <div className="space-y-6">
      <PageHeader title="Attendance" description="Visitors actually let in at the gates, counted on the day they came in. A ticket that was sold but never used is a sale, not an attendance." />
      <RangeBar filters={filters} set={set} problem={problem} options={{ ticketTypes: types, audiences, gates }} />
      <State error={error} problem={problem} reload={() => void reload()} loading={loading} hasData={!!data} />
      {data && !problem && (
        <div className={loading ? 'space-y-6 opacity-60' : 'space-y-6'} data-testid="attendance-report">
          <PeriodLine range={data.range} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Entries" value={count(data.kpis.entries)} note="Each ticket is let in once" testId="kpi-entries" />
            <Stat label="Refused scans" value={count(data.kpis.refusedScans)} testId="kpi-refused" />
            <Stat label="All scans" value={count(data.kpis.totalScans)} />
            <Stat label="Refused share" value={percent(data.kpis.refusedSharePercent)} />
          </div>
          <ChartCard
            title="Entries per period"
            labels={data.series.map((s) => bucketLabel(s.bucket, data.range.granularity))}
            series={[
              { name: 'Let in', values: data.series.map((s) => s.entries), color: TEAL },
              { name: 'Refused', values: data.series.map((s) => s.refused), color: RED },
            ]}
            unit="scans"
            format={count}
            stacked
            actions={<ExportButton report="attendance" filters={filters} range={data.range} />}
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <ShareBars title="Entries by gate" items={data.byGate.map((g) => ({ label: g.nameEn, value: g.entries, share: g.shareOfEntriesPercent }))} unit="entries" format={count} />
            <ShareBars title="Scan results" description="What happened at the gates, including refusals." items={data.results.filter((r) => r.scans > 0).map((r) => ({ label: scanResultLabel(r.code), value: r.scans, share: r.sharePercent }))} unit="scans" format={count} />
          </div>
          <Card title="Gates">
            <DataTable
              testId="gates-table"
              caption="Entries and refused scans by gate"
              columns={[{ header: 'Gate' }, { header: 'Entries', align: 'right' }, { header: 'Refused', align: 'right' }, { header: 'Scans', align: 'right' }, { header: 'Share of entries', align: 'right' }]}
              rows={data.byGate.map((g) => [g.nameEn, count(g.entries), count(g.refused), count(g.scans), percent(g.shareOfEntriesPercent)])}
              totals={['Total', count(data.kpis.entries), count(data.kpis.refusedScans), count(data.kpis.totalScans), '']}
            />
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <ShareBars title="Entries by ticket type" items={data.entriesByTicketType.map((r) => ({ label: r.nameEn, value: r.entries, share: r.shareOfEntriesPercent }))} unit="entries" format={count} />
            <ShareBars title="Entries by audience" items={data.entriesByAudience.map((r) => ({ label: r.nameEn, value: r.entries, share: r.shareOfEntriesPercent }))} unit="entries" format={count} />
          </div>
        </div>
      )}
    </div>
  )
}

// ───────────────────────────── ticket states ─────────────────────────────

export function AnalyticsTicketsPage() {
  const [filters, set] = useFilters()
  const { data, error, loading, problem, reload } = useReport<TicketsReport>('tickets', filters, ['basis'])
  return (
    <div className="space-y-6">
      <PageHeader title="Ticket states" description="What the tickets are now. The system keeps no history of how a ticket got into its state, so this is a snapshot, not a trend of past states." />
      <RangeBar filters={filters} set={set} problem={problem} options={{ basis: true }} />
      <State error={error} problem={problem} reload={() => void reload()} loading={loading} hasData={!!data} />
      {data && !problem && (
        <div className={loading ? 'space-y-6 opacity-60' : 'space-y-6'} data-testid="tickets-report">
          <PeriodLine range={data.range} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Tickets" value={count(data.kpis.total)} testId="kpi-total" />
            <Stat label="Valid, not yet used" value={count(data.kpis.valid)} testId="kpi-valid" />
            <Stat label="Used" value={count(data.kpis.used)} testId="kpi-used" />
            <Stat label="Cancelled" value={count(data.kpis.cancelled)} testId="kpi-cancelled" />
            <Stat label="Awaiting payment" value={count(data.kpis.pending)} />
            <Stat label="Expired" value={count(data.kpis.expired)} />
            <Stat label="Valid but the visit day has passed" value={count(data.kpis.validButDatePassed)} note="Paid, never used" />
            <Stat label="Used, of past visit days" value={percent(data.kpis.usedSharePercentOfPastValid)} note={`${count(data.kpis.usedAfterVisitDate)} used`} />
          </div>
          <ChartCard
            title="Tickets by state per period"
            labels={data.series.map((s) => bucketLabel(s.bucket, data.range.granularity))}
            series={[
              { name: 'Used', values: data.series.map((s) => s.used), color: TEAL },
              { name: 'Valid', values: data.series.map((s) => s.valid), color: AMBER },
              { name: 'Cancelled', values: data.series.map((s) => s.cancelled), color: RED },
              { name: 'Not paid', values: data.series.map((s) => s.notPaid), color: STONE },
            ]}
            unit="tickets"
            format={count}
            stacked
            actions={<ExportButton report="tickets" filters={filters} range={data.range} />}
          />
          <Card title="By ticket type, audience and state">
            <DataTable
              testId="ticket-states"
              caption="Tickets by type, audience and state"
              columns={[{ header: 'Ticket type' }, { header: 'Audience' }, { header: 'State' }, { header: 'Tickets', align: 'right' }]}
              rows={data.byTypeAudienceStatus.map((r) => [r.ticketTypeNameEn, r.audienceNameEn, <Badge key="s">{TICKET_STATE_LABEL[r.status] ?? r.status}</Badge>, count(r.tickets)])}
              totals={['Total', '', '', count(data.kpis.total)]}
            />
          </Card>
        </div>
      )}
    </div>
  )
}

// ───────────────────────────── events ─────────────────────────────

export function AnalyticsEventsPage() {
  const [filters, set] = useFilters()
  const { data, error, loading, problem, reload } = useReport<EventsReport>('events', filters, [])
  return (
    <div className="space-y-6">
      <PageHeader title="Event statistics" description="How many events are in the programme and in what state. Events are not linked to tickets: a ticket admits a visitor to the park, so there are no event sales or attendance figures." />
      <RangeBar filters={filters} set={set} problem={problem} />
      <State error={error} problem={problem} reload={() => void reload()} loading={loading} hasData={!!data} />
      {data && !problem && (
        <div className={loading ? 'space-y-6 opacity-60' : 'space-y-6'} data-testid="events-report">
          <PeriodLine range={data.range} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Events in the period" value={count(data.kpis.inPeriod)} note="By the day each starts" testId="kpi-in-period" />
            <Stat label="Published" value={count(data.kpis.publishedInPeriod)} />
            <Stat label="Coming soon" value={count(data.kpis.comingSoonInPeriod)} />
            <Stat label="Drafts" value={count(data.kpis.draftInPeriod)} />
            <Stat label="Cancelled" value={count(data.kpis.cancelledInPeriod)} />
            <Stat label="Archived" value={count(data.kpis.archivedInPeriod)} />
            <Stat label="Published, all time" value={count(data.kpis.allTime.published)} />
            <Stat label="Drafts, all time" value={count(data.kpis.allTime.draft)} />
          </div>
          <ChartCard
            title="Public events per period"
            description="Published and coming-soon events, by the day they start."
            labels={data.series.map((s) => bucketLabel(s.bucket, data.range.granularity))}
            series={[{ name: 'Events', values: data.series.map((s) => s.events), color: TEAL }]}
            unit="events"
            format={count}
            actions={<ExportButton report="events" filters={filters} range={data.range} />}
          />
          <ShareBars title="Public events by venue" items={data.byVenue.map((v) => ({ label: v.venueEn, value: v.events, share: null }))} unit="events" format={count} />
          <Card title="Events in the period">
            {data.listTruncated && <Notice tone="info">Only the first 500 events are listed. Export the report for the full list.</Notice>}
            <DataTable
              testId="events-list"
              caption="Events in the period"
              columns={[{ header: 'Day' }, { header: 'Event' }, { header: 'Status' }, { header: 'Venue' }]}
              rows={data.list.map((e) => [formatDay(e.date), e.titleEn, e.status, e.venueEn ?? '—'])}
            />
          </Card>
        </div>
      )}
    </div>
  )
}

// ───────────────────────────── reports (exports) ─────────────────────────────

/** Downloads a CSV for the period and filters on the screen. The server checks the permission again and records the export. */
function ExportButton({ report, filters, range, label }: { report: ExportDef['key']; filters: AnalyticsFilters; range: RangeView; label?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const def = EXPORTS.find((e) => e.key === report)
  const keep: Keep = report === 'sales' ? ['basis', 'ticketType', 'audience', 'dayType'] : report === 'attendance' ? ['ticketType', 'audience', 'gateId'] : report === 'tickets' ? ['basis'] : report === 'scans' ? ['gateId'] : []
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const blob = await api.download(`/analytics/export/${report}?${queryOf(filters, keep).toString()}`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = exportFilename(report, range, filters.basis)
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="text-right">
      <Button variant="secondary" busy={busy} onClick={() => void run()} data-testid={`export-${report}`} aria-label={`Download ${def?.label ?? report} as CSV`}>
        {label ?? 'Download CSV'}
      </Button>
      {error && (
        <p role="alert" className="mt-1 max-w-xs text-xs text-red-800">
          {error}
        </p>
      )}
    </div>
  )
}

export function AnalyticsReportsPage() {
  const { can } = useAuth()
  const [filters, set] = useFilters()
  const access = analyticsAccess(can)
  const { data, error, loading, problem, reload } = useReport<Overview>('overview', filters, ['basis'])
  const available = EXPORTS.filter((e) => e.anyOf.some(can))
  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Download a report as a spreadsheet (CSV) for the period you choose. Files hold totals only: no customers, tickets, codes or addresses." />
      <RangeBar filters={filters} set={set} problem={problem} options={{ basis: access.money || access.operations }} />
      <State error={error} problem={problem} reload={() => void reload()} loading={loading} hasData={!!data} />
      {data && !problem && (
        <div className="space-y-4" data-testid="reports">
          <PeriodLine range={data.range} />
          <ul className="grid gap-4 md:grid-cols-2">
            {available.map((e) => (
              <li key={e.key}>
                <Card title={e.label} description={e.description}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-stone-500">{e.basis ? `By ${BASIS_LABEL[filters.basis].toLowerCase()}` : 'By the day it happened'}</p>
                    <ExportButton report={e.key} filters={filters} range={data.range} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <Notice tone="info">Spreadsheet formulas in any text are neutralised, and an export larger than the configured limit is refused: choose a shorter period.</Notice>
        </div>
      )}
    </div>
  )
}
