import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, Card, Checkbox, Notice, PageHeader, Select, Spinner, TextArea, TextInput, useToast } from '../components/ui'
import { api, assetUrl, errorMessage, fieldErrors, type PageMeta } from '../lib/api'
import { useAuth } from '../lib/auth'
import { canReorder, emptyEventForm, eventToForm, formToEvent, STATUS_HELP, STATUS_LABEL, STATUSES, statusActions, timeHint, whenText, type EventData, type EventForm, type EventStatus, type VenueData } from '../lib/events'
import { useLoad } from '../lib/hooks'
import { cairoToday } from '../lib/forms'
import { move, slugify, type MediaItem } from '../lib/restaurants'
import { MediaPicker } from './Media'

const statusTone = (s: EventStatus) => (s === 'PUBLISHED' ? 'teal' : s === 'COMING_SOON' ? 'amber' : s === 'CANCELLED' ? 'red' : 'neutral') as 'teal' | 'amber' | 'red' | 'neutral'

// ───────────────────────────── list ─────────────────────────────

export function EventsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState<'' | EventStatus>('')
  const [items, setItems] = useState<EventData[] | null>(null)
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const canWrite = can('events:write')

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 300)
    return () => window.clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ limit: '100' })
      if (debounced.trim()) p.set('search', debounced.trim())
      if (status) p.set('status', status)
      const r = await api.getPage<EventData>(`/events?${p.toString()}`)
      setItems(r.items)
      setMeta(r.meta)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [debounced, status])

  useEffect(() => {
    void load()
  }, [load])

  const reorderable = !!items && !!meta && canWrite && canReorder({ search: debounced, status }, items.length, meta.total)

  async function reorder(index: number, delta: -1 | 1) {
    if (!items) return
    setBusy(true)
    try {
      const next = await api.put<EventData[]>('/events/order', { ids: move(items, index, delta).map((e) => e.id) })
      setItems(next)
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Events" description="Events and what is coming soon. Only “Coming soon” and “Published” events appear on the website; drafts, cancelled and archived events stay here." />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <TextInput label="Search" placeholder="Title or address" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-48">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as '' | EventStatus)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
        {canWrite && (
          <Link to="/events/new" className="inline-flex rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
            Add an event
          </Link>
        )}
      </div>
      {!items && !error && <Spinner />}
      {error && <Notice tone="error">{error}</Notice>}
      {items && items.length === 0 && <Notice tone="info">{debounced || status ? 'No events match these filters.' : 'No events yet.'}</Notice>}
      {items && items.length > 0 && !reorderable && canWrite && <p className="text-xs text-stone-500">Clear the search and status filter to change the order.</p>}
      <ul className="space-y-3">
        {items?.map((e, i) => (
          <li key={e.id} data-testid="event-row" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <div className="flex min-w-0 items-center gap-4">
              {e.hero ? <img src={assetUrl(e.hero.url)} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" /> : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-xs text-stone-400">No photo</div>}
              <div className="min-w-0">
                <p className="truncate font-medium text-stone-900">
                  {e.titleEn} <span dir="rtl" className="text-stone-500">· {e.titleAr}</span>
                </p>
                <p className="truncate text-xs text-stone-500">
                  {whenText(e)}
                  {e.venue ? ` · ${e.venue.nameEn}` : e.locationNameEn ? ` · ${e.locationNameEn}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={statusTone(e.status)}>{STATUS_LABEL[e.status]}</Badge>
              {reorderable && (
                <>
                  <Button variant="ghost" disabled={busy || i === 0} onClick={() => void reorder(i, -1)} aria-label={`Move ${e.titleEn} up`}>
                    ↑
                  </Button>
                  <Button variant="ghost" disabled={busy || i === items.length - 1} onClick={() => void reorder(i, 1)} aria-label={`Move ${e.titleEn} down`}>
                    ↓
                  </Button>
                </>
              )}
              <Link to={`/events/${e.id}`} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-50" aria-label={`Open ${e.titleEn}`}>
                {canWrite ? 'Edit' : 'View'}
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ───────────────────────────── editor ─────────────────────────────

type Tab = 'details' | 'photos'

export function EventEditor() {
  const { id = '' } = useParams()
  const isNew = id === 'new'
  const { data, loading, error, setData } = useLoad<EventData>(isNew ? null : `/events/${id}`)
  const [tab, setTab] = useState<Tab>('details')

  if (!isNew && loading && !data) return <Spinner />
  if (!isNew && error && !data) return <Notice tone="error">{error}</Notice>

  return (
    <div className="space-y-6">
      <Link to="/events" className="text-sm text-teal-800 hover:underline">
        ← All events
      </Link>
      <PageHeader title={isNew ? 'New event' : (data?.titleEn ?? 'Event')} description={isNew ? 'It starts as a draft. Publish it when it is ready.' : `Address: /events/${data?.slug}`} />
      {data && <StatusPanel event={data} onChanged={setData} />}
      <div role="tablist" className="flex gap-1 border-b border-stone-200">
        {(['details', 'photos'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            disabled={isNew && t !== 'details'}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium capitalize disabled:text-stone-300 ${tab === t ? 'border-teal-700 text-teal-900' : 'border-transparent text-stone-500 hover:text-stone-800'}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'details' && <DetailsTab event={data} isNew={isNew} onSaved={setData} />}
      {tab === 'photos' && data && <PhotosTab event={data} onChanged={setData} />}
    </div>
  )
}

function StatusPanel({ event, onChanged }: { event: EventData; onChanged: (e: EventData) => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState<EventStatus | null>(null)
  const canPublish = can('events:publish')

  async function change(to: EventStatus, confirm?: string) {
    if (confirm && !window.confirm(confirm)) return
    setBusy(to)
    try {
      onChanged(await api.put<EventData>(`/events/${event.id}/status`, { status: to }))
      toast('success', `Event is now ${STATUS_LABEL[to].toLowerCase()}.`)
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">Status</p>
          <p className="mt-1 flex items-center gap-2">
            <Badge tone={statusTone(event.status)}>{STATUS_LABEL[event.status]}</Badge>
            <span className="text-sm text-stone-600">{STATUS_HELP[event.status]}</span>
          </p>
        </div>
        {canPublish ? (
          <div className="flex flex-wrap gap-2">
            {statusActions(event.status).map((a) => (
              <Button key={a.to} variant={a.tone} busy={busy === a.to} disabled={busy !== null} onClick={() => void change(a.to, a.confirm)}>
                {a.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-500">Changing the status needs the publish permission.</p>
        )}
      </div>
    </Card>
  )
}

function DetailsTab({ event, isNew, onSaved }: { event: EventData | null; isNew: boolean; onSaved: (e: EventData) => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const venues = useLoad<VenueData[]>(can('venues:read') ? '/venues' : null)
  const [form, setForm] = useState<EventForm>(emptyEventForm(cairoToday()))
  const [slugTouched, setSlugTouched] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const canWrite = can('events:write')
  const slugLocked = !isNew && !!event?.publishedAt

  useEffect(() => {
    if (event) setForm(eventToForm(event))
  }, [event])

  const set = <K extends keyof EventForm>(key: K, value: EventForm[K]) => setForm({ ...form, [key]: value })
  const hint = timeHint(form.startTime, form.endTime)
  // an inactive venue stays selectable when the event already uses it
  const venueOptions = (venues.data ?? []).filter((v) => v.isActive || v.id === event?.venue?.id)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const body = formToEvent(form, event?.hero?.id ?? null, isNew || !slugLocked)
      if (isNew) {
        const created = await api.post<EventData>('/events', body)
        toast('success', 'Event created as a draft. Add its photos, then publish it.')
        navigate(`/events/${created.id}`, { replace: true })
      } else {
        onSaved(await api.put<EventData>(`/events/${event!.id}`, body))
        toast('success', 'Saved.')
      }
    } catch (err) {
      setErrors(fieldErrors(err))
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      {!canWrite && <Notice tone="info">You can view this event but not change it.</Notice>}

      <Card title="Title and address">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          <TextInput label="Title (English)" value={form.titleEn} onChange={(e) => { const v = e.target.value; setForm({ ...form, titleEn: v, ...(isNew && !slugTouched ? { slug: slugify(v) } : {}) }) }} error={errors.titleEn} maxLength={150} />
          <TextInput label="Title (Arabic)" rtl value={form.titleAr} onChange={(e) => set('titleAr', e.target.value)} error={errors.titleAr} maxLength={150} />
          <div className="md:col-span-2">
            <TextInput
              label="Web address"
              value={form.slug}
              disabled={slugLocked}
              onChange={(e) => { setSlugTouched(true); set('slug', e.target.value) }}
              error={errors.slug}
              hint={slugLocked ? 'This event has been public, so its address can no longer change.' : 'Used in the website address, e.g. /events/cairo-jazz-nights. It locks once the event has been public.'}
            />
          </div>
        </fieldset>
      </Card>

      <Card title="Description">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          <TextArea label="Short description (English)" value={form.shortDescriptionEn} onChange={(e) => set('shortDescriptionEn', e.target.value)} error={errors.shortDescriptionEn} maxLength={300} hint="Shown on cards and in the Coming soon strip." />
          <TextArea label="Short description (Arabic)" rtl value={form.shortDescriptionAr} onChange={(e) => set('shortDescriptionAr', e.target.value)} error={errors.shortDescriptionAr} maxLength={300} />
          <TextArea label="Description (English)" value={form.descriptionEn} onChange={(e) => set('descriptionEn', e.target.value)} error={errors.descriptionEn} maxLength={6000} />
          <TextArea label="Description (Arabic)" rtl value={form.descriptionAr} onChange={(e) => set('descriptionAr', e.target.value)} error={errors.descriptionAr} maxLength={6000} />
        </fieldset>
      </Card>

      <Card title="When and where" description="Times are the park's local time (Cairo). An end time earlier than the start time means the event runs past midnight.">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-3">
          <TextInput label="Date" type="date" value={form.eventDate} onChange={(e) => set('eventDate', e.target.value)} error={errors.eventDate} />
          <TextInput label="Starts" type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} error={errors.startTime} />
          <TextInput label="Ends" type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} error={errors.endTime} />
          {hint && (
            <div className="md:col-span-3">
              <Notice tone={hint.tone === 'error' ? 'warn' : 'info'}>{hint.text}</Notice>
            </div>
          )}
          <Select label="Venue" value={form.venueId} onChange={(e) => set('venueId', e.target.value)} error={errors.venueId} disabled={!can('venues:read')}>
            <option value="">No venue</option>
            {venueOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nameEn}
                {v.isActive ? '' : ' (switched off)'}
              </option>
            ))}
          </Select>
          <TextInput label="Other location (English)" value={form.locationNameEn} onChange={(e) => set('locationNameEn', e.target.value)} error={errors.locationNameEn} hint="Only for a place that is not a venue." />
          <TextInput label="Other location (Arabic)" rtl value={form.locationNameAr} onChange={(e) => set('locationNameAr', e.target.value)} error={errors.locationNameAr} />
        </fieldset>
      </Card>

      <Card title="Display wording (optional)" description="For events that last several days, or need their own wording, such as “Nightly, 8:00 PM – 1:00 AM”. When filled in, this replaces the date or time on the website.">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          <TextInput label="Date wording (English)" value={form.dateLabelEn} onChange={(e) => set('dateLabelEn', e.target.value)} error={errors.dateLabelEn} />
          <TextInput label="Date wording (Arabic)" rtl value={form.dateLabelAr} onChange={(e) => set('dateLabelAr', e.target.value)} error={errors.dateLabelAr} />
          <TextInput label="Time wording (English)" value={form.timeLabelEn} onChange={(e) => set('timeLabelEn', e.target.value)} error={errors.timeLabelEn} />
          <TextInput label="Time wording (Arabic)" rtl value={form.timeLabelAr} onChange={(e) => set('timeLabelAr', e.target.value)} error={errors.timeLabelAr} />
        </fieldset>
      </Card>

      <Card>
        <Checkbox label="Feature this event" checked={form.isFeatured} disabled={!canWrite || busy} onChange={(v) => set('isFeatured', v)} />
      </Card>

      {canWrite && (
        <Button type="submit" busy={busy}>
          {isNew ? 'Create event' : 'Save changes'}
        </Button>
      )}
    </form>
  )
}

function PhotosTab({ event, onChanged }: { event: EventData; onChanged: (e: EventData) => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const canWrite = can('events:write') && can('media:read')
  const [picker, setPicker] = useState<'hero' | 'gallery' | null>(null)
  const [gallery, setGallery] = useState(event.gallery)
  const [busy, setBusy] = useState(false)
  useEffect(() => setGallery(event.gallery), [event.gallery])
  const dirty = JSON.stringify(gallery.map((g) => [g.media.id, g.captionEn, g.captionAr])) !== JSON.stringify(event.gallery.map((g) => [g.media.id, g.captionEn, g.captionAr]))

  async function setHero(media: MediaItem | null) {
    setBusy(true)
    try {
      onChanged(await api.put<EventData>(`/events/${event.id}`, formToEvent(eventToForm(event), media?.id ?? null, false)))
      toast('success', media ? 'Main photo set.' : 'Main photo removed.')
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveGallery() {
    setBusy(true)
    try {
      onChanged(await api.put<EventData>(`/events/${event.id}/gallery`, { items: gallery.map((g) => ({ mediaId: g.media.id, captionEn: g.captionEn?.trim() || null, captionAr: g.captionAr?.trim() || null })) }))
      toast('success', 'Gallery saved.')
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card title="Main photo" description="Shown large on the event's page and on its card.">
        <div className="flex flex-wrap items-center gap-4">
          {event.hero ? <img src={assetUrl(event.hero.url)} alt={event.hero.altEn ?? ''} className="h-32 w-32 rounded-lg object-cover" data-testid="event-hero-preview" /> : <p className="text-sm text-stone-500">No main photo. The website uses a neutral picture until you add one.</p>}
          {canWrite && (
            <div className="flex gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setPicker('hero')}>
                {event.hero ? 'Change photo' : 'Choose photo'}
              </Button>
              {event.hero && (
                <Button variant="ghost" disabled={busy} onClick={() => void setHero(null)}>
                  Remove
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="Gallery" description="Up to 30 photos, shown on the event's page in this order.">
        {gallery.length === 0 && <p className="text-sm text-stone-500">No gallery photos.</p>}
        <ul className="space-y-3">
          {gallery.map((g, i) => (
            <li key={g.media.id} className="grid items-center gap-3 rounded-lg border border-stone-200 p-3 sm:grid-cols-[5rem_1fr_1fr_auto]" data-testid="event-gallery-item">
              <img src={assetUrl(g.media.url)} alt="" className="h-16 w-20 rounded object-cover" />
              <TextInput label="Caption (English)" value={g.captionEn ?? ''} disabled={!canWrite} onChange={(e) => setGallery(gallery.map((x, j) => (j === i ? { ...x, captionEn: e.target.value } : x)))} />
              <TextInput label="Caption (Arabic)" rtl value={g.captionAr ?? ''} disabled={!canWrite} onChange={(e) => setGallery(gallery.map((x, j) => (j === i ? { ...x, captionAr: e.target.value } : x)))} />
              {canWrite && (
                <div className="flex gap-1">
                  <Button variant="ghost" disabled={i === 0} onClick={() => setGallery(move(gallery, i, -1))} aria-label="Move photo up">
                    ↑
                  </Button>
                  <Button variant="ghost" disabled={i === gallery.length - 1} onClick={() => setGallery(move(gallery, i, 1))} aria-label="Move photo down">
                    ↓
                  </Button>
                  <Button variant="ghost" className="text-red-700" onClick={() => setGallery(gallery.filter((_, j) => j !== i))} aria-label="Remove photo from gallery">
                    Remove
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {canWrite && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="secondary" disabled={gallery.length >= 30} onClick={() => setPicker('gallery')}>
              Add photo
            </Button>
            <Button onClick={() => void saveGallery()} busy={busy} disabled={!dirty}>
              Save gallery
            </Button>
            {dirty && <span className="text-xs text-amber-700">Unsaved changes</span>}
          </div>
        )}
      </Card>

      {picker && (
        <MediaPicker
          kind="image"
          title={picker === 'hero' ? 'Choose the main photo' : 'Add a gallery photo'}
          onClose={() => setPicker(null)}
          onPick={(m) => {
            setPicker(null)
            if (picker === 'hero') void setHero(m)
            else if (!gallery.some((g) => g.media.id === m.id)) setGallery([...gallery, { media: m, captionEn: null, captionAr: null }])
          }}
        />
      )}
    </div>
  )
}
