import { useTranslation } from 'react-i18next'
import { useContent } from '../lib/language'
import { useSeo } from '../lib/seo'
import { useAlt } from '../lib/alt'
import { Container } from '../components/ui/Container'
import { Reveal } from '../components/ui/Reveal'
import { PageHero } from '../components/PageHero'
import { ButtonLink, ExternalLink } from '../components/ui/Button'
import { RestaurantVisual } from '../components/RestaurantVisual'
import clsx from 'clsx'

import restaurantHilltop from '../assets/images/restaurant-hilltop.webp'
import restaurantLakeside from '../assets/images/restaurant-lakeside.webp'
import restaurantMasrawya from '../assets/images/restaurant-masrawya.webp'
import restaurantsHero from '../assets/images/restaurants-hero-lakeside.webp'

const images: Record<string, string> = {
  hilltop: restaurantHilltop,
  lakeside: restaurantLakeside,
  masrawya: restaurantMasrawya,
}

// Hill-top Restaurant (Studio Masr) takes reservations through its Instagram, not the in-site form.
const externalReservationLinks: Record<string, string> = {
  hilltop: 'https://www.instagram.com/studio.masr/?hl=en',
}

export function Restaurants() {
  const content = useContent()
  const altText = useAlt()
  const { restaurants } = content
  const { t } = useTranslation()
  useSeo({ title: restaurants.title, description: restaurants.lead, path: '/restaurants' })

  return (
    <div>
      <PageHero
        eyebrow={restaurants.eyebrow}
        title={restaurants.title}
        lead={restaurants.lead}
        image={restaurantsHero}
        imageAlt={altText('restaurantsHero')}
      />

      <div>
        {restaurants.list.map((restaurant, i) => (
          <section key={restaurant.slug} className={clsx('py-20 md:py-28', i % 2 === 1 && 'bg-sand-100')}>
            <Container>
              <div className={clsx('grid items-center gap-12 md:grid-cols-2 md:gap-16', i % 2 === 1 && 'md:[&>*:first-child]:order-2')}>
                <Reveal className="relative mx-auto w-full max-w-sm md:max-w-none">
                  <span
                    aria-hidden="true"
                    className="font-display pointer-events-none absolute -top-10 start-0 z-10 text-[7rem] font-medium leading-none text-gold-500/15 md:-top-14 md:text-[9rem]"
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <RestaurantVisual
                    src={images[restaurant.slug]}
                    alt={restaurant.name}
                    to={`/restaurants/${restaurant.slug}`}
                    className="max-w-sm md:max-w-md"
                  />
                </Reveal>
                <Reveal delay={0.1} className="relative">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold-700">{restaurant.tagline}</p>
                  <h2 className="font-display mt-4 text-3xl font-medium text-ink-900 md:text-4xl">{restaurant.name}</h2>
                  {restaurant.brand ? <p className="mt-1.5 text-sm text-ink-900/50">{t('byBrand', { brand: restaurant.brand })}</p> : null}
                  <div className="mt-5 h-px w-16 bg-gold-500/50" />
                  <p className="mt-6 text-base leading-relaxed text-ink-900/75 md:text-lg">{restaurant.body}</p>
                  <p className="mt-6 inline-flex items-center gap-2 rounded-full bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-800">
                    <ClockIcon />
                    <span dir="ltr">{restaurant.hours}</span>
                  </p>
                  <div className="mt-8 flex flex-wrap gap-4">
                    <ButtonLink to={`/restaurants/${restaurant.slug}`}>
                      <ForkIcon />
                      {t('viewDetails')}
                    </ButtonLink>
                    {' '}
                    {externalReservationLinks[restaurant.slug] ? (
                      <ExternalLink
                        href={externalReservationLinks[restaurant.slug]}
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="ghost"
                        className="text-ink-900"
                      >
                        <CalendarIcon />
                        {t('reserveTable')}
                      </ExternalLink>
                    ) : (
                      <ButtonLink to={`/restaurants/${restaurant.slug}`} variant="ghost" className="text-ink-900">
                        <CalendarIcon />
                        {t('reserveTable')}
                      </ButtonLink>
                    )}
                  </div>
                </Reveal>
              </div>
            </Container>
          </section>
        ))}
      </div>
    </div>
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

function ForkIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M6.5 3v5a1.5 1.5 0 0 0 3 0V3M8 8v9M13.5 3v4.5a1.5 1.5 0 1 0 3 0V3M15 7.5V17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3.5" y="4.5" width="13" height="12" rx="1.5" />
      <path d="M3.5 8h13M7 3v3M13 3v3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
