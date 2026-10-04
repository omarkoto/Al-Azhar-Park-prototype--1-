import { useParams, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../lib/language'
import { useSeo } from '../lib/seo'
import { resolveImage } from '../lib/imageMap'
import { Container } from '../components/ui/Container'
import { Reveal } from '../components/ui/Reveal'
import { Eyebrow } from '../components/ui/SectionHeading'
import { ButtonLink } from '../components/ui/Button'
import { RosetteIcon } from '../components/ui/RosetteIcon'
import { PageHero } from '../components/PageHero'
import { AddToCalendar } from '../components/AddToCalendar'
import type { ComingSoonEvent } from '../content/types'

export function EventDetail() {
  const { slug } = useParams()
  const { content } = useLanguage()
  const { t } = useTranslation()
  const { comingSoon } = content
  const event = comingSoon.events.find((e) => e.slug === slug)

  useSeo({
    title: event?.title ?? comingSoon.title,
    description: event?.description ?? comingSoon.body,
    path: `/events/${slug ?? ''}`,
  })

  if (!event) return <Navigate to="/" replace />

  const related = comingSoon.events.filter((e) => e.slug !== event.slug).slice(0, 2)

  return (
    <div>
      <PageHero eyebrow={comingSoon.badge} title={event.title} lead={event.description} image={resolveImage(event.image)} imageAlt="">
        <Link to="/" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-sand-100/80 hover:text-sand-50">
          ← {t('backToHome')}
        </Link>
      </PageHero>

      <section className="py-16 md:py-24">
        <Container className="grid gap-12 md:grid-cols-[1.3fr_1fr]">
          <Reveal>
            <p className="text-base leading-relaxed text-ink-900/80 md:text-lg">{event.body}</p>
          </Reveal>

          <Reveal delay={0.1} className="h-fit rounded-2xl border border-ink-900/10 bg-sand-100 p-6">
            <span className="inline-flex items-center gap-3">
              <RosetteIcon className="h-5 w-5 shrink-0 text-gold-600" />
              <Eyebrow>{comingSoon.badge}</Eyebrow>
            </span>
            <dl className="mt-5 space-y-4">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/45">{comingSoon.dateLabel}</dt>
                <dd className="mt-1 text-sm font-medium text-ink-900">{event.date}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/45">{t('timeLabel')}</dt>
                <dd className="mt-1 text-sm font-medium text-ink-900">{event.time}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/45">{comingSoon.locationLabel}</dt>
                <dd className="mt-1 text-sm font-medium text-ink-900">{event.location}</dd>
              </div>
            </dl>
            <AddToCalendar
              className="mt-6"
              filename={event.slug}
              entry={{
                title: event.title,
                description: event.description,
                location: `${event.location}, Al-Azhar Park, Salah Salem Street, Cairo`,
                start: event.startsAt,
                end: event.endsAt,
              }}
            />
            <ButtonLink to="/tickets" variant="gold" className="mt-6 w-full justify-center">
              {content.hero.ctaPrimary}
            </ButtonLink>
          </Reveal>
        </Container>
      </section>

      {related.length ? (
        <section className="border-t border-ink-900/10 bg-sand-100 py-16 md:py-20">
          <Container>
            <Eyebrow>{t('relatedEvents')}</Eyebrow>
            <div className="mt-8 grid gap-8 sm:grid-cols-2">
              {related.map((e, i) => (
                <Reveal key={e.slug} delay={i * 0.08}>
                  <RelatedEventCard event={e} badge={comingSoon.badge} />
                </Reveal>
              ))}
            </div>
          </Container>
        </section>
      ) : null}
    </div>
  )
}

function RelatedEventCard({ event, badge }: { event: ComingSoonEvent; badge: string }) {
  return (
    <Link to={`/events/${event.slug}`} className="group block overflow-hidden rounded-2xl border border-ink-900/10 bg-sand-50">
      <div className="aspect-[16/10] overflow-hidden">
        <img
          src={resolveImage(event.image)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      </div>
      <div className="p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">{badge}</p>
        <h3 className="font-display mt-2 text-lg font-medium text-ink-900">{event.title}</h3>
        <p className="mt-1 text-sm text-ink-900/60">{event.description}</p>
      </div>
    </Link>
  )
}
