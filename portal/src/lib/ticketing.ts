export type OrderStatus = 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED' | 'EXPIRED'
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED'
export type PriceStatus = 'current' | 'upcoming' | 'ended' | 'inactive'
export type PriceDays = 'WEEKDAY' | 'WEEKEND' | 'EVERY_DAY' | 'CUSTOM'

export const ORDER_STATUSES: OrderStatus[] = ['PENDING_PAYMENT', 'PAID', 'CANCELLED', 'EXPIRED']

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  PAID: 'Paid',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
}
export const ORDER_STATUS_TONE: Record<OrderStatus, 'neutral' | 'teal' | 'amber' | 'red'> = {
  PENDING_PAYMENT: 'amber',
  PAID: 'teal',
  CANCELLED: 'red',
  EXPIRED: 'neutral',
}
export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = { PENDING: 'Waiting', PAID: 'Paid', FAILED: 'Failed', CANCELLED: 'Cancelled' }

export const PRICE_STATUS_LABEL: Record<PriceStatus, string> = { current: 'Current', upcoming: 'Upcoming', ended: 'Ended', inactive: 'Switched off' }
export const PRICE_STATUS_TONE: Record<PriceStatus, 'neutral' | 'teal' | 'amber' | 'red'> = { current: 'teal', upcoming: 'amber', ended: 'neutral', inactive: 'red' }
export const DAYS_LABEL: Record<PriceDays, string> = {
  WEEKDAY: 'Weekdays (Sun–Thu)',
  WEEKEND: 'Weekend (Fri–Sat)',
  EVERY_DAY: 'Every day',
  CUSTOM: 'Custom days',
}

/** 5000 → "50 EGP", 12550 → "125.50 EGP". Money is kept in piastres (whole numbers) everywhere. */
export function money(minor: number | null | undefined, currency = 'EGP'): string {
  if (minor === null || minor === undefined) return '—'
  const whole = minor % 100 === 0
  return `${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })} ${currency}`
}

export const MAX_PRICE_MINOR = 10_000_000

/**
 * "50", "50.5", "125.50" → piastres. Returns null for anything that is not a sensible price: empty, zero,
 * negative, more than two decimals, text, exponents, or above the limit. There is no free ticket, so 0 is refused.
 */
export function parseEgp(input: string): number | null {
  const v = input.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null
  const minor = Math.round(Number(v) * 100)
  return minor >= 1 && minor <= MAX_PRICE_MINOR ? minor : null
}

export const MIN_REASON = 5

/** A cancellation needs a real reason (the server enforces it too). Returns a message, or null when fine. */
export function reasonProblem(reason: string): string | null {
  const t = reason.trim()
  if (t.length === 0) return 'Say why the order is being cancelled.'
  if (t.length < MIN_REASON) return `Give a little more detail (at least ${MIN_REASON} characters).`
  if (t.length > 500) return 'Keep the reason under 500 characters.'
  return null
}

/** An order can be cancelled while it is waiting for payment or paid, never after it is cancelled or expired. */
export const canCancelOrder = (status: OrderStatus): boolean => status === 'PENDING_PAYMENT' || status === 'PAID'

export type EmailStatus = 'PENDING' | 'SENT' | 'FAILED'

export const EMAIL_STATUS_LABEL: Record<EmailStatus, string> = { PENDING: 'Waiting to send', SENT: 'Sent', FAILED: 'Failed' }
export const EMAIL_STATUS_TONE: Record<EmailStatus, 'neutral' | 'teal' | 'amber' | 'red'> = { PENDING: 'amber', SENT: 'teal', FAILED: 'red' }

export interface EmailRow {
  id: string
  template: string
  recipient: string
  status: EmailStatus
  attempts: number
  lastError: string | null
  sentAt: string | null
  createdAt: string
  nextAttemptAt: string | null
}

/** A ticket can be cancelled while it is waiting or valid; a used or already cancelled ticket cannot. */
export const canCancelTicket = (ticketStatus: string): boolean => ticketStatus === 'PENDING' || ticketStatus === 'VALID'

/** Tickets are e-mailed only for a paid order. */
export const canResendTickets = (orderStatus: OrderStatus): boolean => orderStatus === 'PAID'

/** What to tell staff about one message: sent when, or why it failed and what happens next. */
export function emailSummary(e: Pick<EmailRow, 'status' | 'attempts' | 'nextAttemptAt' | 'sentAt'>, formatMoment: (iso: string | null) => string, maxAttempts = 5): string {
  if (e.status === 'SENT') return `Sent ${formatMoment(e.sentAt)}`
  if (e.status === 'PENDING') return 'Waiting to be sent'
  if (e.nextAttemptAt) return `Failed (attempt ${e.attempts} of ${maxAttempts}); next try ${formatMoment(e.nextAttemptAt)}`
  return `Failed after ${e.attempts} attempt${e.attempts === 1 ? '' : 's'}; it will not be tried again. Use “Resend e-mail”.`
}

export interface OrderRow {
  id: string
  orderNumber: string
  status: OrderStatus
  channel: 'ONLINE' | 'COUNTER_SALE'
  visitDate: string
  totalMinor: number
  currency: string
  ticketCount: number
  createdAt: string
  paidAt: string | null
  expiresAt: string | null
  paymentStatus?: PaymentStatus | null
  customer?: { fullName: string; email: string | null; phone: string | null }
}

export interface OrderDetail {
  id: string
  orderNumber: string
  status: OrderStatus
  channel: 'ONLINE' | 'COUNTER_SALE'
  visitDate: string
  currency: string
  subtotalMinor: number
  discountMinor: number
  totalMinor: number
  createdAt: string
  expiresAt: string | null
  paidAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  cancelledBy: string | null
  customer?: { fullName: string; email: string | null; phone: string | null; consentedAt: string | null }
  items: Array<{ id: string; typeNameEn: string; typeNameAr: string; audienceNameEn: string; audienceNameAr: string; unitPriceMinor: number; quantity: number; lineTotalMinor: number }>
  ticketCounts: Record<string, number>
  tickets?: Array<{ ref: string; status: string; typeNameEn: string; pricePaidMinor: number }>
  emails?: EmailRow[]
  payments?: Array<{ id: string; provider: string; method: string; status: PaymentStatus; amountMinor: number; currency: string; paidAt: string | null; createdAt: string }>
}

export interface TicketTypeRow {
  id: string
  code: string
  nameEn: string
  nameAr: string
  descriptionEn: string | null
  descriptionAr: string | null
  minAge: number
  maxAge: number | null
  isActive: boolean
  sortOrder: number
  timesSold: number
  priceRows: number
}

export interface AudienceRow {
  id: string
  code: string
  nameEn: string
  nameAr: string
  isActive: boolean
}

export interface PriceRowData {
  id: string
  ticketTypeId: string
  ticketType: { code: string; nameEn: string; nameAr: string }
  audienceId: string
  audience: { code: string; nameEn: string; nameAr: string }
  kind: 'STANDARD' | 'SPECIAL' | 'PROMOTIONAL'
  days: PriceDays
  amountMinor: number
  currency: string
  validFrom: string
  validTo: string | null
  isActive: boolean
  status: PriceStatus
  notes: string | null
  timesUsed: number
}

export interface CurrentPrices {
  today: string
  audiences: Array<{ id: string; code: string; nameEn: string; nameAr: string }>
  types: Array<{ id: string; code: string; nameEn: string; nameAr: string; isActive: boolean }>
  cells: Array<{ audienceId: string; ticketTypeId: string; weekdayMinor: number | null; weekendMinor: number | null }>
}

/** "9+" or "2–8" */
export const ageRange = (t: { minAge: number; maxAge: number | null }): string => (t.maxAge === null ? `${t.minAge}+` : `${t.minAge}–${t.maxAge}`)

export interface TypeForm {
  code: string
  nameEn: string
  nameAr: string
  descriptionEn: string
  descriptionAr: string
  minAge: string
  maxAge: string
  isActive: boolean
}

export const emptyTypeForm = (): TypeForm => ({ code: '', nameEn: '', nameAr: '', descriptionEn: '', descriptionAr: '', minAge: '', maxAge: '', isActive: true })
export const typeToForm = (t: TicketTypeRow): TypeForm => ({
  code: t.code, nameEn: t.nameEn, nameAr: t.nameAr, descriptionEn: t.descriptionEn ?? '', descriptionAr: t.descriptionAr ?? '',
  minAge: String(t.minAge), maxAge: t.maxAge === null ? '' : String(t.maxAge), isActive: t.isActive,
})

/** Messages shown next to the fields; the server repeats every rule. Children under 2 never need a ticket. */
export function typeProblems(f: TypeForm, creating: boolean): Partial<Record<keyof TypeForm, string>> {
  const out: Partial<Record<keyof TypeForm, string>> = {}
  if (creating && !/^[A-Z][A-Z0-9_]{1,29}$/.test(f.code.trim().toUpperCase())) out.code = 'Use letters, digits and underscores, for example SENIOR.'
  if (f.nameEn.trim().length < 2) out.nameEn = 'Enter the English name.'
  if (f.nameAr.trim().length < 2) out.nameAr = 'Enter the Arabic name.'
  const min = Number(f.minAge)
  if (f.minAge.trim() === '' || !Number.isInteger(min)) out.minAge = 'Enter the youngest age as a whole number.'
  else if (min < 2) out.minAge = 'Children under 2 enter free and do not need a ticket, so the youngest age must be 2 or more.'
  if (f.maxAge.trim() !== '') {
    const max = Number(f.maxAge)
    if (!Number.isInteger(max)) out.maxAge = 'Enter the oldest age as a whole number, or leave it empty for no upper limit.'
    else if (!out.minAge && max < min) out.maxAge = 'The oldest age cannot be below the youngest age.'
  }
  return out
}

export interface PriceForm {
  ticketTypeId: string
  audienceId: string
  days: 'WEEKDAY' | 'WEEKEND' | 'EVERY_DAY'
  amount: string
  validFrom: string
  notes: string
}

export function priceProblems(f: PriceForm, today: string): Partial<Record<keyof PriceForm, string>> {
  const out: Partial<Record<keyof PriceForm, string>> = {}
  if (!f.ticketTypeId) out.ticketTypeId = 'Choose a ticket type.'
  if (!f.audienceId) out.audienceId = 'Choose who the price is for.'
  if (parseEgp(f.amount) === null) out.amount = 'Enter a price above 0 EGP, with at most two decimals, for example 50 or 62.50.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.validFrom)) out.validFrom = 'Choose the first day the price applies.'
  else if (f.validFrom < today) out.validFrom = 'A new price must start today or later. Past prices cannot be rewritten.'
  return out
}

/** The ISO date of the day before (the day the previous price will end). */
export function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** "7 Oct 2026" — the date exactly as stored (a calendar day, not a moment), so no time zone can shift it. */
export function formatDay(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]
  return `${d} ${month} ${y}`
}

/** A moment, shown in the park's own time (Cairo), whatever the staff member's computer is set to. */
export function formatMoment(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
}
