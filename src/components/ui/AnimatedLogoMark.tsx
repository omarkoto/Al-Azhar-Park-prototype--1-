import { useRef } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import logoMark from '../../assets/brand/logo-mark.svg'

/**
 * The Al-Azhar Park flower, as a small piece of theatre: it floats gently on its own, tilts in 3D toward the pointer,
 * and turns slowly inside a gold dashed ring with a soft glow behind it.
 */
export function AnimatedLogoMark({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const sx = useSpring(px, { stiffness: 120, damping: 14 })
  const sy = useSpring(py, { stiffness: 120, damping: 14 })
  const rotateY = useTransform(sx, [-0.5, 0.5], [-28, 28])
  const rotateX = useTransform(sy, [-0.5, 0.5], [24, -24])

  function onMove(e: React.PointerEvent) {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    px.set((e.clientX - r.left) / r.width - 0.5)
    py.set((e.clientY - r.top) / r.height - 0.5)
  }
  function onLeave() {
    px.set(0)
    py.set(0)
  }

  return (
    <div ref={ref} onPointerMove={onMove} onPointerLeave={onLeave} className={className} style={{ perspective: 700 }} aria-hidden="true">
      <motion.div
        className="relative h-full w-full"
        style={reduceMotion ? undefined : { rotateX, rotateY, transformStyle: 'preserve-3d' }}
        animate={reduceMotion ? undefined : { y: [0, -8, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      >
        <motion.span
          className="absolute -inset-3 rounded-full bg-gold-500/25 blur-xl"
          style={{ transform: 'translateZ(-30px)' }}
          animate={reduceMotion ? undefined : { opacity: [0.5, 1, 0.5], scale: [0.95, 1.08, 0.95] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.svg
          viewBox="0 0 100 100"
          className="absolute -inset-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)]"
          style={{ transform: 'translateZ(-10px)' }}
          animate={reduceMotion ? undefined : { rotate: -360 }}
          transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
        >
          <circle cx="50" cy="50" r="48" fill="none" stroke="#cb9c4f" strokeOpacity="0.7" strokeWidth="1" strokeDasharray="2 5" strokeLinecap="round" />
        </motion.svg>
        <span className="absolute inset-0 rounded-full border border-gold-500/60 bg-sand-50 shadow-xl shadow-ink-900/20" style={{ transform: 'translateZ(0)' }} />
        <motion.img
          src={logoMark}
          alt=""
          draggable={false}
          className="absolute inset-[16%] h-[68%] w-[68%] select-none"
          style={{ transform: 'translateZ(36px)' }}
          animate={reduceMotion ? undefined : { rotate: 360 }}
          transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
        />
      </motion.div>
    </div>
  )
}
