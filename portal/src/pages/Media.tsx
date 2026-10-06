import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button, Card, Modal, Notice, PageHeader, Select, Spinner, TextInput, useToast } from '../components/ui'
import { api, assetUrl, errorMessage, type PageMeta } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatBytes, uploadProblem, type MediaItem } from '../lib/restaurants'

type Kind = '' | 'image' | 'pdf'
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf'

/** The library: browse, upload, describe and delete photos and PDFs. Also used (embedded) by the picker. */
export function MediaLibrary({ pick, kind: fixedKind, onPick }: { pick?: boolean; kind?: 'image' | 'pdf'; onPick?: (m: MediaItem) => void }) {
  const { can } = useAuth()
  const toast = useToast()
  const [kind, setKind] = useState<Kind>(fixedKind ?? '')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<MediaItem[] | null>(null)
  const [meta, setMeta] = useState<PageMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState<MediaItem | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const canWrite = can('media:write')

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebounced(search)
      setPage(1)
    }, 300)
    return () => window.clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: pick ? '12' : '24' })
      if (kind) params.set('kind', kind)
      if (debounced.trim()) params.set('search', debounced.trim())
      const r = await api.getPage<MediaItem>(`/media?${params.toString()}`)
      setItems(r.items)
      setMeta(r.meta)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [kind, debounced, page, pick])

  useEffect(() => {
    void load()
  }, [load])

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    // the FileList is a live view of the input: copy what we need before the input is cleared below
    const chosen = Array.from(files)
    let last: MediaItem | null = null
    for (const file of chosen) {
      const hint = uploadProblem(file)
      if (hint) {
        toast('error', hint)
        continue
      }
      const form = new FormData()
      form.append('file', file)
      try {
        last = await api.upload<MediaItem>('/media', form)
        toast('success', `Uploaded “${file.name}”.`)
      } catch (e) {
        toast('error', `“${file.name}”: ${errorMessage(e)}`)
      }
    }
    setUploading(false)
    if (input.current) input.current.value = ''
    setPage(1)
    await load()
    if (pick && last && onPick && chosen.length === 1) onPick(last)
  }

  async function remove(m: MediaItem) {
    if (!window.confirm(`Delete “${m.fileName}”? This cannot be undone.`)) return
    try {
      await api.delete(`/media/${m.id}`)
      toast('success', 'Deleted.')
      await load()
    } catch (e) {
      toast('error', errorMessage(e)) // for example: still used by a restaurant
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[1fr_10rem_auto] md:items-end">
        <TextInput label="Search" placeholder="File name or description" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select label="Type" value={kind} disabled={!!fixedKind} onChange={(e) => { setKind(e.target.value as Kind); setPage(1) }}>
          <option value="">All</option>
          <option value="image">Photos</option>
          <option value="pdf">PDF files</option>
        </Select>
        {canWrite && (
          <div>
            <input ref={input} type="file" accept={fixedKind === 'pdf' ? 'application/pdf' : fixedKind === 'image' ? 'image/jpeg,image/png,image/webp' : ACCEPT} multiple={!pick} hidden data-testid="media-file-input" onChange={(e) => void upload(e.target.files)} />
            <Button onClick={() => input.current?.click()} busy={uploading}>
              Upload {fixedKind === 'pdf' ? 'a PDF' : fixedKind === 'image' ? 'a photo' : 'files'}
            </Button>
          </div>
        )}
      </div>
      {!items && !error && <Spinner />}
      {error && <Notice tone="error">{error}</Notice>}
      {items && items.length === 0 && <p className="py-6 text-sm text-stone-500">Nothing here yet.{canWrite ? ' Upload a file to get started.' : ''}</p>}
      {items && items.length > 0 && (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" data-testid="media-grid">
          {items.map((m) => (
            <li key={m.id} className="overflow-hidden rounded-lg border border-stone-200 bg-white" data-testid="media-item">
              <div className="flex aspect-[4/3] items-center justify-center bg-stone-100">
                {m.kind === 'image' ? <img src={assetUrl(m.url)} alt={m.altEn ?? ''} loading="lazy" className="h-full w-full object-cover" /> : <span className="text-3xl" aria-hidden="true">📄</span>}
              </div>
              <div className="space-y-2 p-3">
                <p className="truncate text-sm font-medium text-stone-900" title={m.fileName}>
                  {m.fileName}
                </p>
                <p className="text-xs text-stone-500">
                  {m.kind === 'image' && m.width ? `${m.width}×${m.height} · ` : ''}
                  {formatBytes(m.sizeBytes)}
                </p>
                {pick ? (
                  <Button className="w-full" onClick={() => onPick?.(m)}>
                    Choose
                  </Button>
                ) : (
                  <div className="flex gap-1">
                    {canWrite && (
                      <>
                        <Button variant="secondary" className="flex-1" onClick={() => setEditing(m)} aria-label={`Describe ${m.fileName}`}>
                          Details
                        </Button>
                        <Button variant="ghost" className="text-red-700" onClick={() => void remove(m)} aria-label={`Delete ${m.fileName}`}>
                          Delete
                        </Button>
                      </>
                    )}
                    {!canWrite && (
                      <a href={assetUrl(m.url)} target="_blank" rel="noopener noreferrer" className="text-sm text-teal-800 hover:underline">
                        Open
                      </a>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-stone-600">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Previous
          </Button>
          <span>
            Page {meta.page} of {meta.totalPages}
          </span>
          <Button variant="ghost" disabled={page >= meta.totalPages} onClick={() => setPage(page + 1)}>
            Next →
          </Button>
        </div>
      )}
      {editing && (
        <MediaDetails
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

function MediaDetails({ item, onClose, onSaved }: { item: MediaItem; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast()
  const [altEn, setAltEn] = useState(item.altEn ?? '')
  const [altAr, setAltAr] = useState(item.altAr ?? '')
  const [usage, setUsage] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.get<{ usage: string[] }>(`/media/${item.id}`).then((d) => setUsage(d.usage)).catch(() => setUsage([]))
  }, [item.id])

  async function save() {
    setBusy(true)
    try {
      await api.patch(`/media/${item.id}`, { altEn: altEn.trim() || null, altAr: altAr.trim() || null })
      toast('success', 'Saved.')
      await onSaved()
    } catch (e) {
      toast('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={item.fileName} onClose={onClose}>
      <div className="space-y-4">
        {item.kind === 'image' && <img src={assetUrl(item.url)} alt={item.altEn ?? ''} className="max-h-64 w-full rounded-lg object-contain" />}
        <div className="flex flex-wrap gap-2 text-xs text-stone-500">
          <Badge>{item.mimeType}</Badge>
          <Badge>{formatBytes(item.sizeBytes)}</Badge>
          {item.width && <Badge>{item.width}×{item.height}</Badge>}
        </div>
        <p className="text-sm text-stone-600">{usage === null ? 'Checking where it is used…' : usage.length === 0 ? 'Not used anywhere yet.' : `Used by: ${usage.join('; ')}.`}</p>
        <TextInput label="Description (English)" value={altEn} onChange={(e) => setAltEn(e.target.value)} hint="Read aloud to people who cannot see the photo." maxLength={300} />
        <TextInput label="Description (Arabic)" rtl value={altAr} onChange={(e) => setAltAr(e.target.value)} maxLength={300} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} busy={busy}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function MediaPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Media library" description="Photos (JPEG, PNG, WebP, up to 8 MB) and PDF files (up to 15 MB). A file that is in use cannot be deleted until it is removed where it is used." />
      <Card>
        <MediaLibrary />
      </Card>
    </div>
  )
}

/** A dialog to choose (or upload) one file for a restaurant photo or a menu PDF. */
export function MediaPicker({ kind, title, onPick, onClose }: { kind: 'image' | 'pdf'; title: string; onPick: (m: MediaItem) => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <MediaLibrary pick kind={kind} onPick={onPick} />
    </Modal>
  )
}
