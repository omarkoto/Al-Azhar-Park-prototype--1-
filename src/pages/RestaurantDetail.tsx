import { useState } from 'react'
import { useParams, Navigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useContent } from '../lib/language'
import { useSeo } from '../lib/seo'
import { resolveImage } from '../lib/imageMap'
import { Container } from '../components/ui/Container'
import { Reveal } from '../components/ui/Reveal'
import { Eyebrow } from '../components/ui/SectionHeading'
import { Button, ExternalLink } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { ReservationForm } from '../components/ReservationForm'
import { RestaurantVisual } from '../components/RestaurantVisual'
import restaurantsHero from '../assets/images/restaurants-hero.webp'

// Hill-top Restaurant (Studio Masr) takes reservations through its Instagram, not the in-site form.
const externalReservationLinks: Record<string, string> = {
  hilltop: 'https://www.instagram.com/studio.masr/?hl=en',
}

export function RestaurantDetail() {
  const { slug } = useParams()
  const content = useContent()
  const { t } = useTranslation()
  const restaurant = content.restaurants.list.find((r) => r.slug === slug)
  const [menuOpen, setMenuOpen] = useState(false)
  const [reserveOpen, setReserveOpen] = useState(false)

  useSeo({
    title: restaurant?.name ?? content.restaurants.title,
    description: restaurant?.body ?? content.restaurants.lead,
    path: `/restaurants/${slug ?? ''}`,
  })

  if (!restaurant) return <Navigate to="/restaurants" replace />

  return (
    <div>
      <section className="relative flex min-h-[38vh] items-end overflow-hidden bg-teal-950 text-sand-50">
        <img src={restaurantsHero} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-t from-teal-950 via-teal-950/80 to-teal-950/40" />
        <Container className="relative py-12">
          <Reveal>
            <Link to="/restaurants" className="inline-flex items-center gap-2 text-sm font-medium text-sand-100/80 hover:text-sand-50">
              ← {t('backToRestaurants')}
            </Link>
            <div className="mt-6">
              <Eyebrow tone="sand">{restaurant.tagline}</Eyebrow>
            </div>
            <h1 className="font-display mt-3 text-4xl font-medium md:text-5xl">{restaurant.name}</h1>
            {restaurant.brand ? <p className="mt-2 text-sm text-sand-100/70">{t('byBrand', { brand: restaurant.brand })}</p> : null}
          </Reveal>
        </Container>
      </section>

      <section className="py-16 md:py-24">
        <Container className="grid gap-12 md:grid-cols-[1.3fr_1fr]">
          <Reveal>
            <div className="grid gap-10 sm:grid-cols-[0.9fr_1.1fr] sm:items-start">
              <RestaurantVisual src={resolveImage(restaurant.image)} alt={restaurant.name} className="mx-auto w-full max-w-sm sm:mx-0" />
              <div>
                <p className="text-base leading-relaxed text-ink-900/80 md:text-lg">{restaurant.body}</p>
                <h2 className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">{t('atAGlance')}</h2>
                <p className="mt-3 text-base leading-relaxed text-ink-900/75">{restaurant.atmosphere}</p>
              </div>
            </div>

            {restaurant.gallery.length ? (
              <div className="mt-8 grid grid-cols-2 gap-4">
                {restaurant.gallery.map((src) => (
                  <img key={src} src={resolveImage(src)} alt="" className="aspect-[4/3] w-full rounded-sm object-cover" />
                ))}
              </div>
            ) : null}
          </Reveal>

          <Reveal delay={0.1} className="h-fit rounded-2xl border border-ink-900/10 bg-sand-100 p-6">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-teal-800">
              <ClockIcon />
              <span dir="ltr">{restaurant.hours}</span>
            </p>
            <div className="mt-6 space-y-3">
              {externalReservationLinks[restaurant.slug] ? (
                <ExternalLink
                  href={externalReservationLinks[restaurant.slug]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full justify-center"
                >
                  <CalendarIcon />
                  {t('reserveTable')}
                </ExternalLink>
              ) : (
                <Button className="w-full justify-center" onClick={() => setReserveOpen(true)}>
                  <CalendarIcon />
                  {t('reserveTable')}
                </Button>
              )}
              {restaurant.menuUrl ? (
                <ExternalLink
                  href={restaurant.menuUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="ghost"
                  className="w-full justify-center border-ink-900/20 text-ink-900"
                >
                  <ForkIcon />
                  {t('viewMenu')}
                </ExternalLink>
              ) : (
                <Button variant="ghost" className="w-full justify-center border-ink-900/20 text-ink-900" onClick={() => setMenuOpen(true)}>
                  <ForkIcon />
                  {t('viewMenu')}
                </Button>
              )}
            </div>
            <div className="mt-6 border-t border-ink-900/10 pt-5">
              <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">{t('callRestaurant')}</h2>
              <ul className="mt-3 space-y-2">
                {restaurant.phones.map((phone) => (
                  <li key={phone}>
                    <a href={`tel:${phone}`} className="inline-flex items-center gap-2 text-base font-semibold text-teal-800 hover:text-teal-700" dir="ltr">
                      <PhoneIcon />
                      {phone}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </Container>
      </section>

      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title={t('menuComingSoonTitle')}>
        <p className="text-sm leading-relaxed text-ink-900/70">{t('menuComingSoonBody')}</p>
      </Modal>

      <Modal open={reserveOpen} onClose={() => setReserveOpen(false)} title={t('reservationFormTitle')}>
        <ReservationForm restaurantName={restaurant.name} />
      </Modal>
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

function PhoneIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M5 3h2.5l1.2 3.3-1.6 1.1a9 9 0 0 0 4.5 4.5l1.1-1.6L16 11.5V14a2 2 0 0 1-2 2A11 11 0 0 1 3 5a2 2 0 0 1 2-2Z" strokeLinecap="round" strokeLinejoin="round" />
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
