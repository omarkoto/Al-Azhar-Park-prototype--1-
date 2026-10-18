import { Link } from 'react-router-dom'
import { useLanguage } from '../lib/language'
import { useSeo } from '../lib/seo'
import { useAlt } from '../lib/alt'
import { resolveImage } from '../lib/imageMap'
import { Container } from '../components/ui/Container'
import { Reveal } from '../components/ui/Reveal'
import { PageHero } from '../components/PageHero'
import type { NewsItem } from '../content/types'
import journalHero from '../assets/images/royal-visit-welcome.webp'

export function News() {
  const { content } = useLanguage()
  const altText = useAlt()
  const { newsSection } = content
  useSeo({ title: newsSection.title, description: newsSection.body, path: '/news' })

  return (
    <div>
      <PageHero
        eyebrow={newsSection.eyebrow}
        title={newsSection.title}
        lead={newsSection.body}
        image={journalHero}
        imageAlt={altText('newsHero')}
      />

      <section className="py-16 md:py-24">
        <Container>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {newsSection.items.map((item, i) => (
              <Reveal key={item.slug} delay={(i % 6) * 0.06}>
                <NewsIndexCard item={item} cta={newsSection.cta} />
              </Reveal>
            ))}
          </div>
        </Container>
      </section>
    </div>
  )
}

function NewsIndexCard({ item, cta }: { item: NewsItem; cta: string }) {
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
      <div className="p-6">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">{item.category}</p>
          {item.date ? (
            <p className="text-xs text-ink-900/45" dir="ltr">
              {item.date}
            </p>
          ) : null}
        </div>
        <h3 className="font-display mt-2 text-lg font-medium text-ink-900">{item.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-900/65">{item.excerpt}</p>
        <span className="mt-4 inline-block text-sm font-semibold text-teal-700">{cta}</span>
      </div>
    </Link>
  )
}
