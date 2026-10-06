import { useId } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'framer-motion'
import clsx from 'clsx'
import type { Lang } from '../../content'
import type { Plan } from '../../lib/plan/generate'
import { entrance } from '../../lib/plan/stops'
import { ALT } from '../../lib/alt'
import { ARCH_PATH } from '../../lib/archPath'
import logoMark from '../../assets/brand/logo-mark.svg'

type Pt = { x: number; y: number }

// Smooth path through the points (Catmull-Rom converted to cubic Béziers).
function smoothPath(points: Pt[]) {
  if (points.length < 2) return ''
  let d = `M${points[0].x},${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    d += ` C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p2.x},${p2.y}`
  }
  return d
}

const OUTLINE =
  'M40,370 C120,290 260,220 420,195 C600,170 800,180 960,220 L985,300 C990,360 960,395 930,410 C700,435 480,415 330,430 C230,440 120,425 40,370 Z'
const WALL = 'M60,352 C140,285 270,226 420,203 C600,178 800,188 950,226'
const DRAW_SECONDS = 2.8

export function ArchMap({
  plan,
  lang,
  activeId,
  onActive,
  className,
}: {
  plan: Plan
  lang: Lang
  activeId: string | null
  onActive: (id: string | null) => void
  className?: string
}) {
  const reduceMotion = useReducedMotion()
  const uid = useId().replace(/:/g, '')
  const routeId = `route-${uid}`
  const points: Pt[] = [entrance, ...plan.stops.map((p) => p.stop)]
  const routePath = smoothPath(points)
  const signature = plan.stops.map((p) => p.stop.id).join('>')
  const n = plan.stops.length

  return (
    <div className={clsx('relative', className)}>
      {/* The same doorway arch as the Home page, framed in gold: an outer band, a hairline of sand, an inner band */}
      <div aria-hidden="true" className="absolute -inset-4 bg-gradient-to-br from-gold-500 via-gold-600/90 to-gold-700 shadow-2xl shadow-ink-900/25" style={{ clipPath: 'url(#arch-clip)' }} />
      <div aria-hidden="true" className="absolute -inset-[11px] bg-sand-50" style={{ clipPath: 'url(#arch-clip)' }} />
      <div aria-hidden="true" className="absolute -inset-[7px] bg-gradient-to-br from-gold-500 via-gold-600/90 to-gold-700" style={{ clipPath: 'url(#arch-clip)' }} />
      <FlowerBadge />
      <div className="relative aspect-[1000/520] overflow-hidden bg-teal-950" style={{ clipPath: 'url(#arch-clip)' }}>
        {/* a fine gold line echoing the arch, just inside the edge */}
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
          <path d={ARCH_PATH} transform="translate(0.012 0.024) scale(0.976 0.968)" fill="none" stroke="#e0b568" strokeOpacity="0.5" strokeWidth="1.25" vectorEffect="non-scaling-stroke" />
        </svg>
        <svg viewBox="0 30 1000 520" className="absolute inset-0 h-full w-full" role="img" aria-label={ALT.planMap[lang]}>
          <defs>
            <radialGradient id={`sky-${uid}`} cx="50%" cy="0%" r="75%">
              <stop offset="0%" stopColor="#cb9c4f" stopOpacity="0.55" />
              <stop offset="45%" stopColor="#147d6d" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#06251f" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`park-${uid}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#0e4f42" />
              <stop offset="100%" stopColor="#0b3d33" />
            </linearGradient>
            <filter id={`glow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <pattern id={`lat-${uid}`} width="48" height="48" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <path d="M24 0 L48 24 L24 48 L0 24 Z" fill="none" stroke="#cb9c4f" strokeOpacity="0.07" strokeWidth="1" />
            </pattern>
            <clipPath id={`park-clip-${uid}`}>
              <path d={OUTLINE} />
            </clipPath>
          </defs>

          <rect y="30" width="1000" height="520" fill={`url(#lat-${uid})`} />
          <rect y="30" width="1000" height="520" fill={`url(#sky-${uid})`} />

          {/* The park */}
          <path d={OUTLINE} fill={`url(#park-${uid})`} stroke="#cb9c4f" strokeOpacity="0.55" strokeWidth="1.5" />
          <g clipPath={`url(#park-clip-${uid})`}>
            <ellipse cx="640" cy="330" rx="170" ry="60" fill="#147d6d" opacity="0.28" />
            <ellipse cx="860" cy="330" rx="95" ry="70" fill="#2b9684" opacity="0.2" />
            <ellipse cx="420" cy="300" rx="120" ry="42" fill="#2b9684" opacity="0.16" />
            {/* Lake */}
            <ellipse cx="205" cy="322" rx="78" ry="44" fill="#2b9684" opacity="0.55" />
            <ellipse cx="205" cy="322" rx="78" ry="44" fill="none" stroke="#faf7f0" strokeOpacity="0.25" />
            {/* Main axis: entrance → lake */}
            <path d="M500,400 C420,385 330,355 232,326" fill="none" stroke="#f1e2c2" strokeOpacity="0.28" strokeWidth="2" strokeDasharray="2 7" strokeLinecap="round" />
            {/* Garden paths */}
            <path d="M330,430 C380,330 470,270 560,250 S760,250 860,330" fill="none" stroke="#f1e2c2" strokeOpacity="0.1" strokeWidth="1.5" />
            <path d="M440,260 C520,330 620,330 722,288" fill="none" stroke="#f1e2c2" strokeOpacity="0.1" strokeWidth="1.5" />
          </g>

          {/* Ayyubid wall along the northern edge */}
          <path d={WALL} fill="none" stroke="#cb9c4f" strokeOpacity="0.7" strokeWidth="3" strokeDasharray="10 5" />

          {/* Route */}
          {n > 0 ? (
            <g key={signature}>
              <motion.path
                id={routeId}
                d={routePath}
                fill="none"
                stroke="#e0b568"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter={`url(#glow-${uid})`}
                initial={reduceMotion ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: DRAW_SECONDS, ease: [0.45, 0, 0.2, 1] }}
              />
              {reduceMotion ? null : (
                <circle r="7" fill="#faf7f0" filter={`url(#glow-${uid})`}>
                  <animateMotion dur={`${DRAW_SECONDS}s`} fill="freeze" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.2 1">
                    <mpath href={`#${routeId}`} />
                  </animateMotion>
                </circle>
              )}
            </g>
          ) : null}

          {/* Entrance */}
          <g>
            <circle cx={entrance.x} cy={entrance.y} r="9" fill="#06251f" stroke="#faf7f0" strokeWidth="2.5" />
            <text x={entrance.x} y={entrance.y + 28} textAnchor="middle" className="fill-sand-100" fontSize="15" fontWeight="600" paintOrder="stroke" stroke="#06251f" strokeWidth="4" strokeLinejoin="round">
              {entrance.name[lang]}
            </text>
          </g>

          {/* Stops */}
          {plan.stops.map((p, i) => {
            const active = activeId === p.stop.id
            const delay = reduceMotion ? 0 : 0.35 + ((i + 1) / (n + 0.4)) * DRAW_SECONDS * 0.85
            const above = p.stop.y < 300 && p.stop.id !== 'hilltop'
            return (
              <motion.g
                key={`${signature}-${p.stop.id}`}
                initial={reduceMotion ? false : { opacity: 0, scale: 0.3 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay, type: 'spring', stiffness: 320, damping: 18 }}
                style={{ transformOrigin: `${p.stop.x}px ${p.stop.y}px`, cursor: 'pointer' }}
                onMouseEnter={() => onActive(p.stop.id)}
                onMouseLeave={() => onActive(null)}
                onClick={() => onActive(active ? null : p.stop.id)}
              >
                {active ? <circle cx={p.stop.x} cy={p.stop.y} r="26" fill="#cb9c4f" opacity="0.28" /> : null}
                <circle cx={p.stop.x} cy={p.stop.y} r={active ? 17 : 14} fill="#cb9c4f" stroke="#06251f" strokeWidth="3" />
                <text x={p.stop.x} y={p.stop.y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#06251f">
                  {lang === 'ar' ? (i + 1).toLocaleString('ar-EG') : i + 1}
                </text>
                <text
                  x={p.stop.x}
                  y={above ? p.stop.y - 24 : p.stop.y + 34}
                  textAnchor="middle"
                  className="fill-sand-50"
                  fontSize="15"
                  fontWeight={active ? 700 : 500}
                  paintOrder="stroke"
                  stroke="#06251f"
                  strokeWidth="4"
                  strokeLinejoin="round"
                >
                  {p.stop.name[lang]}
                </text>
              </motion.g>
            )
          })}
        </svg>

      </div>
    </div>
  )
}

/**
 * The Al-Azhar Park flower crowning the arch. It turns as the page scrolls — a spring smooths the motion, so it
 * glides and settles like a wheel with weight — while a fine dashed gold ring turns the other way around it.
 */
function FlowerBadge() {
  const reduceMotion = useReducedMotion()
  const { scrollY } = useScroll()
  const turn = useSpring(useTransform(scrollY, (y) => y * 0.5), { stiffness: 55, damping: 16, mass: 0.9 })
  const counter = useTransform(turn, (v) => -v * 0.6)

  return (
    <span className="absolute start-1/2 -top-10 z-20 flex h-[4.5rem] w-[4.5rem] -translate-x-1/2 items-center justify-center rounded-full border border-gold-500/70 bg-sand-50 shadow-xl shadow-ink-900/25 rtl:translate-x-1/2" aria-hidden="true">
      <motion.svg style={reduceMotion ? undefined : { rotate: counter }} viewBox="0 0 100 100" className="absolute -inset-1.5 h-[calc(100%+0.75rem)] w-[calc(100%+0.75rem)]">
        <circle cx="50" cy="50" r="48" fill="none" stroke="#cb9c4f" strokeOpacity="0.7" strokeWidth="1" strokeDasharray="2 5" strokeLinecap="round" />
      </motion.svg>
      <motion.img src={logoMark} alt="" style={reduceMotion ? undefined : { rotate: turn }} className="h-12 w-12 select-none" draggable={false} />
    </span>
  )
}
