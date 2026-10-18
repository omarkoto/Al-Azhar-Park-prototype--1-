import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { siteLinks, type PublicSite, type SiteLinks } from '../content/siteData'
import type { PublicRestaurant } from '../content/restaurantData'
import type { PublicEvent } from '../content/eventData'
import type { PublicJournalArticle } from '../content/journalData'
import { API_URL, apiGet } from './api'

interface SiteDataValue {
  /** null until loaded, or whenever the API is not configured / not reachable: the site then uses its built-in content */
  site: PublicSite | null
  /** the restaurants entered in the portal (null until loaded or when unavailable) */
  restaurants: PublicRestaurant[] | null
  /** false only while the first answer is on its way: pages for portal-created restaurants must wait for it */
  restaurantsSettled: boolean
  /** events from the portal: null until loaded or when the API is unavailable (the site then shows its built-in ones) */
  comingSoonEvents: PublicEvent[] | null
  publishedEvents: PublicEvent[] | null
  /** false only while the first answer is on its way (pages for portal-created events wait for it) */
  eventsSettled: boolean
  /** Journal articles from the portal: null until loaded or when the API is unavailable (the site then shows its built-in ones) */
  journalArticles: PublicJournalArticle[] | null
  /** false only while the first answer is on its way (an article page must not send visitors away before that) */
  journalSettled: boolean
  links: SiteLinks
}

const SiteDataContext = createContext<SiteDataValue>({ site: null, restaurants: null, restaurantsSettled: true, comingSoonEvents: null, publishedEvents: null, eventsSettled: true, journalArticles: null, journalSettled: true, links: siteLinks(null) })
const REFRESH_MS = 5 * 60 * 1000

/** Loads the park's live information (contact, hours, statistics) once, then every few minutes. Never blocks rendering. */
export function SiteDataProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<PublicSite | null>(null)
  const [restaurants, setRestaurants] = useState<PublicRestaurant[] | null>(null)
  const [restaurantsSettled, setRestaurantsSettled] = useState(!API_URL)
  const [comingSoonEvents, setComingSoonEvents] = useState<PublicEvent[] | null>(null)
  const [publishedEvents, setPublishedEvents] = useState<PublicEvent[] | null>(null)
  const [eventsSettled, setEventsSettled] = useState(!API_URL)
  const [journalArticles, setJournalArticles] = useState<PublicJournalArticle[] | null>(null)
  const [journalSettled, setJournalSettled] = useState(!API_URL)

  useEffect(() => {
    if (!API_URL) return
    let cancelled = false
    const controller = new AbortController()
    const load = () => {
      apiGet<PublicSite>('/public/site', controller.signal)
        .then((data) => !cancelled && setSite(data))
        .catch(() => undefined) // keep whatever we have (or the built-in content)
      apiGet<PublicRestaurant[]>('/public/restaurants', controller.signal)
        .then((data) => !cancelled && setRestaurants(data))
        .catch(() => undefined)
        .finally(() => !cancelled && setRestaurantsSettled(true))
      Promise.all([apiGet<PublicEvent[]>('/public/events/coming-soon', controller.signal), apiGet<PublicEvent[]>('/public/events', controller.signal)])
        .then(([soon, published]) => {
          if (cancelled) return
          setComingSoonEvents(soon)
          setPublishedEvents(published)
        })
        .catch(() => undefined) // keep what we have, or the built-in events
        .finally(() => !cancelled && setEventsSettled(true))
      apiGet<PublicJournalArticle[]>('/public/journal', controller.signal)
        .then((data) => !cancelled && setJournalArticles(data))
        .catch(() => undefined) // keep what we have, or the built-in articles
        .finally(() => !cancelled && setJournalSettled(true))
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [])

  const value = useMemo(
    () => ({ site, restaurants, restaurantsSettled, comingSoonEvents, publishedEvents, eventsSettled, journalArticles, journalSettled, links: siteLinks(site) }),
    [site, restaurants, restaurantsSettled, comingSoonEvents, publishedEvents, eventsSettled, journalArticles, journalSettled],
  )
  return <SiteDataContext.Provider value={value}>{children}</SiteDataContext.Provider>
}

export function useSiteData() {
  return useContext(SiteDataContext)
}
