import * as fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { API, PORTAL, USERS, nav, openSection, signedInPage } from './helpers'
import { addDays, apiAs, buyTicket, keepOpenToday, nextWeekday, residentAdultPrice } from './ticket-helpers'

const HEADLINE: Record<string, string> = {
  OPEN: 'The park is open',
  BEFORE_OPENING: 'Not open yet',
  AFTER_CLOSING: 'Closed for today',
  CLOSED_TODAY: 'The park is closed today',
}

let TODAY = ''
let admin: Page
let closeAdmin: () => Promise<void>
let cleanup: () => Promise<void> = async () => undefined

const number = async (page: Page, testId: string) => Number((await page.getByTestId(testId).textContent())!.trim())

/** No page may be wider than the screen: tables scroll inside their own box instead. */
async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

test.describe.serial('portal operations', () => {
  test.beforeAll(async ({ browser }) => {
    const s = await signedInPage(browser, USERS.admin)
    admin = s.page
    closeAdmin = () => s.context.close()
    TODAY = (await (await admin.request.get(`${API}/public/tickets/catalog`)).json()).data.today
    cleanup = await keepOpenToday(admin, TODAY)
  })
  test.afterAll(async () => {
    await cleanup()
    await closeAdmin()
  })

  // ───────────────────────────── FLOW 1: the dashboard ─────────────────────────────

  test('the dashboard shows today\'s real figures, counted by the server', async () => {
    // some activity today, so there is something to count
    const paid = await buyTicket(admin.request, TODAY, { quantity: 2 })
    await buyTicket(admin.request, addDays(TODAY, 1))

    await admin.goto(`${PORTAL}/`)
    await expect(admin.getByRole('heading', { name: 'Welcome, Dev' })).toBeVisible()
    await expect(admin.getByTestId('park-status')).toBeVisible()
    const api = (await apiAs(admin, 'GET', '/dashboard')).data
    expect(api.date).toBe(TODAY)

    // the park: the banner agrees with the server's own status and hours
    await expect(admin.getByTestId('park-headline')).toHaveText(HEADLINE[api.park.status])
    await expect(admin.getByTestId('park-status')).toHaveAttribute('data-status', api.park.status)
    if (api.park.opens) {
      // the wording depends on the time of day (open, not open yet, closed for the day) but always names today's hours
      await expect(admin.getByTestId('park-detail')).toContainText(api.park.opens)
      await expect(admin.getByTestId('park-detail')).toContainText(api.park.closes)
    }
    await expect(admin.getByTestId('park-sales')).toContainText('Online tickets for today')

    // orders and tickets: the numbers on screen are the numbers from the API
    await expect(admin.getByTestId('stat-orders')).toHaveText(String(api.orders.createdToday))
    await expect(admin.getByTestId('stat-paid')).toHaveText(String(api.orders.paidToday))
    await expect(admin.getByTestId('stat-revenue')).toContainText('EGP')
    await expect(admin.getByTestId('stat-tickets')).toHaveText(String(api.tickets.forToday))
    await expect(admin.getByTestId('stat-valid')).toHaveText(String(api.tickets.valid))
    expect(api.orders.paidToday).toBeGreaterThanOrEqual(2)
    expect(api.tickets.valid).toBeGreaterThanOrEqual(2)
    expect(api.orders.revenueMinor).toBeGreaterThanOrEqual(2 * residentAdultPrice(TODAY) + residentAdultPrice(addDays(TODAY, 1)))

    // gates and events
    await expect(admin.getByTestId('gates-today').getByRole('listitem')).toHaveCount(api.gates.length)
    await expect(admin.getByTestId('gates-today')).toContainText('Main entrance')
    await expect(admin.getByTestId('events-coming-up')).toContainText('Cairo Jazz Nights')
    expect(paid.ref).toBeTruthy()
  })

  test('the dashboard refreshes with what happens: entering a ticket moves a ticket from valid to used', async () => {
    const t = await buyTicket(admin.request, TODAY)
    await admin.goto(`${PORTAL}/`)
    await expect(admin.getByTestId('stat-valid')).toBeVisible()
    const before = { valid: await number(admin, 'stat-valid'), used: await number(admin, 'stat-used'), granted: await number(admin, 'stat-granted') }
    const main = (await apiAs(admin, 'GET', '/scans/gates')).data.find((g: { code: string }) => g.code === 'MAIN')
    const scan = await apiAs(admin, 'POST', '/scans', { qr: t.code, gateId: main.id })
    expect(scan.data.result).toBe('ACCESS_GRANTED')
    await admin.reload()
    await expect(admin.getByTestId('stat-used')).toHaveText(String(before.used + 1))
    await expect(admin.getByTestId('stat-valid')).toHaveText(String(before.valid - 1))
    await expect(admin.getByTestId('stat-granted')).toHaveText(String(before.granted + 1))
    await expect(admin.getByTestId('recent-scans')).toContainText(t.ref)
    await expect(admin.getByTestId('recent-scans')).toContainText('Let in')
  })

  // ───────────────────────────── FLOW 2: orders ─────────────────────────────

  test('orders: find an order by its number or by one of its tickets and read it', async ({ browser }) => {
    const t = await buyTicket(admin.request, TODAY, { quantity: 2, name: 'Layla Farouk' })
    const { page, context } = await signedInPage(browser, USERS.operations)
    await openSection(page, 'Orders')
    await page.getByLabel('Search').fill(t.orderNumber)
    await expect(page.getByTestId('order-row')).toHaveCount(1)
    await page.getByLabel('Search').fill(t.ref.toLowerCase()) // a ticket reference finds its order too
    await expect(page.getByTestId('order-row')).toHaveCount(1)
    await expect(page.getByTestId('order-row')).toContainText(t.orderNumber)
    await page.getByRole('button', { name: `Open order ${t.orderNumber}` }).click()
    const detail = page.getByTestId('order-detail')
    await expect(detail).toContainText('Paid')
    await expect(detail).toContainText('Visit date')
    await expect(detail.getByTestId('order-total')).toHaveText(`${(2 * residentAdultPrice(TODAY)) / 100} EGP`)
    await expect(detail).toContainText('Layla Farouk') // operations may see customers
    await expect(detail.getByTestId('order-ticket')).toHaveCount(2)
    await expect(detail.getByTestId('order-ticket').first()).toContainText('valid')
    await expect(detail).toContainText('MOCK') // the payment
    await context.close()
  })

  // ───────────────────────────── FLOW 3: tickets ─────────────────────────────

  test('tickets: search a ticket, open it, see its lifecycle, and download its PDF where allowed', async ({ browser }) => {
    const visit = nextWeekday(addDays(TODAY, 2)) // a weekday: a non-resident child pays 100 EGP
    const t = await buyTicket(admin.request, visit, { audience: 'VISITOR', ticketType: 'CHILD' })
    const ops = await signedInPage(browser, USERS.operations)
    await openSection(ops.page, 'Tickets')
    await expect(ops.page.getByTestId('ticket-row').first()).toBeVisible()
    await ops.page.getByLabel('Search').fill(t.ref)
    await expect(ops.page.getByTestId('ticket-row')).toHaveCount(1)
    const row = ops.page.getByTestId('ticket-row')
    await expect(row).toContainText('Child (2–8 years)')
    await expect(row).toContainText('Non-resident visitor')
    await expect(row).toContainText('100 EGP')
    await expect(row).toContainText('Valid')
    await ops.page.getByRole('button', { name: `Open ticket ${t.ref}` }).click()
    const detail = ops.page.getByTestId('ticket-detail')
    await expect(detail).toContainText('Valid on')
    await expect(detail).toContainText(t.orderNumber)
    await expect(detail).toContainText('Issued')
    await expect(detail).toContainText('QR code')
    await expect(detail.getByTestId('ticket-price')).toHaveText('100 EGP')
    await expect(detail).toContainText('Not scanned yet') // operations may read scans
    const [file] = await Promise.all([ops.page.waitForEvent('download'), detail.getByRole('button', { name: 'Download ticket PDF' }).click()])
    expect(file.suggestedFilename()).toBe(`${t.ref}.pdf`)
    expect(fs.readFileSync((await file.path())!).subarray(0, 5).toString()).toBe('%PDF-')

    // filters
    await ops.page.getByRole('button', { name: 'Close' }).click()
    await ops.page.getByRole('button', { name: 'Clear filters' }).click()
    await ops.page.getByLabel('Status').selectOption('CANCELLED')
    await expect(ops.page.getByText(/No tickets match|ticket-row/)).toBeDefined()
    await ops.page.getByLabel('Status').selectOption('VALID')
    await ops.page.getByLabel('Visit date').fill(visit)
    await ops.page.getByLabel('Ticket type').selectOption({ label: 'Child (2–8 years)' })
    await ops.page.getByLabel('Audience').selectOption({ label: 'Non-resident visitor' })
    await expect(ops.page.getByTestId('ticket-row').filter({ hasText: t.ref })).toHaveCount(1)
    await ops.page.getByLabel('Visit date').fill(addDays(visit, 40))
    await expect(ops.page.getByText('No tickets match these filters.')).toBeVisible()
    await ops.context.close()

    // an analyst may read tickets but not re-deliver them: no PDF button, and the server agrees
    const analyst = await signedInPage(browser, USERS.analyst)
    await openSection(analyst.page, 'Tickets')
    await analyst.page.getByLabel('Search').fill(t.ref)
    await analyst.page.getByRole('button', { name: `Open ticket ${t.ref}` }).click()
    await expect(analyst.page.getByTestId('ticket-detail')).toBeVisible()
    await expect(analyst.page.getByRole('button', { name: 'Download ticket PDF' })).toHaveCount(0)
    expect((await apiAs(analyst.page, 'GET', `/tickets/${(await apiAs(analyst.page, 'GET', `/tickets?search=${t.ref}`)).data[0].id}/pdf`)).status).toBe(403)
    await analyst.context.close()
  })

  // ───────────────────────────── FLOW 4: the scanner and the ticket after it ─────────────────────────────

  test('scanner: a valid ticket is let in, and the ticket, the scan list and the dashboard all show it', async ({ browser }) => {
    const t = await buyTicket(admin.request, TODAY)
    const staff = await signedInPage(browser, USERS.staff)
    await nav(staff.page).getByRole('link', { name: 'Gate scanner', exact: true }).click()
    await staff.page.getByTestId('gate-select').selectOption({ label: 'Main entrance' })
    await staff.page.getByTestId('manual-code').fill(t.code)
    await staff.page.getByRole('button', { name: 'Check ticket' }).click()
    await expect(staff.page.getByTestId('scan-result')).toHaveAttribute('data-result', 'ACCESS_GRANTED')
    await expect(staff.page.getByTestId('scan-headline')).toHaveText('ACCESS GRANTED')

    // the staff member sees their own scan, and only that
    await staff.page.getByTestId('scan-next').click()
    await nav(staff.page).getByRole('link', { name: 'Scans', exact: true }).click()
    await expect(staff.page.getByText('Your own ticket scans, newest first.')).toBeVisible()
    await expect(staff.page.getByTestId('scan-row').first()).toContainText(t.ref)
    await expect(staff.page.getByTestId('scan-row').first()).toContainText('Let in')
    await expect(staff.page.getByRole('columnheader', { name: 'Staff' })).toHaveCount(0)
    await staff.context.close()

    // operations sees the ticket as used, with its scan history and who let it in
    const ops = await signedInPage(browser, USERS.operations)
    await openSection(ops.page, 'Tickets')
    await ops.page.getByLabel('Search').fill(t.ref)
    await expect(ops.page.getByTestId('ticket-row')).toHaveCount(1)
    await expect(ops.page.getByTestId('ticket-row')).toContainText('Used')
    await ops.page.getByRole('button', { name: `Open ticket ${t.ref}` }).click()
    const detail = ops.page.getByTestId('ticket-detail')
    await expect(detail.getByTestId('ticket-used-at')).not.toHaveText('—')
    await expect(detail).toContainText('Dev Ticket Staff')
    await expect(detail.getByTestId('ticket-scans')).toContainText('Let in')
    await expect(detail.getByTestId('ticket-scans')).toContainText('Main entrance')
    await ops.page.getByRole('button', { name: 'Close' }).click()
    await openSection(ops.page, 'Scans')
    await ops.page.getByLabel('Search').fill(t.ref)
    await expect(ops.page.getByTestId('scan-row')).toHaveCount(1)
    await expect(ops.page.getByTestId('scan-row')).toContainText('Dev Ticket Staff')
    await ops.page.getByLabel('Result').selectOption('denied')
    await expect(ops.page.getByText('No scans match these filters.')).toBeVisible()
    await ops.context.close()
  })

  // ───────────────────────────── FLOW 5: gates ─────────────────────────────

  test('gates: switching a gate off stops scans at it; switching it on restores it', async ({ browser }) => {
    const t = await buyTicket(admin.request, TODAY)
    await admin.goto(`${PORTAL}/gates`)
    await expect(admin.getByTestId('gate-row')).toHaveCount(2)
    const main = admin.getByTestId('gate-row').filter({ hasText: 'Main entrance' })
    await expect(main).toHaveAttribute('data-active', 'true')
    await expect(main).toContainText('let in')
    const gateId = (await apiAs(admin, 'GET', '/scans/gates')).data.find((g: { code: string }) => g.code === 'MAIN').id

    try {
      admin.once('dialog', (d) => {
        expect(d.message()).toContain('Scans already made there are kept')
        void d.accept()
      })
      await admin.getByRole('button', { name: 'Switch off Main entrance' }).click()
      await expect(admin.getByText('Main entrance switched off.').first()).toBeVisible()
      await expect(main).toHaveAttribute('data-active', 'false')
      await expect(main).toContainText('Switched off')

      // the scanner no longer offers it, and the server refuses it even if asked directly
      const staff = await signedInPage(browser, USERS.staff)
      await nav(staff.page).getByRole('link', { name: 'Gate scanner', exact: true }).click()
      expect(await staff.page.getByTestId('gate-select').locator('option').allTextContents()).toEqual(['Choose a gate…', 'Darassa entrance'])
      const refused = await apiAs(staff.page, 'POST', '/scans', { qr: t.code, gateId })
      expect(refused.status).toBe(422)
      // the ticket was not used, and the other gate still works
      await staff.page.getByTestId('gate-select').selectOption({ label: 'Darassa entrance' })
      await staff.page.getByTestId('manual-code').fill(t.code)
      await staff.page.getByRole('button', { name: 'Check ticket' }).click()
      await expect(staff.page.getByTestId('scan-result')).toHaveAttribute('data-result', 'ACCESS_GRANTED')
      await expect(staff.page.getByTestId('scan-result')).toContainText('Darassa entrance')
      await staff.context.close()
    } finally {
      await apiAs(admin, 'PUT', `/gates/${gateId}/active`, { isActive: true })
    }

    await admin.reload()
    await expect(main).toHaveAttribute('data-active', 'true')
    await admin.getByRole('button', { name: 'Add a gate' }).click()
    const dialog = admin.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Save gate' }).click()
    await expect(dialog.getByText('Enter the English name.')).toBeVisible()
    await dialog.getByLabel('Name (English)').fill('Gate X')
    await dialog.getByLabel('Name (Arabic)').fill('بوابة')
    await dialog.getByLabel('Code').fill('a b')
    await dialog.getByRole('button', { name: 'Save gate' }).click()
    await expect(dialog.getByText(/Use letters, digits and underscores/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(admin.getByTestId('gate-row')).toHaveCount(2)
  })

  // ───────────────────────────── FLOW 6: who may do what ─────────────────────────────

  test('RBAC: ticket staff see only their own tools, other pages refuse them, and the server rejects direct calls', async ({ browser }) => {
    const staff = await signedInPage(browser, USERS.staff)
    const menu = nav(staff.page)
    await expect(menu.getByRole('group', { name: 'Operations' })).toBeVisible()
    for (const name of ['Gate scanner', 'Scans', 'Gates']) await expect(menu.getByRole('link', { name, exact: true })).toBeVisible()
    for (const name of ['Orders', 'Tickets', 'Park information', 'Staff accounts', 'Roles & permissions', 'Ticket prices']) await expect(menu.getByRole('link', { name, exact: true })).toHaveCount(0)
    await expect(menu.getByRole('group', { name: 'Administration' })).toHaveCount(0)

    // the dashboard holds only what staff may see
    await expect(staff.page.getByTestId('stat-granted')).toBeVisible()
    await expect(staff.page.getByTestId('gates-today')).toBeVisible()
    for (const id of ['stat-orders', 'stat-tickets', 'park-status', 'activity']) await expect(staff.page.getByTestId(id)).toHaveCount(0)

    // direct addresses
    for (const path of ['orders', 'tickets', 'prices', 'users']) {
      await staff.page.goto(`${PORTAL}/${path}`)
      await expect(staff.page.getByText('You do not have access to this page.')).toBeVisible()
    }
    // the gates page is read only for them
    await staff.page.goto(`${PORTAL}/gates`)
    await expect(staff.page.getByTestId('gate-row').first()).toBeVisible()
    await expect(staff.page.getByRole('button', { name: 'Add a gate' })).toHaveCount(0)
    await expect(staff.page.getByRole('button', { name: /^Switch o(ff|n) / })).toHaveCount(0)

    // direct API calls: refused, whatever the screen shows
    const main = (await apiAs(staff.page, 'GET', '/scans/gates')).data[0]
    const denied = async (method: string, path: string, body?: unknown) => expect((await apiAs(staff.page, method, path, body)).status).toBe(403)
    await denied('GET', '/orders')
    await denied('GET', '/tickets')
    await denied('GET', '/prices')
    await denied('POST', '/gates', { code: 'HACK', nameEn: 'Hack gate', nameAr: 'اختراق' })
    await denied('PUT', `/gates/${main.id}/active`, { isActive: false })
    await denied('PUT', `/gates/${main.id}`, { nameEn: 'Renamed', nameAr: 'اسم' })
    await denied('GET', '/users')
    const dash = (await apiAs(staff.page, 'GET', '/dashboard')).data
    expect(Object.keys(dash).sort()).toEqual(['date', 'entry', 'gates', 'generatedAt'])
    expect((await apiAs(admin, 'GET', '/gates')).data.every((g: { isActive: boolean }) => g.isActive)).toBe(true)
    await staff.context.close()

    // a content manager: park and events on the dashboard, no orders, no operations menu
    const content = await signedInPage(browser, USERS.content)
    await expect(nav(content.page).getByRole('group', { name: 'Operations' })).toHaveCount(0)
    await expect(content.page.getByTestId('park-status')).toBeVisible()
    await expect(content.page.getByTestId('events-coming-up')).toBeVisible()
    await expect(content.page.getByTestId('stat-orders')).toHaveCount(0)
    expect((await apiAs(content.page, 'GET', '/dashboard')).data.orders).toBeUndefined()
    await content.context.close()
  })

  // ───────────────────────────── portal layout ─────────────────────────────

  test('the portal fits laptop and tablet screens: tables scroll in their own box, the page does not', async ({ browser }) => {
    for (const [width, height] of [[1366, 768], [1024, 768], [820, 1180], [700, 900]] as const) {
      const context = await browser.newContext({ viewport: { width, height } })
      const page = await context.newPage()
      await page.goto(`${PORTAL}/login`)
      await page.getByLabel('Email').fill(USERS.admin)
      await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? 'E2e-Password-2026!')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible()
      await expect(page.getByTestId('park-status')).toBeVisible()
      await expectNoPageOverflow(page)
      if (width < 768) {
        await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible()
        await page.getByRole('button', { name: 'Menu' }).click()
        await expect(nav(page).getByRole('link', { name: 'Tickets', exact: true })).toBeVisible()
        await nav(page).getByRole('link', { name: 'Tickets', exact: true }).click()
      } else {
        await openSection(page, 'Tickets')
      }
      await expect(page.getByTestId('tickets-table')).toBeVisible()
      await expectNoPageOverflow(page)
      for (const route of ['orders', 'scans', 'gates']) {
        await page.goto(`${PORTAL}/${route}`)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        await expectNoPageOverflow(page)
      }
      await context.close()
    }
  })
})
