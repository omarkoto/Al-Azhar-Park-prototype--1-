import type { PaymentStatus } from './ticketing'

export interface ParkStatus {
  date: string
  status: 'OPEN' | 'BEFORE_OPENING' | 'AFTER_CLOSING' | 'CLOSED_TODAY'
  opens: string | null
  closes: string | null
  source: 'WEEKLY' | 'SPECIAL' | 'NONE'
  special: { labelEn: string; labelAr: string; kind: string; noteEn: string | null; noteAr: string | null } | null
  onlineSales: { open: boolean; closesAt: string | null }
  upcomingSpecial: Array<{ labelEn: string; labelAr: string; kind: string; dateFrom: string; dateTo: string; isClosed: boolean; opens: string | null; closes: string | null }>
}

export interface DashboardEvent {
  id: string
  titleEn: string
  titleAr: string
  status: string
  date: string
  startTime: string | null
  endTime: string | null
  venue: string | null
}

export interface Dashboard {
  generatedAt: string
  date: string
  park?: ParkStatus
  orders?: { createdToday: number; paidToday: number; cancelledToday: number; expiredToday: number; pendingToday: number; revenueMinor: number; currency: string; pendingPaymentNow: number }
  tickets?: { forToday: number; valid: number; used: number; cancelled: number; pending: number; expired: number }
  entry?: {
    scope: 'ALL' | 'OWN'
    granted: number
    denied: number
    deniedByReason: Record<string, number>
    recent: Array<{ id: string; scannedAt: string; granted: boolean; result: string; gate: { code: string; nameEn: string } | null; ticketRef: string | null; staff?: string }>
  }
  gates?: Array<{ id: string; code: string; nameEn: string; nameAr: string; isActive: boolean; entriesToday?: number }>
  events?: { today: DashboardEvent[]; upcoming: DashboardEvent[] }
  activity?: Array<{ id: string; at: string; action: string; entity: string; actor: string | null }>
}

/** What the park is doing right now, in words, with the tone of its banner. */
export function parkBanner(p: Pick<ParkStatus, 'status' | 'opens' | 'closes' | 'special'>): { headline: string; detail: string; tone: 'open' | 'closed' | 'waiting' } {
  const hours = p.opens && p.closes ? `${p.opens} – ${p.closes}` : ''
  const why = p.special ? ` (${p.special.labelEn})` : ''
  switch (p.status) {
    case 'OPEN':
      return { headline: 'The park is open', detail: `Today's hours: ${hours}${why}`, tone: 'open' }
    case 'BEFORE_OPENING':
      return { headline: 'Not open yet', detail: `Opens at ${p.opens}, closes at ${p.closes}${why}`, tone: 'waiting' }
    case 'AFTER_CLOSING':
      return { headline: 'Closed for today', detail: `Today's hours were ${hours}${why}`, tone: 'closed' }
    case 'CLOSED_TODAY':
      return { headline: 'The park is closed today', detail: p.special ? p.special.labelEn : 'No opening hours are set for today.', tone: 'closed' }
  }
}

/** "Online tickets for today are on sale until 21:00", or that they are not. */
export function onlineSalesText(s: ParkStatus['onlineSales']): string {
  if (!s.open) return 'Online tickets for today are no longer on sale.'
  return s.closesAt ? `Online tickets for today are on sale until ${s.closesAt}.` : 'Online tickets are on sale.'
}

const SCAN_LABEL: Record<string, string> = {
  ACCESS_GRANTED: 'Let in',
  ALREADY_USED: 'Refused: already used',
  WRONG_DATE: 'Refused: wrong date',
  CANCELLED: 'Refused: cancelled',
  EXPIRED: 'Refused: expired',
  TICKET_NOT_VALID: 'Refused: not paid',
  TICKET_NOT_FOUND: 'Refused: not found',
  INVALID_QR: 'Refused: not a ticket',
  INVALID_SIGNATURE: 'Refused: invalid ticket',
  RETIRED_KEY: 'Refused: old code',
  // reasons recorded before the precise codes existed
  OK: 'Let in',
  NOT_FOUND: 'Refused: not found',
  NOT_PAID: 'Refused: not paid',
  INVALID_TOKEN: 'Refused: invalid ticket',
  REFUNDED: 'Refused',
}

/** A scan result code as a short phrase for a list. */
export const scanLabel = (code: string): string => SCAN_LABEL[code] ?? 'Refused'

export type TicketStatus = 'PENDING' | 'VALID' | 'USED' | 'CANCELLED' | 'EXPIRED'
export const TICKET_STATUSES: TicketStatus[] = ['PENDING', 'VALID', 'USED', 'CANCELLED', 'EXPIRED']
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = { PENDING: 'Not paid', VALID: 'Valid', USED: 'Used', CANCELLED: 'Cancelled', EXPIRED: 'Expired' }
export const TICKET_STATUS_TONE: Record<TicketStatus, 'neutral' | 'teal' | 'amber' | 'red'> = { PENDING: 'amber', VALID: 'teal', USED: 'neutral', CANCELLED: 'red', EXPIRED: 'neutral' }

export interface TicketRow {
  id: string
  ref: string
  status: TicketStatus
  orderId: string
  orderNumber: string
  orderStatus: string
  visitDate: string
  typeNameEn: string
  typeNameAr: string
  audienceNameEn: string
  audienceNameAr: string
  pricePaidMinor: number
  currency: string
  issuedAt: string | null
  usedAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
}

export interface TicketDetail extends TicketRow {
  order: { id: string; orderNumber: string; status: string; createdAt: string; paidAt: string | null; totalMinor: number; currency: string }
  paymentStatus?: PaymentStatus | null
  qrIssued: boolean
  usedByName?: string | null
  scans?: Array<{ id: string; scannedAt: string; granted: boolean; result: string; gate: { code: string; nameEn: string } | null; staff: string }>
}

export interface ScanRow {
  id: string
  scannedAt: string
  granted: boolean
  result: string
  gate: { id: string; code: string; nameEn: string } | null
  ticketId: string | null
  ticketRef: string | null
  staff?: string
}

export interface GateRow {
  id: string
  code: string
  nameEn: string
  nameAr: string
  isActive: boolean
  createdAt: string
  usage?: { entriesToday: number; deniedToday: number; totalScans: number; lastScanAt: string | null }
}

export interface GateForm {
  code: string
  nameEn: string
  nameAr: string
}

/** Messages for the gate form; the server checks the same rules. The code is fixed once the gate exists. */
export function gateProblems(f: GateForm, creating: boolean): Partial<Record<keyof GateForm, string>> {
  const out: Partial<Record<keyof GateForm, string>> = {}
  if (creating && !/^[A-Z][A-Z0-9_]{1,29}$/.test(f.code.trim().toUpperCase())) out.code = 'Use letters, digits and underscores, for example NORTH.'
  if (f.nameEn.trim().length < 2) out.nameEn = 'Enter the English name.'
  if (f.nameAr.trim().length < 2) out.nameAr = 'Enter the Arabic name.'
  return out
}

/** Things to tell the person before they switch a gate off. */
export function deactivationWarning(gate: Pick<GateRow, 'nameEn'>, activeGates: number): string {
  const last = activeGates <= 1 ? ' It is the last active gate: nobody will be able to scan tickets until a gate is switched on.' : ''
  return `Switch off ${gate.nameEn}? Nobody can scan tickets at it until it is switched on again. Scans already made there are kept.${last}`
}

/** "ticket.cancelled" → "Ticket cancelled", "order.email_resent" → "Order email resent" */
export function activityLabel(action: string): string {
  const text = action.replace(/[._]/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}
