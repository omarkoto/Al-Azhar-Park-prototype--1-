import { useEffect, useState } from 'react'
import { API_URL } from './api'

/**
 * Everything the public site needs to buy tickets from the park's server. The server decides every price and every
 * rule (dates, cut-off, quantities); the site only shows what it is told and sends back codes and quantities.
 */

export class BookingError extends Error {
  readonly code: string
  readonly status: number
  readonly details?: unknown

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
  }
}

export interface CatalogAudience {
  code: string
  nameEn: string
  nameAr: string
  descriptionEn: string | null
  descriptionAr: string | null
}
export interface CatalogType extends CatalogAudience {
  minAge: number
  maxAge: number | null
}
export interface DayInfo {
  date: string
  dayType: 'WEEKDAY' | 'WEEKEND'
  opens: string | null
  closes: string | null
  sale: { allowed: true; salesCloseAt: string | null } | { allowed: false; reason: string }
  prices: Array<{ audience: string; ticketType: string; amountMinor: number; currency: string }>
}
export interface Catalog {
  currency: string
  today: string
  lastBookableDate: string
  freeUnderAge: number
  policy: { maxAdvanceDays: number; sameDayCutoffMinutesBeforeClose: number; maxTicketsPerOrder: number; pendingExpiryMinutes: number }
  onlinePayment: boolean
  audiences: CatalogAudience[]
  ticketTypes: CatalogType[]
  /** what a visitor pays on the next weekday and the next weekend day, per audience and ticket type */
  priceList: Array<{ audience: string; ticketType: string; weekdayMinor: number | null; weekendMinor: number | null }>
  day: DayInfo | null
}

export interface QuoteLine {
  ticketType: string
  nameEn: string
  nameAr: string
  unitPriceMinor: number
  quantity: number
  lineTotalMinor: number
}
export interface Quote {
  visitDate: string
  dayType: 'WEEKDAY' | 'WEEKEND'
  audience: { code: string; nameEn: string; nameAr: string }
  currency: string
  lines: QuoteLine[]
  totalTickets: number
  totalMinor: number
  expiresInMinutes: number
}

export interface PublicOrder {
  orderNumber: string
  status: 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED' | 'EXPIRED'
  visitDate: string
  dayType: 'WEEKDAY' | 'WEEKEND'
  currency: string
  totalMinor: number
  expiresAt: string | null
  paidAt: string | null
  customer: { fullName: string; email: string | null } | null
  items: Array<{ typeNameEn: string; typeNameAr: string; audienceNameEn: string; audienceNameAr: string; unitPriceMinor: number; quantity: number; lineTotalMinor: number }>
  payment: { status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED'; provider: string; isMock: boolean; providerTxnId: string | null } | null
  locale: 'en' | 'ar'
  /** only for a paid order; `qr` is the code's image (a data: URL) while the ticket is valid */
  tickets: Array<{ ref: string; typeNameEn: string; typeNameAr: string; audienceNameEn: string; audienceNameAr: string; status: 'PENDING' | 'VALID' | 'USED' | 'CANCELLED' | 'EXPIRED'; pricePaidMinor: number; qr: string | null }>
}
export interface PaymentInfo {
  status: string
  provider: string
  isMock: boolean
  providerTxnId: string | null
  amountMinor: number
  currency: string
}
export interface CreatedOrder {
  order: PublicOrder
  accessToken: string
  payment: PaymentInfo
}

export interface Selection {
  visitDate: string
  audience: string
  items: Array<{ ticketType: string; quantity: number }>
}
export interface CustomerInput {
  fullName: string
  email: string
  phone: string | null
}

async function call<T>(method: 'GET' | 'POST', path: string, opts: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
  if (!API_URL) throw new BookingError('UNAVAILABLE', 'Online booking is not configured.', 0)
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new BookingError('NETWORK', 'The booking service cannot be reached.', 0)
  }
  const json = (await res.json().catch(() => null)) as { data?: T; error?: { code?: string; message?: string; details?: unknown } } | null
  if (!res.ok) throw new BookingError(json?.error?.code ?? 'ERROR', json?.error?.message ?? `Request failed (${res.status})`, res.status, json?.error?.details)
  return json?.data as T
}

export const fetchCatalog = (date?: string, signal?: AbortSignal) => call<Catalog>('GET', `/public/tickets/catalog${date ? `?date=${encodeURIComponent(date)}` : ''}`, { signal })
export const fetchQuote = (selection: Selection, signal?: AbortSignal) => call<Quote>('POST', '/public/orders/quote', { body: selection, signal })
export const createOrder = (selection: Selection, customer: CustomerInput, locale: 'en' | 'ar', idempotencyKey: string) =>
  call<CreatedOrder>('POST', '/public/orders', { body: { ...selection, customer, acceptTerms: true, locale }, headers: { 'Idempotency-Key': idempotencyKey } })
export const fetchOrder = (orderNumber: string, token: string, signal?: AbortSignal) =>
  call<PublicOrder>('GET', `/public/orders/${encodeURIComponent(orderNumber)}`, { headers: { 'X-Order-Token': token }, signal })
export const payAgain = (orderNumber: string, token: string) =>
  call<{ order: PublicOrder; payment: PaymentInfo }>('POST', `/public/orders/${encodeURIComponent(orderNumber)}/payments`, { body: {}, headers: { 'X-Order-Token': token } })
/**
 * Downloads the ticket PDF (all tickets, or one) and hands it to the browser as a file. The order's private key goes in a
 * header, never in the address, so it cannot end up in logs, history or a shared link.
 */
export async function downloadTicketsPdf(orderNumber: string, token: string, options: { ref?: string; lang: 'en' | 'ar' }): Promise<void> {
  if (!API_URL) throw new BookingError('UNAVAILABLE', 'Online booking is not configured.', 0)
  const path = options.ref ? `/public/orders/${encodeURIComponent(orderNumber)}/tickets/${encodeURIComponent(options.ref)}/pdf` : `/public/orders/${encodeURIComponent(orderNumber)}/tickets/pdf`
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}?lang=${options.lang}`, { headers: { 'X-Order-Token': token } })
  } catch {
    throw new BookingError('NETWORK', 'The booking service cannot be reached.', 0)
  }
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
    throw new BookingError(json?.error?.code ?? 'ERROR', json?.error?.message ?? `Download failed (${res.status})`, res.status)
  }
  const url = URL.createObjectURL(await res.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = options.ref ? `${options.ref}.pdf` : `al-azhar-park-${orderNumber}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** DEVELOPMENT ONLY: the stand-in payment page. The server refuses it unless the mock provider is switched on. */
export const completeMockPayment = (txnId: string, outcome: 'SUCCESS' | 'FAILURE') =>
  call<{ result: string; orderNumber: string }>('POST', `/public/payments/mock/${encodeURIComponent(txnId)}/complete`, { body: { outcome } })

// ───────────────────────────── the cart as a selection ─────────────────────────────

const TICKET_ID = /^([A-Z][A-Z0-9_]{1,29}):([A-Z][A-Z0-9_]{1,29})$/

/** A cart line names its audience and ticket type: "RESIDENT:ADULT". */
export const makeTicketId = (audience: string, ticketType: string) => `${audience}:${ticketType}`
export function parseTicketId(id: string): { audience: string; ticketType: string } | null {
  const m = TICKET_ID.exec(id)
  return m ? { audience: m[1], ticketType: m[2] } : null
}

export type CartProblem = 'EMPTY' | 'NO_DATE' | 'MIXED_DATE' | 'MIXED_AUDIENCE' | 'INVALID'

/**
 * Turns the cart into what is sent to the server: one visit date, one audience, a quantity per ticket type.
 * A cart that mixes dates or audiences cannot be bought in one order, and is reported instead of guessed at.
 */
export function cartSelection(lines: ReadonlyArray<{ ticketId: string; qty: number; visitDate: string | null }>): { selection: Selection } | { problem: CartProblem } {
  if (lines.length === 0) return { problem: 'EMPTY' }
  const dates = new Set(lines.map((l) => l.visitDate))
  if (dates.has(null) || dates.has('')) return { problem: 'NO_DATE' }
  if (dates.size > 1) return { problem: 'MIXED_DATE' }
  const parsed = lines.map((l) => ({ ...parseTicketId(l.ticketId), qty: l.qty }))
  if (parsed.some((p) => !p.audience || !p.ticketType || !Number.isInteger(p.qty) || p.qty < 1)) return { problem: 'INVALID' }
  if (new Set(parsed.map((p) => p.audience)).size > 1) return { problem: 'MIXED_AUDIENCE' }
  const byType = new Map<string, number>()
  for (const p of parsed) byType.set(p.ticketType!, (byType.get(p.ticketType!) ?? 0) + p.qty)
  return { selection: { visitDate: [...dates][0] as string, audience: parsed[0].audience!, items: [...byType].map(([ticketType, quantity]) => ({ ticketType, quantity })) } }
}

/** Keeps only lines this version of the site understands (older carts used other ids and no date). */
export function sanitizeLines<T extends { ticketId: unknown; qty: unknown; visitDate: unknown }>(stored: unknown): T[] {
  if (!Array.isArray(stored)) return []
  return stored.filter(
    (l): l is T =>
      !!l && typeof l === 'object' && typeof (l as T).ticketId === 'string' && parseTicketId((l as T).ticketId as string) !== null &&
      Number.isInteger((l as T).qty) && ((l as T).qty as number) >= 1 && ((l as T).qty as number) <= 1000 &&
      typeof (l as T).visitDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test((l as T).visitDate as string),
  )
}

// ───────────────────────────── messages ─────────────────────────────

/** The translation key that explains a refusal from the server. */
export function problemKey(code: string): string {
  switch (code) {
    case 'DATE_IN_THE_PAST': return 'bookErrPast'
    case 'DATE_TOO_FAR_AHEAD': return 'bookErrTooFar'
    case 'PARK_CLOSED': return 'bookErrClosed'
    case 'SALES_CLOSED_FOR_TODAY': return 'bookErrCutoff'
    case 'PRICE_NOT_AVAILABLE': return 'bookErrPrice'
    case 'TOO_MANY_TICKETS': return 'bookErrTooMany'
    case 'INVALID_TICKET_TYPE':
    case 'INVALID_AUDIENCE': return 'bookErrInvalid'
    case 'SOLD_OUT': return 'bookErrSoldOut'
    case 'PAYMENT_NOT_AVAILABLE': return 'bookErrNoPayment'
    case 'UNAVAILABLE':
    case 'NETWORK': return 'bookErrNetwork'
    case 'RATE_LIMITED': return 'bookErrBusy'
    case 'ORDER_EXPIRED': return 'bookErrExpired'
    default: return 'bookErrGeneric'
  }
}

export const pounds = (minor: number): number => minor / 100

export function secondsLeft(expiresAt: string | null, now: number): number {
  if (!expiresAt) return 0
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000))
}

/** 125 → "02:05" */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** A random key so a repeated submit (double click, retry after a dropped connection) cannot create two orders. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

/** The customer's key to an order is kept in this browser and also in the page address, so the page can be saved. */
const tokenKey = (orderNumber: string) => `azharpark-order-${orderNumber}`
export function saveOrderToken(orderNumber: string, token: string): void {
  try {
    window.localStorage.setItem(tokenKey(orderNumber), token)
  } catch {
    /* private mode: the address still carries it */
  }
}
export function loadOrderToken(orderNumber: string, hash: string): string | null {
  const fromHash = tokenFromHash(hash)
  if (fromHash) return fromHash
  try {
    return window.localStorage.getItem(tokenKey(orderNumber))
  } catch {
    return null
  }
}
export function tokenFromHash(hash: string): string | null {
  const m = /[#&]k=([A-Za-z0-9_-]{20,200})/.exec(hash)
  return m ? m[1] : null
}

/** "09:00" → minutes, for showing opening hours in the visitor's own digits. */
export function hhmmParts(hhmm: string | null): { h: number; m: number } | null {
  const m = hhmm ? /^(\d{2}):(\d{2})$/.exec(hhmm) : null
  return m ? { h: Number(m[1]), m: Number(m[2]) } : null
}

// ───────────────────────────── loading the catalog ─────────────────────────────

export interface CatalogState {
  /** loading: first answer on its way. unavailable: booking is not set up, or the server cannot be reached. */
  status: 'loading' | 'ready' | 'unavailable'
  catalog: Catalog | null
  /** the opening hours, sale decision and prices for the chosen date (null until known) */
  day: DayInfo | null
  dayLoading: boolean
}

/** The ticket catalog, and the details of one visit date. Re-asks when the date changes; keeps the last answer on screen meanwhile. */
export function useBookingCatalog(date: string): CatalogState {
  const [state, setState] = useState<CatalogState>({ status: API_URL ? 'loading' : 'unavailable', catalog: null, day: null, dayLoading: false })

  useEffect(() => {
    if (!API_URL) return
    const controller = new AbortController()
    setState((s) => ({ ...s, dayLoading: !!date }))
    fetchCatalog(date || undefined, controller.signal)
      .then((catalog) => setState({ status: 'ready', catalog, day: catalog.day, dayLoading: false }))
      .catch((e: unknown) => {
        if ((e as Error).name === 'AbortError') return
        setState((s) => (s.catalog ? { ...s, dayLoading: false } : { status: 'unavailable', catalog: null, day: null, dayLoading: false }))
      })
    return () => controller.abort()
  }, [date])

  return state
}

// ───────────────────────────── customer details ─────────────────────────────

/** "٠١٠٠١٢٣" → "0100123": phones typed with Arabic digits are sent in the form the server checks. */
export function toAsciiDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
}

export interface CustomerForm {
  fullName: string
  email: string
  phone: string
  accepted: boolean
}
export type CustomerProblems = Partial<Record<'fullName' | 'email' | 'phone' | 'accepted', true>>

/** What is wrong with the checkout form (the server checks all of it again). */
export function customerProblems(f: CustomerForm): CustomerProblems {
  const out: CustomerProblems = {}
  if (f.fullName.trim().length < 2) out.fullName = true
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) out.email = true
  const phone = toAsciiDigits(f.phone).trim()
  if (phone !== '' && !/^\+?[0-9 ()-]{6,20}$/.test(phone)) out.phone = true
  if (!f.accepted) out.accepted = true
  return out
}

export function customerInput(f: CustomerForm): CustomerInput {
  const phone = toAsciiDigits(f.phone).trim()
  return { fullName: f.fullName.trim(), email: f.email.trim().toLowerCase(), phone: phone === '' ? null : phone }
}
