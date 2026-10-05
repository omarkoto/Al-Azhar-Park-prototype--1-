import { assetUrl } from '../lib/api'
import type { Lang, Restaurant, SiteContent } from './types'

/** One entry of GET /public/restaurants. */
export interface PublicRestaurant {
  slug: string
  nameEn: string
  nameAr: string
  brandEn: string | null
  brandAr: string | null
  taglineEn: string | null
  taglineAr: string | null
  descriptionEn: string
  descriptionAr: string
  atmosphereEn: string | null
  atmosphereAr: string | null
  opensAt: string | null
  closesAt: string | null
  closesAfterMidnight: boolean
  phones: string[]
  hero: { url: string; altEn: string | null; altAr: string | null } | null
  gallery: Array<{ url: string; captionEn: string | null; captionAr: string | null }>
  menus: Array<{ nameEn: string; nameAr: string; kind: 'link' | 'pdf'; url: string }>
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const localDigits = (s: string, lang: Lang) => (lang === 'ar' ? s.replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]) : s)

/** "12:00 – 00:00" (24-hour, the way the site already writes restaurant hours), with Arabic digits in Arabic. */
export function restaurantHours(opens: string | null, closes: string | null, lang: Lang): string | null {
  return opens && closes ? localDigits(`${opens} – ${closes}`, lang) : null
}

/** Used when a restaurant created in the portal has no main photo yet. */
const PLACEHOLDER_IMAGE = '/src/assets/images/restaurants-hero.webp'

function one(api: PublicRestaurant, base: Restaurant | undefined, lang: Lang): Restaurant {
  const ar = lang === 'ar'
  const pick = (en: string | null, arabic: string | null, fallback: string) => (ar ? arabic : en) || fallback
  const menus = api.menus.map((m) => ({ label: ar ? m.nameAr : m.nameEn, url: assetUrl(m.url) }))
  return {
    slug: api.slug,
    name: ar ? api.nameAr : api.nameEn,
    brand: pick(api.brandEn, api.brandAr, '') || undefined,
    phones: api.phones.length > 0 ? api.phones : (base?.phones ?? []),
    menuUrl: menus[0]?.url ?? base?.menuUrl,
    menus: menus.length > 1 ? menus : undefined,
    hours: restaurantHours(api.opensAt, api.closesAt, lang) ?? base?.hours ?? '',
    tagline: pick(api.taglineEn, api.taglineAr, base?.tagline ?? ''),
    body: ar ? api.descriptionAr : api.descriptionEn,
    atmosphere: pick(api.atmosphereEn, api.atmosphereAr, base?.atmosphere ?? ''),
    image: api.hero ? assetUrl(api.hero.url) : (base?.image ?? PLACEHOLDER_IMAGE),
    gallery: api.gallery.length > 0 ? api.gallery.map((g) => assetUrl(g.url)) : (base?.gallery ?? []),
  }
}

/**
 * The restaurant list comes from the portal when the API answered with at least one restaurant: that list, in its
 * order, replaces the built-in one (a restaurant switched off or deleted in the portal disappears). Texts the portal
 * left empty and photos it does not have keep the built-in versions. An empty answer or no answer keeps the
 * built-in list, so the page can never go blank.
 */
export function applyRestaurants(content: SiteContent, list: PublicRestaurant[] | null, lang: Lang): SiteContent {
  if (!list || list.length === 0) return content
  const builtIn = new Map(content.restaurants.list.map((r) => [r.slug, r]))
  return { ...content, restaurants: { ...content.restaurants, list: list.map((r) => one(r, builtIn.get(r.slug), lang)) } }
}
