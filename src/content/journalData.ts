import { assetUrl } from '../lib/api'
import type { Lang, NewsItem, SiteContent } from './types'

/** One entry of GET /public/journal (or /public/journal/:slug). */
export interface PublicJournalArticle {
  slug: string
  titleEn: string
  titleAr: string
  tagEn: string
  tagAr: string
  shortDescriptionEn: string
  shortDescriptionAr: string
  bodyEn: string
  bodyAr: string
  dateLabelEn: string | null
  dateLabelAr: string | null
  isFeatured: boolean
  publishedAt: string | null
  cover: { url: string; width: number | null; height: number | null; altEn: string | null; altAr: string | null } | null
  gallery: Array<{ url: string; width: number | null; height: number | null; altEn: string | null; altAr: string | null; captionEn: string | null; captionAr: string | null }>
}

/** Shown when an article has no cover photo and the site has no built-in picture for its address. */
const PLACEHOLDER_IMAGE = 'park-from-above.webp'

/**
 * An API article in the shape the website's Journal cards and article page already use: the card shows the cover, the tag,
 * the title and the short description; "Read more" opens the article with its full text. A built-in picture for the same
 * address is kept when no cover was uploaded.
 */
export function toNewsItem(a: PublicJournalArticle, lang: Lang, builtIn?: NewsItem): NewsItem {
  const ar = lang === 'ar'
  const title = ar ? a.titleAr : a.titleEn
  const gallery = a.gallery.map((g) => ({ image: assetUrl(g.url), alt: (ar ? g.captionAr || g.altAr : g.captionEn || g.altEn) || title }))
  return {
    id: a.slug,
    slug: a.slug,
    title,
    excerpt: ar ? a.shortDescriptionAr : a.shortDescriptionEn,
    content: ar ? a.bodyAr : a.bodyEn,
    image: a.cover ? assetUrl(a.cover.url) : (builtIn?.image ?? PLACEHOLDER_IMAGE),
    category: ar ? a.tagAr : a.tagEn,
    date: (ar ? a.dateLabelAr : a.dateLabelEn) || '',
    featured: a.isFeatured || undefined,
    ...(gallery.length > 0 ? { gallery } : builtIn?.gallery ? { gallery: builtIn.gallery } : {}),
  }
}

/**
 * The backend is the source of truth for Journal articles. When the API answered, its published list IS the site's Journal
 * (an article switched to draft or archived disappears; an empty list shows an empty Journal). When the API is not
 * configured or not reachable (null), the built-in articles stay, so the page never breaks.
 */
export function applyJournal(content: SiteContent, articles: PublicJournalArticle[] | null, lang: Lang): SiteContent {
  if (!articles) return content
  const builtIn = new Map(content.newsSection.items.map((n) => [n.slug, n]))
  return {
    ...content,
    newsSection: { ...content.newsSection, items: articles.map((a) => toNewsItem(a, lang, builtIn.get(a.slug))) },
  }
}
