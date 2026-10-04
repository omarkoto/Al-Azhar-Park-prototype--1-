import { useEffect, useState } from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { useContent, useLanguage } from '../lib/language'
import { ButtonLink } from './ui/Button'
import { Container } from './ui/Container'
import { CartButton } from './CartButton'
import { BrandMark } from './BrandMark'

export function Header() {
  const content = useContent()
  const { lang, toggleLang } = useLanguage()
  const { t } = useTranslation()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  return (
    <header className="sticky top-0 z-50 border-b border-ink-900/10 bg-sand-50/95 backdrop-blur">
      <Container className="flex h-20 items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-3 shrink-0">
          <BrandMark />
        </Link>

        <nav className="hidden items-center gap-5 xl:gap-7 xl:flex" aria-label={t('primaryNav')}>
          {content.nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                clsx(
                  'whitespace-nowrap text-sm font-medium transition-colors hover:text-teal-700',
                  isActive ? 'text-teal-700' : 'text-ink-900/75',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden shrink-0 items-center gap-3 xl:flex">
          <button
            type="button"
            onClick={toggleLang}
            className="whitespace-nowrap rounded-full border border-ink-900/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-900/70 transition-colors hover:border-teal-700 hover:text-teal-700"
            aria-label={t('switchLanguage')}
          >
            {lang === 'en' ? 'العربية' : 'English'}
          </button>
          <CartButton id="cart-icon-target-desktop" />
          <ButtonLink to="/tickets" className="whitespace-nowrap text-xs">
            {content.ticketsCta}
          </ButtonLink>
        </div>

        <div className="flex items-center gap-2 xl:hidden">
          <CartButton id="cart-icon-target-mobile" />
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-ink-900/15"
            aria-label={t('toggleMenu')}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="relative block h-3 w-4">
              <span
                className={clsx(
                  'absolute inset-x-0 top-0 h-px bg-ink-900 transition-transform',
                  open && 'translate-y-1.5 rotate-45',
                )}
              />
              <span className={clsx('absolute inset-x-0 top-1.5 h-px bg-ink-900 transition-opacity', open && 'opacity-0')} />
              <span
                className={clsx(
                  'absolute inset-x-0 top-3 h-px bg-ink-900 transition-transform',
                  open && '-translate-y-1.5 -rotate-45',
                )}
              />
            </span>
          </button>
        </div>
      </Container>

      {open ? (
        <div className="border-t border-ink-900/10 bg-sand-50 xl:hidden">
          <Container className="flex flex-col gap-1 py-4">
            {content.nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  clsx(
                    'rounded-lg px-3 py-3 text-base font-medium',
                    isActive ? 'bg-teal-50 text-teal-700' : 'text-ink-900/80',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
            <div className="mt-3 flex items-center gap-3 px-3">
              <button
                type="button"
                onClick={toggleLang}
                className="rounded-full border border-ink-900/15 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-900/70"
              >
                {lang === 'en' ? 'العربية' : 'English'}
              </button>
              <ButtonLink to="/tickets" className="flex-1 justify-center text-xs">
                {content.ticketsCta}
              </ButtonLink>
            </div>
          </Container>
        </div>
      ) : null}
    </header>
  )
}
