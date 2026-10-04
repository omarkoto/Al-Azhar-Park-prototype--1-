import { useLanguage } from '../lib/language'
import { useAlt } from '../lib/alt'
import { useSeo } from '../lib/seo'
import { Container } from '../components/ui/Container'
import { Eyebrow } from '../components/ui/SectionHeading'
import { Reveal } from '../components/ui/Reveal'
import { Prose } from '../components/ui/Prose'
import { HeroMedia } from '../components/ui/HeroMedia'
import { RosetteIcon } from '../components/ui/RosetteIcon'
import { LatticePattern } from '../components/ui/LatticePattern'
import { CornerAccents } from '../components/ui/CornerAccents'
import { TimelinePortrait } from '../components/TimelinePortrait'
import { HeritageSections } from '../components/about/HeritageSections'

import historyRubbleBefore from '../assets/images/history-rubble-before.webp'
import transformationAerial from '../assets/images/hero-lake-aerial.webp'
import transformationColonnade from '../assets/images/about-hero-colonnade.webp'
import transformationGarden from '../assets/images/history-lake-after.webp'
import recognitionImage from '../assets/images/recognition-lake-pavilion.webp'
import heroImage from '../assets/images/about-hero-promenade.webp'
import historySkyline from '../assets/images/history-skyline.webp'
import historyMonuments from '../assets/images/history-monuments-collage.jpg'
import agaKhanVisit from '../assets/images/timeline-aga-khan.webp'
import visitorInfoGarden from '../assets/images/visitor-info-garden.webp'
import restaurantsHeroTerrace from '../assets/images/restaurants-hero-terrace.webp'

// Ordered to match content.about.timeline: 969, 12th–13th c., 1984, 1990s, 2005, Today
const timelineImages = [historySkyline, historyMonuments, agaKhanVisit, historyRubbleBefore, visitorInfoGarden, restaurantsHeroTerrace]

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
        <div className="absolute inset-0 bg-gradient-to-t from-teal-950/60 via-teal-950/15 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-teal-950/25 via-transparent to-transparent" />
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
      <section className="relative overflow-hidden py-20 md:py-28">
        <LatticePattern id="about-body-lattice" className="text-teal-900/[0.035]" />
        <Container className="relative">
          <div className="grid gap-8 md:grid-cols-[minmax(0,220px)_1fr] md:gap-16">
            <Reveal className="flex flex-row items-center gap-4 md:flex-col md:items-start md:gap-6">
              <RosetteIcon className="h-8 w-8 shrink-0 text-gold-600/70" />
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

      {/* Transformation */}
      <section className="border-y border-ink-900/10 bg-teal-950 py-20 text-sand-50 md:py-28">
        <Container>
          <Reveal className="max-w-2xl">
            <Eyebrow tone="sand">{about.transformationTitle}</Eyebrow>
          </Reveal>
          <Reveal delay={0.1} className="mt-8 grid gap-4 sm:grid-cols-[1.3fr_1fr]">
            <div className="relative overflow-hidden rounded-2xl ring-1 ring-gold-500/25">
              <img
                src={transformationAerial}
                alt={about.transformationAfter}
                className="aspect-[4/3] w-full object-cover sm:aspect-auto sm:h-full"
              />
              <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-sand-50/10" aria-hidden="true" />
              <CornerAccents />
            </div>
            <div className="grid gap-4">
              <div className="relative overflow-hidden rounded-2xl ring-1 ring-gold-500/25">
                <img
                  src={transformationColonnade}
                  alt={altText('aboutColonnade')}
                  className="aspect-[4/3] w-full object-cover"
                />
              </div>
              <div className="relative overflow-hidden rounded-2xl ring-1 ring-gold-500/25">
                <img
                  src={transformationGarden}
                  alt={altText('aboutGarden')}
                  className="aspect-[4/3] w-full object-cover"
                />
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.2} className="mt-10 max-w-2xl border-t border-sand-50/15 pt-8">
            <p className="text-base leading-relaxed text-sand-100/85 md:text-lg">{about.transformationBody}</p>
          </Reveal>
        </Container>
      </section>

      <HeritageSections.Wall />

      <section className="py-20 md:py-28">
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

      <section className="border-t border-ink-900/10 bg-sand-100 py-20 md:py-28">
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
