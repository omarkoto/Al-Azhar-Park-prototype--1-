import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
// the SAME code the server signs and checks with: tests build a ticket's QR text with it, there is no second scheme
import { createQrPayload } from '../../backend/src/common/security/ticket-qr'
import { API } from './helpers'

const BACKEND = join(__dirname, '..', '..', 'backend')

/** Reads KEY=VALUE lines (quotes allowed) from backend/.env, the same file the API itself uses. */
function backendEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  const file = join(BACKEND, '.env')
  if (!existsSync(file)) return env
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return env
}

export function backendSecret(): string {
  return backendEnv().TICKET_TOKEN_PEPPER || 'dev-only-ticket-pepper-do-not-deploy-0123456789abcdef'
}

/** Calls the API as the signed-in person (refresh cookie → access token), for setting up or checking state. */
export async function apiAs(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  return page.evaluate(
    async ({ api, method, path, body }) => {
      const r = await fetch(`${api}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const token = (await r.json()).data.accessToken as string
      const res = await fetch(`${api}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      return { status: res.status, data: (await res.json().catch(() => ({}))).data }
    },
    { api: API, method, path, body },
  )
}

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export interface Bought {
  orderNumber: string
  token: string
  ref: string
  code: string
}

/** Buys one paid ticket through the public API (the flow customers use). */
export async function buyTicket(request: APIRequestContext, visitDate: string, over: { audience?: string; ticketType?: string; quantity?: number; name?: string } = {}): Promise<Bought> {
  const created = await request.post(`${API}/public/orders`, {
    data: {
      visitDate, audience: over.audience ?? 'RESIDENT', items: [{ ticketType: over.ticketType ?? 'ADULT', quantity: over.quantity ?? 1 }],
      customer: { fullName: over.name ?? 'Ops Test', email: 'ops@example.com' }, acceptTerms: true, locale: 'en',
    },
  })
  expect(created.status()).toBe(201)
  const body = (await created.json()).data
  const paid = await request.post(`${API}/public/payments/mock/${body.payment.providerTxnId}/complete`, { data: { outcome: 'SUCCESS' } })
  expect(paid.status()).toBe(200)
  const order = await request.get(`${API}/public/orders/${body.order.orderNumber}`, { headers: { 'X-Order-Token': body.accessToken } })
  const ticket = (await order.json()).data.tickets[0]
  return { orderNumber: body.order.orderNumber, token: body.accessToken, ref: ticket.ref, code: createQrPayload(ticket.ref, 1, backendSecret()) }
}

/**
 * Tickets for today can be bought until an hour before closing. Late in the evening that is over, which would make
 * every "today" scenario depend on the clock, so the tests keep today open: the park stays open until 23:59 and, in the
 * last hour of the day, the same-day cut-off is set to 0 minutes on the TEST database. Returns the clean-up to run afterwards.
 */
export async function keepOpenToday(admin: Page, today: string): Promise<() => Promise<void>> {
  const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
  const [hour, minute] = now.split(':').map(Number)
  if (hour < 19) return async () => undefined
  const made = await apiAs(admin, 'POST', '/special-hours', { kind: 'SPECIAL_HOURS', dateFrom: today, dateTo: today, isClosed: false, opens: '00:00', closes: '23:59', labelEn: 'Test hours', labelAr: 'ساعات اختبار', priority: 50 })
  expect(made.status).toBe(201)
  let restoreCutoff: (() => Promise<void>) | null = null
  if (hour * 60 + minute >= 22 * 60 + 55) restoreCutoff = await setCutoffMinutes(0)
  return async () => {
    await apiAs(admin, 'DELETE', `/special-hours/${made.data.id}`)
    if (restoreCutoff) await restoreCutoff()
  }
}

/** Changes the same-day cut-off setting on the test database (there is no portal page for it); returns how to put it back. */
async function setCutoffMinutes(minutes: number): Promise<() => Promise<void>> {
  const { PrismaClient } = createRequire(join(BACKEND, 'package.json'))('@prisma/client') as { PrismaClient: new (o: { datasourceUrl?: string }) => any }
  const prisma = new PrismaClient({ datasourceUrl: backendEnv().TEST_DATABASE_URL })
  const key = 'booking.sameDayCutoffMinutesBeforeClose'
  const before = await prisma.systemSetting.findUniqueOrThrow({ where: { key } })
  await prisma.systemSetting.update({ where: { key }, data: { value: minutes } })
  return async () => {
    await prisma.systemSetting.update({ where: { key }, data: { value: before.value } })
    await prisma.$disconnect()
  }
}

/** Friday and Saturday are the weekend (the park's own split); every other day is a weekday. */
export const isWeekend = (iso: string) => [5, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay())

/** The first weekday (Sunday to Thursday) on or after a date. */
export function nextWeekday(from: string): string {
  let d = from
  while (isWeekend(d)) d = addDays(d, 1)
  return d
}

/** What the seeded price list charges one adult resident that day, in piastres. */
export const residentAdultPrice = (iso: string) => (isWeekend(iso) ? 6000 : 5000)
