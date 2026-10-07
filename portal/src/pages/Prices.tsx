import { useState } from 'react'
import { Badge, Button, Card, Modal, Notice, PageHeader, Select, Spinner, TextArea, TextInput, useToast } from '../components/ui'
import { api, errorMessage, fieldErrors } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/hooks'
import {
  dayBefore, DAYS_LABEL, formatDay, money, parseEgp, priceProblems, PRICE_STATUS_LABEL, PRICE_STATUS_TONE, type AudienceRow, type CurrentPrices, type PriceForm, type PriceRowData, type TicketTypeRow,
} from '../lib/ticketing'

/** The price list: what visitors pay now, the full history, and adding a new price from a future date. */
export function PricesPage() {
  const { can } = useAuth()
  const toast = useToast()
  const current = useLoad<CurrentPrices>('/prices/current')
  const history = useLoad<PriceRowData[]>('/prices')
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const canWrite = can('pricing:write')

  async function reloadAll() {
    await Promise.all([current.reload(), history.reload()])
  }

  async function toggle(p: PriceRowData) {
    const turningOff = p.isActive
    const message = turningOff
      ? `Switch off this price (${money(p.amountMinor)} for ${p.ticketType.nameEn}, ${p.audience.nameEn})? If it is the only price for those days, that ticket cannot be bought until another price applies.`
      : `Switch this price back on?`
    if (!window.confirm(message)) return
    setBusyId(p.id)
    try {
      await api.put(`/prices/${p.id}/active`, { isActive: !p.isActive })
      toast('success', turningOff ? 'Price switched off.' : 'Price switched on.')
      await reloadAll()
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const rows = history.data?.filter((p) => !filter || p.status === filter)
  const c = current.data
  return (
    <div className="space-y-6">
      <PageHeader title="Ticket prices" description="What each ticket costs, by audience and by weekday (Sunday–Thursday) or weekend (Friday–Saturday). Prices are history: to change one, add a new price from a future date. The old price ends the day before, and orders already placed keep the price they paid." />
      {canWrite && (
        <div>
          <Button onClick={() => setAdding(true)}>Add a new price</Button>
        </div>
      )}
      <Card title="Visitors pay today" description="The price that applies now, for the next weekday and the next weekend day.">
        {!c && !current.error && <Spinner />}
        {current.error && <Notice tone="error">{current.error}</Notice>}
        {c && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm" data-testid="price-matrix">
              <thead className="text-xs uppercase text-stone-500">
                <tr>
                  <th className="py-2 pr-3">Audience</th>
                  <th className="py-2 pr-3">Ticket</th>
                  <th className="py-2 pr-3">Weekday (Sun–Thu)</th>
                  <th className="py-2">Weekend (Fri–Sat)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {c.audiences.flatMap((a) =>
                  c.types.map((t) => {
                    const cell = c.cells.find((x) => x.audienceId === a.id && x.ticketTypeId === t.id)
                    return (
                      <tr key={`${a.id}-${t.id}`} data-testid="price-matrix-row">
                        <td className="py-2 pr-3">{a.nameEn}</td>
                        <td className="py-2 pr-3">
                          {t.nameEn} {!t.isActive && <Badge>off</Badge>}
                        </td>
                        <td className="py-2 pr-3 font-medium">{money(cell?.weekdayMinor)}</td>
                        <td className="py-2 font-medium">{money(cell?.weekendMinor)}</td>
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="Price history"
        actions={
          <Select label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All</option>
            {(['current', 'upcoming', 'ended', 'inactive'] as const).map((s) => (
              <option key={s} value={s}>
                {PRICE_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        }
      >
        {!rows && !history.error && <Spinner />}
        {history.error && <Notice tone="error">{history.error}</Notice>}
        {rows && rows.length === 0 && <p className="text-sm text-stone-500">Nothing to show.</p>}
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm" data-testid="price-history">
              <thead className="text-xs uppercase text-stone-500">
                <tr>
                  <th className="py-2 pr-3">Ticket · audience</th>
                  <th className="py-2 pr-3">Days</th>
                  <th className="py-2 pr-3">Price</th>
                  <th className="py-2 pr-3">From</th>
                  <th className="py-2 pr-3">To</th>
                  <th className="py-2 pr-3">Status</th>
                  {canWrite && <th className="py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((p) => (
                  <tr key={p.id} data-testid="price-row">
                    <td className="py-2 pr-3">
                      {p.ticketType.nameEn}
                      <div className="text-xs text-stone-500">{p.audience.nameEn}</div>
                    </td>
                    <td className="py-2 pr-3">{DAYS_LABEL[p.days]}</td>
                    <td className="py-2 pr-3 font-medium">
                      {money(p.amountMinor, p.currency)}
                      {p.timesUsed > 0 && <div className="text-xs font-normal text-stone-500">sold {p.timesUsed}×</div>}
                    </td>
                    <td className="py-2 pr-3">{formatDay(p.validFrom)}</td>
                    <td className="py-2 pr-3">{p.validTo ? formatDay(p.validTo) : 'open ended'}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={PRICE_STATUS_TONE[p.status]}>{PRICE_STATUS_LABEL[p.status]}</Badge>
                    </td>
                    {canWrite && (
                      <td className="py-2 text-right">
                        {p.status !== 'ended' && (
                          <Button variant="ghost" busy={busyId === p.id} onClick={() => void toggle(p)} aria-label={`${p.isActive ? 'Switch off' : 'Switch on'} ${p.ticketType.nameEn} ${p.audience.nameEn} ${money(p.amountMinor)}`}>
                            {p.isActive ? 'Switch off' : 'Switch on'}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {adding && c && (
        <PriceModal
          today={c.today}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false)
            await reloadAll()
          }}
        />
      )}
    </div>
  )
}

function PriceModal({ today, onClose, onSaved }: { today: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast()
  const types = useLoad<TicketTypeRow[]>('/ticket-types')
  const audiences = useLoad<AudienceRow[]>('/ticket-audiences')
  const [f, setF] = useState<PriceForm>({ ticketTypeId: '', audienceId: '', days: 'WEEKDAY', amount: '', validFrom: today, notes: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof PriceForm>(k: K, v: PriceForm[K]) => setF({ ...f, [k]: v })

  async function save() {
    const local = priceProblems(f, today)
    setErrors(local as Record<string, string>)
    if (Object.keys(local).length > 0) return
    setBusy(true)
    setFormError(null)
    try {
      await api.post('/prices', { ticketTypeId: f.ticketTypeId, audienceId: f.audienceId, days: f.days, amountMinor: parseEgp(f.amount), validFrom: f.validFrom, notes: f.notes.trim() || null })
      toast('success', 'New price added.')
      await onSaved()
    } catch (err) {
      const fe = fieldErrors(err)
      setErrors(fe)
      setFormError(Object.keys(fe).length === 0 ? errorMessage(err) : null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Add a new price" onClose={onClose}>
      <div className="space-y-4">
        {formError && <Notice tone="error">{formError}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Ticket type" value={f.ticketTypeId} onChange={(e) => set('ticketTypeId', e.target.value)} error={errors.ticketTypeId}>
            <option value="">Choose…</option>
            {types.data?.filter((t) => t.isActive).map((t) => (
              <option key={t.id} value={t.id}>
                {t.nameEn}
              </option>
            ))}
          </Select>
          <Select label="For" value={f.audienceId} onChange={(e) => set('audienceId', e.target.value)} error={errors.audienceId}>
            <option value="">Choose…</option>
            {audiences.data?.filter((a) => a.isActive).map((a) => (
              <option key={a.id} value={a.id}>
                {a.nameEn}
              </option>
            ))}
          </Select>
          <Select label="Days" value={f.days} onChange={(e) => set('days', e.target.value as PriceForm['days'])} error={errors.days}>
            <option value="WEEKDAY">{DAYS_LABEL.WEEKDAY}</option>
            <option value="WEEKEND">{DAYS_LABEL.WEEKEND}</option>
            <option value="EVERY_DAY">{DAYS_LABEL.EVERY_DAY}</option>
          </Select>
          <TextInput label="Price (EGP)" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} error={errors.amount ?? errors.amountMinor} hint="For example 50 or 62.50. Cannot be 0." />
          <TextInput label="Starts on" type="date" min={today} value={f.validFrom} onChange={(e) => set('validFrom', e.target.value)} error={errors.validFrom} />
          <TextArea label="Note (optional)" value={f.notes} onChange={(e) => set('notes', e.target.value)} error={errors.notes} />
        </div>
        {f.validFrom >= today && /^\d{4}-\d{2}-\d{2}$/.test(f.validFrom) && (
          <Notice tone="info">
            The current price for these days (if any) will end on {formatDay(dayBefore(f.validFrom))}. Orders already placed keep the price they paid.
          </Notice>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} busy={busy}>
            Add price
          </Button>
        </div>
      </div>
    </Modal>
  )
}
