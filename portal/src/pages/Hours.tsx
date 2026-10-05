import { useEffect, useState } from 'react'
import { Badge, Button, Card, Checkbox, Modal, Notice, PageHeader, Select, Spinner, TextArea, TextInput, useToast } from '../components/ui'
import { api, errorMessage, fieldErrors } from '../lib/api'
import { useAuth } from '../lib/auth'
import { cairoToday, copyDay, DAY_NAMES, emptySpecial, KIND_LABELS, specialPayload, weeklyPayload, type SpecialData, type SpecialKind, type WeeklyDay } from '../lib/forms'
import { useLoad } from '../lib/hooks'

export function HoursPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Opening hours"
        description="The regular weekly hours, and exceptions such as holidays, Ramadan or a temporary closure. These are the same hours the ticket shop uses: same-day tickets stop being sold one hour before closing."
      />
      <WeeklyHours />
      <SpecialHoursList />
    </div>
  )
}

// ───────────────────────────── weekly ─────────────────────────────

function WeeklyHours() {
  const { can } = useAuth()
  const toast = useToast()
  const { data, loading, error, setData } = useLoad<{ days: WeeklyDay[] }>('/opening-hours')
  const [days, setDays] = useState<WeeklyDay[] | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const canWrite = can('hours:write')

  useEffect(() => {
    if (data) setDays(data.days.map((d) => ({ ...d })))
  }, [data])

  if (loading && !days) return <Spinner />
  if (error && !days) return <Notice tone="error">{error}</Notice>
  if (!days) return null

  const patch = (dayOfWeek: number, p: Partial<WeeklyDay>) => setDays(days.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...p } : d)))
  const dirty = JSON.stringify(weeklyPayload(days)) !== JSON.stringify(weeklyPayload(data?.days ?? []))

  async function save() {
    if (!days) return
    setBusy(true)
    setErrors({})
    try {
      setData(await api.put<{ days: WeeklyDay[] }>('/opening-hours', weeklyPayload(days)))
      toast('success', 'Weekly hours saved.')
    } catch (err) {
      setErrors(fieldErrors(err))
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="Weekly hours"
      description="Tick “Closed” for a day the park does not open."
      actions={
        canWrite && (
          <Button variant="secondary" type="button" onClick={() => setDays(copyDay(days, 0, [1, 2, 3, 4, 5, 6]))}>
            Copy Sunday to every day
          </Button>
        )
      }
    >
      {!canWrite && <Notice tone="info">You can view the hours but not change them.</Notice>}
      <div className="divide-y divide-stone-100">
        {days.map((d, i) => (
          <div key={d.dayOfWeek} className="grid items-end gap-3 py-3 sm:grid-cols-[8rem_1fr_1fr_auto]">
            <p className="text-sm font-medium text-stone-900">{DAY_NAMES[d.dayOfWeek]}</p>
            <TextInput label="Opens" type="time" disabled={!canWrite || busy || d.isClosed} value={d.opens ?? ''} onChange={(e) => patch(d.dayOfWeek, { opens: e.target.value })} error={errors[`days.${i}.opens`]} />
            <TextInput label="Closes" type="time" disabled={!canWrite || busy || d.isClosed} value={d.closes ?? ''} onChange={(e) => patch(d.dayOfWeek, { closes: e.target.value })} error={errors[`days.${i}.closes`]} />
            <div className="pb-2">
              <Checkbox label="Closed" checked={d.isClosed} disabled={!canWrite || busy} onChange={(v) => patch(d.dayOfWeek, v ? { isClosed: true } : { isClosed: false, opens: d.opens ?? '09:00', closes: d.closes ?? '22:00' })} />
            </div>
          </div>
        ))}
      </div>
      {errors.days && <p className="mt-2 text-xs font-medium text-red-700">{errors.days}</p>}
      {canWrite && (
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => void save()} busy={busy} disabled={!dirty}>
            Save weekly hours
          </Button>
          {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
        </div>
      )}
    </Card>
  )
}

// ───────────────────────────── special hours ─────────────────────────────

type When = 'upcoming' | 'past' | 'all'

function SpecialHoursList() {
  const { can } = useAuth()
  const toast = useToast()
  const [when, setWhen] = useState<When>('upcoming')
  const { data, loading, error, reload } = useLoad<SpecialData[]>(`/special-hours?when=${when}`)
  const [editing, setEditing] = useState<SpecialData | 'new' | null>(null)
  const canWrite = can('hours:write')

  async function remove(s: SpecialData) {
    if (!window.confirm(`Delete “${s.labelEn}”? This cannot be undone (it stays in the audit log).`)) return
    try {
      await api.delete(`/special-hours/${s.id}`)
      toast('success', 'Deleted.')
      await reload()
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  return (
    <Card
      title="Holidays, Ramadan and closures"
      description="When several periods cover the same day, the one with the highest priority applies."
      actions={
        <div className="flex items-center gap-2">
          <select aria-label="Show" value={when} onChange={(e) => setWhen(e.target.value as When)} className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm">
            <option value="upcoming">Upcoming</option>
            <option value="past">Past</option>
            <option value="all">All</option>
          </select>
          {canWrite && <Button onClick={() => setEditing('new')}>Add</Button>}
        </div>
      }
    >
      {loading && !data && <Spinner />}
      {error && <Notice tone="error">{error}</Notice>}
      {data && data.length === 0 && <p className="text-sm text-stone-500">Nothing here. The weekly hours apply every day.</p>}
      {data && data.length > 0 && (
        <ul className="divide-y divide-stone-100">
          {data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-900">
                  {s.labelEn} <span dir="rtl" className="text-stone-500">· {s.labelAr}</span>
                </p>
                <p className="mt-0.5 text-xs text-stone-500">
                  {s.dateFrom === s.dateTo ? s.dateFrom : `${s.dateFrom} → ${s.dateTo}`} ·{' '}
                  {s.isClosed ? 'Closed' : `${s.opens}–${s.closes}`} · priority {s.priority}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={s.kind === 'TEMPORARY_CLOSURE' ? 'red' : s.kind === 'HOLIDAY' ? 'amber' : 'teal'}>{KIND_LABELS[s.kind].split(' (')[0]}</Badge>
                {!s.isActive && <Badge>Inactive</Badge>}
                {canWrite && (
                  <>
                    <Button variant="ghost" onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                    <Button variant="ghost" className="text-red-700" onClick={() => void remove(s)}>
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <SpecialForm
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await reload()
          }}
        />
      )}
    </Card>
  )
}

function SpecialForm({ initial, onClose, onSaved }: { initial: SpecialData | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast()
  const [s, setS] = useState<Omit<SpecialData, 'id'>>(() => (initial ? { ...initial } : emptySpecial(cairoToday())))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof typeof s>(key: K, value: (typeof s)[K]) => setS({ ...s, [key]: value })
  const closed = s.kind === 'TEMPORARY_CLOSURE' || s.isClosed

  async function submit() {
    setBusy(true)
    setErrors({})
    setFormError(null)
    try {
      const body = specialPayload(s)
      if (initial) await api.put(`/special-hours/${initial.id}`, body)
      else await api.post('/special-hours', body)
      toast('success', 'Saved.')
      await onSaved()
    } catch (err) {
      const fe = fieldErrors(err)
      setErrors(fe)
      setFormError(Object.keys(fe).length === 0 ? errorMessage(err) : null)
      if (Object.keys(fe).length > 0) toast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={initial ? 'Edit period' : 'Add a period'} onClose={onClose}>
      <div className="space-y-4">
        {formError && <Notice tone="error">{formError}</Notice>}
        <Select label="Type" value={s.kind} onChange={(e) => set('kind', e.target.value as SpecialKind)} error={errors.kind}>
          {(Object.keys(KIND_LABELS) as SpecialKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="First day" type="date" value={s.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} error={errors.dateFrom} />
          <TextInput label="Last day" type="date" value={s.dateTo} onChange={(e) => set('dateTo', e.target.value)} error={errors.dateTo} />
        </div>
        {s.kind !== 'TEMPORARY_CLOSURE' && <Checkbox label="Closed on these days" checked={s.isClosed} onChange={(v) => set('isClosed', v)} />}
        {!closed && (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Opens" type="time" value={s.opens ?? ''} onChange={(e) => set('opens', e.target.value)} error={errors.opens} />
            <TextInput label="Closes" type="time" value={s.closes ?? ''} onChange={(e) => set('closes', e.target.value)} error={errors.closes} />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Name (English)" value={s.labelEn} onChange={(e) => set('labelEn', e.target.value)} error={errors.labelEn} maxLength={120} />
          <TextInput label="Name (Arabic)" rtl value={s.labelAr} onChange={(e) => set('labelAr', e.target.value)} error={errors.labelAr} maxLength={120} />
          <TextArea label="Note (English, optional)" value={s.noteEn ?? ''} onChange={(e) => set('noteEn', e.target.value)} error={errors.noteEn} maxLength={500} />
          <TextArea label="Note (Arabic, optional)" rtl value={s.noteAr ?? ''} onChange={(e) => set('noteAr', e.target.value)} error={errors.noteAr} maxLength={500} />
        </div>
        <div className="grid items-end gap-4 sm:grid-cols-2">
          <TextInput label="Priority (0–100)" type="number" min={0} max={100} value={s.priority} onChange={(e) => set('priority', Number(e.target.value))} error={errors.priority} hint="Higher wins when periods overlap." />
          <div className="pb-2">
            <Checkbox label="Active" checked={s.isActive} onChange={(v) => set('isActive', v)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} busy={busy}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}
