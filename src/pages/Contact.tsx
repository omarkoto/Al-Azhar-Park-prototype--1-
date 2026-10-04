import { useState, type FormEvent } from 'react'
import { useLanguage } from '../lib/language'
import { useAlt, useCredit } from '../lib/alt'
import { DIRECTIONS_URL, MAPS_URL, mapEmbedUrl, telHref } from '../lib/location'
import { useSeo } from '../lib/seo'
import { Container } from '../components/ui/Container'
import { Reveal } from '../components/ui/Reveal'
import { PageHero } from '../components/PageHero'
import { Button, ExternalLink } from '../components/ui/Button'
import heroImage from '../assets/images/contact-hero-banner.webp'

export function Contact() {
  const { content, lang } = useLanguage()
  const altText = useAlt()
  const credit = useCredit()
  const { contact } = content
  useSeo({ title: contact.title, description: contact.lead, path: '/contact' })
  const [sent, setSent] = useState(false)

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSent(true)
  }

  return (
    <div>
      <PageHero eyebrow={contact.eyebrow} title={contact.title} lead={contact.lead} image={heroImage}
        imageAlt={altText('contactHero')}
        credit={{ text: credit('Djehouty', 'CC BY-SA 4.0'), href: 'https://commons.wikimedia.org/wiki/File:Al-Azhar-Park_2016-03-28e.jpg' }}
      />

      <section className="py-20 md:py-28">
        <Container className="grid gap-14 md:grid-cols-[1fr_1.2fr]">
          <Reveal className="space-y-8">
            <InfoRow label={contact.addressLabel} value={contact.address} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">{contact.phoneLabel}</p>
              <div className="mt-2 space-y-1">
                {contact.phones.map((phone) => (
                  <a key={phone} href={telHref(phone)} dir="ltr" className="block text-base font-medium text-ink-900 hover:text-teal-700">
                    {phone}
                  </a>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">{contact.faxLabel}</p>
              <p dir="ltr" className="mt-2 text-start text-base font-medium text-ink-900">
                {contact.fax}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">{contact.emailLabel}</p>
              <a href={`mailto:${contact.email}`} className="mt-2 block text-base font-medium text-ink-900 hover:text-teal-700">
                {contact.email}
              </a>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">{contact.mapTitle}</p>
              <div className="mt-3 overflow-hidden rounded-2xl border border-ink-900/10 shadow-sm">
                <iframe
                  title={contact.mapTitle}
                  src={mapEmbedUrl(lang)}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                  className="block h-72 w-full border-0"
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <ExternalLink href={DIRECTIONS_URL} target="_blank" rel="noopener noreferrer" className="text-xs">
                  {contact.getDirections}
                </ExternalLink>
                <ExternalLink href={MAPS_URL} target="_blank" rel="noopener noreferrer" variant="ghost" className="border-ink-900/20 text-xs text-ink-900">
                  {contact.openInMaps}
                </ExternalLink>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.1} className="rounded-2xl border border-ink-900/10 bg-sand-100 p-8">
            <h2 className="font-display text-2xl font-medium text-ink-900">{contact.formTitle}</h2>

            {sent ? (
              <p className="mt-6 rounded-xl bg-teal-50 px-5 py-4 text-sm text-teal-800">{contact.formSuccess}</p>
            ) : (
              <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
                <Field label={contact.formName} name="name" type="text" />
                <Field label={contact.formEmail} name="email" type="email" />
                <div>
                  <label htmlFor="message" className="text-xs font-semibold uppercase tracking-wide text-ink-900/50">
                    {contact.formMessage}
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    rows={5}
                    required
                    className="mt-2 w-full rounded-xl border border-ink-900/15 bg-sand-50 px-4 py-3 text-sm text-ink-900 outline-none transition-colors focus:border-teal-700"
                  />
                </div>
                <Button type="submit" className="w-full sm:w-auto">
                  {contact.formSubmit}
                </Button>
                <p className="text-xs text-ink-900/45">{contact.formNote}</p>
              </form>
            )}
          </Reveal>
        </Container>
      </section>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/50">{label}</p>
      <p className="mt-2 text-base font-medium text-ink-900">{value}</p>
    </div>
  )
}

function Field({ label, name, type }: { label: string; name: string; type: string }) {
  return (
    <div>
      <label htmlFor={name} className="text-xs font-semibold uppercase tracking-wide text-ink-900/50">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required
        className="mt-2 w-full rounded-xl border border-ink-900/15 bg-sand-50 px-4 py-3 text-sm text-ink-900 outline-none transition-colors focus:border-teal-700"
      />
    </div>
  )
}
