import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { siteLinks, type PublicSite, type SiteLinks } from '../content/siteData'
import { API_URL, apiGet } from './api'

interface SiteDataValue {
  /** null until loaded, or whenever the API is not configured / not reachable: the site then uses its built-in content */
  site: PublicSite | null
  links: SiteLinks
}

const SiteDataContext = createContext<SiteDataValue>({ site: null, links: siteLinks(null) })
const REFRESH_MS = 5 * 60 * 1000

/** Loads the park's live information (contact, hours, statistics) once, then every few minutes. Never blocks rendering. */
export function SiteDataProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<PublicSite | null>(null)

  useEffect(() => {
    if (!API_URL) return
    let cancelled = false
    const controller = new AbortController()
    const load = () => {
      apiGet<PublicSite>('/public/site', controller.signal)
        .then((data) => !cancelled && setSite(data))
        .catch(() => undefined) // keep whatever we have (or the built-in content)
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      controller.abort()
      window.clearInterval(timer)
    }
  }, [])

  const value = useMemo(() => ({ site, links: siteLinks(site) }), [site])
  return <SiteDataContext.Provider value={value}>{children}</SiteDataContext.Provider>
}

export function useSiteData() {
  return useContext(SiteDataContext)
}
