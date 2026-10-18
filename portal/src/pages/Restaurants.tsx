import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, Card, Checkbox, Modal, Notice, PageHeader, Spinner, TextArea, TextInput, useToast } from '../components/ui'
import { api, assetUrl, errorMessage, fieldErrors } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/hooks'
import { emptyRestaurantForm, formToRestaurant, hoursLabel, move, restaurantToForm, slugify, type MediaItem, type MenuItemView, type RestaurantData, type RestaurantForm } from '../lib/restaurants'
import { MediaPicker } from './Media'

// ───────────────────────────── list ─────────────────────────────

export function RestaurantsPage() {
  const { can } = useAuth()
  const toast = useToast()
  const { data, loading, error, setData } = useLoad<RestaurantData[]>('/restaurants')
  const [busy, setBusy] = useState(false)
  const canWrite = can('restaurants:write')

  async function reorder(index: number, delta: -1 | 1) {
    if (!data) return
    const next = move(data, index, delta)
    setBusy(true)
    try {
      setData(await api.put<RestaurantData[]>('/restaurants/order', { ids: next.map((r) => r.id) }))
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Restaurants" description="The restaurants shown on the website, in this order. Turn one off to hide it without deleting it." />
      {canWrite && (
        <div>
          <Link to="/restaurants/new" className="inline-flex rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
            Add a restaurant
          </Link>
        </div>
      )}
      {loading && !data && <Spinner />}
      {error && <Notice tone="error">{error}</Notice>}
      {data && data.length === 0 && <Notice tone="info">No restaurants yet. The website shows its built-in ones until you add one here.</Notice>}
      <ul className="space-y-3">
        {data?.map((r, i) => (
          <li key={r.id} data-testid="restaurant-row" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand-200 bg-white p-4 shadow-sm">
            <div className="flex min-w-0 items-center gap-4">
              {r.hero ? <img src={assetUrl(r.hero.url)} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" /> : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-xs text-stone-400">No photo</div>}
              <div className="min-w-0">
                <p className="truncate font-medium text-stone-900">
                  {r.nameEn} <span dir="rtl" className="text-stone-500">· {r.nameAr}</span>
                </p>
                <p className="text-xs text-stone-500">
                  {hoursLabel(r)} · {r.menus.length} menu{r.menus.length === 1 ? '' : 's'} · {r.gallery.length} photo{r.gallery.length === 1 ? '' : 's'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={r.isActive ? 'teal' : 'neutral'}>{r.isActive ? 'On the website' : 'Hidden'}</Badge>
              {canWrite && (
                <>
                  <Button variant="ghost" disabled={busy || i === 0} onClick={() => void reorder(i, -1)} aria-label={`Move ${r.nameEn} up`}>
                    ↑
                  </Button>
                  <Button variant="ghost" disabled={busy || i === data.length - 1} onClick={() => void reorder(i, 1)} aria-label={`Move ${r.nameEn} down`}>
                    ↓
                  </Button>
                </>
              )}
              <Link to={`/restaurants/${r.id}`} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-50" aria-label={`Open ${r.nameEn}`}>
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

type Tab = 'details' | 'photos' | 'menus'

export function RestaurantEditor() {
  const { id = '' } = useParams()
  const isNew = id === 'new'
  const { data, loading, error, setData } = useLoad<RestaurantData>(isNew ? null : `/restaurants/${id}`)
  const [tab, setTab] = useState<Tab>('details')

  if (!isNew && loading && !data) return <Spinner />
  if (!isNew && error && !data) return <Notice tone="error">{error}</Notice>

  return (
    <div className="space-y-6">
      <div>
        <Link to="/restaurants" className="text-sm text-teal-800 hover:underline">
          ← All restaurants
        </Link>
      </div>
      <PageHeader title={isNew ? 'New restaurant' : (data?.nameEn ?? 'Restaurant')} description={isNew ? 'Fill in the details, then add photos and menus.' : `Address: /restaurants/${data?.slug}`} />
      <div role="tablist" className="flex gap-1 border-b border-sand-200">
        {(['details', 'photos', 'menus'] as Tab[]).map((t) => (
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
      {tab === 'details' && <DetailsTab restaurant={data} isNew={isNew} onSaved={setData} />}
      {tab === 'photos' && data && <PhotosTab restaurant={data} onChanged={setData} />}
      {tab === 'menus' && data && <MenusTab restaurant={data} onChanged={setData} />}
    </div>
  )
}

function DetailsTab({ restaurant, isNew, onSaved }: { restaurant: RestaurantData | null; isNew: boolean; onSaved: (r: RestaurantData) => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState<RestaurantForm>(emptyRestaurantForm())
  const [slugTouched, setSlugTouched] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const canWrite = can('restaurants:write')

  useEffect(() => {
    if (restaurant) setForm(restaurantToForm(restaurant))
  }, [restaurant])

  const set = <K extends keyof RestaurantForm>(key: K, value: RestaurantForm[K]) => setForm({ ...form, [key]: value })

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const body = formToRestaurant(form, restaurant?.hero?.id ?? null)
      if (isNew) {
        const created = await api.post<RestaurantData>('/restaurants', body)
        toast('success', 'Restaurant created. Add its photos and menus next.')
        navigate(`/restaurants/${created.id}`, { replace: true })
      } else {
        onSaved(await api.put<RestaurantData>(`/restaurants/${restaurant!.id}`, body))
        toast('success', 'Saved.')
      }
    } catch (err) {
      const fe = fieldErrors(err)
      const phone = Object.entries(fe).find(([k]) => k.startsWith('phones'))?.[1]
      setErrors({ ...fe, ...(phone ? { phones: phone } : {}) })
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!restaurant || !window.confirm(`Remove “${restaurant.nameEn}” from the website and this list?`)) return
    try {
      await api.delete(`/restaurants/${restaurant.id}`)
      toast('success', 'Restaurant removed.')
      navigate('/restaurants', { replace: true })
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      {!canWrite && <Notice tone="info">You can view this restaurant but not change it.</Notice>}
      <Card title="Name and address">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          <TextInput label="Name (English)" value={form.nameEn} onChange={(e) => { const v = e.target.value; setForm({ ...form, nameEn: v, ...(isNew && !slugTouched ? { slug: slugify(v) } : {}) }) }} error={errors.nameEn} maxLength={100} />
          <TextInput label="Name (Arabic)" rtl value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} error={errors.nameAr} maxLength={100} />
          <TextInput label="Brand / operator (English)" value={form.brandEn} onChange={(e) => set('brandEn', e.target.value)} error={errors.brandEn} />
          <TextInput label="Brand / operator (Arabic)" rtl value={form.brandAr} onChange={(e) => set('brandAr', e.target.value)} error={errors.brandAr} />
          <div className="md:col-span-2">
            <TextInput label="Web address" value={form.slug} disabled={!isNew} onChange={(e) => { setSlugTouched(true); set('slug', e.target.value) }} error={errors.slug} hint={isNew ? 'Used in the website address, e.g. /restaurants/lake-side. It cannot be changed later.' : 'Cannot be changed.'} />
          </div>
        </fieldset>
      </Card>

      <Card title="Description">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          <TextInput label="Tagline (English)" value={form.taglineEn} onChange={(e) => set('taglineEn', e.target.value)} error={errors.taglineEn} maxLength={200} />
          <TextInput label="Tagline (Arabic)" rtl value={form.taglineAr} onChange={(e) => set('taglineAr', e.target.value)} error={errors.taglineAr} maxLength={200} />
          <TextArea label="Description (English)" value={form.descriptionEn} onChange={(e) => set('descriptionEn', e.target.value)} error={errors.descriptionEn} maxLength={4000} />
          <TextArea label="Description (Arabic)" rtl value={form.descriptionAr} onChange={(e) => set('descriptionAr', e.target.value)} error={errors.descriptionAr} maxLength={4000} />
          <TextArea label="Atmosphere (English)" value={form.atmosphereEn} onChange={(e) => set('atmosphereEn', e.target.value)} error={errors.atmosphereEn} maxLength={500} />
          <TextArea label="Atmosphere (Arabic)" rtl value={form.atmosphereAr} onChange={(e) => set('atmosphereAr', e.target.value)} error={errors.atmosphereAr} maxLength={500} />
          <TextInput label="Location in the park (English)" value={form.locationEn} onChange={(e) => set('locationEn', e.target.value)} error={errors.locationEn} />
          <TextInput label="Location in the park (Arabic)" rtl value={form.locationAr} onChange={(e) => set('locationAr', e.target.value)} error={errors.locationAr} />
        </fieldset>
      </Card>

      <Card title="Hours and contact" description="A closing time that is not later than the opening time means the restaurant closes after midnight (for example 12:00 – 00:00, or 18:00 – 01:00).">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          <TextInput label="Opens" type="time" value={form.opensAt} onChange={(e) => set('opensAt', e.target.value)} error={errors.opensAt} />
          <TextInput label="Closes" type="time" value={form.closesAt} onChange={(e) => set('closesAt', e.target.value)} error={errors.closesAt} />
          <TextArea label="Phone numbers" hint="One per line, up to 6." value={form.phones} onChange={(e) => set('phones', e.target.value)} error={errors.phones} />
          <div className="space-y-4">
            <TextInput label="Website" type="url" value={form.websiteUrl} onChange={(e) => set('websiteUrl', e.target.value)} error={errors.websiteUrl} placeholder="https://" />
            <TextInput label="Instagram" type="url" value={form.instagramUrl} onChange={(e) => set('instagramUrl', e.target.value)} error={errors.instagramUrl} placeholder="https://www.instagram.com/…" hint="The website's “Reserve a table” button opens this page. Without it, the button is not shown." />
          </div>
        </fieldset>
      </Card>

      <Card>
        <Checkbox label="Show this restaurant on the website" checked={form.isActive} disabled={!canWrite || busy} onChange={(v) => set('isActive', v)} />
      </Card>

      {canWrite && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" busy={busy}>
            {isNew ? 'Create restaurant' : 'Save changes'}
          </Button>
          {!isNew && (
            <Button type="button" variant="danger" onClick={() => void remove()}>
              Remove restaurant
            </Button>
          )}
        </div>
      )}
    </form>
  )
}

function PhotosTab({ restaurant, onChanged }: { restaurant: RestaurantData; onChanged: (r: RestaurantData) => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const canWrite = can('restaurants:write')
  const [picker, setPicker] = useState<'hero' | 'gallery' | null>(null)
  const [gallery, setGallery] = useState(restaurant.gallery)
  const [busy, setBusy] = useState(false)
  useEffect(() => setGallery(restaurant.gallery), [restaurant.gallery])
  const dirty = JSON.stringify(gallery.map((g) => [g.media.id, g.captionEn, g.captionAr])) !== JSON.stringify(restaurant.gallery.map((g) => [g.media.id, g.captionEn, g.captionAr]))

  async function setHero(media: MediaItem | null) {
    setBusy(true)
    try {
      onChanged(await api.put<RestaurantData>(`/restaurants/${restaurant.id}`, formToRestaurant(restaurantToForm(restaurant), media?.id ?? null)))
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
      onChanged(await api.put<RestaurantData>(`/restaurants/${restaurant.id}/gallery`, { items: gallery.map((g) => ({ mediaId: g.media.id, captionEn: g.captionEn?.trim() || null, captionAr: g.captionAr?.trim() || null })) }))
      toast('success', 'Gallery saved.')
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card title="Main photo" description="Shown large on the restaurants page and the restaurant's own page.">
        <div className="flex flex-wrap items-center gap-4">
          {restaurant.hero ? <img src={assetUrl(restaurant.hero.url)} alt={restaurant.hero.altEn ?? ''} className="h-32 w-32 rounded-lg object-cover" data-testid="hero-preview" /> : <p className="text-sm text-stone-500">No main photo. The website uses its built-in photo if it has one.</p>}
          {canWrite && (
            <div className="flex gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setPicker('hero')}>
                {restaurant.hero ? 'Change photo' : 'Choose photo'}
              </Button>
              {restaurant.hero && (
                <Button variant="ghost" disabled={busy} onClick={() => void setHero(null)}>
                  Remove
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="Gallery" description="Up to 20 photos, shown on the restaurant's page in this order.">
        {gallery.length === 0 && <p className="text-sm text-stone-500">No gallery photos.</p>}
        <ul className="space-y-3">
          {gallery.map((g, i) => (
            <li key={g.media.id} className="grid items-center gap-3 rounded-lg border border-sand-200 p-3 sm:grid-cols-[5rem_1fr_1fr_auto]" data-testid="gallery-item">
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
            <Button variant="secondary" disabled={gallery.length >= 20} onClick={() => setPicker('gallery')}>
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

function MenusTab({ restaurant, onChanged }: { restaurant: RestaurantData; onChanged: (r: RestaurantData) => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const canWrite = can('menus:write')
  const [editing, setEditing] = useState<MenuItemView | 'new' | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async () => onChanged(await api.get<RestaurantData>(`/restaurants/${restaurant.id}`))

  async function reorder(index: number, delta: -1 | 1) {
    setBusy(true)
    try {
      await api.put(`/restaurants/${restaurant.id}/menus/order`, { ids: move(restaurant.menus, index, delta).map((m) => m.id) })
      await refresh()
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(m: MenuItemView) {
    if (!window.confirm(`Delete the menu “${m.nameEn}”?`)) return
    try {
      await api.delete(`/menus/${m.id}`)
      toast('success', 'Menu deleted.')
      await refresh()
    } catch (e) {
      toast('error', errorMessage(e))
    }
  }

  return (
    <Card
      title="Menus"
      description="A menu is a link to a page or PDF elsewhere, or a PDF you upload here. Visitors see the active ones, in this order."
      actions={canWrite && <Button onClick={() => setEditing('new')}>Add a menu</Button>}
    >
      {restaurant.menus.length === 0 && <p className="text-sm text-stone-500">No menus. Visitors will see a “menu coming soon” message.</p>}
      <ul className="divide-y divide-sand-100">
        {restaurant.menus.map((m, i) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid="menu-row">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-stone-900">
                {m.nameEn} <span dir="rtl" className="text-stone-500">· {m.nameAr}</span>
              </p>
              <p className="truncate text-xs text-stone-500">{m.kind === 'pdf' ? `PDF: ${m.pdf?.fileName}` : m.externalUrl}</p>
            </div>
            <div className="flex items-center gap-1">
              <Badge tone={m.isActive ? 'teal' : 'neutral'}>{m.isActive ? 'Active' : 'Hidden'}</Badge>
              {canWrite && (
                <>
                  <Button variant="ghost" disabled={busy || i === 0} onClick={() => void reorder(i, -1)} aria-label={`Move ${m.nameEn} up`}>
                    ↑
                  </Button>
                  <Button variant="ghost" disabled={busy || i === restaurant.menus.length - 1} onClick={() => void reorder(i, 1)} aria-label={`Move ${m.nameEn} down`}>
                    ↓
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(m)} aria-label={`Edit ${m.nameEn}`}>
                    Edit
                  </Button>
                  <Button variant="ghost" className="text-red-700" onClick={() => void remove(m)} aria-label={`Delete ${m.nameEn}`}>
                    Delete
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {editing && (
        <MenuForm
          restaurantId={restaurant.id}
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await refresh()
          }}
        />
      )}
    </Card>
  )
}

function MenuForm({ restaurantId, initial, onClose, onSaved }: { restaurantId: string; initial: MenuItemView | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast()
  const [nameEn, setNameEn] = useState(initial?.nameEn ?? '')
  const [nameAr, setNameAr] = useState(initial?.nameAr ?? '')
  const [source, setSource] = useState<'link' | 'pdf'>(initial?.kind ?? 'link')
  const [url, setUrl] = useState(initial?.externalUrl ?? '')
  const [pdf, setPdf] = useState<MediaItem | null>(initial?.pdf ?? null)
  const [active, setActive] = useState(initial?.isActive ?? true)
  const [picking, setPicking] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    setErrors({})
    setFormError(null)
    try {
      const body = { nameEn: nameEn.trim(), nameAr: nameAr.trim(), externalUrl: source === 'link' ? url.trim() || null : null, pdfMediaId: source === 'pdf' ? (pdf?.id ?? null) : null, isActive: active }
      if (initial) await api.put(`/menus/${initial.id}`, body)
      else await api.post(`/restaurants/${restaurantId}/menus`, body)
      toast('success', 'Menu saved.')
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
    <Modal title={initial ? 'Edit menu' : 'Add a menu'} onClose={onClose}>
      <div className="space-y-4">
        {formError && <Notice tone="error">{formError}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Name (English)" value={nameEn} onChange={(e) => setNameEn(e.target.value)} error={errors.nameEn} placeholder="Dinner menu" />
          <TextInput label="Name (Arabic)" rtl value={nameAr} onChange={(e) => setNameAr(e.target.value)} error={errors.nameAr} />
        </div>
        <fieldset>
          <legend className="mb-1 text-xs font-semibold tracking-wide text-stone-500 uppercase">Where is the menu?</legend>
          <div className="flex gap-6 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="source" checked={source === 'link'} onChange={() => setSource('link')} /> A link
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="source" checked={source === 'pdf'} onChange={() => setSource('pdf')} /> A PDF I upload
            </label>
          </div>
        </fieldset>
        {source === 'link' ? (
          <TextInput label="Link to the menu" type="url" value={url} onChange={(e) => setUrl(e.target.value)} error={errors.externalUrl} placeholder="https://" />
        ) : (
          <div>
            <p className="text-sm text-stone-700">{pdf ? `Chosen: ${pdf.fileName}` : 'No PDF chosen.'}</p>
            <Button variant="secondary" className="mt-2" onClick={() => setPicking(true)}>
              {pdf ? 'Change PDF' : 'Choose or upload a PDF'}
            </Button>
            {errors.externalUrl && <p className="mt-1 text-xs font-medium text-red-700">{errors.externalUrl}</p>}
          </div>
        )}
        <Checkbox label="Show this menu on the website" checked={active} onChange={setActive} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} busy={busy}>
            Save menu
          </Button>
        </div>
      </div>
      {picking && (
        <MediaPicker
          kind="pdf"
          title="Choose a PDF"
          onClose={() => setPicking(false)}
          onPick={(m) => {
            setPdf(m)
            setPicking(false)
          }}
        />
      )}
    </Modal>
  )
}
