import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { useLanguage } from '../lib/language'
import { resolveImage } from '../lib/imageMap'
import { useCarousel } from '../lib/useCarousel'
import { Container } from './ui/Container'
import { SectionHeading } from './ui/SectionHeading'
import type { ComingSoonEvent } from '../content/types'

export function ComingSoonCarousel() {
  const { content } = useLanguage()
  const { t } = useTranslation()
  const { comingSoon } = content
  const events = comingSoon.events

  const { trackRef, setItemRef, activeIndex, progress, setPaused, next, prev, goTo, handleKeyDown } = useCarousel({
    length: events.length,
    intervalMs: 2000,
  })

  if (events.length === 0) return null

  // A trailing clone of slide 0 gives a seamless forward loop (see useCarousel).
  const slides = events.length > 1 ? [...events, events[0]] : events

  return (
    <section className="pt-8 pb-4 md:pt-10 md:pb-6">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading eyebrow={comingSoon.eyebrow} title={comingSoon.title} body={comingSoon.body} className="max-w-xl" />
          {events.length > 1 ? (
            <div className="hidden items-center gap-3 md:flex">
              <SpotlightArrow direction="prev" onClick={prev} />
              <SpotlightArrow direction="next" onClick={next} />
            </div>
          ) : null}
        </div>

        <div
          ref={trackRef}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="region"
          aria-roledescription="carousel"
          aria-label={comingSoon.title}
          className="relative mt-10 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-2 outline-none [-ms-overflow-style:none] [scrollbar-width:none] md:mt-14 md:gap-6 [&::-webkit-scrollbar]:hidden"
          style={{ overflowAnchor: 'none' }}
        >
          {slides.map((event, i) => {
            const isClone = i >= events.length
            return (
              <EventSlide
                key={isClone ? `${event.id}-clone` : event.id}
                event={event}
                setRef={setItemRef(i)}
                badge={comingSoon.badge}
                locationLabel={comingSoon.locationLabel}
                cta={comingSoon.cta}
                inert={isClone}
                position={(isClone ? 0 : i) + 1}
                total={events.length}
              />
            )
          })}
        </div>

        {events.length > 1 ? (
          <div className="mt-7 flex items-center justify-center gap-2.5">
            {events.map((event, i) => (
              <button
                key={event.id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={t('goToSlide', { n: i + 1 })}
                aria-current={activeIndex === i}
                className="relative h-1 w-9 overflow-hidden rounded-full bg-ink-900/10 transition-colors hover:bg-ink-900/20"
              >
                {activeIndex === i ? (
                  <span className="absolute inset-y-0 start-0 bg-gold-500" style={{ width: `${progress}%` }} />
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </Container>
    </section>
  )
}

function EventSlide({
  event,
  setRef,
  badge,
  locationLabel,
  cta,
  inert,
  position,
  total,
}: {
  event: ComingSoonEvent
  setRef: (el: HTMLElement | null) => void
  badge: string
  locationLabel: string
  cta: string
  inert: boolean
  position: number
  total: number
}) {
  return (
    <Link
      to={`/events/${event.slug}`}
      ref={setRef}
      aria-hidden={inert || undefined}
      tabIndex={inert ? -1 : undefined}
      aria-roledescription="slide"
      aria-label={`${position} / ${total}`}
      className="group relative block w-[78%] shrink-0 snap-center sm:w-[46%] lg:w-[31%]"
      style={{ opacity: 'calc(0.55 + 0.45 * var(--carousel-ratio, 1))' }}
    >
      <div className="overflow-hidden rounded-2xl bg-sand-50 shadow-sm shadow-ink-900/5 ring-1 ring-ink-900/5 transition-shadow duration-300 group-hover:shadow-lg">
        <div className="relative aspect-[4/3] w-full overflow-hidden">
          <img
            src={resolveImage(event.image)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          />
          <span className="absolute start-3 top-3 inline-flex items-center rounded-full bg-sand-50/95 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-teal-800">
            {badge}
          </span>
        </div>
        <div className="p-5">
          <h3 className="font-display line-clamp-2 text-lg font-medium leading-snug text-ink-900 transition-colors group-hover:text-teal-700">
            {event.title}
          </h3>
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-900/65">{event.description}</p>
          <p className="mt-3 text-xs font-semibold text-teal-800">
            {event.date} · {event.time}
          </p>
          <p className="mt-1 text-xs text-ink-900/45">
            {locationLabel}: {event.location}
          </p>
          <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700">
            {cta}
            <NextIcon className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
          </span>
        </div>
      </div>
    </Link>
  )
}

function SpotlightArrow({ direction, onClick }: { direction: 'prev' | 'next'; onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t(direction === 'next' ? 'next' : 'previous')}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-ink-900/15 text-ink-900/70 transition-colors hover:border-teal-700 hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-600"
    >
      {direction === 'next' ? <NextIcon className="h-4 w-4" /> : <PrevIcon className="h-4 w-4" />}
    </button>
  )
}

function NextIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={clsx(className, 'rtl:-scale-x-100')} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 10h12M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PrevIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={clsx(className, 'rtl:-scale-x-100')} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M16 10H4M9 5 4 10l5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
