import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { useLanguage } from '../lib/language'
import { useSeo } from '../lib/seo'
import { useAlt, useCredit } from '../lib/alt'
import { Container } from '../components/ui/Container'
import { Eyebrow } from '../components/ui/SectionHeading'
import { Reveal } from '../components/ui/Reveal'
import { ButtonLink } from '../components/ui/Button'
import { ArchFrame } from '../components/ui/ArchFrame'
import { LatticePattern } from '../components/ui/LatticePattern'
import { RosetteIcon } from '../components/ui/RosetteIcon'
import { PageHero } from '../components/PageHero'
import { RestaurantVisual } from '../components/RestaurantVisual'
import { WhatsOn } from '../components/WhatsOn'

import heroImage from '../assets/images/events-hero-banner.webp'
import fountainGarden from '../assets/images/venue-fountain-garden.webp'
import openLawn from '../assets/images/venue-open-lawn.webp'
import lakesidePavilion from '../assets/images/venue-lakeside-pavilion.webp'
import concert from '../assets/images/events-hero.webp'

// Venue order is identical in every language: Sunken Garden, Open Area, Lake Side Restaurant.
const VENUE_IMAGES = [fountainGarden, openLawn, lakesidePavilion]
const VENUE_CAPACITY = [300, 4000, 300]
const MAX_CAPACITY = 4000
const PHOTO_CREDITS = [
  { author: 'Filip Maljković', license: 'CC BY-SA 2.0', url: 'https://commons.wikimedia.org/wiki/File:Fountains_in_Al_Azhar_Park_(2714876199).jpg' },
  { author: 'Sakorty', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:الفطار_وسط_الطبيعة.jpg' },
  { author: 'Kareem Tarek Hussein', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:مصر_العظيمة.jpg' },
]

const TYPE_KEYS = ['all', 'venueHire', 'festivals', 'corporate', 'sports'] as const
type TypeKey = (typeof TYPE_KEYS)[number]

// Curatorial mapping (presentation only): which venues suit which kind of event.
const VENUES_BY_TYPE: Record<TypeKey, number[]> = {
  all: [0, 1, 2],
  venueHire: [0, 2],
  festivals: [1],
  corporate: [2],
  sports: [1],
}

const TYPE_LABEL: Record<TypeKey, string> = {
  all: 'eventTypeAll',
  venueHire: 'eventTypeVenueHire',
  festivals: 'eventTypeFestivals',
  corporate: 'eventTypeCorporate',
  sports: 'eventTypeSports',
}

const NUMERALS = { en: ['I', 'II', 'III', 'IV'], ar: ['١', '٢', '٣', '٤'] }

export function Events() {
  const { content, lang } = useLanguage()
  const altText = useAlt()
  const credit_ = useCredit()
  const { events } = content
  const { t } = useTranslation()
  useSeo({ title: events.title, description: events.lead, path: '/events' })
  const reduceMotion = useReducedMotion()

  const [activeType, setActiveType] = useState<TypeKey>('all')
  const [selected, setSelected] = useState(0)

  const suited = VENUES_BY_TYPE[activeType]
  const venue = events.venues[selected]
  const credit = PHOTO_CREDITS[selected]

  function chooseType(key: TypeKey) {
    setActiveType(key)
    if (!VENUES_BY_TYPE[key].includes(selected)) setSelected(VENUES_BY_TYPE[key][0])
  }

  // Which event types a venue is best for (excluding "all")
  const venueTypes = (index: number) => TYPE_KEYS.filter((k) => k !== 'all' && VENUES_BY_TYPE[k].includes(index))

  return (
    <div>
      <PageHero
        eyebrow={events.eyebrow}
        title={events.title}
        lead={events.lead}
        image={heroImage}
        imageAlt={altText('eventsHero')}
        credit={{ text: credit_('Yasser.mahmoud', 'CC BY-SA 4.0'), href: 'https://commons.wikimedia.org/wiki/File:حـديقة_الازهر_11.jpg' }}
      />

      {/* Events from the portal: published, coming soon, or an empty state */}
      <WhatsOn />

      {/* Venue showcase */}
      <section className="relative overflow-hidden py-20 md:py-28">
        <LatticePattern id="events-lattice" className="text-teal-900/[0.035]" />
        <Container className="relative">
          <Reveal className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-3">
              <RosetteIcon className="h-5 w-5 shrink-0 text-gold-600" />
              <Eyebrow>{events.venuesTitle}</Eyebrow>
            </span>
            <h2 className="font-display mt-4 text-3xl leading-tight font-medium text-ink-900 md:text-5xl">{events.planningTitle}</h2>
          </Reveal>

          {/* What are you planning? */}
          <Reveal delay={0.08} className="mt-8 flex flex-wrap justify-center gap-2">
            {TYPE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => chooseType(key)}
                aria-pressed={activeType === key}
                className={clsx(
                  'rounded-full border px-5 py-2.5 text-xs font-semibold tracking-wide transition-colors',
                  activeType === key
                    ? 'border-teal-700 bg-teal-700 text-sand-50'
                    : 'border-ink-900/15 bg-sand-50 text-ink-900/65 hover:border-teal-700 hover:text-teal-700',
                )}
              >
                {t(TYPE_LABEL[key])}
              </button>
            ))}
          </Reveal>

          {/* Three arched doorways — pick a venue */}
          <Reveal delay={0.12} className="mx-auto mt-14 grid max-w-2xl grid-cols-3 gap-4 sm:gap-8">
            {events.venues.map((v, i) => {
              const isSelected = selected === i
              const isSuited = suited.includes(i)
              return (
                <button
                  key={v.name}
                  type="button"
                  onClick={() => setSelected(i)}
                  aria-pressed={isSelected}
                  className={clsx('group text-center transition-opacity duration-300', !isSuited && 'opacity-35')}
                >
                  <div className="relative mx-auto w-full max-w-[9rem]">
                    <div
                      aria-hidden="true"
                      className={clsx(
                        '-inset-1.5 absolute bg-gradient-to-br from-gold-500 via-gold-600/90 to-gold-700 transition-opacity duration-300',
                        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-60',
                      )}
                      style={{ clipPath: 'url(#arch-clip)' }}
                    />
                    <ArchFrame src={VENUE_IMAGES[i]} alt="" className={clsx('aspect-[3/4] w-full transition-transform duration-500', isSelected && 'scale-[1.02]')} />
                  </div>
                  <p className={clsx('mt-4 text-xs font-semibold leading-snug transition-colors sm:text-sm', isSelected ? 'text-teal-800' : 'text-ink-900/60')}>{v.name}</p>
                </button>
              )
            })}
          </Reveal>

          {/* Selected venue */}
          <div className="mt-16 min-h-[30rem]">
            <AnimatePresence mode="wait">
              <motion.div
                key={selected}
                initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -12 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="grid items-center gap-12 md:grid-cols-[minmax(0,420px)_1fr] md:gap-20"
              >
                <div>
                  <RestaurantVisual src={VENUE_IMAGES[selected]} alt={venue.name} className="mx-auto w-full max-w-sm" />
                  <p className="mt-6 text-center text-[11px] text-ink-900/40">
                    {events.photoLabel}:{' '}
                    <a href={credit.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-teal-700 hover:underline">
                      {credit.author} · {credit.license}
                    </a>
                  </p>
                </div>

                <div>
                  <p className="font-display text-sm font-semibold tracking-[0.3em] text-gold-700">{NUMERALS[lang][selected]}</p>
                  <h3 className="font-display mt-2 text-4xl leading-tight font-medium text-ink-900 md:text-5xl">{venue.name}</h3>
                  <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-900/75 md:text-lg">{venue.body}</p>

                  {/* Plaque */}
                  <dl className="mt-8 grid max-w-xl grid-cols-2 divide-x divide-gold-500/30 rounded-2xl border border-gold-500/40 bg-sand-100 rtl:divide-x-reverse">
                    <div className="px-6 py-5">
                      <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-900/45">{events.areaLabel}</dt>
                      <dd className="font-display mt-1 text-2xl font-medium text-teal-800">{venue.area}</dd>
                    </div>
                    <div className="px-6 py-5">
                      <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-900/45">{events.capacityLabel}</dt>
                      <dd className="font-display mt-1 text-2xl font-medium text-teal-800">{venue.capacity}</dd>
                    </div>
                  </dl>

                  {/* Scale of the gathering */}
                  <div className="mt-8 max-w-xl">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-900/45">{events.scaleLabel}</p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-ink-900/10">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-500"
                        initial={reduceMotion ? false : { width: 0 }}
                        animate={{ width: `${Math.max(6, (VENUE_CAPACITY[selected] / MAX_CAPACITY) * 100)}%` }}
                        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
                      />
                    </div>
                  </div>

                  {/* Best for */}
                  <div className="mt-8 max-w-xl">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-900/45">{events.suitedLabel}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {venueTypes(selected).map((key) => (
                        <span key={key} className="rounded-full border border-teal-700/25 bg-teal-50 px-4 py-1.5 text-xs font-semibold text-teal-800">
                          {t(TYPE_LABEL[key])}
                        </span>
                      ))}
                    </div>
                  </div>

                  <ButtonLink to="/contact" className="mt-10">
                    {events.enquireVenue}
                  </ButtonLink>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </Container>
      </section>

      {/* What we host — arch-topped plaques */}
      <section className="border-y border-ink-900/10 bg-sand-100 py-20 md:py-28">
        <Container>
          <Reveal className="mx-auto max-w-2xl text-center">
            <Eyebrow>{events.typesTitle}</Eyebrow>
          </Reveal>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {events.types.map((type, i) => (
              <Reveal key={type.title} delay={i * 0.08}>
                <div className="group relative h-full rounded-t-[999px] rounded-b-2xl border border-gold-500/35 bg-sand-50 px-7 pb-9 pt-20 text-center shadow-sm shadow-ink-900/5 transition-all duration-300 hover:-translate-y-1.5 hover:border-gold-500/70 hover:shadow-xl hover:shadow-ink-900/10">
                  <span className="absolute inset-x-8 top-8 flex items-center gap-3" aria-hidden="true">
                    <span className="h-px flex-1 bg-gradient-to-r from-transparent to-gold-500/60" />
                    <span className="font-display text-sm font-semibold tracking-[0.25em] text-gold-700">{NUMERALS[lang][i]}</span>
                    <span className="h-px flex-1 bg-gradient-to-l from-transparent to-gold-500/60" />
                  </span>
                  <h3 className="font-display text-xl leading-snug font-medium text-ink-900">{type.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-ink-900/65">{type.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      {/* Notable events */}
      <section className="relative overflow-hidden bg-teal-950 py-20 text-sand-50 md:py-28">
        <LatticePattern id="events-notable-lattice" className="text-gold-500/[0.07]" />
        <div className="pointer-events-none absolute -top-24 start-0 h-72 w-72 rounded-full bg-gold-500/15 blur-3xl" aria-hidden="true" />
        <Container className="relative grid items-center gap-16 md:grid-cols-[1.1fr_minmax(0,380px)] md:gap-20">
          <Reveal>
            <span className="inline-flex items-center gap-3">
              <RosetteIcon className="h-5 w-5 shrink-0 text-gold-500" />
              <Eyebrow tone="sand">{events.notableTitle}</Eyebrow>
            </span>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-sand-100/85 md:text-lg">{events.notableBody}</p>
            <ul className="mt-8 flex flex-wrap gap-3">
              {events.notableNames.map((name, i) => (
                <motion.li
                  key={name}
                  initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06, duration: 0.5 }}
                  className="rounded-full border border-gold-500/40 bg-teal-900/60 px-5 py-2.5 text-sm font-medium text-gold-100 backdrop-blur-sm"
                >
                  {name}
                </motion.li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            <RestaurantVisual src={concert} alt={altText('eventsConcert')} className="mx-auto w-full max-w-sm" />
          </Reveal>
        </Container>
      </section>

      {/* Enquire */}
      <section className="py-20 md:py-28">
        <Container>
          <Reveal className="relative overflow-hidden rounded-3xl border border-gold-500/40 bg-sand-100 px-8 py-14 text-center md:px-16 md:py-20">
            <LatticePattern id="events-cta-lattice" className="text-gold-600/[0.08]" />
            <div className="relative mx-auto max-w-2xl">
              <RosetteIcon className="mx-auto h-8 w-8 text-gold-600" />
              <h2 className="font-display mt-6 text-3xl leading-tight font-medium text-ink-900 md:text-4xl">{events.ctaTitle}</h2>
              <p className="mt-5 text-base leading-relaxed text-ink-900/70 md:text-lg">{events.ctaBody}</p>
              <ButtonLink to="/contact" variant="gold" className="mt-9">
                {events.cta}
              </ButtonLink>
            </div>
          </Reveal>
        </Container>
      </section>
    </div>
  )
}
