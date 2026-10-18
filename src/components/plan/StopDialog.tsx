import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { Lang } from '../../content'
import type { Plan } from '../../lib/plan/generate'
import type { PlanCopy } from '../../lib/plan/copy'

export function StopDialog({
  plan,
  lang,
  copy,
  selectedId,
  fmt,
  onSelect,
}: {
  plan: Plan
  lang: Lang
  copy: PlanCopy
  selectedId: string | null
  fmt: (min: number) => string
  onSelect: (id: string | null) => void
}) {
  const reduceMotion = useReducedMotion()
  const closeRef = useRef<HTMLButtonElement>(null)
  const index = plan.stops.findIndex((p) => p.stop.id === selectedId)
  const current = index >= 0 ? plan.stops[index] : null
  const num = (n: number) => (lang === 'ar' ? n.toLocaleString('ar-EG') : String(n))

  useEffect(() => {
    if (!current) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSelect(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [current, onSelect])

  const go = (delta: number) => {
    const next = plan.stops[index + delta]
    if (next) onSelect(next.stop.id)
  }

  return (
    <AnimatePresence>
      {current ? (
        <motion.div
          key="stop-dialog"
          className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <button type="button" aria-label={copy.close} tabIndex={-1} onClick={() => onSelect(null)} className="absolute inset-0 cursor-default bg-teal-950/70 backdrop-blur-sm" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={current.stop.name[lang]}
            key={current.stop.id}
            initial={reduceMotion ? false : { opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-gold-500/50 bg-sand-50 shadow-2xl shadow-ink-900/40 sm:rounded-3xl"
          >
            <div className="relative h-56 shrink-0 sm:h-64">
              <img src={current.stop.image} alt="" className="h-full w-full object-cover" draggable={false} />
              <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-teal-950/85 via-teal-950/15 to-transparent" />
              <button
                ref={closeRef}
                type="button"
                onClick={() => onSelect(null)}
                aria-label={copy.close}
                className="absolute end-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-sand-50/90 text-lg text-ink-900 shadow-md transition-colors hover:bg-gold-500"
              >
                ✕
              </button>
              <span className="absolute start-5 bottom-4 flex items-center gap-3 text-sand-50">
                <span className="font-display flex h-11 w-11 items-center justify-center rounded-full border-2 border-teal-950 bg-gold-500 text-lg font-bold text-teal-950">{num(index + 1)}</span>
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">{copy.stopOf(index + 1, plan.stops.length)}</span>
              </span>
            </div>

            <div className="overflow-y-auto p-6 sm:p-7">
              <h3 className="font-display text-2xl font-medium text-ink-900 sm:text-3xl">{current.stop.name[lang]}</h3>

              <div className="mt-3 flex flex-wrap gap-2">
                {current.stop.moods.map((m) => (
                  <span key={m} className="rounded-full border border-teal-700/30 bg-teal-700/10 px-3 py-1 text-xs font-semibold text-teal-800">
                    {copy.moods[m]}
                  </span>
                ))}
                {current.stop.sunset ? <span className="rounded-full border border-gold-600/40 bg-gold-500/20 px-3 py-1 text-xs font-semibold text-gold-700">☀ {copy.sunsetSpot}</span> : null}
                {current.stop.kids ? (
                  <span className="rounded-full border border-gold-600/40 bg-gold-500/20 px-3 py-1 text-xs font-semibold text-gold-700">
                    {current.stop.kids === 'only' ? copy.kidsOnly : copy.goodForKids}
                  </span>
                ) : null}
              </div>

              <p className="mt-4 text-base leading-relaxed text-ink-900/75">{current.stop.blurb[lang]}</p>

              <dl className="mt-6 grid grid-cols-3 gap-3 text-center">
                <Fact label={copy.arriveAt} value={fmt(current.startMin)} ltr />
                <Fact label={copy.timeHere} value={copy.minutes(current.stop.minutes)} />
                <Fact label={copy.walkLabel} value={copy.minutes(current.walkMin)} />
              </dl>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-ink-900/10 pt-5">
                <div className="flex gap-2">
                  <NavBtn label={copy.prevStop} disabled={index === 0} onClick={() => go(-1)} glyph="‹" />
                  <NavBtn label={copy.nextStop} disabled={index === plan.stops.length - 1} onClick={() => go(1)} glyph="›" />
                </div>
                {current.stop.restaurantSlug ? (
                  <Link
                    to={`/restaurants/${current.stop.restaurantSlug}`}
                    className="rounded-full bg-teal-700 px-5 py-2.5 text-sm font-semibold text-sand-50 transition-colors hover:bg-teal-800"
                  >
                    {copy.openRestaurant} →
                  </Link>
                ) : null}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function Fact({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="rounded-2xl border border-gold-500/30 bg-sand-100 px-2 py-3">
      <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-ink-900/50">{label}</dt>
      <dd className="font-display mt-1 text-base font-medium text-teal-800" dir={ltr ? 'ltr' : undefined}>
        {value}
      </dd>
    </div>
  )
}

function NavBtn({ label, glyph, disabled, onClick }: { label: string; glyph: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-full border border-ink-900/20 text-xl text-ink-900/70 transition-colors hover:border-teal-700 hover:text-teal-700 disabled:opacity-35 rtl:rotate-180"
    >
      {glyph}
    </button>
  )
}
