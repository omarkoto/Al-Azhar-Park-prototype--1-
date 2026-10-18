import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'
import { resolveImage } from '../lib/imageMap'
import { Eyebrow } from './ui/SectionHeading'
import { Reveal } from './ui/Reveal'

export function RestaurantGallery({ images, name }: { images: string[]; name: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<number | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  if (!images.length) return null

  function close() {
    setOpen(null)
    triggerRef.current?.focus()
  }

  return (
    <section className="relative overflow-hidden bg-teal-950 py-16 text-sand-50 md:py-24">
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 start-1/2 h-80 w-[40rem] -translate-x-1/2 rounded-full bg-gold-500/10 blur-3xl" />
      <div className="relative mx-auto w-full max-w-7xl px-5 sm:px-8">
        <Reveal className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow tone="sand">{name}</Eyebrow>
            <h2 className="font-display mt-3 text-3xl font-medium md:text-4xl">{t('restaurantGalleryTitle')}</h2>
          </div>
          <span className="rounded-full border border-gold-500/40 px-4 py-1.5 text-xs font-semibold tracking-[0.16em] text-gold-100 uppercase">
            {t('restaurantGalleryCount', { count: images.length })}
          </span>
        </Reveal>

        <div className="mt-10 grid auto-rows-[11rem] grid-cols-2 gap-3 sm:auto-rows-[13rem] md:grid-cols-3 md:gap-4 lg:grid-cols-4 lg:auto-rows-[14rem]">
          {images.map((src, i) => (
            <Reveal key={src} delay={(i % 6) * 0.05} className="min-h-0">
              <button
                type="button"
                aria-label={t('viewPhoto', { n: i + 1 })}
                onClick={(e) => {
                  triggerRef.current = e.currentTarget
                  setOpen(i)
                }}
                className="group relative block h-full w-full overflow-hidden rounded-2xl bg-teal-900 ring-1 ring-gold-500/25 transition-shadow duration-500 hover:shadow-2xl hover:shadow-black/40 hover:ring-gold-500/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500"
              >
                <img src={resolveImage(src)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-110" />
                <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-t from-teal-950/70 via-transparent to-transparent opacity-60 transition-opacity duration-500 group-hover:opacity-20" />
                <span aria-hidden="true" className="absolute end-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-teal-950/60 text-gold-100 opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M12 3h5v5M8 17H3v-5M17 3l-5.5 5.5M3 17l5.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </button>
            </Reveal>
          ))}
        </div>
      </div>

      <AnimatePresence>{open !== null ? <Viewer images={images} name={name} index={open} onClose={close} onNavigate={setOpen} /> : null}</AnimatePresence>
    </section>
  )
}

function Viewer({ images, name, index, onClose, onNavigate }: { images: string[]; name: string; index: number; onClose: () => void; onNavigate: (i: number) => void }) {
  const { t } = useTranslation()
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const go = (d: number) => onNavigate((index + d + images.length) % images.length)

  useEffect(() => {
    closeRef.current?.focus()
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  const btn =
    'flex h-11 w-11 items-center justify-center rounded-full border border-sand-50/25 bg-teal-950/50 text-sand-50 backdrop-blur-sm transition-colors hover:border-gold-500 hover:text-gold-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500'

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="fixed inset-0 z-[60] flex flex-col bg-teal-950/95 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <div className="flex items-center justify-between px-5 py-4 text-sand-100/80" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm tabular-nums">{t('imageOf', { current: index + 1, total: images.length })}</span>
        <button ref={closeRef} type="button" onClick={onClose} className={btn} aria-label={t('close')}>
          ✕
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 sm:px-20">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            go(-1)
          }}
          className={clsx(btn, 'absolute start-3 rtl:-scale-x-100 sm:start-6')}
          aria-label={t('previous')}
        >
          ‹
        </button>
        <AnimatePresence mode="wait">
          <motion.img
            key={images[index]}
            src={resolveImage(images[index])}
            alt={name}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="max-h-full max-w-full rounded-xl object-contain shadow-2xl shadow-black/50 ring-1 ring-gold-500/30"
            onClick={(e) => e.stopPropagation()}
          />
        </AnimatePresence>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            go(1)
          }}
          className={clsx(btn, 'absolute end-3 rtl:-scale-x-100 sm:end-6')}
          aria-label={t('next')}
        >
          ›
        </button>
      </div>

      <div className="flex justify-center gap-2 overflow-x-auto px-5 py-4" onClick={(e) => e.stopPropagation()}>
        {images.map((src, i) => (
          <button
            key={src}
            type="button"
            onClick={() => onNavigate(i)}
            aria-label={t('viewPhoto', { n: i + 1 })}
            aria-current={i === index}
            className={clsx('h-14 w-14 shrink-0 overflow-hidden rounded-lg transition-all sm:h-16 sm:w-16', i === index ? 'opacity-100 ring-2 ring-gold-500' : 'opacity-50 hover:opacity-90')}
          >
            <img src={resolveImage(src)} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    </motion.div>
  )
}
