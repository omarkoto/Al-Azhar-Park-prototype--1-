import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { useLanguage } from '../lib/language'
import { useSeo } from '../lib/seo'
import { useAlt, useCredit, useMoney } from '../lib/alt'
import { useCart, type CartLine } from '../lib/cart'
import { makeTicketId, pounds, useBookingCatalog } from '../lib/booking'
import { useBookingFormat } from '../lib/bookingFormat'
import { cairoIso } from '../lib/calendar'
import { generatePlan, type Arrival } from '../lib/plan/generate'
import { planCopy } from '../lib/plan/copy'
import { sunsetMinutes } from '../lib/plan/sun'
import type { Mood } from '../lib/plan/stops'
import { Container } from '../components/ui/Container'
import { Eyebrow } from '../components/ui/SectionHeading'
import { Reveal } from '../components/ui/Reveal'
import { Button } from '../components/ui/Button'
import { ArchFrame } from '../components/ui/ArchFrame'
import { PageHero } from '../components/PageHero'
import heroImage from '../assets/images/plan-hero-promenade-dusk.webp'
import { AddToCalendar } from '../components/AddToCalendar'
import { ArchMap } from '../components/plan/ArchMap'
import { StopDialog } from '../components/plan/StopDialog'
import { BookingNotes, DayNotice } from '../components/BookingNotes'

const MOODS: Mood[] = ['calm', 'scenic', 'foodie', 'culture']
const ARRIVALS: Arrival[] = ['morning', 'afternoon', 'sunset']
const HOURS = [2, 4, 6] as const

function localDate(offsetDays: number) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function Plan() {
  const { lang } = useLanguage()
  const altText = useAlt()
  const credit = useCredit()
  const money = useMoney()
  const { t } = useTranslation()
  const { addSelection, open } = useCart()
  const bf = useBookingFormat()
  const copy = planCopy[lang]
  useSeo({ title: copy.eyebrow, description: copy.lead, path: '/plan' })

  const [date, setDate] = useState(() => localDate(1))
  const [adults, setAdults] = useState(2)
  const [children, setChildren] = useState(0)
  const [category, setCategory] = useState('RESIDENT')
  const [arrival, setArrival] = useState<Arrival>('sunset')
  const [hours, setHours] = useState<2 | 4 | 6>(4)
  const [mood, setMood] = useState<Mood>('scenic')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [added, setAdded] = useState(false)

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localDate(1)
  const sunsetMin = useMemo(() => sunsetMinutes(validDate), [validDate])
  const plan = useMemo(() => generatePlan({ children, mood, hours, arrival, sunsetMin }), [children, mood, hours, arrival, sunsetMin])

  const fmt = (min: number) =>
    new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(min * 60000))

  // Ticket prices and the booking rules come from the park's server; this page only picks quantities.
  const { status: bookingStatus, catalog, day, dayLoading } = useBookingCatalog(validDate)
  const audiences = catalog?.audiences ?? []
  const canSell = !!day?.sale.allowed && day.date === validDate && !dayLoading
  const ticketRows = ([['ADULT', adults], ['CHILD', children]] as const).map(([code, qty]) => {
    const type = catalog?.ticketTypes.find((tp) => tp.code === code)
    const price = day?.prices.find((pr) => pr.audience === category && pr.ticketType === code)
    return { code, type, qty, price: price ? pounds(price.amountMinor) : null }
  })
  const priced = ticketRows.every((r) => r.qty === 0 || (r.type && r.price !== null))
  const total = canSell && priced ? ticketRows.reduce((sum, r) => sum + (r.price ?? 0) * r.qty, 0) : 0
  const maxTickets = catalog?.policy.maxTicketsPerOrder ?? 50
  const audienceInfo = audiences.find((a) => a.code === category)

  function addTickets() {
    if (!canSell || !priced) return
    const lines: CartLine[] = ticketRows
      .filter((r) => r.qty > 0 && r.type)
      .map((r) => ({
        ticketId: makeTicketId(category, r.code),
        label: `${bf.name(r.type!)} — ${audienceInfo ? bf.name(audienceInfo) : ''} (${t(day?.dayType === 'WEEKEND' ? 'weekend' : 'weekday')})`,
        unitPrice: r.price as number,
        qty: r.qty,
        visitDate: validDate,
      }))
    addSelection(lines)
    setAdded(true)
    open()
    window.setTimeout(() => setAdded(false), 2200)
  }

  const calendarEntry = {
    title: copy.planTitle,
    description: plan.stops.map((p) => `${fmt(p.startMin)} — ${p.stop.name[lang]}`).join('\n'),
    location: 'Al-Azhar Park, Salah Salem Street, Cairo',
    start: cairoIso(validDate, plan.startMin),
    end: cairoIso(validDate, plan.endMin),
  }

  return (
    <div>
      <PageHero eyebrow={copy.eyebrow} title={copy.title} lead={copy.lead} image={heroImage} imageAlt={altText('planHero')}
        credit={{ text: credit('Yasser.mahmoud', 'CC BY-SA 4.0'), href: 'https://commons.wikimedia.org/wiki/File:حـديقة_الازهر_09.jpg' }}
      />

      <section className="py-14 md:py-20">
        {/* Phone: the map and route first, then the choices, then the tickets. Desktop: choices on the left; map above tickets on the right, the tickets ending level with the choices. */}
        <Container className="grid gap-12 lg:grid-cols-[minmax(0,380px)_1fr] lg:grid-rows-[auto_1fr] lg:gap-x-14 lg:gap-y-8">
          {/* Controls */}
          <Reveal className="order-2 rounded-2xl border border-ink-900/10 bg-sand-100 p-6 lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-1">
            <h2 className="font-display text-2xl font-medium text-ink-900">{copy.yourDay}</h2>

            <Field label={copy.date}>
              <input
                type="date"
                value={date}
                min={catalog?.today ?? localDate(0)}
                max={catalog?.lastBookableDate}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-xl border border-ink-900/15 bg-sand-50 px-4 py-3 text-sm text-ink-900 outline-none focus:border-teal-700"
              />
            </Field>

            <Field label={copy.guests}>
              <div className="space-y-2">
                <Stepper label={copy.adults} value={adults} min={1} max={Math.max(1, Math.min(12, maxTickets - children))} onChange={setAdults} />
                <Stepper label={copy.children} value={children} min={0} max={Math.max(0, Math.min(12, maxTickets - adults))} onChange={setChildren} />
              </div>
              <Chips
                className="mt-3"
                value={category}
                options={
                  audiences.length > 0
                    ? audiences.map((a) => ({ value: a.code, label: bf.name(a) }))
                    : [{ value: 'RESIDENT', label: copy.resident }, { value: 'VISITOR', label: copy.visitor }]
                }
                onChange={(v) => setCategory(v)}
              />
              {day && day.date === validDate ? <DayNotice day={day} /> : null}
            </Field>

            <Field label={copy.arrival}>
              <Chips value={arrival} options={ARRIVALS.map((a) => ({ value: a, label: copy.arrivals[a] }))} onChange={(v) => setArrival(v as Arrival)} />
            </Field>

            <Field label={copy.duration}>
              <Chips value={hours} options={HOURS.map((h) => ({ value: h, label: copy.hours(h) }))} onChange={(v) => setHours(v as 2 | 4 | 6)} />
            </Field>

            <Field label={copy.mood}>
              <Chips value={mood} options={MOODS.map((m) => ({ value: m, label: copy.moods[m] }))} onChange={(v) => setMood(v as Mood)} />
            </Field>
          </Reveal>

          {/* Map + actions */}
          <div className="order-1 mt-8 min-w-0 lg:order-none lg:col-start-2 lg:row-start-1 lg:mt-6">
            <Reveal>
              <ArchMap plan={plan} lang={lang} activeId={activeId} onActive={setActiveId} onSelect={setSelectedId} />
            </Reveal>
            <StopDialog plan={plan} lang={lang} copy={copy} selectedId={selectedId} fmt={fmt} onSelect={setSelectedId} />

            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-semibold text-teal-800">
              <span>{copy.stopsCount(plan.stops.length)}</span>
              <span dir="ltr">
                {fmt(plan.startMin)} – {fmt(plan.endMin)}
              </span>
            </div>

          </div>

          <Reveal delay={0.1} className="order-3 rounded-2xl border border-ink-900/10 bg-sand-100 p-6 lg:order-none lg:col-start-2 lg:row-start-2 lg:self-end">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/45">{copy.total}</p>
                  <p className="font-display mt-1 text-3xl font-medium text-teal-800" dir="auto">
                    {money(total)}
                  </p>
                </div>
                {bookingStatus === 'unavailable' ? (
                  <p className="max-w-xs text-sm text-ink-900/65" data-testid="booking-unavailable">
                    {t('bookUnavailableTitle')}
                  </p>
                ) : (
                  <Button onClick={addTickets} disabled={!canSell || !priced} className="min-w-52 justify-center">
                    {added ? `✓ ${copy.ticketsAdded}` : copy.addTickets}
                  </Button>
                )}
              </div>
              <BookingNotes catalog={catalog} className="mt-5" />
              <AddToCalendar className="mt-6 border-t border-ink-900/10 pt-6" entry={calendarEntry} filename={`plan-${validDate}`} />
            </Reveal>
        </Container>
      </section>

      {/* Timeline */}
      <section className="border-t border-ink-900/10 bg-sand-100 py-14 md:py-20">
        <Container className="max-w-4xl">
          <Eyebrow>{copy.yourRoute}</Eyebrow>
          <ol className="relative mt-10 space-y-6 border-s border-gold-500/40 ps-8">
            {plan.stops.map((p, i) => {
              const active = activeId === p.stop.id
              return (
                <li
                  key={`${p.stop.id}-${i}`}
                  onMouseEnter={() => setActiveId(p.stop.id)}
                  onMouseLeave={() => setActiveId(null)}
                  className="relative"
                >
                  <span
                    className={clsx(
                      'font-display absolute -start-[3.2rem] top-1 flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-colors',
                      active ? 'border-gold-600 bg-gold-500 text-teal-950' : 'border-gold-500/60 bg-sand-50 text-teal-800',
                    )}
                  >
                    {lang === 'ar' ? (i + 1).toLocaleString('ar-EG') : i + 1}
                  </span>
                  <div
                    className={clsx(
                      'flex items-start gap-5 rounded-2xl border bg-sand-50 p-4 transition-shadow sm:p-5',
                      active ? 'border-gold-500/60 shadow-lg shadow-ink-900/10' : 'border-ink-900/10',
                    )}
                  >
                    <ArchFrame src={p.stop.image} alt="" className="aspect-[3/4] w-16 shrink-0 sm:w-24" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-700" dir="ltr">
                        {fmt(p.startMin)} – {fmt(p.endMin)}
                        <span className="text-ink-900/40"> · {copy.walk(p.walkMin)}</span>
                      </p>
                      <h3 className="font-display mt-1 text-xl font-medium text-ink-900">{p.stop.name[lang]}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-ink-900/70">{p.stop.blurb[lang]}</p>
                      {p.stop.restaurantSlug ? (
                        <Link to={`/restaurants/${p.stop.restaurantSlug}`} className="mt-3 inline-block text-xs font-semibold text-teal-700 underline-offset-4 hover:underline">
                          {copy.openRestaurant} →
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
          <p className="mt-8 text-xs leading-relaxed text-ink-900/55">{copy.routeNote}</p>
        </Container>
      </section>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">{label}</p>
      {children}
    </div>
  )
}

function Chips<T extends string | number>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={clsx('flex flex-wrap gap-2', className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-full border px-4 py-2 text-xs font-semibold tracking-wide transition-colors',
            value === o.value ? 'border-teal-700 bg-teal-700 text-sand-50' : 'border-ink-900/15 text-ink-900/65 hover:border-teal-700 hover:text-teal-700',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-ink-900/15 bg-sand-50 px-4 py-2">
      <span className="text-sm text-ink-900/80">{label}</span>
      <span className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`− ${label}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-900/20 text-ink-900/70 transition-colors hover:border-teal-700 hover:text-teal-700 disabled:opacity-35"
        >
          −
        </button>
        <span className="w-5 text-center text-sm font-semibold text-ink-900">{value}</span>
        <button
          type="button"
          aria-label={`+ ${label}`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-900/20 text-ink-900/70 transition-colors hover:border-teal-700 hover:text-teal-700 disabled:opacity-35"
        >
          +
        </button>
      </span>
    </div>
  )
}
