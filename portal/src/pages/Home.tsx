import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Card, Notice, PageHeader, Spinner } from '../components/ui'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/hooks'
import { activityLabel, onlineSalesText, parkBanner, scanLabel, type Dashboard } from '../lib/operations'
import { formatDay, formatMoment, money } from '../lib/ticketing'

const REFRESH_MS = 30_000

/** The first thing staff see: what is happening at the park today. Everything here is counted by the server, in Cairo time. */
export function Home() {
  const { profile } = useAuth()
  const { data, error, reload } = useLoad<Dashboard>('/dashboard')

  useEffect(() => {
    const timer = window.setInterval(() => void reload(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [reload])

  const empty = data && !data.park && !data.orders && !data.tickets && !data.entry && !data.gates && !data.events && !data.activity
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${profile?.fullName.split(' ')[0] ?? ''}`}
        description={data ? `Today is ${formatDay(data.date)} (Cairo time). Figures refresh every 30 seconds.` : 'Loading today’s operations…'}
      />
      {!data && !error && <Spinner />}
      {error && <Notice tone="error">{error}</Notice>}
      {empty && <Notice tone="info">Your account has no operational sections yet. Use the menu for the pages you can open, or ask an administrator for access.</Notice>}

      {data?.park && <ParkCard park={data.park} />}

      {(data?.orders || data?.tickets) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.orders && (
            <Card title="Orders today" description="Orders placed today. Money is the stored total of the paid ones.">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3" data-testid="orders-today">
                <Stat label="Placed" value={data.orders.createdToday} testId="stat-orders" />
                <Stat label="Paid" value={data.orders.paidToday} testId="stat-paid" />
                <Stat label="Revenue" value={money(data.orders.revenueMinor, data.orders.currency)} testId="stat-revenue" />
                <Stat label="Waiting for payment now" value={data.orders.pendingPaymentNow} testId="stat-pending" tone={data.orders.pendingPaymentNow > 0 ? 'amber' : undefined} />
                <Stat label="Cancelled" value={data.orders.cancelledToday} />
                <Stat label="Expired" value={data.orders.expiredToday} />
              </dl>
              <Link to="/orders" className="mt-4 inline-block text-sm font-medium text-teal-800 hover:underline">
                Open orders →
              </Link>
            </Card>
          )}
          {data.tickets && (
            <Card title="Tickets for today" description="Tickets whose visit date is today.">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3" data-testid="tickets-today">
                <Stat label="Sold" value={data.tickets.forToday} testId="stat-tickets" />
                <Stat label="Still valid" value={data.tickets.valid} testId="stat-valid" tone="teal" />
                <Stat label="Used (entered)" value={data.tickets.used} testId="stat-used" />
                <Stat label="Cancelled" value={data.tickets.cancelled} testId="stat-cancelled" />
                <Stat label="Not paid yet" value={data.tickets.pending} />
                <Stat label="Expired" value={data.tickets.expired} />
              </dl>
              <Link to="/tickets" className="mt-4 inline-block text-sm font-medium text-teal-800 hover:underline">
                Open tickets →
              </Link>
            </Card>
          )}
        </div>
      )}

      {data?.entry && (
        <Card title="Entry today" description={data.entry.scope === 'ALL' ? 'Every gate scan today.' : 'Your own scans today.'}>
          <dl className="grid grid-cols-2 gap-4 sm:max-w-md" data-testid="entry-today">
            <Stat label="Let in" value={data.entry.granted} testId="stat-granted" tone="teal" />
            <Stat label="Refused" value={data.entry.denied} testId="stat-denied" tone={data.entry.denied > 0 ? 'amber' : undefined} />
          </dl>
          {data.entry.denied > 0 && (
            <p className="mt-3 text-sm text-stone-600">
              Refused because: {Object.entries(data.entry.deniedByReason).map(([k, n]) => `${scanLabel(k).replace('Refused: ', '')} (${n})`).join(', ')}
            </p>
          )}
          <h3 className="mt-5 text-xs font-semibold tracking-wide text-stone-500 uppercase">Latest scans</h3>
          {data.entry.recent.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">No scans yet today.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[30rem] text-left text-sm" data-testid="recent-scans">
                <tbody className="divide-y divide-stone-100">
                  {data.entry.recent.map((s) => (
                    <tr key={s.id}>
                      <td className="py-1.5 pr-3 whitespace-nowrap text-stone-500">{formatMoment(s.scannedAt)}</td>
                      <td className="py-1.5 pr-3">
                        <Badge tone={s.granted ? 'teal' : 'red'}>{scanLabel(s.result)}</Badge>
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-xs">{s.ticketRef ?? '—'}</td>
                      <td className="py-1.5 pr-3">{s.gate?.nameEn ?? '—'}</td>
                      {data.entry?.scope === 'ALL' && <td className="py-1.5 text-stone-600">{s.staff}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link to="/scans" className="mt-4 inline-block text-sm font-medium text-teal-800 hover:underline">
            All scans →
          </Link>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {data?.gates && (
          <Card title="Gates">
            <ul className="divide-y divide-stone-100" data-testid="gates-today">
              {data.gates.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="font-medium text-stone-900">{g.nameEn}</span>
                  <span className="flex items-center gap-2">
                    {g.entriesToday !== undefined && <span className="text-stone-500">{g.entriesToday} in today</span>}
                    <Badge tone={g.isActive ? 'teal' : 'neutral'}>{g.isActive ? 'Active' : 'Switched off'}</Badge>
                  </span>
                </li>
              ))}
              {data.gates.length === 0 && <li className="py-2 text-sm text-stone-500">No gates yet.</li>}
            </ul>
          </Card>
        )}
        {data?.events && (
          <Card title="Events">
            <EventList title="Today" events={data.events.today} empty="No events today." />
            <EventList title="Coming up" events={data.events.upcoming} empty="No events scheduled." />
            <Link to="/events" className="mt-3 inline-block text-sm font-medium text-teal-800 hover:underline">
              Open events →
            </Link>
          </Card>
        )}
      </div>

      {data?.activity && (
        <Card title="Recent activity" description="The latest changes made by staff and by the system.">
          {data.activity.length === 0 ? (
            <p className="text-sm text-stone-500">Nothing yet.</p>
          ) : (
            <ul className="divide-y divide-stone-100" data-testid="activity">
              {data.activity.map((a) => (
                <li key={a.id} className="flex flex-wrap justify-between gap-2 py-1.5 text-sm">
                  <span>
                    {activityLabel(a.action)} <span className="text-stone-500">· {a.actor ?? 'system'}</span>
                  </span>
                  <span className="text-stone-500">{formatMoment(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value, testId, tone }: { label: string; value: number | string; testId?: string; tone?: 'teal' | 'amber' }) {
  const color = tone === 'teal' ? 'text-teal-800' : tone === 'amber' ? 'text-amber-700' : 'text-stone-900'
  return (
    <div>
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className={`text-2xl font-semibold ${color}`} data-testid={testId}>
        {value}
      </dd>
    </div>
  )
}

function ParkCard({ park }: { park: NonNullable<Dashboard['park']> }) {
  const b = parkBanner(park)
  const tone = b.tone === 'open' ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : b.tone === 'waiting' ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-red-300 bg-red-50 text-red-950'
  return (
    <section className={`rounded-xl border-2 p-5 ${tone}`} data-testid="park-status" data-status={park.status}>
      <h2 className="text-2xl font-bold" data-testid="park-headline">
        {b.headline}
      </h2>
      <p className="mt-1 text-base" data-testid="park-detail">
        {b.detail}
      </p>
      {park.special?.noteEn && <p className="mt-1 text-sm">{park.special.noteEn}</p>}
      {park.status !== 'CLOSED_TODAY' && (
        <p className="mt-2 text-sm" data-testid="park-sales">
          {onlineSalesText(park.onlineSales)}
        </p>
      )}
      {park.upcomingSpecial.length > 0 && (
        <div className="mt-4 border-t border-current/20 pt-3">
          <h3 className="text-xs font-semibold tracking-wide uppercase opacity-70">Coming special dates</h3>
          <ul className="mt-1 space-y-0.5 text-sm" data-testid="park-upcoming">
            {park.upcomingSpecial.map((s, i) => (
              <li key={i}>
                {formatDay(s.dateFrom)}
                {s.dateTo !== s.dateFrom ? ` – ${formatDay(s.dateTo)}` : ''}: <strong>{s.labelEn}</strong> · {s.isClosed ? 'closed' : `${s.opens} – ${s.closes}`}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link to="/hours" className="mt-3 inline-block text-sm font-medium underline">
        Opening hours →
      </Link>
    </section>
  )
}

function EventList({ title, events, empty }: { title: string; events: NonNullable<Dashboard['events']>['today']; empty: string }) {
  return (
    <div className="mt-2 first:mt-0">
      <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{title}</h3>
      {events.length === 0 ? (
        <p className="mt-1 text-sm text-stone-500">{empty}</p>
      ) : (
        <ul className="mt-1 divide-y divide-stone-100" data-testid={`events-${title.toLowerCase().replace(' ', '-')}`}>
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
              <Link to={`/events/${e.id}`} className="font-medium text-teal-900 hover:underline">
                {e.titleEn}
              </Link>
              <span className="flex items-center gap-2 text-stone-500">
                {formatDay(e.date)}
                {e.startTime ? ` · ${e.startTime}${e.endTime ? `–${e.endTime}` : ''}` : ''}
                <Badge tone={e.status === 'PUBLISHED' ? 'teal' : e.status === 'DRAFT' ? 'neutral' : 'amber'}>{e.status.replace('_', ' ').toLowerCase()}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
