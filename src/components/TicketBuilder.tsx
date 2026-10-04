import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMoney } from '../lib/alt'
import clsx from 'clsx'
import { useCart } from '../lib/cart'
import { flyToCart } from '../lib/flyToCart'
import { ticketCatalog, isWeekend, type TicketCategory, type TicketType } from '../lib/tickets'
import { Button } from './ui/Button'
import { TicketCard3D } from './TicketCard3D'

const TYPES: TicketType[] = ['adult', 'child']

export function TicketBuilder() {
  const { t } = useTranslation()
  const money = useMoney()
  const { addLine } = useCart()
  const [category, setCategory] = useState<TicketCategory>('resident')
  const [visitDate, setVisitDate] = useState('')
  const [manualWeekend, setManualWeekend] = useState(false)
  const [qty, setQty] = useState<Record<TicketType, number>>({ adult: 2, child: 0 })
  const [justAdded, setJustAdded] = useState(false)
  const addButtonRef = useRef<HTMLButtonElement | null>(null)

  const dayType = visitDate ? (isWeekend(new Date(visitDate)) ? 'weekend' : 'weekday') : manualWeekend ? 'weekend' : 'weekday'

  const rows = useMemo(
    () =>
      TYPES.map((type) => {
        const ticket = ticketCatalog.find((tk) => tk.category === category && tk.type === type && tk.day === dayType)!
        return { type, ticket }
      }),
    [category, dayType],
  )

  const total = rows.reduce((sum, row) => sum + row.ticket.price * qty[row.type], 0)
  const hasItems = rows.some((row) => qty[row.type] > 0)

  function handleAdd() {
    for (const row of rows) {
      if (qty[row.type] > 0) {
        addLine(
          {
            ticketId: row.ticket.id,
            label: `${t(row.type)} — ${t(category)} (${t(dayType)})`,
            unitPrice: row.ticket.price,
            visitDate: visitDate || null,
          },
          qty[row.type],
        )
      }
    }
    if (addButtonRef.current) flyToCart(addButtonRef.current)
    setJustAdded(true)
    window.setTimeout(() => setJustAdded(false), 1800)
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-16">
      <div className="order-2 lg:order-1">
        <h3 className="font-display text-2xl font-medium text-ink-900">{t('ticketBuilderTitle')}</h3>

        <div className="mt-6 flex flex-wrap gap-2">
          {(['resident', 'visitor'] as TicketCategory[]).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={clsx(
                'rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-colors',
                category === cat
                  ? 'border-teal-700 bg-teal-700 text-sand-50'
                  : 'border-ink-900/15 text-ink-900/60 hover:border-teal-700 hover:text-teal-700',
              )}
            >
              {t(cat)}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-900/50">{t('visitDate')}</span>
            <input
              type="date"
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
              className="mt-2 w-full rounded-xl border border-ink-900/15 bg-sand-50 px-4 py-2.5 text-sm text-ink-900 outline-none focus:border-teal-700"
            />
          </label>
          {!visitDate ? (
            <label className="flex items-end gap-3 pb-1">
              <input
                type="checkbox"
                checked={manualWeekend}
                onChange={(e) => setManualWeekend(e.target.checked)}
                className="h-4 w-4 rounded border-ink-900/30 accent-teal-700"
              />
              <span className="text-sm text-ink-900/70">{t('weekend')}</span>
            </label>
          ) : (
            <p className="self-end pb-2 text-sm text-ink-900/60">
              {visitDate} — {t(dayType)}
            </p>
          )}
        </div>

        <div className="mt-6 divide-y divide-ink-900/10 rounded-2xl border border-ink-900/10 bg-sand-50">
          {rows.map((row) => (
            <div key={row.type} className="flex items-center justify-between gap-4 px-5 py-4">
              <div>
                <p className="text-sm font-semibold text-ink-900">{t(row.type)}</p>
                <p className="text-xs text-ink-900/50" dir="ltr">
                  {money(row.ticket.price)} <span dir="auto">{t('perTicket')}</span>
                </p>
              </div>
              <Stepper value={qty[row.type]} onChange={(v) => setQty((q) => ({ ...q, [row.type]: Math.max(0, v) }))} />
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <p className="text-lg font-semibold text-ink-900" dir="ltr">
            {money(total)}
          </p>
          <Button ref={addButtonRef} onClick={handleAdd} disabled={!hasItems} className="min-w-[10rem] justify-center">
            {justAdded ? `${t('added')} ✓` : t('addToCart')}
          </Button>
        </div>
      </div>

      <div className="order-1 lg:order-2">
        <TicketCard3D category={category} visitDate={visitDate} dayType={dayType} rows={rows.map((r) => ({ type: r.type, qty: qty[r.type], price: r.ticket.price }))} total={total} />
      </div>
    </div>
  )
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-900/20 text-ink-900/70 hover:border-teal-700 hover:text-teal-700"
        aria-label="-"
      >
        −
      </button>
      <span className="w-6 text-center text-sm font-medium text-ink-900">{value}</span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-900/20 text-ink-900/70 hover:border-teal-700 hover:text-teal-700"
        aria-label="+"
      >
        +
      </button>
    </div>
  )
}
