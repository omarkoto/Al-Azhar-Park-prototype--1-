import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test'
// the SAME code the server signs and checks with: the test builds a ticket's QR text with it, there is no second scheme
import { createQrPayload } from '../../backend/src/common/security/ticket-qr'
import { API, PORTAL, SITE, USERS, nav, signedInPage } from './helpers'

function backendSecret(): string {
  const file = join(__dirname, '..', '..', 'backend', '.env')
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*TICKET_TOKEN_PEPPER\s*=\s*(.*)\s*$/.exec(line)
      if (m && m[1]) return m[1].replace(/^(['"])(.*)\1$/, '$2')
    }
  }
  return 'dev-only-ticket-pepper-do-not-deploy-0123456789abcdef'
}
const SECRET = backendSecret()

async function apiAs(page: Page, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
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

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

interface Bought {
  orderNumber: string
  token: string
  ref: string
  code: string
  qrImage: string
}

let TODAY = ''
let admin: Page
let closeAdmin: () => Promise<void>
let specialHoursId: string | null = null

/** Buys one paid ticket through the public API (the flow customers use) and returns its references and QR text. */
async function buy(request: APIRequestContext, visitDate: string): Promise<Bought> {
  const created = await request.post(`${API}/public/orders`, {
    data: { visitDate, audience: 'RESIDENT', items: [{ ticketType: 'ADULT', quantity: 1 }], customer: { fullName: 'Gate Test', email: 'gate@example.com' }, acceptTerms: true, locale: 'en' },
  })
  expect(created.status()).toBe(201)
  const body = (await created.json()).data
  const paid = await request.post(`${API}/public/payments/mock/${body.payment.providerTxnId}/complete`, { data: { outcome: 'SUCCESS' } })
  expect(paid.status()).toBe(200)
  const order = await request.get(`${API}/public/orders/${body.order.orderNumber}`, { headers: { 'X-Order-Token': body.accessToken } })
  const view = (await order.json()).data
  const ticket = view.tickets[0]
  return { orderNumber: body.order.orderNumber, token: body.accessToken, ref: ticket.ref, code: createQrPayload(ticket.ref, 1, SECRET), qrImage: ticket.qr }
}

async function openScanner(browser: Browser, email: string = USERS.staff, init?: (context: BrowserContext) => Promise<void>) {
  const context = await browser.newContext()
  if (init) await init(context)
  const page = await context.newPage()
  await page.goto(`${PORTAL}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? 'E2e-Password-2026!')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible()
  await nav(page).getByRole('link', { name: 'Gate scanner', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Gate scanner' })).toBeVisible()
  return { page, context }
}

async function chooseGate(page: Page, name = 'Main entrance') {
  await page.getByTestId('gate-select').selectOption({ label: name })
  await expect(page.getByTestId('manual-code')).toBeVisible()
}

async function submitManual(page: Page, code: string) {
  await page.getByTestId('manual-code').fill(code)
  await page.getByRole('button', { name: 'Check ticket' }).click()
}

const result = (page: Page) => page.getByTestId('scan-result')

/** A camera that is a picture: the page's getUserMedia returns a stream drawn from `dataUrl`. */
const fakeCamera = (dataUrl: string | null, mode: 'picture' | 'denied' = 'picture') => async (context: BrowserContext) => {
  await context.addInitScript(
    ({ dataUrl, mode }) => {
      const opened: MediaStreamTrack[] = []
      ;(window as unknown as { __cameraTracks: MediaStreamTrack[] }).__cameraTracks = opened
      navigator.mediaDevices.getUserMedia = async () => {
        if (mode === 'denied') throw new DOMException('Permission denied', 'NotAllowedError')
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 480
        const ctx = canvas.getContext('2d')!
        const img = new Image()
        if (dataUrl) img.src = dataUrl
        const draw = () => {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, 640, 480)
          if (dataUrl && img.complete) ctx.drawImage(img, 120, 40, 400, 400)
        }
        draw()
        setInterval(draw, 80)
        const stream = canvas.captureStream(15)
        stream.getTracks().forEach((t) => opened.push(t))
        return stream
      }
    },
    { dataUrl, mode },
  )
}

test.describe.serial('gate scanner', () => {
  test.beforeAll(async ({ browser }) => {
    const s = await signedInPage(browser, USERS.admin)
    admin = s.page
    closeAdmin = () => s.context.close()
    TODAY = (await (await admin.request.get(`${API}/public/tickets/catalog`)).json()).data.today
    // tickets for today can be bought until an hour before closing: late in the evening, keep the park open later today
    const cairoHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
    if (cairoHour >= 19) {
      const made = await apiAs(admin, 'POST', '/special-hours', { kind: 'SPECIAL_HOURS', dateFrom: TODAY, dateTo: TODAY, isClosed: false, opens: '00:00', closes: '23:59', labelEn: 'Scanner test hours', labelAr: 'ساعات اختبار', priority: 50 })
      expect(made.status).toBe(201)
      specialHoursId = made.data.id
    }
  })
  test.afterAll(async () => {
    if (specialHoursId) await apiAs(admin, 'DELETE', `/special-hours/${specialHoursId}`)
    await closeAdmin()
  })

  test('the scanner is for people who may scan: it is in their menu, and others are refused', async ({ browser }) => {
    const staff = await signedInPage(browser, USERS.staff)
    await expect(nav(staff.page).getByRole('link', { name: 'Gate scanner', exact: true })).toBeVisible()
    await staff.context.close()
    for (const email of [USERS.analyst, USERS.content]) {
      const other = await signedInPage(browser, email)
      await expect(nav(other.page).getByRole('link', { name: 'Gate scanner', exact: true })).toHaveCount(0)
      await other.page.goto(`${PORTAL}/scanner`)
      await expect(other.page.getByText('You do not have access to this page.')).toBeVisible()
      // and the server refuses them whatever the screen shows
      const refused = await apiAs(other.page, 'POST', '/scans', { qr: 'AZP1.x', gateId: '7b9d8c6e-1b0d-4f4a-9a2e-0f0b6c6d5a11' })
      expect(refused.status).toBe(403)
      await other.context.close()
    }
  })

  test('the page asks for a gate first, lists the active gates, and shows the camera area and the manual entry', async ({ browser }) => {
    const { page, context } = await openScanner(browser, USERS.staff, fakeCamera(null))
    await expect(page.getByText('Choose the gate you are working at to start scanning.')).toBeVisible()
    await expect(page.getByTestId('manual-code')).toHaveCount(0)
    const options = await page.getByTestId('gate-select').locator('option').allTextContents()
    expect(options).toEqual(['Choose a gate…', 'Darassa entrance', 'Main entrance'])
    await chooseGate(page)
    await expect(page.getByTestId('camera')).toBeVisible()
    await expect(page.getByTestId('camera')).toHaveAttribute('data-camera', 'on')
    await expect(page.getByTestId('manual-code')).toBeFocused()
    await expect(page.getByText('Gate: Main entrance')).toBeVisible()
    // the choice is remembered on this device
    await page.reload()
    await expect(page.getByTestId('gate-select')).toHaveValue(/.+/)
    await expect(page.getByTestId('manual-code')).toBeVisible()
    await context.close()
  })

  test('a valid ticket: ACCESS GRANTED, then the same ticket is ALREADY USED', async ({ browser }) => {
    const ticket = await buy(admin.request, TODAY)
    const { page, context } = await openScanner(browser, USERS.staff, fakeCamera(null))
    await chooseGate(page)
    await submitManual(page, ticket.code)
    await expect(result(page)).toHaveAttribute('data-result', 'ACCESS_GRANTED')
    await expect(result(page)).toHaveAttribute('data-granted', 'true')
    await expect(page.getByTestId('scan-headline')).toHaveText('ACCESS GRANTED')
    await expect(page.getByTestId('scan-ref')).toHaveText(ticket.ref)
    await expect(result(page)).toContainText('Main entrance')
    await expect(result(page)).toContainText('Adult')
    await expect(result(page)).toContainText('Scanned')
    for (const private_ of ['Gate Test', 'gate@example.com']) await expect(result(page)).not.toContainText(private_)

    // next ticket: the same one again
    await page.getByTestId('scan-next').click()
    await expect(result(page)).toHaveCount(0)
    await expect(page.getByTestId('manual-code')).toBeFocused()
    await submitManual(page, ticket.code)
    await expect(result(page)).toHaveAttribute('data-result', 'ALREADY_USED')
    await expect(result(page)).toHaveAttribute('data-granted', 'false')
    await expect(page.getByTestId('scan-headline')).toHaveText('TICKET ALREADY USED')
    await expect(result(page)).toContainText('Access denied')
    await expect(result(page)).toContainText('First used')
    await context.close()
  })

  test('refused tickets say why: wrong date, cancelled, forged, not a ticket, unknown', async ({ browser }) => {
    const tomorrow = await buy(admin.request, addDays(TODAY, 1))
    const cancelled = await buy(admin.request, TODAY)
    const orders = (await apiAs(admin, 'GET', `/orders?search=${cancelled.orderNumber}`)).data as Array<{ id: string }>
    expect((await apiAs(admin, 'POST', `/orders/${orders[0].id}/tickets/${cancelled.ref}/cancel`, { reason: 'Duplicate purchase by mistake' })).status).toBe(200)
    const forged = `${cancelled.code.slice(0, -2)}${cancelled.code.endsWith('A') ? 'BB' : 'AA'}`

    const { page, context } = await openScanner(browser, USERS.staff, fakeCamera(null))
    await chooseGate(page, 'Darassa entrance')
    const expectDenied = async (code: string, resultCode: string, headline: string, text?: string) => {
      await submitManual(page, code)
      await expect(result(page)).toHaveAttribute('data-result', resultCode)
      await expect(result(page)).toHaveAttribute('data-granted', 'false')
      await expect(page.getByTestId('scan-headline')).toHaveText(headline)
      await expect(result(page)).toContainText('Access denied')
      if (text) await expect(result(page)).toContainText(text)
      await expect(result(page)).toContainText('Darassa entrance')
      await page.getByTestId('scan-next').click()
    }
    await expectDenied(tomorrow.code, 'WRONG_DATE', 'WRONG VISIT DATE', addDays(TODAY, 1).slice(0, 4))
    await expectDenied(cancelled.code, 'CANCELLED', 'TICKET CANCELLED')
    await expectDenied(forged, 'INVALID_SIGNATURE', 'INVALID TICKET')
    await expectDenied('hello world', 'INVALID_QR', 'INVALID TICKET')
    await expectDenied(createQrPayload('TKT-AAAAAAAAAA', 1, SECRET), 'TICKET_NOT_FOUND', 'TICKET NOT FOUND')
    await expectDenied(createQrPayload(tomorrow.ref, 7, SECRET).replace('.7.', '.9.'), 'RETIRED_KEY', 'TICKET NOT ACCEPTED')

    // the wrong-date ticket was not used up: it is still good on its own day
    const stillValid = await admin.request.get(`${API}/public/orders/${tomorrow.orderNumber}`, { headers: { 'X-Order-Token': tomorrow.token } })
    expect((await stillValid.json()).data.tickets[0].status).toBe('VALID')
    await context.close()
  })

  test('the camera reads a ticket by itself, and does not submit the same ticket again and again', async ({ browser }) => {
    const ticket = await buy(admin.request, TODAY)
    const { page, context } = await openScanner(browser, USERS.staff, fakeCamera(ticket.qrImage))
    await chooseGate(page)
    await expect(page.getByTestId('camera')).toHaveAttribute('data-camera', 'on')
    // nothing was typed: the camera found the code and the server let the ticket in
    await expect(result(page)).toHaveAttribute('data-result', 'ACCESS_GRANTED', { timeout: 15_000 })
    await expect(page.getByTestId('scan-ref')).toHaveText(ticket.ref)

    // while the result is on screen the camera keeps looking at the same ticket, but nothing else is submitted
    await page.waitForTimeout(1500)
    await expect(result(page)).toHaveAttribute('data-result', 'ACCESS_GRANTED')
    await page.getByTestId('scan-next').click()
    // the same ticket is still in front of the camera: after a short pause it is read again and refused as used
    await expect(result(page)).toHaveAttribute('data-result', 'ALREADY_USED', { timeout: 15_000 })

    // leaving the scanner lets go of the camera
    await nav(page).getByRole('link', { name: 'Home', exact: true }).click()
    await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible()
    const states = await page.evaluate(() => (window as unknown as { __cameraTracks: MediaStreamTrack[] }).__cameraTracks.map((t) => t.readyState))
    expect(states.length).toBeGreaterThan(0)
    expect(states.every((s) => s === 'ended')).toBe(true)
    await context.close()
  })

  test('a blocked camera is explained and the manual entry still works', async ({ browser }) => {
    const ticket = await buy(admin.request, TODAY)
    const { page, context } = await openScanner(browser, USERS.staff, fakeCamera(null, 'denied'))
    await chooseGate(page)
    await expect(page.getByTestId('camera')).toHaveAttribute('data-camera', 'denied')
    await expect(page.getByTestId('camera-problem')).toContainText('Camera access was blocked')
    await submitManual(page, ticket.code)
    await expect(result(page)).toHaveAttribute('data-result', 'ACCESS_GRANTED')
    await context.close()
  })

  test('typing nothing is refused on the screen, and a failed check can be retried without reloading', async ({ browser }) => {
    const ticket = await buy(admin.request, TODAY)
    const { page, context } = await openScanner(browser, USERS.staff, fakeCamera(null))
    await chooseGate(page)
    await page.getByRole('button', { name: 'Check ticket' }).click()
    await expect(page.getByText('Type or scan the ticket code first.')).toBeVisible()

    await page.route('**/api/v1/scans', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()))
    await submitManual(page, ticket.code)
    await expect(page.getByTestId('scan-failed')).toContainText('the result is not known')
    await expect(page.getByTestId('scan-failed')).toContainText('already let in')
    await page.unroute('**/api/v1/scans')
    await page.getByRole('button', { name: 'Check again' }).click()
    await expect(result(page)).toHaveAttribute('data-result', 'ACCESS_GRANTED')
    await page.getByTestId('scan-next').click()
    await expect(page.getByTestId('manual-code')).toBeVisible()
    await context.close()
  })

  test('two gates scanning the same ticket at the same moment: exactly one is let in', async ({ browser }) => {
    const ticket = await buy(admin.request, TODAY)
    const one = await openScanner(browser, USERS.staff, fakeCamera(null))
    const two = await openScanner(browser, USERS.operations, fakeCamera(null))
    await chooseGate(one.page, 'Main entrance')
    await chooseGate(two.page, 'Darassa entrance')
    await one.page.getByTestId('manual-code').fill(ticket.code)
    await two.page.getByTestId('manual-code').fill(ticket.code)
    await Promise.all([one.page.getByRole('button', { name: 'Check ticket' }).click(), two.page.getByRole('button', { name: 'Check ticket' }).click()])
    await expect(result(one.page)).toBeVisible()
    await expect(result(two.page)).toBeVisible()
    const outcomes = [await result(one.page).getAttribute('data-result'), await result(two.page).getAttribute('data-result')].sort()
    expect(outcomes).toEqual(['ACCESS_GRANTED', 'ALREADY_USED'])
    await one.context.close()
    await two.context.close()
  })

  test('the website does not carry the scanner, and the ticket on the website still shows its QR', async ({ browser }) => {
    const ticket = await buy(admin.request, addDays(TODAY, 2))
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(`${SITE}/scanner`)
    await expect(page.getByText('Gate scanner')).toHaveCount(0)
    await page.goto(`${SITE}/orders/${ticket.orderNumber}#k=${ticket.token}`)
    await expect(page.getByTestId('ticket-qr')).toBeVisible()
    await context.close()
  })
})
