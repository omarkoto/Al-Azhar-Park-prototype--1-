import { useCallback, useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

interface UseCarouselOptions {
  /** Number of real, distinct slides. */
  length: number
  /** Autoplay interval in ms. Set to 0 to disable autoplay entirely. */
  intervalMs?: number
}

/**
 * Carousel built on native CSS scroll-snap + IntersectionObserver, navigated
 * by scrolling the carousel's OWN container directly (container.scrollBy)
 * rather than el.scrollIntoView(). scrollIntoView walks the whole ancestor
 * chain and can end up scrolling the page itself (on either axis) to bring
 * a slide into view — that was the actual cause of a "page jumps" bug.
 * Scrolling the track element's own scrollLeft can never touch the page's
 * vertical scroll, by construction. The delta is computed from
 * getBoundingClientRect (physical pixels) and is direction-aware, so it's
 * correct under RTL without relying on the browser's inconsistent RTL
 * scrollLeft sign conventions.
 */
export function useCarousel({ length, intervalMs = 4000 }: UseCarouselOptions) {
  const [rawIndex, setRawIndex] = useState(0) // 0..length, where `length` is the clone slot
  const [progress, setProgress] = useState(0)
  const [paused, setPaused] = useState(false)
  const [inView, setInView] = useState(false)
  const reduceMotion = useReducedMotion()

  const trackRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<(HTMLElement | null)[]>([])

  // Autoplay only once the carousel has actually scrolled into view — otherwise
  // it silently advances itself while still below the fold, and by the time a
  // visitor scrolls down to it several slides have already gone by.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.4 })
    observer.observe(track)
    return () => observer.disconnect()
  }, [])

  const setItemRef = useCallback(
    (i: number) => (el: HTMLElement | null) => {
      itemRefs.current[i] = el
    },
    [],
  )

  const scrollToIndex = useCallback((i: number, behavior: ScrollBehavior = 'smooth') => {
    const track = trackRef.current
    const target = itemRefs.current[i]
    if (!track || !target) return
    const trackRect = track.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    const isRTL = getComputedStyle(track).direction === 'rtl'
    const delta = isRTL ? targetRect.right - trackRect.right : targetRect.left - trackRect.left
    track.scrollBy({ left: delta, behavior })
  }, [])

  // Set while a programmatic scroll (next/prev/goTo/autoplay) is in flight, so
  // the IntersectionObserver below — whose job is to pick up manual dragging —
  // doesn't fight it. With several cards visible at once (e.g. 3-up on wide
  // screens), the last couple of indices can be geometrically unreachable:
  // the browser clamps the scroll short because there's no more track left,
  // even though that slide is already fully on screen. Left to the observer
  // alone, it would keep reporting an earlier, still-tied-for-highest-ratio
  // slide as current, which would both reset our own advance and make
  // autoplay re-target the same unreachable index forever — the carousel
  // would never reach the clone slide that triggers the loop back to start.
  const suppressObserverRef = useRef(false)
  const navigate = useCallback(
    (i: number, behavior: ScrollBehavior = 'smooth') => {
      suppressObserverRef.current = true
      scrollToIndex(i, behavior)
      setRawIndex(i)
      window.setTimeout(() => {
        suppressObserverRef.current = false
      }, 700)
    },
    [scrollToIndex],
  )

  const goTo = useCallback(
    (i: number) => {
      navigate(((i % length) + length) % length)
    },
    [length, navigate],
  )

  const next = useCallback(() => {
    navigate(Math.min(rawIndex + 1, length))
  }, [rawIndex, length, navigate])

  const prev = useCallback(() => {
    navigate(rawIndex <= 0 ? length - 1 : rawIndex - 1)
  }, [rawIndex, length, navigate])

  // Track which slide is most visible inside the scroller. We keep a running
  // ratio per slide and always promote the single highest one — reacting to
  // each entry in isolation is a race: more than one slide can cross the
  // threshold in the same callback batch, and whichever was processed last
  // would otherwise win arbitrarily.
  const ratiosRef = useRef<number[]>([])
  useEffect(() => {
    const track = trackRef.current
    if (!track || length === 0) return
    ratiosRef.current = new Array(length + 1).fill(0)
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement
          target.style.setProperty('--carousel-ratio', String(entry.intersectionRatio))
          const i = itemRefs.current.indexOf(target)
          if (i !== -1) ratiosRef.current[i] = entry.intersectionRatio
        }
        let best = 0
        let bestRatio = -1
        ratiosRef.current.forEach((ratio, i) => {
          if (ratio > bestRatio) {
            bestRatio = ratio
            best = i
          }
        })
        if (bestRatio > 0.6 && !suppressObserverRef.current) setRawIndex(best)
      },
      { root: track, threshold: [0, 0.25, 0.5, 0.6, 0.75, 0.9, 1] },
    )
    for (const el of itemRefs.current) if (el) observer.observe(el)
    return () => observer.disconnect()
  }, [length])

  // Seamless loop: once the clone slide (index === length) settles, snap
  // back to the real first slide with no animation.
  useEffect(() => {
    if (rawIndex !== length) return
    const id = window.setTimeout(() => {
      navigate(0, 'auto')
    }, 550)
    return () => window.clearTimeout(id)
  }, [rawIndex, length, navigate])

  // Autoplay with a progress timer, pausable.
  useEffect(() => {
    if (paused || !inView || reduceMotion || length <= 1 || intervalMs <= 0) {
      setProgress(0)
      return
    }
    let raf = 0
    const start = performance.now()
    function tick(now: number) {
      const elapsed = now - start
      const pct = Math.min(100, (elapsed / intervalMs) * 100)
      setProgress(pct)
      if (elapsed < intervalMs) {
        raf = requestAnimationFrame(tick)
      } else {
        navigate(Math.min(rawIndex + 1, length))
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawIndex, paused, inView, reduceMotion, intervalMs, length, navigate])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      next()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      prev()
    }
  }

  return {
    trackRef,
    setItemRef,
    activeIndex: rawIndex === length ? 0 : rawIndex,
    progress,
    paused,
    setPaused,
    next,
    prev,
    goTo,
    reduceMotion,
    handleKeyDown,
  }
}
