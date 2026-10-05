export interface MediaItem {
  id: string
  url: string
  kind: 'image' | 'pdf'
  fileName: string
  mimeType: string
  sizeBytes: number
  width: number | null
  height: number | null
  altEn: string | null
  altAr: string | null
  createdAt: string
}

export interface MenuItemView {
  id: string
  nameEn: string
  nameAr: string
  kind: 'link' | 'pdf'
  externalUrl: string | null
  pdf: MediaItem | null
  url: string
  isActive: boolean
}

export interface RestaurantData {
  id: string
  slug: string
  nameEn: string
  nameAr: string
  brandEn: string | null
  brandAr: string | null
  taglineEn: string | null
  taglineAr: string | null
  shortDescriptionEn: string | null
  shortDescriptionAr: string | null
  descriptionEn: string
  descriptionAr: string
  atmosphereEn: string | null
  atmosphereAr: string | null
  locationEn: string | null
  locationAr: string | null
  opensAt: string | null
  closesAt: string | null
  closesAfterMidnight: boolean
  phones: string[]
  reservationUrl: string | null
  websiteUrl: string | null
  instagramUrl: string | null
  hero: MediaItem | null
  gallery: Array<{ media: MediaItem; captionEn: string | null; captionAr: string | null }>
  menus: MenuItemView[]
  isActive: boolean
  sortOrder: number
  updatedAt: string
}

export interface RestaurantForm {
  slug: string
  nameEn: string
  nameAr: string
  brandEn: string
  brandAr: string
  taglineEn: string
  taglineAr: string
  descriptionEn: string
  descriptionAr: string
  atmosphereEn: string
  atmosphereAr: string
  locationEn: string
  locationAr: string
  opensAt: string
  closesAt: string
  phones: string
  reservationUrl: string
  websiteUrl: string
  instagramUrl: string
  isActive: boolean
}

export const emptyRestaurantForm = (): RestaurantForm => ({
  slug: '', nameEn: '', nameAr: '', brandEn: '', brandAr: '', taglineEn: '', taglineAr: '', descriptionEn: '', descriptionAr: '',
  atmosphereEn: '', atmosphereAr: '', locationEn: '', locationAr: '', opensAt: '12:00', closesAt: '23:00', phones: '',
  reservationUrl: '', websiteUrl: '', instagramUrl: '', isActive: true,
})

export function restaurantToForm(r: RestaurantData): RestaurantForm {
  return {
    slug: r.slug, nameEn: r.nameEn, nameAr: r.nameAr, brandEn: r.brandEn ?? '', brandAr: r.brandAr ?? '', taglineEn: r.taglineEn ?? '', taglineAr: r.taglineAr ?? '',
    descriptionEn: r.descriptionEn, descriptionAr: r.descriptionAr, atmosphereEn: r.atmosphereEn ?? '', atmosphereAr: r.atmosphereAr ?? '',
    locationEn: r.locationEn ?? '', locationAr: r.locationAr ?? '', opensAt: r.opensAt ?? '', closesAt: r.closesAt ?? '', phones: r.phones.join('\n'),
    reservationUrl: r.reservationUrl ?? '', websiteUrl: r.websiteUrl ?? '', instagramUrl: r.instagramUrl ?? '', isActive: r.isActive,
  }
}

const blank = (v: string) => v.trim() || null

/** The body for POST/PUT /restaurants. The main photo is kept as it is (it is changed in the Photos tab). */
export function formToRestaurant(f: RestaurantForm, heroMediaId: string | null) {
  return {
    slug: f.slug.trim(),
    nameEn: f.nameEn.trim(), nameAr: f.nameAr.trim(), brandEn: blank(f.brandEn), brandAr: blank(f.brandAr),
    taglineEn: blank(f.taglineEn), taglineAr: blank(f.taglineAr), descriptionEn: f.descriptionEn.trim(), descriptionAr: f.descriptionAr.trim(),
    atmosphereEn: blank(f.atmosphereEn), atmosphereAr: blank(f.atmosphereAr), locationEn: blank(f.locationEn), locationAr: blank(f.locationAr),
    opensAt: blank(f.opensAt), closesAt: blank(f.closesAt),
    phones: f.phones.split('\n').map((p) => p.trim()).filter(Boolean),
    reservationUrl: blank(f.reservationUrl), websiteUrl: blank(f.websiteUrl), instagramUrl: blank(f.instagramUrl),
    heroMediaId, isActive: f.isActive,
  }
}

/** "Lake Side Restaurant" → "lake-side-restaurant" (the editor can still change it before saving). */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** Moves one item up (-1) or down (+1) in a list; out-of-range moves change nothing. */
export function move<T>(items: readonly T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return [...items]
  const next = [...items]
  ;[next[index], next[to]] = [next[to], next[index]]
  return next
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Hours as shown in the list: "12:00 – 00:00 (after midnight)". */
export function hoursLabel(r: Pick<RestaurantData, 'opensAt' | 'closesAt' | 'closesAfterMidnight'>): string {
  if (!r.opensAt || !r.closesAt) return 'Hours not set'
  return `${r.opensAt} – ${r.closesAt}${r.closesAfterMidnight ? ' (after midnight)' : ''}`
}

/** Client-side hint only (the server checks the real bytes): is this a file we will even try to upload? */
export function uploadProblem(file: { name: string; size: number; type: string }, limits = { image: 8 * 1048576, pdf: 15 * 1048576 }): string | null {
  const isPdf = file.type === 'application/pdf'
  const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
  if (!isPdf && !isImage) return `“${file.name}” is not a JPEG, PNG, WebP or PDF file.`
  const limit = isPdf ? limits.pdf : limits.image
  if (file.size > limit) return `“${file.name}” is too large (${formatBytes(file.size)}; the limit is ${formatBytes(limit)}).`
  if (file.size === 0) return `“${file.name}” is empty.`
  return null
}
