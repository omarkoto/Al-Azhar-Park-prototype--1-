import { useEffect, useRef } from 'react'
import { motion, useMotionValue, useSpring, useTransform, animate, useReducedMotion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useMoney } from '../lib/alt'
import type { TicketCategory, TicketType } from '../lib/tickets'

interface TicketCard3DProps {
  category: TicketCategory
  visitDate: string
  dayType: 'weekday' | 'weekend'
  rows: { type: TicketType; qty: number; price: number }[]
  total: number
}

export function TicketCard3D({ category, visitDate, dayType, rows, total }: TicketCard3DProps) {
  const { t } = useTranslation()
  const money = useMoney()
  const reduceMotion = useReducedMotion()
  const cardRef = useRef<HTMLDivElement>(null)
  const floatY = useMotionValue(0)

  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const rotateX = useSpring(useTransform(py, [0, 1], [10, -10]), { stiffness: 220, damping: 22 })
  const rotateY = useSpring(useTransform(px, [0, 1], [-10, 10]), { stiffness: 220, damping: 22 })
  const sheenX = useTransform(px, [0, 1], ['0%', '100%'])

  useEffect(() => {
    if (reduceMotion) return
    const controls = animate(floatY, [0, -8, 0], { duration: 5, repeat: Infinity, ease: 'easeInOut' })
    return () => controls.stop()
  }, [floatY, reduceMotion])

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (reduceMotion) return
    const rect = cardRef.current!.getBoundingClientRect()
    px.set((e.clientX - rect.left) / rect.width)
    py.set((e.clientY - rect.top) / rect.height)
  }

  function handleLeave() {
    px.set(0.5)
    py.set(0.5)
  }

  const activeRows = rows.filter((r) => r.qty > 0)

  return (
    <motion.div style={{ y: floatY }} className="mx-auto w-full max-w-sm" aria-hidden="true">
      <div style={{ perspective: 1400 }}>
        <motion.div
          ref={cardRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleLeave}
          style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}
          className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-ink-900 via-[#241f18] to-black p-7 shadow-2xl shadow-black/40 ring-1 ring-gold-500/20"
        >
          {/* holographic sheen */}
          <motion.div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              background: useTransform(
                sheenX,
                (v) => `linear-gradient(115deg, transparent 20%, rgba(203,156,79,0.25) ${v}, transparent 80%)`,
              ),
            }}
          />

          {/* notches */}
          <span className="absolute -start-4 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-sand-50" />
          <span className="absolute -end-4 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full bg-sand-50" />

          <div className="relative flex items-center justify-between">
            <div>
              <p className="font-display text-lg font-medium text-sand-50">{t('ticketParkName')}</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-gold-500/80">{t('admission')}</p>
            </div>
            <span className="rounded-full border border-gold-500/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-gold-500">
              {t(category)}
            </span>
          </div>

          <div className="relative mt-6 border-t border-dashed border-sand-50/20 pt-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sand-100/40">{t('visitDate')}</p>
            <p className="mt-1 text-base font-semibold text-sand-50" dir="ltr">
              {visitDate || t(dayType)}
            </p>
          </div>

          <div className="relative mt-5 space-y-2">
            {activeRows.length === 0 ? (
              <p className="text-sm text-sand-100/40">—</p>
            ) : (
              activeRows.map((row) => (
                <div key={row.type} className="flex items-center justify-between text-sm">
                  <span className="text-sand-100/70">
                    {row.qty}× {t(row.type)}
                  </span>
                  <span className="font-medium text-sand-50" dir="ltr">
                    {money(row.price * row.qty)}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="relative mt-6 flex items-end justify-between border-t border-dashed border-sand-50/20 pt-5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-sand-100/40">{t('totalLabel')}</span>
            <span className="font-display text-3xl font-medium text-gold-500" dir="ltr">
              {money(total)}
            </span>
          </div>

          {/* barcode */}
          <div
            className="relative mt-6 h-8 w-full opacity-70"
            style={{
              backgroundImage:
                'repeating-linear-gradient(90deg, #F7F3EA 0px, #F7F3EA 2px, transparent 2px, transparent 5px, #F7F3EA 5px, #F7F3EA 6px, transparent 6px, transparent 10px)',
            }}
          />
        </motion.div>
      </div>
    </motion.div>
  )
}
