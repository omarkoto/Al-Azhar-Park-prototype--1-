import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge, Button, Card, Checkbox, Notice, PageHeader, Select, Spinner, TextArea, TextInput, useToast } from '../components/ui'
import { api, assetUrl, errorMessage, fieldErrors, type PageMeta } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useLoad } from '../lib/hooks'
import {
  counter, emptyJournalForm, formToJournal, JOURNAL_LIMITS, JOURNAL_STATUS_HELP, JOURNAL_STATUS_LABEL, JOURNAL_STATUSES, journalStatusActions, journalToForm, paragraphCount, publishWarnings,
  type JournalData, type JournalForm, type JournalStatus,
} from '../lib/journal'
import { move, slugify, type MediaItem } from '../lib/restaurants'
import { MediaPicker } from './Media'

const statusTone = (s: JournalStatus) => (s === 'PUBLISHED' ? 'teal' : 'neutral') as 'teal' | 'neutral'

// ───────────────────────────── list ─────────────────────────────

export function JournalPage() {
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState<'' | JournalStatus>('')
  const [items, setItems] = useState<JournalData[] | null>(null)
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canWrite = can('journal:write')

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 300)
    return () => window.clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    try {
      const p = new URLSearchParams({ limit: '100' })
      if (debounced.trim()) p.set('search', debounced.trim())
      if (status) p.set('status', status)
      const r = await api.getPage<JournalData>(`/journal?${p.toString()}`)
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

  return (
    <div className="space-y-6">
      <PageHeader title="Journal" description="The stories on the website’s Journal. Only “Published” articles appear on the website; drafts and archived articles stay here. The newest published article comes first." />
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <TextInput label="Search" placeholder="Title, tag or address" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-48">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as '' | JournalStatus)}>
            <option value="">All statuses</option>
            {JOURNAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {JOURNAL_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </div>
        {canWrite && (
          <Link to="/journal/new" className="inline-flex rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
            Add an article
          </Link>
        )}
      </div>
      {!items && !error && <Spinner />}
      {error && <Notice tone="error">{error}</Notice>}
      {items && items.length === 0 && <Notice tone="info">{debounced || status ? 'No articles match these filters.' : 'No articles yet. Add the first one.'}</Notice>}
      {meta && meta.total > (items?.length ?? 0) && <p className="text-xs text-stone-500">Showing the first {items?.length} of {meta.total}. Narrow the search to find the others.</p>}
      <ul className="space-y-3">
        {items?.map((a) => (
          <li key={a.id} data-testid="journal-row" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sand-200 bg-white p-4 shadow-sm">
            <div className="flex min-w-0 items-center gap-4">
              {a.cover ? <img src={assetUrl(a.cover.url)} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" /> : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-xs text-stone-400">No photo</div>}
              <div className="min-w-0">
                <p className="truncate font-medium text-stone-900">
                  {a.titleEn} <span dir="rtl" className="text-stone-500">· {a.titleAr}</span>
                </p>
                <p className="truncate text-xs text-stone-500">
                  {a.tagEn}
                  {a.dateLabelEn ? ` · ${a.dateLabelEn}` : ''}
                  {a.isFeatured ? ' · Featured' : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={statusTone(a.status)}>{JOURNAL_STATUS_LABEL[a.status]}</Badge>
              <Link to={`/journal/${a.id}`} className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-50" aria-label={`Open ${a.titleEn}`}>
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

export function JournalEditor() {
  const { id = '' } = useParams()
  const isNew = id === 'new'
  const { data, loading, error, setData } = useLoad<JournalData>(isNew ? null : `/journal/${id}`)
  const [tab, setTab] = useState<Tab>('details')

  if (!isNew && loading && !data) return <Spinner />
  if (!isNew && error && !data) return <Notice tone="error">{error}</Notice>

  return (
    <div className="space-y-6">
      <Link to="/journal" className="text-sm text-teal-800 hover:underline">
        ← All articles
      </Link>
      <PageHeader title={isNew ? 'New article' : (data?.titleEn ?? 'Article')} description={isNew ? 'It starts as a draft. Publish it when it is ready.' : `Address: /news/${data?.slug}`} />
      {data && <StatusPanel article={data} onChanged={setData} />}
      <div role="tablist" className="flex gap-1 border-b border-sand-200">
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
      {tab === 'details' && <DetailsTab article={data} isNew={isNew} onSaved={setData} />}
      {tab === 'photos' && data && <PhotosTab article={data} onChanged={setData} />}
    </div>
  )
}

function StatusPanel({ article, onChanged }: { article: JournalData; onChanged: (a: JournalData) => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState<JournalStatus | null>(null)
  const canPublish = can('journal:publish')
  const warnings = article.status === 'PUBLISHED' ? [] : publishWarnings(article)

  async function change(to: JournalStatus, confirm?: string) {
    if (confirm && !window.confirm(confirm)) return
    setBusy(to)
    try {
      onChanged(await api.put<JournalData>(`/journal/${article.id}/status`, { status: to }))
      toast('success', `Article is now ${JOURNAL_STATUS_LABEL[to].toLowerCase()}.`)
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
            <Badge tone={statusTone(article.status)}>{JOURNAL_STATUS_LABEL[article.status]}</Badge>
            <span className="text-sm text-stone-600">{JOURNAL_STATUS_HELP[article.status]}</span>
          </p>
        </div>
        {canPublish ? (
          <div className="flex flex-wrap gap-2">
            {journalStatusActions(article.status).map((a) => (
              <Button key={a.to} variant={a.tone} busy={busy === a.to} disabled={busy !== null} onClick={() => void change(a.to, a.confirm)}>
                {a.label}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-stone-500">Changing the status needs the publish permission.</p>
        )}
      </div>
      {warnings.length > 0 && canPublish && (
        <div className="mt-4 space-y-2" data-testid="publish-warnings">
          {warnings.map((w) => (
            <Notice key={w} tone="warn">
              {w}
            </Notice>
          ))}
        </div>
      )}
    </Card>
  )
}

/** What a visitor sees on the Journal card, updated as the editor types. */
function CardPreview({ form, cover }: { form: JournalForm; cover: MediaItem | null }) {
  const one = (lang: 'en' | 'ar') => {
    const ar = lang === 'ar'
    const title = ar ? form.titleAr : form.titleEn
    const tag = ar ? form.tagAr : form.tagEn
    const short = ar ? form.shortDescriptionAr : form.shortDescriptionEn
    const date = ar ? form.dateLabelAr : form.dateLabelEn
    return (
      <div dir={ar ? 'rtl' : 'ltr'} className="overflow-hidden rounded-xl border border-sand-200 bg-white" data-testid={`card-preview-${lang}`}>
        {cover ? <img src={assetUrl(cover.url)} alt="" className="aspect-[4/3] w-full object-cover" /> : <div className="flex aspect-[4/3] w-full items-center justify-center bg-stone-100 text-xs text-stone-400">No cover photo</div>}
        <div className="p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold tracking-wide text-amber-700 uppercase">{tag.trim() || (ar ? 'الوسم' : 'Tag')}</p>
            {date.trim() && <p className="text-xs text-stone-500">{date}</p>}
          </div>
          <p className="mt-2 text-base font-medium text-stone-900">{title.trim() || (ar ? 'العنوان' : 'Title')}</p>
          <p className="mt-1 line-clamp-3 text-sm text-stone-600">{short.trim() || (ar ? 'الوصف المختصر يظهر هنا.' : 'The short description appears here.')}</p>
          <span className="mt-3 inline-block text-sm font-semibold text-teal-700">{ar ? 'اقرأ المزيد' : 'Read more'}</span>
        </div>
      </div>
    )
  }
  return (
    <Card title="How the card will look" description="The card on the website’s Journal. “Read more” opens the full article.">
      <div className="grid gap-4 md:grid-cols-2">
        {one('en')}
        {one('ar')}
      </div>
    </Card>
  )
}

function DetailsTab({ article, isNew, onSaved }: { article: JournalData | null; isNew: boolean; onSaved: (a: JournalData) => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState<JournalForm>(emptyJournalForm())
  const [slugTouched, setSlugTouched] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const canWrite = can('journal:write')
  const slugLocked = !isNew && !!article?.publishedAt

  useEffect(() => {
    if (article) setForm(journalToForm(article))
  }, [article])

  const set = <K extends keyof JournalForm>(key: K, value: JournalForm[K]) => setForm({ ...form, [key]: value })
  const L = JOURNAL_LIMITS

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const body = formToJournal(form, article?.cover?.id ?? null, isNew || !slugLocked)
      if (isNew) {
        const created = await api.post<JournalData>('/journal', body)
        toast('success', 'Article created as a draft. Add its cover photo, then publish it.')
        navigate(`/journal/${created.id}`, { replace: true })
      } else {
        onSaved(await api.put<JournalData>(`/journal/${article!.id}`, body))
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
      {!canWrite && <Notice tone="info">You can view this article but not change it.</Notice>}

      <CardPreview form={form} cover={article?.cover ?? null} />

      <Card title="Title and address">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          <TextInput label="Title (English)" value={form.titleEn} onChange={(e) => { const v = e.target.value; setForm({ ...form, titleEn: v, ...(isNew && !slugTouched ? { slug: slugify(v) } : {}) }) }} error={errors.titleEn} maxLength={L.title} />
          <TextInput label="Title (Arabic)" rtl value={form.titleAr} onChange={(e) => set('titleAr', e.target.value)} error={errors.titleAr} maxLength={L.title} />
          <div className="md:col-span-2">
            <TextInput
              label="Web address"
              value={form.slug}
              disabled={slugLocked}
              onChange={(e) => { setSlugTouched(true); set('slug', e.target.value) }}
              error={errors.slug}
              hint={slugLocked ? 'This article has been public, so its address can no longer change.' : 'Used in the website address, e.g. /news/a-royal-welcome. It locks once the article has been public.'}
            />
          </div>
        </fieldset>
      </Card>

      <Card title="Tag" description="One short label on the card, for example History or Dining.">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          <TextInput label="Tag (English)" value={form.tagEn} onChange={(e) => set('tagEn', e.target.value)} error={errors.tagEn} maxLength={L.tag} hint={`${counter(form.tagEn, L.tag).text}`} />
          <TextInput label="Tag (Arabic)" rtl value={form.tagAr} onChange={(e) => set('tagAr', e.target.value)} error={errors.tagAr} maxLength={L.tag} hint={`${counter(form.tagAr, L.tag).text}`} />
        </fieldset>
      </Card>

      <Card title="Short description" description="Shown on the card, under the title.">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          <TextArea label="Short description (English)" rows={3} value={form.shortDescriptionEn} onChange={(e) => set('shortDescriptionEn', e.target.value)} error={errors.shortDescriptionEn} maxLength={L.short} hint={counter(form.shortDescriptionEn, L.short).text} />
          <TextArea label="Short description (Arabic)" rtl rows={3} value={form.shortDescriptionAr} onChange={(e) => set('shortDescriptionAr', e.target.value)} error={errors.shortDescriptionAr} maxLength={L.short} hint={counter(form.shortDescriptionAr, L.short).text} />
        </fieldset>
      </Card>

      <Card title="Article" description="Shown when a visitor opens “Read more”. Plain text: leave a blank line between paragraphs.">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          <TextArea label="Article (English)" rows={12} value={form.bodyEn} onChange={(e) => set('bodyEn', e.target.value)} error={errors.bodyEn} maxLength={L.body} hint={`${paragraphCount(form.bodyEn)} paragraph(s) · ${counter(form.bodyEn, L.body).text}`} />
          <TextArea label="Article (Arabic)" rtl rows={12} value={form.bodyAr} onChange={(e) => set('bodyAr', e.target.value)} error={errors.bodyAr} maxLength={L.body} hint={`${paragraphCount(form.bodyAr)} paragraph(s) · ${counter(form.bodyAr, L.body).text}`} />
        </fieldset>
      </Card>

      <Card title="Date wording (optional)" description="Shown on the card and the article, for example “2006”, “1990s” or “Ongoing”. Leave empty to show no date.">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          <TextInput label="Date wording (English)" value={form.dateLabelEn} onChange={(e) => set('dateLabelEn', e.target.value)} error={errors.dateLabelEn} maxLength={L.dateLabel} />
          <TextInput label="Date wording (Arabic)" rtl value={form.dateLabelAr} onChange={(e) => set('dateLabelAr', e.target.value)} error={errors.dateLabelAr} maxLength={L.dateLabel} />
        </fieldset>
      </Card>

      <Card>
        <Checkbox label="Feature this article" checked={form.isFeatured} disabled={!canWrite || busy} onChange={(v) => set('isFeatured', v)} />
      </Card>

      {canWrite && (
        <Button type="submit" busy={busy}>
          {isNew ? 'Create article' : 'Save changes'}
        </Button>
      )}
    </form>
  )
}

function PhotosTab({ article, onChanged }: { article: JournalData; onChanged: (a: JournalData) => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const canWrite = can('journal:write') && can('media:read')
  const [picker, setPicker] = useState<'cover' | 'gallery' | null>(null)
  const [gallery, setGallery] = useState(article.gallery)
  const [busy, setBusy] = useState(false)
  useEffect(() => setGallery(article.gallery), [article.gallery])
  const dirty = JSON.stringify(gallery.map((g) => [g.media.id, g.captionEn, g.captionAr])) !== JSON.stringify(article.gallery.map((g) => [g.media.id, g.captionEn, g.captionAr]))

  async function setCover(media: MediaItem | null) {
    setBusy(true)
    try {
      onChanged(await api.put<JournalData>(`/journal/${article.id}`, formToJournal(journalToForm(article), media?.id ?? null, false)))
      toast('success', media ? 'Cover photo set.' : 'Cover photo removed.')
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveGallery() {
    setBusy(true)
    try {
      onChanged(await api.put<JournalData>(`/journal/${article.id}/gallery`, { items: gallery.map((g) => ({ mediaId: g.media.id, captionEn: g.captionEn?.trim() || null, captionAr: g.captionAr?.trim() || null })) }))
      toast('success', 'Gallery saved.')
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card title="Cover photo" description="Shown on the card and at the top of the article.">
        <div className="flex flex-wrap items-center gap-4">
          {article.cover ? <img src={assetUrl(article.cover.url)} alt={article.cover.altEn ?? ''} className="h-32 w-32 rounded-lg object-cover" data-testid="journal-cover-preview" /> : <p className="text-sm text-stone-500">No cover photo. The website uses a neutral picture until you add one.</p>}
          {canWrite && (
            <div className="flex gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setPicker('cover')}>
                {article.cover ? 'Change photo' : 'Choose photo'}
              </Button>
              {article.cover && (
                <Button variant="ghost" disabled={busy} onClick={() => void setCover(null)}>
                  Remove
                </Button>
              )}
            </div>
          )}
        </div>
      </Card>

      <Card title="Gallery" description="Optional extra photos, up to 30, shown on the article’s page in this order.">
        {gallery.length === 0 && <p className="text-sm text-stone-500">No gallery photos.</p>}
        <ul className="space-y-3">
          {gallery.map((g, i) => (
            <li key={g.media.id} className="grid items-center gap-3 rounded-lg border border-sand-200 p-3 sm:grid-cols-[5rem_1fr_1fr_auto]" data-testid="journal-gallery-item">
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
          title={picker === 'cover' ? 'Choose the cover photo' : 'Add a gallery photo'}
          onClose={() => setPicker(null)}
          onPick={(m) => {
            setPicker(null)
            if (picker === 'cover') void setCover(m)
            else if (!gallery.some((g) => g.media.id === m.id)) setGallery([...gallery, { media: m, captionEn: null, captionAr: null }])
          }}
        />
      )}
    </div>
  )
}
