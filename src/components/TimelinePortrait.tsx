import { motion } from 'framer-motion'

export function TimelinePortrait({ src, alt, delay = 0 }: { src: string; alt: string; delay?: number }) {
  return (
    <motion.div
      className="group relative aspect-[4/5] w-24 shrink-0 overflow-hidden rounded-lg shadow-md shadow-ink-900/10 ring-1 ring-gold-500/30 sm:w-28 md:w-36"
      initial={{ opacity: 0, scale: 0.92, y: 14 }}
      whileInView={{ opacity: 1, scale: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px 0px' }}
      transition={{ duration: 0.7, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105" />
      <span className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-sand-50/40" aria-hidden="true" />
    </motion.div>
  )
}
