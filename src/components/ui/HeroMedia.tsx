import { useRef, useState } from 'react'
import clsx from 'clsx'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'

export function HeroMedia({ image, alt, videoSrc = '/videos/hero.mp4' }: { image: string; alt: string; videoSrc?: string }) {
  const [videoReady, setVideoReady] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const reduceMotion = useReducedMotion()
  const containerRef = useRef<HTMLDivElement>(null)

  const { scrollYProgress } = useScroll({ target: containerRef, offset: ['start start', 'end start'] })
  const parallaxY = useTransform(scrollYProgress, [0, 1], reduceMotion ? ['0%', '0%'] : ['0%', '18%'])

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden">
      <motion.div className="absolute inset-x-0 -top-[10%] -bottom-[10%]" style={{ y: parallaxY }}>
        <motion.img
          src={image}
          alt={alt}
          className="h-full w-full object-cover"
          initial={reduceMotion ? undefined : { scale: 1 }}
          animate={reduceMotion ? undefined : { scale: 1.1 }}
          transition={reduceMotion ? undefined : { duration: 22, ease: 'linear' }}
        />
      </motion.div>
      {!videoFailed && !reduceMotion ? (
        <video
          className={clsx('absolute inset-0 h-full w-full object-cover transition-opacity duration-700', videoReady ? 'opacity-100' : 'opacity-0')}
          autoPlay
          muted
          loop
          playsInline
          onCanPlay={() => setVideoReady(true)}
          onError={() => setVideoFailed(true)}
        >
          <source src={videoSrc} type="video/mp4" />
        </video>
      ) : null}
    </div>
  )
}
