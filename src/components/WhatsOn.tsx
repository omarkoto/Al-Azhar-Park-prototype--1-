import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toSiteEvent } from '../content/eventData'
import type { ComingSoonEvent } from '../content/types'
import { resolveImage } from '../lib/imageMap'
import { useLanguage } from '../lib/language'
import { useSiteData } from '../lib/siteData'
import { ButtonLink } from './ui/Button'
import { Container } from './ui/Container'
import { Eyebrow } from './ui/SectionHeading'
import { LatticePattern } from './ui/LatticePattern'
import { Reveal } from './ui/Reveal'
import { RosetteIcon } from './ui/RosetteIcon'

/**
 * "What's on" at the top of the Events page: the published events, then the coming-soon ones, straight from the
 * portal. With no events it shows a polished empty state; if the API is not reachable it falls back to the
 * built-in coming-soon list, so the page never breaks.
 */
export function WhatsOn() {
  const { content, lang } = useLanguage()
  const { t } = useTranslation()
  const { publishedEvents, comingSoonEvents, eventsSettled } = useSiteData()

  if (!eventsSettled) return null
  const live = publishedEvents !== null && comingSoonEvents !== null
  const published = (publishedEvents ?? []).map((e) => toSiteEvent(e, lang, t('eventBadge')))
  const soon = content.comingSoon.events
  const nothing = published.length === 0 && soon.length === 0

  if (nothing && !live) return null

  return (
    <section className="relative overflow-hidden border-b border-ink-900/10 py-16 md:py-24" data-testid="whats-on">
      <LatticePattern id="whats-on-lattice" className="text-teal-900/[0.035]" />
      <Container className="relative">
        <Reveal className="max-w-2xl">
          <Eyebrow>{t('whatsOnEyebrow')}</Eyebrow>
          <h2 className="font-display mt-4 text-3xl leading-tight font-medium text-ink-900 md:text-5xl">{t('whatsOnTitle')}</h2>
        </Reveal>

        {nothing ? (
          <Reveal delay={0.08} className="mx-auto mt-12 max-w-xl rounded-3xl border border-gold-500/40 bg-sand-100 px-8 py-14 text-center" >
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-gold-500/50 bg-sand-50">
              <RosetteIcon className="h-7 w-7 text-gold-600" />
            </span>
            <h3 className="font-display mt-6 text-2xl font-medium text-ink-900" data-testid="events-empty">
              {t('eventsEmptyTitle')}
            </h3>
            <p className="mt-3 text-base leading-relaxed text-ink-900/65">{t('eventsEmptyBody')}</p>
            <ButtonLink to="/plan" className="mt-8">
              {t('eventsEmptyCta')}
            </ButtonLink>
          </Reveal>
        ) : (
          <>
            {published.length > 0 ? <Group title={t('whatsOnUpcoming')} events={published} testId="events-published" /> : null}
            {soon.length > 0 ? <Group title={t('whatsOnSoon')} events={soon} testId="events-coming-soon" /> : null}
          </>
        )}
      </Container>
    </section>
  )
}

function Group({ title, events, testId }: { title: string; events: ComingSoonEvent[]; testId: string }) {
  return (
    <div className="mt-12" data-testid={testId}>
      <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-700">{title}</h3>
      <div className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((e, i) => (
          <Reveal key={e.slug} delay={Math.min(i, 5) * 0.06}>
            <EventCard event={e} />
          </Reveal>
        ))}
      </div>
    </div>
  )
}

function EventCard({ event }: { event: ComingSoonEvent }) {
  const { t } = useTranslation()
  return (
    <Link to={`/events/${event.slug}`} className="group block h-full overflow-hidden rounded-2xl border border-ink-900/10 bg-sand-50 shadow-sm shadow-ink-900/5 transition-shadow hover:shadow-lg" data-testid="event-card">
      <div className="relative aspect-[16/10] overflow-hidden">
        <img src={resolveImage(event.image)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        <span className="absolute start-3 top-3 inline-flex items-center rounded-full bg-sand-50/95 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-teal-800">{event.status}</span>
      </div>
      <div className="p-6">
        <p className="text-xs font-semibold tracking-wide text-gold-700">
          {event.date}
          {event.time ? <span className="text-ink-900/45"> · {event.time}</span> : null}
        </p>
        <h4 className="font-display mt-2 text-xl font-medium text-ink-900 transition-colors group-hover:text-teal-700">{event.title}</h4>
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-900/65">{event.description}</p>
        {event.location ? <p className="mt-3 text-xs text-ink-900/50">{event.location}</p> : null}
        <span className="mt-4 inline-block text-xs font-semibold text-teal-700 underline-offset-4 group-hover:underline">{t('viewEvent')} →</span>
      </div>
    </Link>
  )
}
