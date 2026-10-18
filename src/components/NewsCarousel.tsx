import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { useLanguage } from '../lib/language'
import { resolveImage } from '../lib/imageMap'
import { useCarousel } from '../lib/useCarousel'
import { Container } from './ui/Container'
import { SectionHeading } from './ui/SectionHeading'
import type { NewsItem } from '../content/types'

export function NewsCarousel() {
  const { content } = useLanguage()
  const { t } = useTranslation()
  const { newsSection } = content
  const items = newsSection.items

  const { trackRef, setItemRef, activeIndex, progress, setPaused, next, prev, goTo, handleKeyDown } = useCarousel({
    length: items.length,
    intervalMs: 4000,
  })

  if (items.length === 0) return null

  const slides = items.length > 1 ? [...items, items[0]] : items

  return (
    <section className="border-y border-ink-900/10 bg-sand-100 py-8 md:py-12">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionHeading eyebrow={newsSection.eyebrow} title={newsSection.title} body={newsSection.body} className="max-w-xl" />
          <div className="flex items-center gap-4">
            <Link to="/news" className="hidden items-center gap-2 border-b border-teal-700 pb-1 text-sm font-semibold text-teal-700 md:inline-flex">
              {newsSection.viewAll}
              <NextIcon className="h-4 w-4" />
            </Link>
            {items.length > 1 ? (
              <div className="hidden items-center gap-3 md:flex">
                <SpotlightArrow direction="prev" onClick={prev} />
                <SpotlightArrow direction="next" onClick={next} />
              </div>
            ) : null}
          </div>
        </div>

        <div
          ref={trackRef}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="region"
          aria-roledescription="carousel"
          aria-label={newsSection.title}
          className="relative mt-10 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-2 outline-none [-ms-overflow-style:none] [scrollbar-width:none] md:mt-14 md:gap-6 [&::-webkit-scrollbar]:hidden"
          style={{ overflowAnchor: 'none' }}
        >
          {slides.map((item, i) => {
            const isClone = i >= items.length
            return (
              <NewsCard
                key={isClone ? `${item.id}-clone` : item.id}
                item={item}
                setRef={setItemRef(i)}
                cta={newsSection.cta}
                inert={isClone}
                position={(isClone ? 0 : i) + 1}
                total={items.length}
              />
            )
          })}
        </div>

        {items.length > 1 ? (
          <div className="mt-7 flex items-center justify-center gap-2.5">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={t('goToSlide', { n: i + 1 })}
                aria-current={activeIndex === i}
                className="relative h-1 w-8 overflow-hidden rounded-full bg-ink-900/10 transition-colors hover:bg-ink-900/20"
              >
                {activeIndex === i ? (
                  <span className="absolute inset-y-0 start-0 bg-teal-700" style={{ width: `${progress}%` }} />
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        <Link to="/news" className="mt-7 flex items-center justify-center gap-2 text-sm font-semibold text-teal-700 md:hidden">
          {newsSection.viewAll}
          <NextIcon className="h-4 w-4" />
        </Link>
      </Container>
    </section>
  )
}

function NewsCard({
  item,
  setRef,
  cta,
  inert,
  position,
  total,
}: {
  item: NewsItem
  setRef: (el: HTMLElement | null) => void
  cta: string
  inert: boolean
  position: number
  total: number
}) {
  return (
    <Link
      to={`/news/${item.slug}`}
      ref={setRef}
      aria-hidden={inert || undefined}
      tabIndex={inert ? -1 : undefined}
      aria-roledescription="slide"
      aria-label={`${position} / ${total}`}
      className="group relative block w-[78%] shrink-0 snap-center sm:w-[46%] lg:w-[31%]"
      style={{
        opacity: 'calc(0.55 + 0.45 * var(--carousel-ratio, 1))',
      }}
    >
      <div className="overflow-hidden rounded-2xl bg-sand-50 shadow-sm shadow-ink-900/5 ring-1 ring-ink-900/5 transition-shadow duration-300 group-hover:shadow-lg">
        <div className="relative aspect-[16/10] w-full overflow-hidden">
          <img
            src={resolveImage(item.image)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          />
          <span className="absolute start-3 top-3 inline-flex items-center rounded-full bg-sand-50/95 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-teal-800">
            {item.category}
          </span>
        </div>
        <div className="p-5">
          {item.date ? (
            <p className="text-xs text-ink-900/45" dir="ltr">
              {item.date}
            </p>
          ) : null}
          <h3 className="font-display mt-1.5 line-clamp-2 text-base font-medium leading-snug text-ink-900 transition-colors group-hover:text-teal-700">
            {item.title}
          </h3>
          <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-900/60">{item.excerpt}</p>
          <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700">
            {cta}
            <NextIcon className="h-3 w-3 transition-transform duration-300 group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
          </span>
        </div>
      </div>
    </Link>
  )
}

function SpotlightArrow({ direction, onClick }: { direction: 'prev' | 'next'; onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t(direction === 'next' ? 'next' : 'previous')}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-ink-900/15 text-ink-900/70 transition-colors hover:border-teal-700 hover:text-teal-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-600"
    >
      {direction === 'next' ? <NextIcon className="h-4 w-4" /> : <PrevIcon className="h-4 w-4" />}
    </button>
  )
}

function NextIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={clsx(className, 'rtl:-scale-x-100')} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 10h12M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PrevIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={clsx(className, 'rtl:-scale-x-100')} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M16 10H4M9 5 4 10l5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
