import { useCallback, useEffect, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

interface UseSpotlightOptions {
  length: number
  /** Autoplay interval in ms. Set to 0 to disable autoplay. */
  intervalMs?: number
}

/**
 * A single-item "spotlight" rotator: one slide visible at a time, advanced
 * by swapping index + crossfading (via the consumer's AnimatePresence), not
 * by scrolling a track. Deliberately has no DOM scroll involvement at all —
 * a scroll-snap carousel's scrollIntoView() can end up nudging the page's
 * own vertical scroll when a slide isn't fully in view, which is exactly
 * the bug this replaces.
 */
export function useSpotlight({ length, intervalMs = 4000 }: UseSpotlightOptions) {
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const [progress, setProgress] = useState(0)
  const [paused, setPaused] = useState(false)
  const reduceMotion = useReducedMotion()

  const goTo = useCallback(
    (i: number, dir: 1 | -1 = 1) => {
      setDirection(dir)
      setIndex(((i % length) + length) % length)
    },
    [length],
  )
  const next = useCallback(() => goTo(index + 1, 1), [index, goTo])
  const prev = useCallback(() => goTo(index - 1, -1), [index, goTo])

  useEffect(() => {
    if (paused || reduceMotion || length <= 1 || intervalMs <= 0) {
      setProgress(0)
      return
    }
    let raf = 0
    const start = performance.now()
    function tick(now: number) {
      const elapsed = now - start
      setProgress(Math.min(100, (elapsed / intervalMs) * 100))
      if (elapsed < intervalMs) {
        raf = requestAnimationFrame(tick)
      } else {
        goTo(index + 1, 1)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, paused, reduceMotion, intervalMs, length])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      next()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      prev()
    }
  }

  return { index, direction, progress, paused, setPaused, next, prev, goTo, reduceMotion, handleKeyDown }
}
