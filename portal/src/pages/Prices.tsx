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
  const [editing, setEditing] = useState<EditTarget | null>(null)
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
      <PageHeader title="Ticket prices" description="What each ticket costs, by audience and by weekday (Sunday–Thursday) or weekend (Friday–Saturday). Click any price to change it. Orders already placed keep the price they paid, and every change is kept in the history." />
      {canWrite && (
        <div>
          <Button onClick={() => setAdding(true)}>Add a new price</Button>
        </div>
      )}
      <Card title="Visitors pay today" description={canWrite ? 'The price that applies now. Click a price to change it — the new price starts today by default and the old one is kept in the history below.' : 'The price that applies now, for the next weekday and the next weekend day.'}>
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
              <tbody className="divide-y divide-sand-100">
                {c.audiences.flatMap((a) =>
                  c.types.map((t) => {
                    const cell = c.cells.find((x) => x.audienceId === a.id && x.ticketTypeId === t.id)
                    return (
                      <tr key={`${a.id}-${t.id}`} data-testid="price-matrix-row">
                        <td className="py-2 pr-3">{a.nameEn}</td>
                        <td className="py-2 pr-3">
                          {t.nameEn} {!t.isActive && <Badge>off</Badge>}
                        </td>
                        <td className="py-2 pr-3 font-medium">
                          <PriceCell minor={cell?.weekdayMinor} canEdit={canWrite && t.isActive} label={`${t.nameEn}, ${a.nameEn}, weekday`} onEdit={() => setEditing({ type: t, audience: a, days: 'WEEKDAY', currentMinor: cell?.weekdayMinor ?? null })} />
                        </td>
                        <td className="py-2 font-medium">
                          <PriceCell minor={cell?.weekendMinor} canEdit={canWrite && t.isActive} label={`${t.nameEn}, ${a.nameEn}, weekend`} onEdit={() => setEditing({ type: t, audience: a, days: 'WEEKEND', currentMinor: cell?.weekendMinor ?? null })} />
                        </td>
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
              <tbody className="divide-y divide-sand-100">
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
      {editing && c && history.data && (
        <EditPriceModal
          target={editing}
          today={c.today}
          history={history.data}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await reloadAll()
          }}
        />
      )}
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

interface EditTarget {
  type: { id: string; nameEn: string }
  audience: { id: string; nameEn: string }
  days: 'WEEKDAY' | 'WEEKEND'
  currentMinor: number | null
}

function PriceCell({ minor, canEdit, label, onEdit }: { minor: number | null | undefined; canEdit: boolean; label: string; onEdit: () => void }) {
  if (!canEdit) return <>{money(minor)}</>
  return (
    <button onClick={onEdit} aria-label={`Change price: ${label}`} className="group inline-flex items-center gap-2 rounded-full border border-sand-200 bg-sand-50 px-3 py-1 font-semibold text-teal-900 transition-colors hover:border-gold-500 hover:bg-gold-100/60">
      {money(minor)}
      <span className="text-xs font-medium text-gold-700 group-hover:underline">Edit</span>
    </button>
  )
}

/**
 * Changing a price in place, from the visitor's point of view. Underneath, the park keeps price history: the old price is
 * closed the day before the new one starts (or switched off if it started on the same day), so past orders never change.
 */
function EditPriceModal({ target, today, history, onClose, onSaved }: { target: EditTarget; today: string; history: PriceRowData[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast()
  const [amount, setAmount] = useState(target.currentMinor === null ? '' : String(target.currentMinor / 100))
  const [validFrom, setValidFrom] = useState(today)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    const minor = parseEgp(amount)
    if (minor === null) return setError('Enter a price above 0, for example 50 or 62.50.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || validFrom < today) return setError('The new price must start today or later.')
    if (minor === target.currentMinor && validFrom === today) return setError('That is already the current price.')
    setBusy(true)
    setError(null)
    try {
      // a price that starts on or after the new start date cannot be "closed the day before", so it is switched off first
      const clashing = history.filter(
        (p) => p.ticketTypeId === target.type.id && p.audienceId === target.audience.id && p.days === target.days && p.isActive && p.status !== 'ended' && p.validFrom >= validFrom,
      )
      for (const p of clashing) await api.put(`/prices/${p.id}/active`, { isActive: false })
      await api.post('/prices', { ticketTypeId: target.type.id, audienceId: target.audience.id, days: target.days, amountMinor: minor, validFrom, notes: null })
      toast('success', `Price updated to ${money(minor)}.`)
      await onSaved()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Change ticket price" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-stone-600">
          {target.type.nameEn} · {target.audience.nameEn} · {DAYS_LABEL[target.days]}
          <br />
          Now: <strong className="text-teal-900">{money(target.currentMinor)}</strong>
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="New price (EGP)" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} hint="For example 50 or 62.50." />
          <TextInput label="Starts on" type="date" min={today} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
        </div>
        <Notice tone="info">Orders already placed keep the price they paid. The old price stays in the history below.</Notice>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} busy={busy}>
            Save price
          </Button>
        </div>
      </div>
    </Modal>
  )
}
