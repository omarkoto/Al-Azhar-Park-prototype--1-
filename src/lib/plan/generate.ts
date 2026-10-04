import { entrance, stops, type Mood, type Stop } from './stops'

export type Arrival = 'morning' | 'afternoon' | 'sunset'

export interface PlanInput {
  children: number
  mood: Mood
  hours: 2 | 4 | 6
  arrival: Arrival
  /** Sunset for the chosen date, minutes after local midnight. */
  sunsetMin: number
}

export interface PlanStop {
  stop: Stop
  walkMin: number
  startMin: number
  endMin: number
}

export interface Plan {
  stops: PlanStop[]
  startMin: number
  endMin: number
}

const START: Record<Exclude<Arrival, 'sunset'>, number> = { morning: 10 * 60, afternoon: 14 * 60 }
const EARLIEST = 9 * 60

type Point = { x: number; y: number }

function walkMinutes(a: Point, b: Point) {
  return Math.max(2, Math.round(Math.hypot(a.x - b.x, a.y - b.y) / 55))
}

function score(stop: Stop, input: PlanInput) {
  let s = 1
  if (stop.moods.includes(input.mood)) s += 3
  if (input.children > 0 && stop.kids === 'good') s += 1
  if (input.children > 0 && stop.kids === 'only') s += 4
  if (input.mood === 'scenic' && stop.sunset) s += 1
  return s
}

export function generatePlan(input: PlanInput): Plan {
  const budget = input.hours * 60
  const eligible = stops.filter((s) => s.kids !== 'only' || input.children > 0)
  const forced = input.arrival === 'sunset' ? eligible.find((s) => s.sunset) : undefined

  // Pick the best-scoring stops that fit the time budget.
  const ranked = eligible
    .filter((s) => s !== forced)
    .sort((a, b) => score(b, input) - score(a, input))
  const chosen: Stop[] = []
  let used = forced ? forced.minutes + 8 : 0
  for (const s of ranked) {
    const cost = s.minutes + 8
    if (used + cost <= budget || (chosen.length === 0 && !forced)) {
      chosen.push(s)
      used += cost
    }
  }

  // Order the walk: nearest neighbour from the entrance, golden-hour stop last.
  const ordered: Stop[] = []
  let here: Point = entrance
  const pool = [...chosen]
  while (pool.length) {
    pool.sort((a, b) => walkMinutes(here, a) - walkMinutes(here, b))
    const next = pool.shift()!
    ordered.push(next)
    here = next
  }
  if (forced) ordered.push(forced)

  // Lay the day out on the clock, starting at 0 and shifting afterwards.
  let t = 0
  let prev: Point = entrance
  const timed = ordered.map((stop) => {
    const walkMin = walkMinutes(prev, stop)
    t += walkMin
    const startMin = t
    t += stop.minutes
    prev = stop
    return { stop, walkMin, startMin, endMin: t }
  })

  let shift: number
  if (input.arrival === 'sunset' && forced) {
    const anchor = timed[timed.length - 1]
    shift = Math.max(EARLIEST, input.sunsetMin - 30 - anchor.startMin)
  } else {
    shift = START[input.arrival === 'sunset' ? 'afternoon' : input.arrival]
  }

  const shifted = timed.map((p) => ({ ...p, startMin: p.startMin + shift, endMin: p.endMin + shift }))
  return {
    stops: shifted,
    startMin: shifted[0].startMin - shifted[0].walkMin,
    endMin: shifted[shifted.length - 1].endMin,
  }
}
