import { Link } from 'react-router-dom'
import { useContent } from '../lib/language'
import { useTranslation } from 'react-i18next'
import { DIRECTIONS_URL, telHref } from '../lib/location'
import { Container } from './ui/Container'
import { BrandMark } from './BrandMark'

export function Footer() {
  const content = useContent()
  const { t } = useTranslation()
  const year = new Date().getFullYear()

  return (
    <footer className="bg-teal-950 text-sand-100">
      <Container className="grid gap-10 py-16 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
        <div>
          <Link to="/" className="flex items-center gap-3">
            <BrandMark tone="inverted" size="sm" />
          </Link>
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-sand-100/70">{content.footer.tagline}</p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-100">{t('explore')}</h3>
          <ul className="mt-4 space-y-3 text-sm text-sand-100/80">
            {content.nav.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className="transition-colors hover:text-sand-50">
                  {item.to === '/events' ? t('eventsFull') : item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-100">{content.contact.eyebrow}</h3>
          <ul className="mt-4 space-y-3 text-sm text-sand-100/80">
            <li>
              <a href={DIRECTIONS_URL} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-sand-50">
                {content.contact.address}
              </a>
            </li>
            {content.contact.phones.map((phone) => (
              <li key={phone} dir="ltr" className="text-start">
                <a href={telHref(phone)} className="transition-colors hover:text-sand-50">
                  {phone}
                </a>
              </li>
            ))}
            <li dir="ltr" className="text-start text-sand-100/65">
              {content.contact.faxLabel}: {content.contact.fax}
            </li>
            <li>
              <a href={`mailto:${content.contact.email}`} className="transition-colors hover:text-sand-50">
                {content.contact.email}
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-100">{content.contact.socialTitle}</h3>
          <div className="mt-4 flex gap-3">
            <SocialIcon label="Facebook">
              <path d="M13.5 9H15V6.5h-1.6C11.3 6.5 10 7.9 10 9.9V11H8.5v2.5H10V19h2.5v-5.5H14l.5-2.5h-2V10c0-.6.3-1 1-1Z" />
            </SocialIcon>
            <SocialIcon label="Instagram">
              <rect x="5" y="5" width="14" height="14" rx="4" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <circle cx="16.2" cy="7.8" r="0.9" />
            </SocialIcon>
          </div>
        </div>
      </Container>

      <div className="border-t border-sand-100/10 py-6">
        <Container className="flex flex-col items-center justify-between gap-2 text-xs text-sand-100/60 sm:flex-row">
          <p>
            © {year} {content.meta.title}. {content.footer.rights}
          </p>
        </Container>
      </div>
    </footer>
  )
}

function SocialIcon({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <a
      href="#"
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-full border border-sand-100/20 text-sand-100/80 transition-colors hover:border-sand-50 hover:text-sand-50"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        {children}
      </svg>
    </a>
  )
}
