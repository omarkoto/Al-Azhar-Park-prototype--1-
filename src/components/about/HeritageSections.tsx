import { motion, useReducedMotion } from 'framer-motion'
import { ARCH_PATH } from '../../lib/archPath'
import { useLanguage } from '../../lib/language'
import { Container } from '../ui/Container'
import { Eyebrow } from '../ui/SectionHeading'
import { Reveal } from '../ui/Reveal'
import { RosetteIcon } from '../ui/RosetteIcon'
import { LatticePattern } from '../ui/LatticePattern'
import azharMosque from '../../assets/images/wall-969-al-azhar-mosque.webp'
import babFutuh from '../../assets/images/wall-1087-bab-al-futuh.webp'
import ayyubidWall from '../../assets/images/wall-ayyubid-al-azhar-park.webp'

/** "Green lung" — a full-bleed statement band. */
function Lung() {
  const { content, lang } = useLanguage()
  const { greenLung } = content.about.heritage
  const reduceMotion = useReducedMotion()

  return (
    <section className="relative overflow-hidden bg-teal-900 py-24 text-sand-50 md:py-32">
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
    <section className="relative overflow-hidden py-20 md:py-28">
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

// One photograph per building phase (Wikimedia Commons). Credits are shown under each card.
const PHOTOS = [
  { src: azharMosque, position: '50% 28%', author: 'Tentoila', license: 'Public domain', url: 'https://commons.wikimedia.org/wiki/File:Al-Azhar_(inside)_2006.jpg' },
  { src: babFutuh, position: '20% 50%', author: 'Djehouty', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Cairo_-_Bab_al-Futuh_03.jpg' },
  { src: ayyubidWall, position: '80% 50%', author: 'R Prazeres', license: 'CC BY-SA 4.0', url: 'https://commons.wikimedia.org/wiki/File:Ayyubid_wall_Cairo_DSCF1591.jpg' },
]

/** The eastern city wall — three arched "gates", one per building phase, textured like the masonry itself. */
function Wall() {
  const { content, lang } = useLanguage()
  const { wall } = content.about.heritage
  const numerals = lang === 'ar' ? ['١', '٢', '٣'] : ['I', 'II', 'III']

  return (
    <section className="border-t border-ink-900/10 bg-sand-100 py-20 md:py-28">
      <Container>
        <Reveal className="max-w-3xl">
          <Eyebrow>{wall.eyebrow}</Eyebrow>
          <h2 className="font-display mt-4 text-3xl leading-tight font-medium text-ink-900 md:text-4xl">{wall.title}</h2>
          <p className="mt-5 text-base leading-relaxed text-ink-900/70 md:text-lg">{wall.lead}</p>
        </Reveal>

        <div className="relative mt-14 grid gap-14 md:grid-cols-3 md:gap-x-8 md:gap-y-0">
          {/* A single gold thread tying the three phases together */}
          <span className="pointer-events-none absolute inset-x-[16%] top-[7.5rem] hidden h-px bg-gradient-to-r from-gold-500/0 via-gold-500/60 to-gold-500/0 md:block" aria-hidden="true" />

          {wall.layers.map((layer, i) => {
            const photo = PHOTOS[i]
            return (
              <Reveal key={layer.year} delay={i * 0.12} className="md:row-span-6 md:grid md:grid-rows-subgrid">
                {/* Six shared rows (arch, title, text, caption, inscription, credit) so all three cards line up exactly */}
                <article className="group md:row-span-6 md:grid md:grid-rows-subgrid">
                  <div className="relative mx-auto w-full max-w-[17rem]">
                    <div
                      aria-hidden="true"
                      className="absolute -inset-2 bg-gradient-to-br from-gold-500 via-gold-600/90 to-gold-700"
                      style={{ clipPath: 'url(#arch-clip)' }}
                    />
                    <div
                      className="relative flex aspect-[3/4] w-full items-end justify-center overflow-hidden bg-teal-900"
                      style={{ clipPath: 'url(#arch-clip)' }}
                    >
                      <img
                        src={photo.src}
                        alt={layer.caption}
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-110"
                        style={{ objectPosition: photo.position }}
                      />
                      <span className="absolute inset-0 bg-gradient-to-t from-teal-950/85 via-teal-950/15 to-transparent" aria-hidden="true" />
                      <div className="relative pb-8 text-center">
                        <p className="font-display text-sm font-semibold tracking-[0.3em] text-gold-100/90">{numerals[i]}</p>
                        <p className="font-display mt-1 px-3 text-3xl font-medium text-sand-50 drop-shadow md:text-4xl">{layer.year}</p>
                      </div>
                    </div>
                  </div>

                  <h3 className="font-display mx-auto mt-9 w-full max-w-sm text-center text-xl leading-snug font-medium text-ink-900 md:text-[1.35rem]">{layer.title}</h3>
                  <p className="mx-auto mt-3 w-full max-w-sm text-center text-sm leading-relaxed text-ink-900/70 md:text-[15px]">{layer.body}</p>
                  <p className="mx-auto mt-4 w-full max-w-sm text-center text-[13px] italic leading-relaxed text-ink-900/55">{layer.caption}</p>

                  {/* Inscription band */}
                  <div className="mx-auto mt-8 w-full max-w-sm">
                    <div className="relative border-y border-gold-500/45 py-5">
                      <span className="absolute -top-[5px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-gold-500" aria-hidden="true" />
                      <span className="absolute -bottom-[5px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-gold-500" aria-hidden="true" />
                      <dl className="grid grid-cols-2 divide-x divide-gold-500/30 text-center rtl:divide-x-reverse">
                        <div className="px-3">
                          <dt className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold-700">{wall.builderLabel}</dt>
                          <dd className="font-display mt-2 text-base leading-snug text-teal-800">{layer.builder}</dd>
                        </div>
                        <div className="px-3">
                          <dt className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gold-700">{wall.materialLabel}</dt>
                          <dd className="font-display mt-2 text-base leading-snug text-teal-800">{layer.material}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>
                  <p className="mx-auto mt-4 w-full max-w-sm text-center text-[11px] text-ink-900/40">
                    {wall.photoLabel}:{' '}
                    <a href={photo.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-teal-700 hover:underline">
                      {photo.author} · {photo.license}
                    </a>
                  </p>
                </article>
              </Reveal>
            )
          })}
        </div>
      </Container>
    </section>
  )
}

export const HeritageSections = { Lung, History, Wall }
