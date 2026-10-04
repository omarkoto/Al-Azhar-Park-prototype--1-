import { useParams, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../lib/language'
import { useSeo } from '../lib/seo'
import { resolveImage } from '../lib/imageMap'
import { Container } from '../components/ui/Container'
import { Reveal } from '../components/ui/Reveal'
import { Eyebrow } from '../components/ui/SectionHeading'
import { Prose } from '../components/ui/Prose'
import { PageHero } from '../components/PageHero'
import type { NewsItem } from '../content/types'

export function NewsDetail() {
  const { slug } = useParams()
  const { content } = useLanguage()
  const { t } = useTranslation()
  const { newsSection } = content
  const item = newsSection.items.find((n) => n.slug === slug)

  useSeo({
    title: item?.title ?? newsSection.title,
    description: item?.excerpt ?? newsSection.body,
    path: `/news/${slug ?? ''}`,
  })

  if (!item) return <Navigate to="/news" replace />

  const related = newsSection.items.filter((n) => n.slug !== item.slug).slice(0, 3)

  return (
    <div>
      <PageHero eyebrow={item.category} title={item.title} lead={item.excerpt} image={resolveImage(item.image)} imageAlt="">
        <Link to="/news" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-sand-100/80 hover:text-sand-50">
          ← {t('backToNews')}
        </Link>
      </PageHero>

      <section className="py-16 md:py-24">
        <Container className="max-w-3xl">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-900/45" dir="ltr">
              {item.date}
            </p>
            <Prose text={item.content} className="mt-4 space-y-4 text-base leading-relaxed text-ink-900/80 md:text-lg" />
          </Reveal>
        </Container>
      </section>

      {item.gallery?.length ? (
        <section className="border-t border-ink-900/10 bg-sand-100 py-16 md:py-20">
          <Container>
            <Eyebrow>{t('gallery')}</Eyebrow>
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              {item.gallery.map((photo, i) => (
                <Reveal key={photo.image} delay={i * 0.08} className="relative overflow-hidden rounded-2xl ring-1 ring-ink-900/10">
                  <img
                    src={resolveImage(photo.image)}
                    alt={photo.alt}
                    loading="lazy"
                    className="aspect-[4/3] w-full object-cover"
                  />
                </Reveal>
              ))}
            </div>
          </Container>
        </section>
      ) : null}

      {related.length ? (
        <section className="border-t border-ink-900/10 bg-sand-100 py-16 md:py-20">
          <Container>
            <Eyebrow>{t('relatedNews')}</Eyebrow>
            <div className="mt-8 grid gap-8 sm:grid-cols-3">
              {related.map((n, i) => (
                <Reveal key={n.slug} delay={i * 0.08}>
                  <RelatedNewsCard item={n} cta={newsSection.cta} />
                </Reveal>
              ))}
            </div>
          </Container>
        </section>
      ) : null}
    </div>
  )
}

function RelatedNewsCard({ item, cta }: { item: NewsItem; cta: string }) {
  return (
    <Link to={`/news/${item.slug}`} className="group block overflow-hidden rounded-2xl border border-ink-900/10 bg-sand-50">
      <div className="aspect-[4/3] overflow-hidden">
        <img
          src={resolveImage(item.image)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      </div>
      <div className="p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">{item.category}</p>
        <h3 className="font-display mt-2 text-base font-medium text-ink-900">{item.title}</h3>
        <span className="mt-2 inline-block text-xs font-semibold text-teal-700">{cta}</span>
      </div>
    </Link>
  )
}
