import { motion, useReducedMotion } from 'framer-motion'
import { ARCH_PATH } from '../../lib/archPath'
import { useLanguage } from '../../lib/language'
import { Container } from '../ui/Container'
import { Eyebrow } from '../ui/SectionHeading'
import { Reveal } from '../ui/Reveal'
import { RosetteIcon } from '../ui/RosetteIcon'
import { LatticePattern } from '../ui/LatticePattern'

/** "Green lung" — a full-bleed statement band. */
function Lung() {
  const { content, lang } = useLanguage()
  const { greenLung } = content.about.heritage
  const reduceMotion = useReducedMotion()

  return (
    <section className="relative overflow-hidden bg-teal-900 py-16 text-sand-50 md:py-24">
      <LatticePattern id="lung-lattice" className="text-gold-500/[0.07]" />

      {/* Slowly "breathing" rings behind the quote */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="absolute rounded-full border border-gold-500/25"
            style={{ width: 360 + i * 220, height: 360 + i * 220 }}
            animate={reduceMotion ? undefined : { scale: [1, 1.07, 1], opacity: [0.9, 0.45, 0.9] }}
            transition={{ duration: 7, delay: i * 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        ))}
      </div>

      <Container className="relative max-w-4xl text-center">
        <Reveal>
          <span className="inline-flex items-center gap-3">
            <RosetteIcon className="h-5 w-5 shrink-0 text-gold-500" />
            <Eyebrow tone="sand">{greenLung.eyebrow}</Eyebrow>
          </span>
        </Reveal>
        <Reveal delay={0.1}>
          <blockquote className="font-display mt-8 text-3xl leading-[1.25] font-medium text-sand-50 md:text-5xl">
            <span className="text-gold-500" aria-hidden="true">
              {lang === 'ar' ? '«' : '“'}
            </span>
            {greenLung.quote.replace(/^[“«]|[”»]$/g, '')}
            <span className="text-gold-500" aria-hidden="true">
              {lang === 'ar' ? '»' : '”'}
            </span>
          </blockquote>
        </Reveal>
        <Reveal delay={0.2}>
          <span className="mx-auto mt-8 block h-px w-24 bg-gold-500/60" aria-hidden="true" />
          <p className="mx-auto mt-8 max-w-2xl text-base leading-relaxed text-sand-100/80 md:text-lg">{greenLung.body}</p>
        </Reveal>
      </Container>
    </section>
  )
}

/**
 * A key fact on a doorway arch — the same arch as the Home page photos: a gold ring, a hairline of sand, a fine gold
 * line just inside the edge, and a soft light falling from the point of the arch.
 */
function FactArch({ value, label }: { value: string; label: string }) {
  return (
    <div className="group relative aspect-[3/4] drop-shadow-[0_10px_18px_rgba(10,37,31,0.14)] transition-all duration-500 hover:-translate-y-1.5 hover:drop-shadow-[0_18px_26px_rgba(10,37,31,0.22)] sm:aspect-[4/5]">
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-br from-gold-500 via-gold-600/90 to-gold-700 transition-[filter] duration-500 group-hover:brightness-110" style={{ clipPath: 'url(#arch-clip)' }} />
      <div aria-hidden="true" className="absolute inset-[3px] bg-sand-50" style={{ clipPath: 'url(#arch-clip)' }} />
      <div aria-hidden="true" className="absolute inset-[6px] bg-gradient-to-b from-gold-100/70 via-sand-100 to-sand-100" style={{ clipPath: 'url(#arch-clip)' }} />
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
        <path d={ARCH_PATH} transform="translate(0.035 0.04) scale(0.93 0.935)" fill="none" stroke="#cb9c4f" strokeOpacity="0.45" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-5 pt-[26%] text-center sm:px-6">
        <p className="font-display text-3xl font-medium text-teal-800 sm:text-4xl">{value}</p>
        <span aria-hidden="true" className="my-3 flex items-center gap-2 text-gold-600">
          <span className="h-px w-6 bg-gradient-to-r from-transparent to-gold-500/70" />
          <span className="h-1.5 w-1.5 rotate-45 bg-gold-500" />
          <span className="h-px w-6 bg-gradient-to-l from-transparent to-gold-500/70" />
        </span>
        <p className="text-xs leading-snug text-ink-900/70 sm:text-sm">{label}</p>
      </div>
    </div>
  )
}

/** History — narrative on one side, four arch-topped "plaques" of key facts on the other. */
function History() {
  const { content } = useLanguage()
  const { history } = content.about.heritage

  return (
    <section className="relative overflow-hidden py-14 md:py-20">
      <LatticePattern id="history-about-lattice" className="text-teal-900/[0.035]" />
      <Container className="relative grid items-center gap-14 md:grid-cols-[1.05fr_1fr] md:gap-20">
        <Reveal>
          <Eyebrow>{history.eyebrow}</Eyebrow>
          <h2 className="font-display mt-4 text-3xl leading-tight font-medium text-ink-900 md:text-4xl">{history.title}</h2>
          <p className="mt-6 text-base leading-relaxed text-ink-900/75 md:text-lg">{history.body}</p>
        </Reveal>

        <div className="grid grid-cols-2 gap-4 sm:gap-5">
          {history.facts.map((fact, i) => (
            <Reveal key={fact.value} delay={i * 0.08} className={i % 2 === 1 ? 'mt-8' : undefined}>
              <FactArch value={fact.value} label={fact.label} />
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  )
}

export const HeritageSections = { Lung, History }
