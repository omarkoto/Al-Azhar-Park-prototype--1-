import { useState } from 'react'
import { Badge, Button, Card, Checkbox, Modal, Notice, PageHeader, Spinner, TextArea, TextInput, useToast } from '../components/ui'
import { api, errorMessage, fieldErrors } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { VenueData } from '../lib/events'
import { useLoad } from '../lib/hooks'
import { move, slugify } from '../lib/restaurants'

interface VenueForm {
  slug: string
  nameEn: string
  nameAr: string
  descriptionEn: string
  descriptionAr: string
  addressEn: string
  addressAr: string
  capacity: string
  isActive: boolean
}

const empty = (): VenueForm => ({ slug: '', nameEn: '', nameAr: '', descriptionEn: '', descriptionAr: '', addressEn: '', addressAr: '', capacity: '', isActive: true })
const toForm = (v: VenueData): VenueForm => ({
  slug: v.slug, nameEn: v.nameEn, nameAr: v.nameAr, descriptionEn: v.descriptionEn ?? '', descriptionAr: v.descriptionAr ?? '', addressEn: v.addressEn ?? '',
  addressAr: v.addressAr ?? '', capacity: v.capacity === null ? '' : String(v.capacity), isActive: v.isActive,
})
const blank = (s: string) => s.trim() || null

export function VenuesPage() {
  const { can } = useAuth()
  const toast = useToast()
  const { data, loading, error, setData, reload } = useLoad<VenueData[]>('/venues')
  const [editing, setEditing] = useState<VenueData | 'new' | null>(null)
  const [busy, setBusy] = useState(false)
  const canWrite = can('venues:write')

  async function reorder(index: number, delta: -1 | 1) {
    if (!data) return
    setBusy(true)
    try {
      setData(await api.put<VenueData[]>('/venues/order', { ids: move(data, index, delta).map((v) => v.id) }))
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(v: VenueData) {
    if (!window.confirm(`Delete the venue “${v.nameEn}”?`)) return
    try {
      await api.delete(`/venues/${v.id}`)
      toast('success', 'Venue deleted.')
      await reload()
    } catch (e) {
      toast('error', errorMessage(e))
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Venues" description="Places in the park where events happen. Events point to a venue, so changing a venue here updates every event that uses it. Switch a venue off to stop using it for new events." />
      {canWrite && (
        <div>
          <Button onClick={() => setEditing('new')}>Add a venue</Button>
        </div>
      )}
      {loading && !data && <Spinner />}
      {error && <Notice tone="error">{error}</Notice>}
      <Card>
        {data && data.length === 0 && <p className="text-sm text-stone-500">No venues yet.</p>}
        <ul className="divide-y divide-stone-100">
          {data?.map((v, i) => (
            <li key={v.id} data-testid="venue-row" className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-stone-900">
                  {v.nameEn} <span dir="rtl" className="text-stone-500">· {v.nameAr}</span>
                </p>
                <p className="truncate text-xs text-stone-500">
                  {v.eventCount} event{v.eventCount === 1 ? '' : 's'}
                  {v.capacity ? ` · up to ${v.capacity.toLocaleString()} people` : ''}
                  {v.addressEn ? ` · ${v.addressEn}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Badge tone={v.isActive ? 'teal' : 'neutral'}>{v.isActive ? 'Active' : 'Switched off'}</Badge>
                {canWrite && (
                  <>
                    <Button variant="ghost" disabled={busy || i === 0} onClick={() => void reorder(i, -1)} aria-label={`Move ${v.nameEn} up`}>
                      ↑
                    </Button>
                    <Button variant="ghost" disabled={busy || i === data.length - 1} onClick={() => void reorder(i, 1)} aria-label={`Move ${v.nameEn} down`}>
                      ↓
                    </Button>
                    <Button variant="ghost" onClick={() => setEditing(v)} aria-label={`Edit ${v.nameEn}`}>
                      Edit
                    </Button>
                    <Button variant="ghost" className="text-red-700" disabled={v.eventCount > 0} title={v.eventCount > 0 ? 'Used by events: switch it off instead' : undefined} onClick={() => void remove(v)} aria-label={`Delete ${v.nameEn}`}>
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      {editing && (
        <VenueModal
          venue={editing === 'new' ? null : editing}
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

function VenueModal({ venue, onClose, onSaved }: { venue: VenueData | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast()
  const [f, setF] = useState<VenueForm>(venue ? toForm(venue) : empty())
  const [slugTouched, setSlugTouched] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof VenueForm>(k: K, v: VenueForm[K]) => setF({ ...f, [k]: v })

  async function save() {
    setBusy(true)
    setErrors({})
    setFormError(null)
    try {
      const body = {
        nameEn: f.nameEn.trim(), nameAr: f.nameAr.trim(), descriptionEn: blank(f.descriptionEn), descriptionAr: blank(f.descriptionAr), addressEn: blank(f.addressEn),
        addressAr: blank(f.addressAr), capacity: f.capacity.trim() ? Number(f.capacity) : null, isActive: f.isActive,
      }
      if (venue) await api.put(`/venues/${venue.id}`, body)
      else await api.post('/venues', { slug: f.slug.trim(), ...body })
      toast('success', 'Venue saved.')
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
    <Modal title={venue ? 'Edit venue' : 'Add a venue'} onClose={onClose}>
      <div className="space-y-4">
        {formError && <Notice tone="error">{formError}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Name (English)" value={f.nameEn} onChange={(e) => { const v = e.target.value; setF({ ...f, nameEn: v, ...(!venue && !slugTouched ? { slug: slugify(v) } : {}) }) }} error={errors.nameEn} />
          <TextInput label="Name (Arabic)" rtl value={f.nameAr} onChange={(e) => set('nameAr', e.target.value)} error={errors.nameAr} />
          <TextInput label="Web address" value={f.slug} disabled={!!venue} onChange={(e) => { setSlugTouched(true); set('slug', e.target.value) }} error={errors.slug} hint={venue ? 'Cannot be changed.' : 'Lower-case letters and hyphens.'} />
          <TextInput label="Capacity (people)" inputMode="numeric" value={f.capacity} onChange={(e) => set('capacity', e.target.value.replace(/[^\d]/g, ''))} error={errors.capacity} />
          <TextInput label="Address / where in the park (English)" value={f.addressEn} onChange={(e) => set('addressEn', e.target.value)} error={errors.addressEn} />
          <TextInput label="Address / where in the park (Arabic)" rtl value={f.addressAr} onChange={(e) => set('addressAr', e.target.value)} error={errors.addressAr} />
          <TextArea label="Description (English)" value={f.descriptionEn} onChange={(e) => set('descriptionEn', e.target.value)} error={errors.descriptionEn} />
          <TextArea label="Description (Arabic)" rtl value={f.descriptionAr} onChange={(e) => set('descriptionAr', e.target.value)} error={errors.descriptionAr} />
        </div>
        <Checkbox label="Active (can be chosen for new events)" checked={f.isActive} onChange={(v) => set('isActive', v)} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} busy={busy}>
            Save venue
          </Button>
        </div>
      </div>
    </Modal>
  )
}
