import { useState } from 'react'
import { Badge, Button, Card, Checkbox, Modal, Notice, PageHeader, Spinner, TextArea, TextInput, useToast } from '../components/ui'
import { api, errorMessage, fieldErrors } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/hooks'
import { move } from '../lib/restaurants'
import { ageRange, emptyTypeForm, typeProblems, typeToForm, type TicketTypeRow, type TypeForm } from '../lib/ticketing'

const blank = (s: string) => s.trim() || null

export function TicketTypesPage() {
  const { can } = useAuth()
  const toast = useToast()
  const { data, loading, error, setData, reload } = useLoad<TicketTypeRow[]>('/ticket-types')
  const [editing, setEditing] = useState<TicketTypeRow | 'new' | null>(null)
  const [busy, setBusy] = useState(false)
  const canWrite = can('ticket-types:write')

  async function reorder(index: number, delta: -1 | 1) {
    if (!data) return
    setBusy(true)
    try {
      setData(await api.put<TicketTypeRow[]>('/ticket-types/order', { ids: move(data, index, delta).map((t) => t.id) }))
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Ticket types" description="The kinds of ticket visitors can buy, by age. Children under 2 enter free and do not need a ticket, so no ticket type can start below age 2. A type is never deleted: switch it off to stop selling it. Prices are managed on the Ticket prices page." />
      {canWrite && (
        <div>
          <Button onClick={() => setEditing('new')}>Add a ticket type</Button>
        </div>
      )}
      {loading && !data && <Spinner />}
      {error && <Notice tone="error">{error}</Notice>}
      <Card>
        {data && data.length === 0 && <p className="text-sm text-stone-500">No ticket types yet.</p>}
        <ul className="divide-y divide-sand-100">
          {data?.map((t, i) => (
            <li key={t.id} data-testid="ticket-type-row" className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-stone-900">
                  {t.nameEn} <span dir="rtl" className="text-stone-500">· {t.nameAr}</span>
                </p>
                <p className="text-xs text-stone-500">
                  Ages {ageRange(t)} · code {t.code} · sold {t.timesSold} time{t.timesSold === 1 ? '' : 's'} · {t.priceRows} price row{t.priceRows === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Badge tone={t.isActive ? 'teal' : 'neutral'}>{t.isActive ? 'On sale' : 'Switched off'}</Badge>
                {canWrite && (
                  <>
                    <Button variant="ghost" disabled={busy || i === 0} onClick={() => void reorder(i, -1)} aria-label={`Move ${t.nameEn} up`}>
                      ↑
                    </Button>
                    <Button variant="ghost" disabled={busy || i === data.length - 1} onClick={() => void reorder(i, 1)} aria-label={`Move ${t.nameEn} down`}>
                      ↓
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(t)} aria-label={`Edit ${t.nameEn}`}>
                      Edit
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {editing && (
        <TypeModal
          type={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await reload()
          }}
        />
      )}
    </div>
  )
}

function TypeModal({ type, onClose, onSaved }: { type: TicketTypeRow | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast()
  const [f, setF] = useState<TypeForm>(type ? typeToForm(type) : emptyTypeForm())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof TypeForm>(k: K, v: TypeForm[K]) => setF({ ...f, [k]: v })
  const locked = !!type && type.timesSold > 0

  async function save() {
    const local = typeProblems(f, !type)
    setErrors(local as Record<string, string>)
    if (Object.keys(local).length > 0) return
    setBusy(true)
    setFormError(null)
    try {
      const body = {
        nameEn: f.nameEn.trim(), nameAr: f.nameAr.trim(), descriptionEn: blank(f.descriptionEn), descriptionAr: blank(f.descriptionAr),
        minAge: Number(f.minAge), maxAge: f.maxAge.trim() === '' ? null : Number(f.maxAge), isActive: f.isActive,
      }
      if (type) await api.put(`/ticket-types/${type.id}`, body)
      else await api.post('/ticket-types', { code: f.code.trim().toUpperCase(), ...body })
      toast('success', 'Ticket type saved.')
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
    <Modal title={type ? `Edit ${type.nameEn}` : 'Add a ticket type'} onClose={onClose}>
      <div className="space-y-4">
        {formError && <Notice tone="error">{formError}</Notice>}
        {locked && <Notice tone="info">This type has already been sold, so its age range is fixed. Names and descriptions can change; past orders keep the name they were sold under.</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Name (English)" value={f.nameEn} onChange={(e) => set('nameEn', e.target.value)} error={errors.nameEn} />
          <TextInput label="Name (Arabic)" rtl value={f.nameAr} onChange={(e) => set('nameAr', e.target.value)} error={errors.nameAr} />
          <TextInput label="Code" value={f.code} disabled={!!type} onChange={(e) => set('code', e.target.value.toUpperCase())} error={errors.code} hint={type ? 'Cannot be changed.' : 'Capital letters, digits and underscores, e.g. SENIOR.'} />
          <div />
          <TextInput label="Youngest age" inputMode="numeric" value={f.minAge} disabled={locked} onChange={(e) => set('minAge', e.target.value.replace(/[^\d-]/g, ''))} error={errors.minAge} hint="At least 2." />
          <TextInput label="Oldest age" inputMode="numeric" value={f.maxAge} disabled={locked} onChange={(e) => set('maxAge', e.target.value.replace(/[^\d]/g, ''))} error={errors.maxAge} hint="Leave empty for no upper limit." />
          <TextArea label="Description (English)" value={f.descriptionEn} onChange={(e) => set('descriptionEn', e.target.value)} error={errors.descriptionEn} />
          <TextArea label="Description (Arabic)" rtl value={f.descriptionAr} onChange={(e) => set('descriptionAr', e.target.value)} error={errors.descriptionAr} />
        </div>
        <Checkbox label="On sale (switch off to stop selling this ticket)" checked={f.isActive} onChange={(v) => set('isActive', v)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} busy={busy}>
            Save ticket type
          </Button>
        </div>
      </div>
    </Modal>
  )
}
