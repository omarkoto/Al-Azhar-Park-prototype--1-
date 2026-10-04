import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'

const ZOOMS = [1, 1.6, 2.4, 3.4]

/** A picture that opens full-screen with zoom controls — used for the park map. */
export function MapViewer({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  function close() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('mapEnlarge')}
        className={clsx('group relative block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-ink-900/10 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-600', className)}
      >
        <img src={src} alt={alt} className="w-full transition-transform duration-700 ease-out group-hover:scale-[1.02]" />
        <span className="absolute bottom-3 end-3 inline-flex items-center gap-2 rounded-full bg-teal-950/85 px-3.5 py-2 text-xs font-semibold text-sand-50 shadow-lg backdrop-blur-sm transition-colors group-hover:bg-teal-800">
          <ExpandIcon />
          {t('mapEnlarge')}
        </span>
      </button>
      {typeof document !== 'undefined' ? createPortal(<AnimatePresence>{open ? <Viewer src={src} alt={alt} onClose={close} /> : null}</AnimatePresence>, document.body) : null}
    </>
  )
}

function Viewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [zoomIndex, setZoomIndex] = useState(0)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const zoom = ZOOMS[zoomIndex]

  useEffect(() => {
    closeRef.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === '+' || e.key === '=') setZoomIndex((i) => Math.min(i + 1, ZOOMS.length - 1))
      else if (e.key === '-') setZoomIndex((i) => Math.max(i - 1, 0))
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[70] flex flex-col bg-teal-950/95 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <ZoomButton label={t('zoomOut')} disabled={zoomIndex === 0} onClick={() => setZoomIndex((i) => Math.max(i - 1, 0))}>
            −
          </ZoomButton>
          <span className="w-12 text-center text-sm font-semibold text-sand-50" dir="ltr">
            {Math.round(zoom * 100)}%
          </span>
          <ZoomButton label={t('zoomIn')} disabled={zoomIndex === ZOOMS.length - 1} onClick={() => setZoomIndex((i) => Math.min(i + 1, ZOOMS.length - 1))}>
            +
          </ZoomButton>
          <button
            type="button"
            onClick={() => setZoomIndex(0)}
            className="ms-2 rounded-full border border-sand-50/30 px-4 py-2 text-xs font-semibold text-sand-50 transition-colors hover:bg-sand-50/10"
          >
            {t('zoomReset')}
          </button>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-sand-50/30 text-sand-50 transition-colors hover:bg-sand-50/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500"
        >
          ✕
        </button>
      </div>

      {/* Scrollable stage: the image grows with the zoom level and can be panned by scrolling or dragging */}
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-6" onClick={(e) => e.stopPropagation()}>
        <motion.img
          key={alt}
          src={src}
          alt={alt}
          draggable={false}
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          onDoubleClick={() => setZoomIndex((i) => (i === ZOOMS.length - 1 ? 0 : i + 1))}
          className="mx-auto block max-w-none rounded-xl shadow-2xl"
          style={{ width: `min(${zoom * 100}vh - ${zoom * 7}rem, ${zoom * 100}vw)`, cursor: zoomIndex === ZOOMS.length - 1 ? 'zoom-out' : 'zoom-in' }}
        />
      </div>
    </motion.div>
  )
}

function ZoomButton({ children, label, disabled, onClick }: { children: string; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-sand-50/30 text-xl text-sand-50 transition-colors hover:bg-sand-50/10 disabled:opacity-30"
    >
      {children}
    </button>
  )
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3h5v5M8 17H3v-5M17 3l-5.5 5.5M3 17l5.5-5.5" />
    </svg>
  )
}
