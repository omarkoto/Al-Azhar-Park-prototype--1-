import { useEffect } from 'react'
import { useLanguage } from './language'

// TODO: replace with the real production domain once the site has one —
// canonical/OG URLs are meaningless placeholders until then.
const SITE_URL = 'https://www.azharpark.com'
const SITE_NAME_EN = 'Al-Azhar Park'
const SITE_NAME_AR = 'حديقة الأزهر'

interface SeoOptions {
  title: string
  description: string
  path: string
}

export function useSeo({ title, description, path }: SeoOptions) {
  const { lang } = useLanguage()

  useEffect(() => {
    const siteName = lang === 'ar' ? SITE_NAME_AR : SITE_NAME_EN
    const fullTitle = title === siteName ? title : `${title} — ${siteName}`
    const url = `${SITE_URL}${path}`

    document.title = fullTitle
    setMeta('description', description)
    setMeta('og:title', fullTitle, true)
    setMeta('og:description', description, true)
    setMeta('og:type', 'website', true)
    setMeta('og:url', url, true)
    setMeta('og:locale', lang === 'ar' ? 'ar_EG' : 'en_US', true)
    setMeta('twitter:card', 'summary_large_image')
    setMeta('twitter:title', fullTitle)
    setMeta('twitter:description', description)
    setCanonical(url)
  }, [title, description, path, lang])
}

function setMeta(name: string, content: string, isProperty = false) {
  const attr = isProperty ? 'property' : 'name'
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, name)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function setCanonical(url: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!link) {
    link = document.createElement('link')
    link.setAttribute('rel', 'canonical')
    document.head.appendChild(link)
  }
  link.setAttribute('href', url)
}
