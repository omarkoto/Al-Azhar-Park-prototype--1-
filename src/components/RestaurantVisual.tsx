import { useRef } from 'react'
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'framer-motion'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { ArchFrame } from './ui/ArchFrame'

export function RestaurantVisual({
  src,
  alt,
  to,
  className,
}: {
  src: string
  alt: string
  to?: string
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  const wrapRef = useRef<HTMLDivElement>(null)
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const rotateX = useSpring(useTransform(py, [0, 1], [7, -7]), { stiffness: 240, damping: 24 })
  const rotateY = useSpring(useTransform(px, [0, 1], [-7, 7]), { stiffness: 240, damping: 24 })

  function handleMove(e: React.MouseEvent<HTMLDivElement>) {
    if (reduceMotion) return
    const rect = wrapRef.current!.getBoundingClientRect()
    px.set((e.clientX - rect.left) / rect.width)
    py.set((e.clientY - rect.top) / rect.height)
  }

  function handleLeave() {
    px.set(0.5)
    py.set(0.5)
  }

  const frame = <ArchFrame src={src} alt={alt} className="aspect-[3/4] w-full shadow-2xl shadow-ink-900/25" />

  return (
    <div style={{ perspective: 1400 }} className={clsx('relative', className)}>
      <div
        aria-hidden="true"
        className="absolute -inset-2.5 bg-gradient-to-br from-gold-500 via-gold-600/90 to-gold-700"
        style={{ clipPath: 'url(#arch-clip)' }}
      />
      <motion.div
        ref={wrapRef}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
        whileHover={reduceMotion ? undefined : { scale: 1.015 }}
        style={reduceMotion ? undefined : { rotateX, rotateY }}
        transition={{ type: 'spring', stiffness: 300, damping: 22 }}
        className="relative"
      >
        {to ? (
          <Link to={to} className="group block">
            {frame}
          </Link>
        ) : (
          <div className="group block">{frame}</div>
        )}
      </motion.div>
    </div>
  )
}
