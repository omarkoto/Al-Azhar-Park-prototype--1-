import { cairoOffsetMinutes } from '../calendar'

const LAT = 30.0444
const LON = 31.2357
const rad = (d: number) => (d * Math.PI) / 180

/** Sunset in Cairo for a `YYYY-MM-DD` date, as minutes after local midnight (Cairo time, DST aware). */
export function sunsetMinutes(dateStr: string): number {
  const noonUtc = new Date(`${dateStr}T12:00:00Z`)
  const julianDate = noonUtc.getTime() / 86400000 + 2440587.5
  const n = Math.ceil(julianDate - 2451545.0 + 0.0008)
  const jStar = n - LON / 360
  const M = (357.5291 + 0.98560028 * jStar) % 360
  const C = 1.9148 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 0.0003 * Math.sin(rad(3 * M))
  const lambda = (M + C + 180 + 102.9372) % 360
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(rad(M)) - 0.0069 * Math.sin(rad(2 * lambda))
  const sinDec = Math.sin(rad(lambda)) * Math.sin(rad(23.44))
  const cosDec = Math.cos(Math.asin(sinDec))
  const cosH = (Math.sin(rad(-0.833)) - Math.sin(rad(LAT)) * sinDec) / (Math.cos(rad(LAT)) * cosDec)
  const hourAngle = (Math.acos(Math.max(-1, Math.min(1, cosH))) * 180) / Math.PI
  const jSet = jTransit + hourAngle / 360
  const utcMinutes = Math.round((((jSet - 2440587.5) * 86400000) % 86400000) / 60000)
  const local = utcMinutes + cairoOffsetMinutes(dateStr)
  return ((local % 1440) + 1440) % 1440
}
