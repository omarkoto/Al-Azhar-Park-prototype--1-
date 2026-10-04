import { useRef } from 'react'
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion'
import clsx from 'clsx'

interface HighlightCardProps {
  title: string
  body: string
  to: string
  image: string
  index: number
  className?: string
}

export function HighlightCard({ title, body, to, image, index, className }: HighlightCardProps) {
  const reduceMotion = useReducedMotion()
  const ref = useRef<HTMLAnchorElement>(null)
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const rotateX = useSpring(useTransform(py, [0, 1], [5, -5]), { stiffness: 260, damping: 26 })
  const rotateY = useSpring(useTransform(px, [0, 1], [-5, 5]), { stiffness: 260, damping: 26 })

  function handleMove(e: React.MouseEvent<HTMLAnchorElement>) {
    if (reduceMotion) return
    const rect = ref.current!.getBoundingClientRect()
    px.set((e.clientX - rect.left) / rect.width)
    py.set((e.clientY - rect.top) / rect.height)
  }

  function handleLeave() {
    px.set(0.5)
    py.set(0.5)
  }

  return (
    <div style={{ perspective: 1000 }} className={clsx('h-full w-full', className)}>
      <motion.a
        href={to}
        ref={ref}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        style={reduceMotion ? undefined : { rotateX, rotateY }}
        className="group relative block h-full w-full overflow-hidden rounded-2xl shadow-lg shadow-ink-900/10 ring-1 ring-ink-900/5 transition-shadow duration-300 hover:shadow-2xl hover:shadow-ink-900/25"
      >
        <img
          src={image}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-900/90 via-ink-900/25 to-transparent transition-colors duration-300 group-hover:from-teal-950/90" />

        <span className="font-display absolute end-5 top-5 text-xs font-semibold tracking-wide text-sand-50/45">
          {String(index + 1).padStart(2, '0')}
        </span>

        <div className="absolute inset-x-0 bottom-0 p-6">
          <h3 className="font-display text-xl font-medium text-sand-50 md:text-2xl">{title}</h3>
          <p className="mt-2 hidden max-w-xs text-sm leading-relaxed text-sand-100/80 md:block">{body}</p>
          <span className="mt-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-sand-50/40 text-sand-50 transition-all duration-300 group-hover:border-gold-500 group-hover:bg-gold-500 group-hover:text-ink-900 group-hover:translate-x-1 rtl:group-hover:-translate-x-1">
            <ArrowIcon />
          </span>
        </div>
      </motion.a>
    </div>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M4 10h12M11 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
