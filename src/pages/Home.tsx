import clsx from 'clsx'
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion'
import { useContent, useLanguage } from '../lib/language'
import { useSeo } from '../lib/seo'
import { contentByLang } from '../content'
import { Container } from '../components/ui/Container'
import { Eyebrow } from '../components/ui/SectionHeading'
import { SectionHeading } from '../components/ui/SectionHeading'
import { Reveal } from '../components/ui/Reveal'
import { ButtonLink } from '../components/ui/Button'
import { ArchFrame } from '../components/ui/ArchFrame'
import { RestaurantVisual } from '../components/RestaurantVisual'
import { HeroMedia } from '../components/ui/HeroMedia'
import { RosetteIcon } from '../components/ui/RosetteIcon'
import { LatticePattern } from '../components/ui/LatticePattern'
import { TicketBuilder } from '../components/TicketBuilder'
import { HighlightCard } from '../components/HighlightCard'
import { ComingSoonCarousel } from '../components/ComingSoonCarousel'
import { NewsCarousel } from '../components/NewsCarousel'
import { MapViewer } from '../components/MapViewer'
import { planCopy } from '../lib/plan/copy'
import { useAlt } from '../lib/alt'
import { useTranslation } from 'react-i18next'

import heroImage from '../assets/images/hero-citadel-sunset.webp'
import heroBanner from '../assets/images/home-hero-aerial.webp'
import mapImage from '../assets/images/park-map.jpg'
import restaurantHilltop from '../assets/images/restaurant-hilltop.webp'
import restaurantLakeside from '../assets/images/restaurant-lakeside.webp'
import restaurantMasrawya from '../assets/images/restaurant-masrawya.webp'
import restaurantsHero from '../assets/images/restaurants-hero.webp'
import venueSunken from '../assets/images/venue-sunken-garden.webp'
import venueOpen from '../assets/images/venue-open-area.webp'
import venueFountainGarden from '../assets/images/venue-fountain-garden.webp'
import venueOpenLawn from '../assets/images/venue-open-lawn.webp'
import venueLakesidePavilion from '../assets/images/venue-lakeside-pavilion.webp'
import galleryWedding from '../assets/images/gallery-wedding.webp'
import galleryConcert from '../assets/images/events-hero.webp'
import historyBeforeAfter from '../assets/images/history-before-after.webp'
import experiencesCollage from '../assets/images/experiences-collage.webp'
import historySkyline from '../assets/images/history-skyline.webp'
import historyRubbleBefore from '../assets/images/history-rubble-before.webp'
import visitorInfoGarden from '../assets/images/visitor-info-garden.webp'

const restaurantImages: Record<string, string> = {
  hilltop: restaurantHilltop,
  lakeside: restaurantLakeside,
  masrawya: restaurantMasrawya,
}

// The "Eat & drink" teaser always shows the restaurant name bilingually
// (English above, Arabic below) regardless of the site's active language —
// a deliberate exception, independent of the rest of that card's content.
const restaurantNameEn: Record<string, string> = Object.fromEntries(
  contentByLang.en.restaurants.list.map((r) => [r.slug, r.name]),
)
const restaurantNameAr: Record<string, string> = Object.fromEntries(
  contentByLang.ar.restaurants.list.map((r) => [r.slug, r.name]),
)
const restaurantBrandEn: Record<string, string | undefined> = Object.fromEntries(
  contentByLang.en.restaurants.list.map((r) => [r.slug, r.brand]),
)
const restaurantBrandAr: Record<string, string | undefined> = Object.fromEntries(
  contentByLang.ar.restaurants.list.map((r) => [r.slug, r.brand]),
)

// Same order as content.events.venues: Sunken Garden, Open Area, Lake Side Restaurant
const venueImages = [venueFountainGarden, venueOpenLawn, venueLakesidePavilion]

// Ordered to match content.highlights: History, Restaurants, Events & Venues, Visitor Info
const highlightImages = [historySkyline, restaurantsHero, venueOpen, visitorInfoGarden]

const galleryPreviewImages = [
  { src: heroImage, alt: 'Sunset over the Citadel, seen from the park' },
  { src: experiencesCollage, alt: 'The lakeside promenade and park experiences' },
  { src: galleryWedding, alt: 'A private celebration on the lawn' },
  { src: venueSunken, alt: 'The Sunken Garden fountain' },
  { src: galleryConcert, alt: 'Live music on the open lawn' },
  { src: historyBeforeAfter, alt: 'The park, before and after' },
]

export function Home() {
  const content = useContent()
  const { lang } = useLanguage()
  const altText = useAlt()
  const { t } = useTranslation()
  const plan = planCopy[lang]
  useSeo({
    title: content.meta.title,
    description: content.hero.body,
    path: '/',
  })

  const reduceMotion = useReducedMotion()
  const heroTiltX = useMotionValue(0)
  const heroTiltY = useMotionValue(0)
  const heroSpringX = useSpring(heroTiltX, { stiffness: 150, damping: 22, mass: 0.4 })
  const heroSpringY = useSpring(heroTiltY, { stiffness: 150, damping: 22, mass: 0.4 })

  function handleHeroPointerMove(e: React.PointerEvent<HTMLElement>) {
    if (reduceMotion || e.pointerType !== 'mouse') return
    const rect = e.currentTarget.getBoundingClientRect()
    heroTiltX.set(((e.clientX - rect.left) / rect.width - 0.5) * -14)
    heroTiltY.set(((e.clientY - rect.top) / rect.height - 0.5) * -8)
  }
  function handleHeroPointerLeave() {
    heroTiltX.set(0)
    heroTiltY.set(0)
  }

  return (
    <div>
      {/* Hero */}
      <section
        className="relative flex min-h-[80vh] items-end overflow-hidden bg-teal-950 text-sand-50 md:min-h-[86vh]"
        onPointerMove={handleHeroPointerMove}
        onPointerLeave={handleHeroPointerLeave}
      >
        <HeroMedia image={heroBanner} alt={altText('homeHero')} />
        <div className="absolute inset-0 bg-gradient-to-t from-teal-950/60 via-teal-950/30 to-teal-950/10" />

        {/* Fine gold frame — a quiet premium/heritage touch */}
        <div className="pointer-events-none absolute inset-4 hidden rounded-sm border border-sand-50/15 md:inset-6 md:block" aria-hidden="true" />

        <motion.div className="relative w-full" style={{ x: heroSpringX, y: heroSpringY }}>
          <Container className="py-16 md:py-24">
            <Reveal>
              <span className="inline-flex items-center gap-3">
                <RosetteIcon className="h-5 w-5 shrink-0 text-gold-500" />
                <Eyebrow tone="sand">{content.hero.eyebrow}</Eyebrow>
              </span>
            </Reveal>
            <Reveal delay={0.08}>
              <h1 className="font-display mt-5 max-w-3xl text-4xl leading-[1.08] font-medium md:text-6xl">
                {content.hero.title}
              </h1>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-sand-100/85 md:text-lg">{content.hero.body}</p>
            </Reveal>
            <Reveal delay={0.24}>
              <div className="mt-9 flex flex-wrap gap-4">
                <ButtonLink to="/tickets" variant="gold">
                  {content.hero.ctaPrimary}
                </ButtonLink>
                <ButtonLink to="/about" variant="ghost" className="text-sand-50">
                  {content.hero.ctaSecondary}
                </ButtonLink>
              </div>
            </Reveal>
          </Container>
        </motion.div>
      </section>

      {/* Visitor info — surfaced immediately, before anything else */}
      <div className="relative z-10 -mt-10 md:-mt-16">
        <Container>
          <Reveal>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-2xl border border-ink-900/10 bg-sand-50 px-6 py-6 shadow-xl shadow-ink-900/10 md:grid-cols-4 md:gap-8 md:px-10 md:py-8">
              <VisitorBarItem icon={<ClockIcon />} label={content.visitorBar.hoursLabel} value={content.visitorBar.hoursValue} />
              <VisitorBarItem icon={<TicketIcon />} label={content.visitorBar.ticketsLabel} value={content.visitorBar.ticketsValue} to="/tickets" />
              <VisitorBarItem icon={<PinIcon />} label={content.visitorBar.locationLabel} value={content.visitorBar.locationValue} to="/contact" />
              <VisitorBarItem
                icon={<ForkIcon />}
                label={content.visitorBar.restaurantsLabel}
                value={content.visitorBar.restaurantsValue}
                to="/restaurants"
              />
            </div>
          </Reveal>
        </Container>
      </div>

      {/* Stats */}
      <section className="mt-10 md:mt-14">
        <Container className="grid grid-cols-2 gap-8 border-b border-ink-900/10 pb-10 md:grid-cols-4 md:pb-12">
          {content.stats.map((stat, i) => (
            <Reveal key={stat.label} delay={i * 0.06} className="text-center md:text-start">
              <p className="font-display text-4xl font-medium text-teal-800 md:text-5xl">{stat.value}</p>
              <p className="mt-2 text-xs leading-snug text-ink-900/60 md:text-sm">{stat.label}</p>
            </Reveal>
          ))}
        </Container>
      </section>

      <ComingSoonCarousel />

      {/* Intro */}
      <section className="py-12 md:py-16">
        <Container>
          <SectionHeading eyebrow={content.intro.eyebrow} title={content.intro.title} body={content.intro.body} />
        </Container>
      </section>

      {/* Highlights grid */}
      <section className="pb-14 md:pb-20">
        <Container>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4 md:grid-rows-2 md:h-[560px]">
            {content.highlights.map((item, i) => {
              const spanClass =
                i === 0
                  ? 'md:col-span-2 md:row-span-2'
                  : i === 1
                    ? 'md:col-span-2 md:row-span-1'
                    : 'md:col-span-1 md:row-span-1'
              return (
                <Reveal key={item.title} delay={i * 0.06} className={clsx('h-64 md:h-auto', spanClass)}>
                  <HighlightCard
                    title={item.title}
                    body={item.body}
                    to={item.to}
                    image={highlightImages[i]}
                    index={i}
                  />
                </Reveal>
              )
            })}
          </div>
        </Container>
      </section>

      {/* Plan my day — interactive itinerary teaser */}
      <section className="pb-14 md:pb-20">
        <Container>
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl bg-teal-950 px-8 py-12 text-sand-50 md:px-14 md:py-16">
              <LatticePattern id="plan-cta-lattice" className="text-gold-500/[0.08]" />
              <div className="pointer-events-none absolute -top-20 end-10 h-60 w-60 rounded-full bg-gold-500/25 blur-3xl" aria-hidden="true" />
              <div className="relative grid items-center gap-8 md:grid-cols-[1fr_auto]">
                <div>
                  <span className="inline-flex items-center gap-3">
                    <RosetteIcon className="h-5 w-5 shrink-0 text-gold-500" />
                    <Eyebrow tone="sand">{plan.eyebrow}</Eyebrow>
                  </span>
                  <h2 className="font-display mt-4 max-w-2xl text-3xl leading-tight font-medium md:text-4xl">{plan.ctaTitle}</h2>
                  <p className="mt-4 max-w-xl text-base leading-relaxed text-sand-100/80">{plan.ctaBody}</p>
                </div>
                <ButtonLink to="/plan" variant="gold">
                  {plan.ctaButton}
                </ButtonLink>
              </div>
            </div>
          </Reveal>
        </Container>
      </section>

      {/* History teaser */}
      <section className="relative overflow-hidden bg-teal-900 py-24 text-sand-50 md:py-32">
        <LatticePattern id="history-lattice" className="text-gold-500/[0.08]" />
        <Container className="relative grid items-center gap-20 md:grid-cols-2 md:gap-16">
          <Reveal>
            <div className="relative mx-auto max-w-sm md:max-w-md">
              <RestaurantVisual
                src={historySkyline}
                alt={altText('homeHistory')}
              />

              <div className="absolute -end-5 -top-5 z-10 flex h-20 w-20 flex-col items-center justify-center rounded-full border border-gold-500/50 bg-teal-950 text-center shadow-lg sm:h-24 sm:w-24 md:-end-7 md:-top-7">
                <span className="font-display text-xl font-medium text-gold-100 sm:text-2xl">1984</span>
                <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-sand-100/60">{t('proposed')}</span>
              </div>

              <div className="absolute -start-5 -bottom-6 z-10 w-28 sm:w-36 md:-start-9 md:-bottom-8 md:w-40">
                <div aria-hidden="true" className="absolute -inset-[3px] bg-sand-50" style={{ clipPath: 'url(#arch-clip)' }} />
                <div className="relative">
                  <ArchFrame
                    src={historyRubbleBefore}
                    alt={altText('homeBefore')}
                    className="aspect-[4/5] w-full shadow-2xl"
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-teal-950/85 py-1 text-center font-display text-[10px] font-semibold uppercase tracking-widest text-gold-100">
                    {content.historyTeaser.beforeLabel}
                  </span>
                </div>
              </div>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <Eyebrow tone="sand">{content.historyTeaser.eyebrow}</Eyebrow>
            <h2 className="font-display mt-4 text-3xl leading-tight font-medium md:text-4xl">{content.historyTeaser.title}</h2>
            <p className="mt-5 text-base leading-relaxed text-sand-100/80 md:text-lg">{content.historyTeaser.body}</p>

            <dl className="mt-9 grid grid-cols-3 gap-4 border-t border-sand-50/15 pt-6">
              {[0, 2, 4].map((idx) => {
                const event = content.about.timeline[idx]
                return (
                  <div key={event.year}>
                    <dt className="font-display text-lg font-medium text-gold-100 md:text-xl">{event.year}</dt>
                    <dd className="mt-1 text-xs leading-snug text-sand-100/70 md:text-sm">{event.title}</dd>
                  </div>
                )
              })}
            </dl>

            <ButtonLink to="/about" variant="gold" className="mt-9">
              {content.historyTeaser.cta}
            </ButtonLink>
          </Reveal>
        </Container>
      </section>

      {/* Restaurants teaser */}
      <section className="py-20 md:py-28">
        <Container>
          <SectionHeading eyebrow={content.restaurantsTeaser.eyebrow} title={content.restaurantsTeaser.title} align="center" />

          <div className="mx-auto mt-16 grid max-w-5xl gap-14 md:grid-cols-3 md:gap-10">
            {content.restaurants.list.map((restaurant, i) => (
              <Reveal key={restaurant.slug} delay={i * 0.08}>
                <a href={`/restaurants/${restaurant.slug}`} className="group block text-center">
                  <RestaurantVisual
                    src={restaurantImages[restaurant.slug]}
                    alt={restaurant.name}
                    className="mx-auto w-full max-w-[15rem]"
                  />
                  <h3 className="font-display mt-6 text-2xl font-medium text-teal-800">{restaurantNameEn[restaurant.slug]}</h3>
                  <p className="font-display mt-1 text-2xl font-medium text-teal-800" style={{ fontFamily: 'var(--font-arabic)' }}>
                    {restaurantNameAr[restaurant.slug]}
                  </p>
                  <p className="mt-1.5 text-xs font-semibold tracking-[0.2em] text-gold-600 uppercase" aria-hidden={!restaurantBrandEn[restaurant.slug]}>
                    {restaurantBrandEn[restaurant.slug] ?? ' '}
                    {restaurantBrandAr[restaurant.slug] ? (
                      <span style={{ fontFamily: 'var(--font-arabic)' }}> · {restaurantBrandAr[restaurant.slug]}</span>
                    ) : null}
                  </p>
                  <p className="font-display mt-2 text-sm italic text-teal-700/70">{restaurant.tagline}</p>
                  <p className="mx-auto mt-4 line-clamp-3 max-w-xs text-sm leading-relaxed text-ink-900/60 md:min-h-[4.5rem]">{restaurant.body}</p>
                  <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-gold-600" dir="ltr">
                    {restaurant.hours}
                  </p>
                </a>
              </Reveal>
            ))}
          </div>

          <div className="mt-14 text-center">
            <a href="/restaurants" className="inline-flex items-center gap-2 border-b border-teal-700 pb-1 text-sm font-semibold text-teal-700">
              {content.restaurantsTeaser.cta}
              <ArrowIcon />
            </a>
          </div>
        </Container>
      </section>

      {/* Buy tickets */}
      <section className="border-y border-ink-900/10 bg-sand-100 py-20 md:py-28">
        <Container>
          <SectionHeading eyebrow={content.ticketsSection.eyebrow} title={content.ticketsSection.title} body={content.ticketsSection.body} />
          <Reveal delay={0.1} className="mt-12">
            <TicketBuilder />
          </Reveal>
        </Container>
      </section>

      {/* Events & Venues teaser */}
      <section className="border-y border-ink-900/10 bg-sand-100 py-20 md:py-28">
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHeading eyebrow={content.eventsTeaser.eyebrow} title={content.eventsTeaser.title} body={content.eventsTeaser.body} className="max-w-xl" />
            <a
              href="/events"
              className="hidden items-center gap-2 border-b border-teal-700 pb-1 text-sm font-semibold text-teal-700 md:inline-flex"
            >
              {content.eventsTeaser.cta}
              <ArrowIcon />
            </a>
          </div>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {content.events.venues.map((venue, i) => (
              <Reveal key={venue.name} delay={i * 0.08}>
                <a href="/events" className="group block overflow-hidden rounded-2xl border border-ink-900/10 bg-sand-50">
                  <div className="aspect-[4/3] overflow-hidden">
                    <img
                      src={venueImages[i]}
                      alt={venue.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                  <div className="p-6">
                    <h3 className="font-display text-lg font-medium text-ink-900">{venue.name}</h3>
                    <p className="mt-1 text-sm font-semibold text-teal-700">{venue.capacity}</p>
                  </div>
                </a>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <NewsCarousel />

      {/* Gallery preview */}
      <section className="py-20 md:py-28">
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHeading eyebrow={content.galleryTeaser.eyebrow} title={content.galleryTeaser.title} className="max-w-xl" />
            <a
              href="/gallery"
              className="hidden items-center gap-2 border-b border-teal-700 pb-1 text-sm font-semibold text-teal-700 md:inline-flex"
            >
              {content.galleryTeaser.cta}
              <ArrowIcon />
            </a>
          </div>

          <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
            {galleryPreviewImages.map((img, i) => (
              <Reveal key={img.src} delay={(i % 6) * 0.05}>
                <a href="/gallery" className="block aspect-square overflow-hidden rounded-xl bg-teal-900">
                  <img
                    src={img.src}
                    alt={img.alt}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                  />
                </a>
              </Reveal>
            ))}
          </div>

          <a
            href="/gallery"
            className="mt-8 flex items-center justify-center gap-2 text-sm font-semibold text-teal-700 md:hidden"
          >
            {content.galleryTeaser.cta}
            <ArrowIcon />
          </a>
        </Container>
      </section>

      {/* Plan your visit — final CTA */}
      <section className="border-t border-ink-900/10 bg-sand-100 py-20 md:py-28">
        <Container className="grid items-center gap-12 md:grid-cols-2">
          <Reveal>
            <Eyebrow>{content.visitTeaser.eyebrow}</Eyebrow>
            <h2 className="font-display mt-4 text-3xl leading-tight font-medium text-ink-900 md:text-4xl">
              {content.visitTeaser.title}
            </h2>
            <p className="mt-5 text-base leading-relaxed text-ink-900/70 md:text-lg">{content.visitTeaser.body}</p>

            <dl className="mt-8 grid grid-cols-2 gap-6">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">
                  {content.visitTeaser.hoursLabel}
                </dt>
                <dd className="mt-2 text-sm font-medium text-ink-900">{content.visitTeaser.hours}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">
                  {content.visitTeaser.addressLabel}
                </dt>
                <dd className="mt-2 text-sm font-medium text-ink-900">{content.visitTeaser.address}</dd>
              </div>
            </dl>

            <ButtonLink to="/tickets" className="mt-9">
              {content.visitTeaser.cta}
            </ButtonLink>
          </Reveal>
          <Reveal delay={0.1}>
            <MapViewer src={mapImage} alt={altText('parkMap')} />
          </Reveal>
        </Container>
      </section>
    </div>
  )
}

function VisitorBarItem({
  icon,
  label,
  value,
  to,
}: {
  icon: React.ReactNode
  label: string
  value: string
  to?: string
}) {
  const inner = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-700">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-900/45">{label}</span>
        <span className="block text-sm font-semibold leading-snug text-ink-900">{value}</span>
      </span>
    </>
  )
  if (to) {
    return (
      <a href={to} className="flex items-center gap-3 rounded-lg transition-opacity hover:opacity-70">
        {inner}
      </a>
    )
  }
  return <div className="flex items-center gap-3">{inner}</div>
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 10h12M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6.2V10l2.6 1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TicketIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path
        d="M3 8a2 2 0 0 0 0 4v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2a2 2 0 0 1 0-4V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v2Z"
        strokeLinejoin="round"
      />
      <path d="M8 5v10" strokeDasharray="1.6 1.6" strokeLinecap="round" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M10 18s6-5.5 6-10a6 6 0 1 0-12 0c0 4.5 6 10 6 10Z" strokeLinejoin="round" />
      <circle cx="10" cy="8" r="2.2" />
    </svg>
  )
}

function ForkIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M6 3v6a2 2 0 0 0 4 0V3M8 9v8M14 3v5a2 2 0 1 0 4 0V3M16 8v9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
