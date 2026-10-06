import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { contentByLang, type Lang, type SiteContent } from '../content'
import { applyEvents } from '../content/eventData'
import { applyRestaurants } from '../content/restaurantData'
import { applySiteData } from '../content/siteData'
import { useSiteData } from './siteData'

interface LanguageContextValue {
  lang: Lang
  dir: 'ltr' | 'rtl'
  content: SiteContent
  toggleLang: () => void
  setLang: (lang: Lang) => void
}

const LanguageContext = createContext<LanguageContextValue | null>(null)
const STORAGE_KEY = 'azharpark-lang'

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const { site, restaurants, comingSoonEvents } = useSiteData()
  const lang: Lang = i18n.language === 'ar' ? 'ar' : 'en'
  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = dir
    window.localStorage.setItem(STORAGE_KEY, lang)
  }, [lang, dir])

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      dir,
      content: applyEvents(applyRestaurants(applySiteData(contentByLang[lang], site, lang), restaurants, lang), comingSoonEvents, lang),
      toggleLang: () => {
        void i18n.changeLanguage(lang === 'en' ? 'ar' : 'en')
      },
      setLang: (l: Lang) => {
        void i18n.changeLanguage(l)
      },
    }),
    [lang, dir, i18n, site, restaurants, comingSoonEvents],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider')
  return ctx
}

export function useContent() {
  return useLanguage().content
}
