import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContent } from '../lib/language'
import { useSeo } from '../lib/seo'
import { useAlt } from '../lib/alt'
import { resolveImage } from '../lib/imageMap'
import { photoCredits } from '../content/photoCredits'
import { Container } from '../components/ui/Container'
import { Reveal } from '../components/ui/Reveal'
import { PageHero } from '../components/PageHero'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import restaurantsHero from '../assets/images/restaurants-hero.webp'

export function Gallery() {
  const content = useContent()
  const altText = useAlt()
  const { gallery } = content
  useSeo({ title: gallery.title, description: gallery.lead, path: '/gallery' })
  const [active, setActive] = useState<string>('all')
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null)

  const categories = useMemo(() => ['all', ...Array.from(new Set(gallery.images.map((img) => img.category)))], [gallery.images])
  const countOf = (cat: string) => (cat === 'all' ? gallery.images.length : gallery.images.filter((img) => img.category === cat).length)

  const filtered = useMemo(
    () => (active === 'all' ? gallery.images : gallery.images.filter((img) => img.category === active)),
    [active, gallery.images],
  )

  function openLightbox(globalIndex: number, trigger: HTMLButtonElement) {
    lastTriggerRef.current = trigger
    setLightboxIndex(globalIndex)
  }

  function closeLightbox() {
    setLightboxIndex(null)
    lastTriggerRef.current?.focus()
  }

  return (
    <div>
      <PageHero eyebrow={gallery.eyebrow} title={gallery.title} lead={gallery.lead} image={restaurantsHero} imageAlt={altText('galleryHero')} />

      <section className="py-16 md:py-20">
        <Container>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActive(cat)}
                aria-pressed={active === cat}
                className={clsx(
                  'rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-colors',
                  active === cat
                    ? 'border-teal-700 bg-teal-700 text-sand-50'
                    : 'border-ink-900/15 text-ink-900/60 hover:border-teal-700 hover:text-teal-700',
                )}
              >
                {cat === 'all' ? gallery.allLabel : cat}
                <span className={clsx('ms-2 text-[10px] font-medium', active === cat ? 'text-sand-50/70' : 'text-ink-900/35')}>{countOf(cat)}</span>
              </button>
            ))}
          </div>

          <motion.div layout className="mt-10 columns-2 gap-4 sm:columns-3 lg:columns-4 [&>*]:mb-4">
            {filtered.map((image, i) => {
              const globalIndex = gallery.images.indexOf(image)
              return (
                <Reveal key={image.src} delay={(i % 8) * 0.04} className="break-inside-avoid">
                  <button
                    type="button"
                    onClick={(e) => openLightbox(globalIndex, e.currentTarget)}
                    className="group relative block w-full overflow-hidden rounded-xl bg-teal-900 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-600"
                    style={image.ratio ? { aspectRatio: String(image.ratio) } : undefined}
                  >
                    <img
                      src={resolveImage(image.src)}
                      alt={image.caption}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                    />
                    <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-teal-950/85 via-teal-950/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-2 p-4 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
                      <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-100">{image.category}</span>
                      <span className="mt-1 block text-sm leading-snug text-sand-50">{image.caption}</span>
                    </span>
                  </button>
                </Reveal>
              )
            })}
          </motion.div>
        </Container>
      </section>

      <AnimatePresence>
        {lightboxIndex !== null ? (
          <Lightbox images={gallery.images} index={lightboxIndex} onClose={closeLightbox} onNavigate={setLightboxIndex} />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function Lightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: { src: string; caption: string; category: string }[]
  index: number
  onClose: () => void
  onNavigate: (i: number) => void
}) {
  const { t } = useTranslation()
  const image = images[index]
  const credit = photoCredits[(image.src.split('/').pop() ?? '')]
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const go = (delta: number) => onNavigate((index + delta + images.length) % images.length)

  useEffect(() => {
    closeButtonRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={image.caption}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink-900/90 p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={onClose}
        className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full border border-sand-50/30 text-sand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500"
        aria-label={t('close')}
      >
        ✕
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          go(-1)
        }}
        className="absolute start-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-sand-50/30 text-sand-50 rtl:-scale-x-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500"
        aria-label={t('previous')}
      >
        ‹
      </button>

      <motion.figure
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-h-[85vh] max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <img src={resolveImage(image.src)} alt={image.caption} className="max-h-[75vh] w-auto rounded-lg object-contain" />
        <figcaption className="mt-3 text-center text-sm text-sand-100/80">
          {image.caption}
          {credit ? (
            <a href={credit.url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[11px] text-sand-100/50 hover:text-sand-50" onClick={(e) => e.stopPropagation()}>
              {credit.author} · {credit.license}
            </a>
          ) : null}
          <span className="sr-only"> — {t('imageOf', { current: index + 1, total: images.length })}</span>
        </figcaption>
      </motion.figure>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          go(1)
        }}
        className="absolute end-4 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-sand-50/30 text-sand-50 rtl:-scale-x-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500"
        aria-label={t('next')}
      >
        ›
      </button>
    </motion.div>
  )
}
