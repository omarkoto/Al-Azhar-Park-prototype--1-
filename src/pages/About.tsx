import { useLanguage } from '../lib/language'
import { useAlt } from '../lib/alt'
import { useSeo } from '../lib/seo'
import { Container } from '../components/ui/Container'
import { Eyebrow } from '../components/ui/SectionHeading'
import { Reveal } from '../components/ui/Reveal'
import { Prose } from '../components/ui/Prose'
import { HeroMedia } from '../components/ui/HeroMedia'
import { RosetteIcon } from '../components/ui/RosetteIcon'
import { AnimatedLogoMark } from '../components/ui/AnimatedLogoMark'
import { LatticePattern } from '../components/ui/LatticePattern'
import { CornerAccents } from '../components/ui/CornerAccents'
import { TimelinePortrait } from '../components/TimelinePortrait'
import { HeritageSections } from '../components/about/HeritageSections'

import historyRubbleBefore from '../assets/images/history-rubble-before.webp'
import transformationBefore from '../assets/images/about-before-darassa-aerial.jpg'
import wallImage from '../assets/images/wall-ayyubid-al-azhar-park.webp'
import designTerraces from '../assets/images/venue-garden-aerial-citadel.jpg'
import designFountain from '../assets/images/venue-garden-steps-sunset.jpg'
import designSunken from '../assets/images/venue-sunken-garden.webp'
import designPavilion from '../assets/images/about-arches-night.jpg'
import transformationGarden from '../assets/images/about-after-park-aerial.jpg'
import recognitionImage from '../assets/images/recognition-lake-pavilion.webp'
import heroImage from '../assets/images/about-hero-fountain-plaza.jpg'
import historySkyline from '../assets/images/history-skyline.webp'
import agaKhanVisit from '../assets/images/timeline-aga-khan.webp'
import visitorInfoGarden from '../assets/images/visitor-info-garden.webp'
import restaurantsHeroTerrace from '../assets/images/restaurants-hero-terrace.webp'

// Ordered to match content.about.timeline: 1984, 1990, 1996–97, the wall, 2005, Today
const timelineImages = [agaKhanVisit, historySkyline, historyRubbleBefore, wallImage, visitorInfoGarden, restaurantsHeroTerrace]
// Ordered to match content.about.design.items
const designImages = [designTerraces, designFountain, designSunken, designPavilion]

export function About() {
  const { content, lang } = useLanguage()
  const altText = useAlt()
  const { about } = content
  useSeo({ title: about.title, description: about.lead, path: '/about' })

  const [firstPara, ...restParas] = about.body.split('\n\n')
  const dropCap = lang === 'en' && firstPara.length > 1

  return (
    <div>
      {/* Hero */}
      <section className="relative flex min-h-[62vh] items-end overflow-hidden bg-teal-950 text-sand-50 md:min-h-[72vh]">
        <HeroMedia
          image={heroImage}
          alt={altText('aboutHero')}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-teal-950/70 via-teal-950/20 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-teal-950/55 via-teal-950/10 to-transparent" />
        <div className="pointer-events-none absolute inset-4 hidden rounded-sm border border-sand-50/15 md:inset-6 md:block" aria-hidden="true" />

        <Container className="relative py-14 md:py-20">
          <Reveal>
            <span className="inline-flex items-center gap-3">
              <RosetteIcon className="h-5 w-5 shrink-0 text-gold-500" />
              <Eyebrow tone="sand">{about.eyebrow}</Eyebrow>
            </span>
          </Reveal>
          <Reveal delay={0.08}>
            <h1 className="font-display mt-5 max-w-2xl text-4xl leading-[1.1] font-medium md:text-5xl lg:text-6xl">{about.title}</h1>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-sand-100/85 md:text-lg">{about.lead}</p>
          </Reveal>
          <Reveal delay={0.24}>
            <div className="mt-8 inline-flex items-center gap-3 rounded-full border border-gold-500/40 bg-teal-950/50 px-5 py-2.5 backdrop-blur-sm">
              <span className="font-display text-base font-medium text-gold-100 md:text-lg">{content.stats[1].value}</span>
              <span className="h-3 w-px bg-gold-500/50" aria-hidden="true" />
              <span className="font-display text-base font-medium text-gold-100 md:text-lg">{content.stats[2].value}</span>
            </div>
          </Reveal>
        </Container>
      </section>

      {/* Lead narrative */}
      <section className="relative overflow-hidden py-14 md:py-20">
        <LatticePattern id="about-body-lattice" className="text-teal-900/[0.035]" />
        <Container className="relative">
          <div className="grid gap-8 md:grid-cols-[minmax(0,220px)_1fr] md:gap-16">
            <Reveal className="flex flex-row items-center gap-4 md:flex-col md:items-start md:gap-6">
              <AnimatedLogoMark className="h-20 w-20 shrink-0 md:h-28 md:w-28" />
              <span className="h-px flex-1 bg-ink-900/10 md:h-auto md:w-px md:flex-1" aria-hidden="true" />
            </Reveal>
            <Reveal delay={0.1}>
              <p className="text-base leading-relaxed text-ink-900/80 md:text-lg">
                {dropCap ? (
                  <>
                    <span className="font-display float-start me-3 mt-1 text-6xl leading-[0.82] font-medium text-teal-800 md:text-7xl">
                      {firstPara[0]}
                    </span>
                    {firstPara.slice(1)}
                  </>
                ) : (
                  firstPara
                )}
              </p>
              {restParas.length ? <Prose text={restParas.join('\n\n')} className="mt-4 space-y-4 text-base leading-relaxed text-ink-900/80 md:text-lg" /> : null}
            </Reveal>
          </div>
        </Container>
      </section>

      <HeritageSections.Lung />
      <HeritageSections.History />

      {/* Before and after */}
      <section className="relative overflow-hidden bg-teal-950 py-14 text-sand-50 md:py-20">
        <LatticePattern id="about-transform-lattice" className="text-gold-500/[0.07]" />
        <Container className="relative">
          <Reveal className="mx-auto max-w-2xl text-center">
            <Eyebrow tone="sand">{about.eyebrow}</Eyebrow>
            <h2 className="font-display mt-4 text-3xl leading-tight font-medium md:text-5xl">{about.transformationTitle}</h2>
          </Reveal>

          <Reveal delay={0.1} className="mt-12 grid gap-8 md:grid-cols-2 md:gap-10">
            {[
              { src: transformationBefore, label: about.beforeLabel, caption: about.transformationBefore, muted: false },
              { src: transformationGarden, label: about.afterLabel, caption: about.transformationAfter, muted: false },
            ].map((panel) => (
              <figure key={panel.label}>
                <div className="relative">
                  <div aria-hidden="true" className="absolute -inset-2 rounded-[1.75rem] bg-gradient-to-br from-gold-500 via-gold-600/90 to-gold-700" />
                  <div className="relative overflow-hidden rounded-3xl">
                    <img src={panel.src} alt={panel.caption} loading="lazy" className={`aspect-[4/3] w-full object-cover ${panel.muted ? 'sepia-[0.55] saturate-75' : ''}`} />
                    <span className="absolute start-4 top-4 rounded-full bg-teal-950/85 px-4 py-1.5 font-display text-xs font-semibold tracking-[0.2em] text-gold-100 uppercase backdrop-blur-sm">{panel.label}</span>
                  </div>
                </div>
                <figcaption className="mt-6 text-center text-sm leading-relaxed text-sand-100/75">{panel.caption}</figcaption>
              </figure>
            ))}
          </Reveal>

          <Reveal delay={0.15} className="mx-auto mt-12 max-w-3xl text-center">
            <p className="text-base leading-relaxed text-sand-100/85 md:text-lg">{about.transformationBody}</p>
          </Reveal>

          <Reveal delay={0.2}>
            <dl className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-y-8 border-t border-sand-50/15 pt-10 md:grid-cols-4">
              {about.numbers.map((n) => (
                <div key={n.label} className="px-3 text-center">
                  <dt className="font-display text-3xl font-medium text-gold-100 md:text-4xl">{n.value}</dt>
                  <dd className="mt-2 text-xs leading-snug text-sand-100/70 md:text-sm">{n.label}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </Container>
      </section>

      {/* Design — what the gardens are made of */}
      <section className="relative overflow-hidden py-14 md:py-20">
        <LatticePattern id="about-design-lattice" className="text-teal-900/[0.035]" />
        <Container className="relative">
          <Reveal className="max-w-2xl">
            <Eyebrow>{about.design.eyebrow}</Eyebrow>
            <h2 className="font-display mt-4 text-3xl leading-tight font-medium text-ink-900 md:text-4xl">{about.design.title}</h2>
            <p className="mt-4 text-base leading-relaxed text-ink-900/70 md:text-lg">{about.design.lead}</p>
          </Reveal>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {about.design.items.map((item, i) => (
              <Reveal key={item.title} delay={i * 0.07}>
                <article className="group h-full overflow-hidden rounded-2xl border border-gold-500/25 bg-sand-50 shadow-sm transition-shadow duration-300 hover:shadow-xl hover:shadow-ink-900/10">
                  <div className="aspect-[4/3] overflow-hidden">
                    <img src={designImages[i]} alt={item.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  </div>
                  <div className="p-5">
                    <span className="mb-3 block h-0.5 w-8 rounded bg-gold-500" aria-hidden="true" />
                    <h3 className="font-display text-lg font-medium text-teal-900">{item.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-ink-900/70">{item.body}</p>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-14 md:py-20">
        <Container>
          <Reveal>
            <Eyebrow>{about.timelineTitle}</Eyebrow>
          </Reveal>

          <ol className="mt-10 border-s-2 border-teal-700/25 ps-8">
            {about.timeline.map((event, i) => (
              <Reveal key={event.year} delay={i * 0.06} className="relative pb-12 last:pb-0">
                <span className="absolute -start-[2.55rem] top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-teal-700 bg-sand-50">
                  <span className="h-2 w-2 rounded-full bg-teal-700" />
                </span>
                <div className="flex items-start gap-5 sm:gap-6">
                  <TimelinePortrait src={timelineImages[i]} alt={event.title} delay={i * 0.06 + 0.15} />
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="font-display text-xl font-medium text-teal-800">{event.year}</p>
                    <p className="mt-1 text-base font-semibold text-ink-900">{event.title}</p>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-900/70 md:text-base">{event.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </ol>
        </Container>
      </section>

      <section className="border-t border-ink-900/10 bg-sand-100 py-14 md:py-20">
        <Container className="grid items-center gap-12 md:grid-cols-2">
          <Reveal className="relative">
            <div className="relative overflow-hidden rounded-2xl ring-1 ring-gold-500/25">
              <img src={recognitionImage} alt={altText('aboutRecognition')} className="w-full" />
            </div>
            <CornerAccents />
          </Reveal>
          <Reveal delay={0.1}>
            <Eyebrow>{about.recognitionTitle}</Eyebrow>
            <p className="mt-5 text-base leading-relaxed text-ink-900/75 md:text-lg">{about.recognitionBody}</p>
          </Reveal>
        </Container>
      </section>
    </div>
  )
}
