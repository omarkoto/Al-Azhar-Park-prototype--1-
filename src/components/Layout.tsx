import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Header } from './Header'
import { Footer } from './Footer'
import { SvgDefs } from './ui/SvgDefs'
import { CartDrawer } from './CartDrawer'

export function Layout() {
  const location = useLocation()
  const { t } = useTranslation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [location.pathname])

  return (
    <div className="flex min-h-screen flex-col">
      <SvgDefs />
      <a
        href="#main-content"
        className="sr-only rounded-full bg-teal-700 px-5 py-3 text-sm font-semibold text-sand-50 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]"
      >
        {t('skipToContent')}
      </a>
      <Header />
      <main id="main-content" className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <CartDrawer />
    </div>
  )
}
