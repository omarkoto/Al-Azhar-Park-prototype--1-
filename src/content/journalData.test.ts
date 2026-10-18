import { describe, expect, it } from 'vitest'
import { en } from './en'
import { ar } from './ar'
import { applyJournal, toNewsItem, type PublicJournalArticle } from './journalData'

const api = (over: Partial<PublicJournalArticle> = {}): PublicJournalArticle => ({
  slug: 'new-story', titleEn: 'A new story', titleAr: 'قصة جديدة', tagEn: 'News', tagAr: 'أخبار', shortDescriptionEn: 'The card text.', shortDescriptionAr: 'نص البطاقة.',
  bodyEn: 'First paragraph.\n\nSecond paragraph.', bodyAr: 'الفقرة الأولى.\n\nالفقرة الثانية.', dateLabelEn: null, dateLabelAr: null, isFeatured: false, publishedAt: '2026-10-10T10:00:00.000Z',
  cover: null, gallery: [], ...over,
})

const photo = (name: string) => ({ url: `/api/v1/media/file/${name}.png`, width: 800, height: 600, altEn: `${name} alt`, altAr: `${name} بديل` })

describe('a Journal article from the portal as a website card and page', () => {
  it('uses the tag, title, short description and the full text, in either language', () => {
    expect(toNewsItem(api(), 'en')).toMatchObject({ id: 'new-story', slug: 'new-story', title: 'A new story', category: 'News', excerpt: 'The card text.', content: 'First paragraph.\n\nSecond paragraph.' })
    expect(toNewsItem(api(), 'ar')).toMatchObject({ title: 'قصة جديدة', category: 'أخبار', excerpt: 'نص البطاقة.', content: 'الفقرة الأولى.\n\nالفقرة الثانية.' })
  })

  it('shows the cover photo uploaded in the portal, ahead of any built-in picture', () => {
    const item = toNewsItem(api({ cover: photo('cover') }), 'en', en.newsSection.items[0])
    expect(item.image).toMatch(/\/api\/v1\/media\/file\/cover\.png$/)
  })

  it('keeps the built-in picture and gallery for the same address when no cover was uploaded, and a neutral picture otherwise', () => {
    const builtIn = en.newsSection.items[0]
    const same = toNewsItem(api({ slug: builtIn.slug }), 'en', builtIn)
    expect(same.image).toBe(builtIn.image)
    expect(same.gallery).toEqual(builtIn.gallery)
    const unknown = toNewsItem(api(), 'en')
    expect(unknown.image).toBe('park-from-above.webp')
    expect(unknown.gallery).toBeUndefined()
  })

  it('turns the gallery into photos with a caption or description as their text, falling back to the title', () => {
    const item = toNewsItem(api({ gallery: [{ ...photo('a'), captionEn: 'Caption A', captionAr: 'تعليق' }, { ...photo('b'), captionEn: null, captionAr: null }, { ...photo('c'), altEn: null, altAr: null, captionEn: null, captionAr: null }] }), 'en')
    expect(item.gallery?.map((g) => g.alt)).toEqual(['Caption A', 'b alt', 'A new story'])
    expect(item.gallery?.[0].image).toMatch(/\/media\/file\/a\.png$/)
    expect(toNewsItem(api({ gallery: [{ ...photo('a'), captionEn: 'Caption A', captionAr: 'تعليق' }] }), 'ar').gallery?.[0].alt).toBe('تعليق')
  })

  it('shows the date wording only when the editor typed one, and flags a featured article', () => {
    expect(toNewsItem(api(), 'en').date).toBe('')
    expect(toNewsItem(api({ dateLabelEn: '2006', dateLabelAr: '٢٠٠٦' }), 'en').date).toBe('2006')
    expect(toNewsItem(api({ dateLabelEn: '2006', dateLabelAr: '٢٠٠٦' }), 'ar').date).toBe('٢٠٠٦')
    expect(toNewsItem(api({ isFeatured: true }), 'en').featured).toBe(true)
    expect(toNewsItem(api(), 'en').featured).toBeUndefined()
  })

  it('passes markup through as plain text (the page renders text, never HTML)', () => {
    const item = toNewsItem(api({ bodyEn: '<script>alert(1)</script> & <b>x</b>', titleEn: '<img src=x onerror=alert(1)>' }), 'en')
    expect(item.content).toBe('<script>alert(1)</script> & <b>x</b>')
    expect(item.title).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('which articles the website shows', () => {
  it('shows the articles the API returned, in its order, instead of the built-in ones', () => {
    const out = applyJournal(en, [api({ slug: 'second' }), api({ slug: 'first' })], 'en')
    expect(out.newsSection.items.map((n) => n.slug)).toEqual(['second', 'first'])
    expect(out.newsSection.eyebrow).toBe(en.newsSection.eyebrow) // headings and the rest of the page are untouched
    expect(out.comingSoon).toBe(en.comingSoon)
  })

  it('keeps the built-in articles when the API is not configured or not reachable (null), so the page never breaks', () => {
    expect(applyJournal(en, null, 'en')).toBe(en)
    expect(applyJournal(ar, null, 'ar')).toBe(ar)
  })

  it('shows an empty Journal when the API answered with no published articles (the backend is the source of truth)', () => {
    expect(applyJournal(en, [], 'en').newsSection.items).toEqual([])
  })

  it('keeps an article\'s built-in picture only for the matching address', () => {
    const builtIn = en.newsSection.items[1]
    const out = applyJournal(en, [api({ slug: builtIn.slug }), api({ slug: 'brand-new' })], 'en')
    expect(out.newsSection.items[0].image).toBe(builtIn.image)
    expect(out.newsSection.items[1].image).toBe('park-from-above.webp')
  })

  it('works in Arabic with the same articles', () => {
    const out = applyJournal(ar, [api()], 'ar')
    expect(out.newsSection.items[0]).toMatchObject({ title: 'قصة جديدة', category: 'أخبار' })
    expect(out.newsSection.cta).toBe(ar.newsSection.cta)
  })
})
