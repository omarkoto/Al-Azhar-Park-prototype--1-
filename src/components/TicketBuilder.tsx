import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMoney } from '../lib/alt'
import clsx from 'clsx'
import { useCart, type CartLine } from '../lib/cart'
import { flyToCart } from '../lib/flyToCart'
import { makeTicketId, pounds, useBookingCatalog } from '../lib/booking'
import { nextDay, useBookingFormat } from '../lib/bookingFormat'
import { Button, ButtonLink } from './ui/Button'
import { BookingNotes, DayNotice } from './BookingNotes'
import { TicketCard3D } from './TicketCard3D'

export function TicketBuilder() {
  const { t } = useTranslation()
  const money = useMoney()
  const f = useBookingFormat()
  const { addSelection } = useCart()
  const [audience, setAudience] = useState('')
  const [visitDate, setVisitDate] = useState('')
  const [qty, setQty] = useState<Record<string, number>>({})
  const [justAdded, setJustAdded] = useState(false)
  const addButtonRef = useRef<HTMLButtonElement | null>(null)
  const { status, catalog, day, dayLoading } = useBookingCatalog(visitDate)

  // first answer from the server: pick the first audience, tomorrow as the date, and two of the first ticket type
  useEffect(() => {
    if (!catalog) return
    setAudience((a) => a || catalog.audiences[0]?.code || '')
    setVisitDate((d) => d || nextDay(catalog.today))
    setQty((q) => (Object.keys(q).length > 0 || !catalog.ticketTypes[0] ? q : { [catalog.ticketTypes[0].code]: 2 }))
  }, [catalog])

  const rows = useMemo(
    () =>
      (catalog?.ticketTypes ?? []).map((type) => {
        const price = day?.prices.find((p) => p.audience === audience && p.ticketType === type.code)
        return { type, price: price ? pounds(price.amountMinor) : null, qty: qty[type.code] ?? 0 }
      }),
    [catalog, day, audience, qty],
  )

  const ticketsChosen = rows.reduce((n, r) => n + r.qty, 0)
  const max = catalog?.policy.maxTicketsPerOrder ?? 50
  const canSell = !!day?.sale.allowed && !dayLoading
  const total = rows.reduce((sum, r) => sum + (r.price ?? 0) * r.qty, 0)
  const priced = rows.filter((r) => r.qty > 0).every((r) => r.price !== null)
  const audienceInfo = catalog?.audiences.find((a) => a.code === audience)

  if (status === 'loading') {
    return <p className="py-10 text-center text-sm text-ink-900/60">{t('bookLoading')}</p>
  }
  if (status === 'unavailable' || !catalog) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-ink-900/10 bg-sand-100 p-8 text-center" data-testid="booking-unavailable">
        <h3 className="font-display text-xl font-medium text-ink-900">{t('bookUnavailableTitle')}</h3>
        <p className="mt-3 text-sm leading-relaxed text-ink-900/70">{t('bookUnavailableBody')}</p>
        <ButtonLink to="/contact" className="mt-6">
          {t('bookContactPark')}
        </ButtonLink>
      </div>
    )
  }

  function handleAdd() {
    if (!catalog) return
    const dayLabel = t(day?.dayType === 'WEEKEND' ? 'weekend' : 'weekday')
    const lines: CartLine[] = rows
      .filter((r) => r.qty > 0 && r.price !== null)
      .map((r) => ({
        ticketId: makeTicketId(audience, r.type.code),
        label: `${f.name(r.type)} — ${audienceInfo ? f.name(audienceInfo) : ''} (${dayLabel})`,
        unitPrice: r.price as number,
        qty: r.qty,
        visitDate,
      }))
    addSelection(lines)
    if (addButtonRef.current) flyToCart(addButtonRef.current)
    setJustAdded(true)
    window.setTimeout(() => setJustAdded(false), 1800)
  }

  const change = (code: string, value: number) =>
    setQty((q) => {
      const others = Object.entries(q).reduce((n, [k, v]) => (k === code ? n : n + v), 0)
      return { ...q, [code]: Math.max(0, Math.min(value, max - others)) }
    })

  return (
    <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-16">
      <div className="order-2 lg:order-1">
        <h3 className="font-display text-2xl font-medium text-ink-900">{t('ticketBuilderTitle')}</h3>

        <div className="mt-6 flex flex-wrap gap-2" role="radiogroup" aria-label={t('ticketBuilderTitle')}>
          {catalog.audiences.map((a) => (
            <button
              key={a.code}
              type="button"
              role="radio"
              aria-checked={audience === a.code}
              onClick={() => setAudience(a.code)}
              className={clsx(
                'rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-colors',
                audience === a.code ? 'border-teal-700 bg-teal-700 text-sand-50' : 'border-ink-900/15 text-ink-900/60 hover:border-teal-700 hover:text-teal-700',
              )}
            >
              {f.name(a)}
            </button>
          ))}
        </div>

        <div className="mt-5">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-900/50">{t('visitDate')}</span>
            <input
              type="date"
              value={visitDate}
              min={catalog.today}
              max={catalog.lastBookableDate}
              onChange={(e) => setVisitDate(e.target.value)}
              className="mt-2 w-full rounded-xl border border-ink-900/15 bg-sand-50 px-4 py-2.5 text-sm text-ink-900 outline-none focus:border-teal-700 sm:max-w-xs"
            />
          </label>
          {!visitDate ? <p className="mt-3 text-sm text-ink-900/60">{t('bookPickDate')}</p> : dayLoading && !day ? <p className="mt-3 text-sm text-ink-900/60">{t('bookChecking')}</p> : null}
          {day && day.date === visitDate ? (
            <>
              <p className="mt-3 text-sm text-ink-900/60">
                {f.day(visitDate)} — {t(day.dayType === 'WEEKEND' ? 'weekend' : 'weekday')}
              </p>
              <DayNotice day={day} />
            </>
          ) : null}
        </div>

        <div className={clsx('mt-6 divide-y divide-ink-900/10 rounded-2xl border border-ink-900/10 bg-sand-50 transition-opacity', !canSell && 'opacity-60')}>
          {rows.map((row) => (
            <div key={row.type.code} className="flex items-center justify-between gap-4 px-5 py-4" data-testid="ticket-row">
              <div>
                <p className="text-sm font-semibold text-ink-900">{f.name(row.type)}</p>
                <p className="text-xs text-ink-900/50" dir="ltr" data-testid="ticket-price">
                  {row.price !== null && canSell ? (
                    <>
                      {money(row.price)} <span dir="auto">{t('perTicket')}</span>
                    </>
                  ) : (
                    '—'
                  )}
                </p>
              </div>
              <Stepper value={row.qty} disabled={!canSell} atMax={ticketsChosen >= max} onChange={(v) => change(row.type.code, v)} label={f.name(row.type)} />
            </div>
          ))}
        </div>
        {ticketsChosen >= max ? <p className="mt-2 text-xs text-ink-900/60">{t('bookMaxTickets', { max: f.digits(max) })}</p> : null}

        <BookingNotes catalog={catalog} className="mt-5" />

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <p className="text-lg font-semibold text-ink-900" dir="ltr" data-testid="ticket-total">
            {money(canSell && priced ? total : 0)}
          </p>
          <Button ref={addButtonRef} onClick={handleAdd} disabled={ticketsChosen === 0 || !canSell || !priced} className="min-w-[10rem] justify-center">
            {justAdded ? `${t('added')} ✓` : t('addToCart')}
          </Button>
        </div>
      </div>

      <div className="order-1 lg:order-2">
        <TicketCard3D
          categoryLabel={audienceInfo ? f.name(audienceInfo) : ''}
          dateLabel={visitDate ? f.day(visitDate) : t('selectDate')}
          rows={rows.map((r) => ({ key: r.type.code, label: f.name(r.type), qty: canSell ? r.qty : 0, price: r.price ?? 0 }))}
          total={canSell && priced ? total : 0}
        />
      </div>
    </div>
  )
}

function Stepper({ value, onChange, disabled, atMax, label }: { value: number; onChange: (v: number) => void; disabled?: boolean; atMax?: boolean; label: string }) {
  const f = useBookingFormat()
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= 0}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-900/20 text-ink-900/70 hover:border-teal-700 hover:text-teal-700 disabled:opacity-35"
        aria-label={`− ${label}`}
      >
        −
      </button>
      <span className="w-6 text-center text-sm font-medium text-ink-900" aria-live="polite">
        {f.digits(value)}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled || atMax}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-900/20 text-ink-900/70 hover:border-teal-700 hover:text-teal-700 disabled:opacity-35"
        aria-label={`+ ${label}`}
      >
        +
      </button>
    </div>
  )
}
