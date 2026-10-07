import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useContent } from '../lib/language'
import { useSeo } from '../lib/seo'
import { useAlt } from '../lib/alt'
import { Container } from '../components/ui/Container'
import { Eyebrow } from '../components/ui/SectionHeading'
import { Reveal } from '../components/ui/Reveal'
import { LatticePattern } from '../components/ui/LatticePattern'
import { RosetteIcon } from '../components/ui/RosetteIcon'
import { PageHero } from '../components/PageHero'
import { TicketBuilder } from '../components/TicketBuilder'
import { pounds, useBookingCatalog } from '../lib/booking'
import { useMoney } from '../lib/alt'
import { useTranslation } from 'react-i18next'
import ticketsHero from '../assets/images/tickets-hero-entrance.webp'

export function Tickets() {
  const content = useContent()
  const altText = useAlt()
  const { visit } = content
  useSeo({ title: visit.title, description: visit.lead, path: '/tickets' })
  const { t } = useTranslation()
  const money = useMoney()
  const { catalog } = useBookingCatalog('')
  // the price table shows the park's live prices (the same ones checkout uses); the built-in table is only the fallback
  const live = (groupIndex: number, rowIndex: number, kind: 'weekdayMinor' | 'weekendMinor'): string | null => {
    const audience = catalog?.audiences[groupIndex]
    const type = catalog?.ticketTypes[rowIndex]
    const cell = audience && type ? catalog?.priceList.find((p) => p.audience === audience.code && p.ticketType === type.code) : undefined
    const minor = cell?.[kind]
    return minor === null || minor === undefined ? null : money(pounds(minor))
  }

  return (
    <div>
      <PageHero
        eyebrow={visit.eyebrow}
        title={visit.title}
        lead={visit.lead}
        image={ticketsHero}
        imageAlt={altText('ticketsHero')}
      />

      {/* Buy tickets — the primary reason to be on this page */}
      <section className="bg-sand-100 py-20 md:py-28">
        <Container>
          <Reveal>
            <Eyebrow>{visit.ticketsTitle}</Eyebrow>
            <p className="mt-4 max-w-2xl rounded-xl border border-gold-500/30 bg-gold-100/40 px-5 py-4 text-sm leading-relaxed text-ink-900/70">
              {catalog ? t('bookPricesLive') : visit.ticketsNote}
            </p>
          </Reveal>

          <Reveal delay={0.1} className="mt-12">
            <TicketBuilder />
          </Reveal>
        </Container>
      </section>

      {/* Reference price table */}
      <section className="border-b border-ink-900/10 py-20 md:py-28">
        <Container>
          <div className="grid gap-8 md:grid-cols-2">
            {visit.ticketGroups.map((group, i) => (
              <Reveal
                key={group.title}
                delay={i * 0.08}
                className="overflow-hidden rounded-2xl border border-ink-900/10 bg-sand-100"
              >
                <div className="border-b border-ink-900/10 px-6 py-5">
                  <h3 className="font-display text-lg font-medium text-ink-900">{group.title}</h3>
                  <p className="mt-1 text-xs text-ink-900/50">{group.note}</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-ink-900/40">
                      <th className="px-6 py-3 text-start font-medium"> </th>
                      <th className="px-6 py-3 text-start font-medium">{visit.weekdayLabel}</th>
                      <th className="px-6 py-3 text-start font-medium">{visit.weekendLabel}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-900/10">
                    {group.rows.map((row, r) => (
                      <tr key={row.label}>
                        <td className="px-6 py-3 font-medium text-ink-900">{row.label}</td>
                        <td className="px-6 py-3 text-ink-900/75" dir="ltr">
                          {live(i, r, 'weekdayMinor') ?? row.weekday}
                        </td>
                        <td className="px-6 py-3 text-ink-900/75" dir="ltr">
                          {live(i, r, 'weekendMinor') ?? row.weekend}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 md:py-28">
        <Container className="grid gap-12 md:grid-cols-2">
          <Reveal>
            <Eyebrow>{visit.hoursTitle}</Eyebrow>
            <dl className="mt-6 divide-y divide-ink-900/10 rounded-2xl border border-ink-900/10">
              {visit.hours.map((row) => (
                <div key={row.label} className="flex items-center justify-between px-5 py-4">
                  <dt className="text-sm font-medium text-ink-900/70">{row.label}</dt>
                  <dd className="text-sm font-semibold text-ink-900" dir="ltr">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm leading-relaxed text-ink-900/60">{visit.hoursNote}</p>
          </Reveal>

          <Reveal delay={0.1}>
            <Eyebrow>{visit.gettingThereTitle}</Eyebrow>
            <p className="mt-6 text-base leading-relaxed text-ink-900/75">{visit.gettingThereBody}</p>
          </Reveal>
        </Container>
      </section>

      {/* Good to know + park instructions */}
      <section className="relative overflow-hidden border-t border-ink-900/10 py-20 md:py-28">
        <LatticePattern id="tickets-info-lattice" className="text-teal-900/[0.035]" />
        <Container className="relative">
          <Reveal>
            <Eyebrow>{visit.goodToKnowTitle}</Eyebrow>
          </Reveal>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {visit.goodToKnow.map((item, i) => (
              <Reveal key={item.title} delay={i * 0.07}>
                <div className="group h-full rounded-t-[999px] rounded-b-2xl border border-gold-500/35 bg-sand-100 px-6 pb-8 pt-12 text-center transition-all duration-300 hover:-translate-y-1 hover:border-gold-500/70 hover:shadow-lg hover:shadow-ink-900/10">
                  <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-700 text-sand-50 shadow-md">
                    <InfoIcon name={item.icon} />
                  </span>
                  <h3 className="font-display mt-5 text-lg font-medium text-ink-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-900/70">{item.body}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.1} className="mt-16 overflow-hidden rounded-3xl border border-gold-500/40 bg-teal-950 text-sand-50">
            <div className="relative px-8 py-10 md:px-14 md:py-14">
              <LatticePattern id="tickets-rules-lattice" className="text-gold-500/[0.07]" />
              <div className="relative grid gap-10 md:grid-cols-[minmax(0,320px)_1fr] md:gap-16">
                <div>
                  <RosetteIcon className="h-8 w-8 text-gold-500" />
                  <h2 className="font-display mt-5 text-3xl leading-tight font-medium">{visit.rulesTitle}</h2>
                  <p className="mt-4 text-base leading-relaxed text-sand-100/80">{visit.rulesIntro}</p>
                </div>
                <ul className="grid gap-x-10 gap-y-4 sm:grid-cols-2">
                  {visit.rules.map((rule) => (
                    <li key={rule} className="flex items-start gap-3 text-sm leading-relaxed text-sand-100/90">
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gold-500/60 text-gold-500">
                        <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                          <path d="M5 5l10 10M15 5L5 15" />
                        </svg>
                      </span>
                      {rule}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
        </Container>
      </section>

      <section className="border-t border-ink-900/10 bg-sand-100 py-20 md:py-28">
        <Container>
          <Reveal>
            <Eyebrow>{visit.amenitiesTitle}</Eyebrow>
          </Reveal>
          <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-ink-900/10 bg-ink-900/10 sm:grid-cols-2 lg:grid-cols-5">
            {visit.amenities.map((item, i) => (
              <Reveal key={item.title} delay={(i % 5) * 0.05} className="bg-sand-50 p-6">
                <h3 className="text-sm font-semibold text-ink-900">{item.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-ink-900/60">{item.body}</p>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-ink-900/10 py-20 md:py-28">
        <Container className="max-w-3xl">
          <Reveal>
            <Eyebrow>{visit.faqTitle}</Eyebrow>
          </Reveal>
          <div className="mt-10 space-y-4">
            {visit.faqs.map((faq, i) => (
              <FaqCard key={faq.q} faq={faq} index={i} defaultOpen={i === 0} />
            ))}
          </div>
        </Container>
      </section>
    </div>
  )
}

function InfoIcon({ name }: { name: 'parking' | 'camera' | 'metro' | 'bus' }) {
  const common = { viewBox: '0 0 24 24', className: 'h-5 w-5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  if (name === 'parking')
    return (
      <svg {...common}>
        <rect x="4" y="4" width="16" height="16" rx="3" />
        <path d="M9.5 16.5v-9h3.2a2.6 2.6 0 0 1 0 5.2H9.5" />
      </svg>
    )
  if (name === 'camera')
    return (
      <svg {...common}>
        <path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3V18H4Z" />
        <circle cx="12" cy="13" r="3.2" />
      </svg>
    )
  if (name === 'metro')
    return (
      <svg {...common}>
        <rect x="5.5" y="3.5" width="13" height="13" rx="3" />
        <path d="M5.5 11h13M9 20l1.6-3.5M15 20l-1.6-3.5" />
        <circle cx="9" cy="13.8" r=".6" fill="currentColor" />
        <circle cx="15" cy="13.8" r=".6" fill="currentColor" />
      </svg>
    )
  return (
    <svg {...common}>
      <rect x="4" y="4" width="16" height="12.5" rx="2.5" />
      <path d="M4 10h16M7 20v-3.5M17 20v-3.5" />
      <circle cx="8" cy="13.4" r=".6" fill="currentColor" />
      <circle cx="16" cy="13.4" r=".6" fill="currentColor" />
    </svg>
  )
}

function FaqCard({ faq, index, defaultOpen }: { faq: { q: string; a: string }; index: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <Reveal delay={index * 0.05}>
      <div
        className={`overflow-hidden rounded-2xl border transition-colors ${open ? 'border-gold-500/40 bg-gold-100/25' : 'border-ink-900/10 bg-sand-50'}`}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-4 px-6 py-5 text-start"
          aria-expanded={open}
        >
          <span
            className={`font-display flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors ${open ? 'bg-teal-700 text-sand-50' : 'bg-teal-50 text-teal-800'}`}
          >
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="flex-1 text-base font-medium text-ink-900">{faq.q}</span>
          <motion.span
            animate={{ rotate: open ? 45 : 0 }}
            transition={{ duration: 0.25 }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink-900/20 text-ink-900/60"
          >
            +
          </motion.span>
        </button>
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <p className="px-6 pb-6 ps-[4.25rem] text-sm leading-relaxed text-ink-900/65">{faq.a}</p>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </Reveal>
  )
}
