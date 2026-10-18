import * as fs from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { API, PORTAL, USERS, nav, openSection, signedInPage } from './helpers'
import { addDays, apiAs, buyTicket, keepOpenToday, nextWeekday } from './ticket-helpers'

let TODAY = ''
let admin: Page
let closeAdmin: () => Promise<void>
let cleanup: () => Promise<void> = async () => undefined

/** The same wording the portal uses for money, from piastres. */
const egp = (minor: number) => `EGP ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

/** Lets a ticket in through the scanner endpoint, as a gate staff member. */
async function letIn(staff: Page, code: string, gate = 'Main entrance') {
  const gates = (await apiAs(staff, 'GET', '/gates')).data as Array<{ id: string; nameEn: string }>
  const gateId = gates.find((g) => g.nameEn === gate)!.id
  const res = await apiAs(staff, 'POST', '/scans', { qr: code, gateId })
  expect(res.status).toBe(200)
  expect(res.data.result).toBe('ACCESS_GRANTED')
}

test.describe.serial('portal analytics', () => {
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

  // ───────────────────────────── FLOW 1: the overview ─────────────────────────────

  test('the overview shows the server\'s own figures for today, with a chart and its table', async ({ browser }) => {
    const before = (await apiAs(admin, 'GET', '/analytics/overview?range=today')).data
    const bought = await buyTicket(admin.request, TODAY, { quantity: 2 })
    const staff = await signedInPage(browser, USERS.staff)
    await letIn(staff.page, bought.code)
    await staff.context.close()

    await openSection(admin, 'Overview')
    await expect(admin.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible()
    await admin.getByTestId('range-today').click()
    await expect(admin.getByTestId('period-line')).toContainText('1 day')
    const api = (await apiAs(admin, 'GET', '/analytics/overview?range=today')).data
    expect(api.range).toMatchObject({ from: TODAY, to: TODAY })
    expect(api.sales.kpis.paidOrders).toBe(before.sales.kpis.paidOrders + 1)
    expect(api.sales.kpis.ticketsSold).toBe(before.sales.kpis.ticketsSold + 2)
    expect(api.attendance.kpis.entries).toBe(before.attendance.kpis.entries + 1)

    await expect(admin.getByTestId('kpi-sales-value')).toHaveText(egp(api.sales.kpis.paidSalesMinor))
    await expect(admin.getByTestId('kpi-orders-value')).toHaveText(String(api.sales.kpis.paidOrders))
    await expect(admin.getByTestId('kpi-tickets-sold-value')).toHaveText(String(api.sales.kpis.ticketsSold))
    await expect(admin.getByTestId('kpi-entries-value')).toHaveText(String(api.attendance.kpis.entries))
    // sales and attendance are separate sections: sold tickets are not entries
    await expect(admin.getByRole('heading', { name: /^Sales/ })).toBeVisible()
    await expect(admin.getByRole('heading', { name: /^Attendance/ })).toBeVisible()

    // the chart is a real picture with a description, and the same numbers are one click away as a table
    const chart = admin.getByTestId('chart-paid-sales-per-period')
    await expect(chart.getByTestId('chart-svg')).toBeVisible()
    await expect(chart.getByTestId('chart-svg')).toHaveAttribute('aria-label', /Paid sales per period/)
    const table = admin.getByTestId('table-paid-sales-per-period')
    await table.getByText('View as a table').click()
    await expect(table.getByRole('table')).toContainText(egp(api.sales.kpis.paidSalesMinor))
    await expectNoPageOverflow(admin)
  })

  // ───────────────────────────── FLOW 2: choosing the period ─────────────────────────────

  test('a custom range sends the chosen dates to the server, stays in the address bar, and bad ranges are explained', async () => {
    await admin.goto(`${PORTAL}/analytics/sales`)
    await admin.getByTestId('range-custom').click()
    await expect(admin.getByText('Choose both a start date and an end date.')).toBeVisible()

    const from = addDays(TODAY, -6)
    const asked = admin.waitForRequest((r) => r.url().includes('/analytics/sales') && r.url().includes(`from=${from}`) && r.url().includes(`to=${TODAY}`))
    await admin.getByTestId('range-from').fill(from)
    await admin.getByTestId('range-to').fill(TODAY)
    const request = await asked
    expect(request.url()).not.toContain('range=')
    await expect(admin.getByTestId('period-line')).toContainText('7 days')
    await expect(admin).toHaveURL(new RegExp(`from=${from}`))

    // reload keeps the choice
    await admin.reload()
    await expect(admin.getByTestId('range-from')).toHaveValue(from)
    await expect(admin.getByTestId('period-line')).toContainText('7 days')

    // start after end: explained, and nothing is asked of the server
    let asks = 0
    admin.on('request', (r) => {
      if (r.url().includes('/analytics/sales')) asks += 1
    })
    await admin.getByTestId('range-from').fill(addDays(TODAY, 3))
    await expect(admin.getByText('The start date must not be after the end date.')).toBeVisible()
    expect(asks).toBe(0)

    // too long: told before asking, and the server says the same if asked directly
    await admin.getByTestId('range-from').fill(addDays(TODAY, -400))
    await expect(admin.getByText(/at most 366 days/)).toBeVisible()
    expect(asks).toBe(0)
    const refused = await apiAs(admin, 'GET', `/analytics/sales?from=${addDays(TODAY, -400)}&to=${TODAY}`)
    expect(refused.status).toBe(422)
    admin.removeAllListeners('request')

    // a ready-made range replaces it
    await admin.getByTestId('range-yesterday').click()
    await expect(admin.getByTestId('period-line')).toContainText('1 day')
    await expect(admin.getByTestId('period-line')).toContainText(new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${addDays(TODAY, -1)}T00:00:00Z`)))
  })

  // ───────────────────────────── FLOW 3: sales, by sale date and by visit date ─────────────────────────────

  test('sales: a ticket bought today for a later day is a sale today and a visit on that later day', async () => {
    const visit = nextWeekday(addDays(TODAY, 3))
    const visitSales = async (basis: string, day: string) => (await apiAs(admin, 'GET', `/analytics/sales?from=${day}&to=${day}&basis=${basis}`)).data
    const beforeToday = await visitSales('sale', TODAY)
    const beforeVisit = await visitSales('visit', visit)
    await buyTicket(admin.request, visit, { audience: 'VISITOR', ticketType: 'CHILD' }) // a non-resident child on a weekday: 100 EGP

    await admin.goto(`${PORTAL}/analytics/sales?from=${TODAY}&to=${TODAY}`)
    const todayBySale = await visitSales('sale', TODAY)
    expect(todayBySale.kpis.paidSalesMinor).toBe(beforeToday.kpis.paidSalesMinor + 10000)
    await expect(admin.getByTestId('kpi-sales-value')).toHaveText(egp(todayBySale.kpis.paidSalesMinor))

    // the same ticket, counted by the day of the visit: nothing today (it is not visited today) ...
    await admin.getByTestId('filter-basis').selectOption('visit')
    await expect(admin.getByTestId('sales-report')).toBeVisible()
    const todayByVisit = await visitSales('visit', TODAY)
    await expect(admin.getByTestId('kpi-sales-value')).toHaveText(egp(todayByVisit.kpis.paidSalesMinor))

    // ... and a sale on that later day
    await admin.goto(`${PORTAL}/analytics/sales?from=${visit}&to=${visit}&basis=visit`)
    await expect(admin.getByTestId('filter-basis')).toHaveValue('visit')
    await expect(admin.getByTestId('kpi-sales-value')).toHaveText(egp(beforeVisit.kpis.paidSalesMinor + 10000))
    // by sale date the later day (in the future) has none: nothing was ever placed then
    await admin.getByTestId('filter-basis').selectOption('sale')
    await expect(admin.getByTestId('kpi-sales-value')).toHaveText(egp(0))

    // filters narrow the figures and say so
    await admin.goto(`${PORTAL}/analytics/sales?from=${visit}&to=${visit}&basis=visit`)
    await expect(admin.getByTestId('sales-breakdown')).toContainText('Non-Egyptian')
    await admin.getByTestId('filter-audience').selectOption({ label: 'Non-Egyptian' })
    await expect(admin.getByText('These figures are for the tickets that match your filters')).toBeVisible()
    await expect(admin.getByTestId('kpi-sales-value')).toHaveText(egp(beforeVisit.kpis.paidSalesMinor + 10000)) // all the sales that day were non-resident
    await admin.getByRole('button', { name: 'Clear filters' }).click()
    await expect(admin.getByText('These figures are for the tickets that match your filters')).toHaveCount(0)
    await expectNoPageOverflow(admin)
  })

  // ───────────────────────────── FLOW 4: attendance ─────────────────────────────

  test('attendance: entries come from the gate, one per ticket, and the gate table agrees', async ({ browser }) => {
    const baseline = (await apiAs(admin, 'GET', '/analytics/attendance?range=today')).data
    const bought = await buyTicket(admin.request, TODAY)
    const staff = await signedInPage(browser, USERS.staff)
    await letIn(staff.page, bought.code, 'Darassa entrance')
    // the same ticket again is refused and is not a second entry
    const gateId = ((await apiAs(staff.page, 'GET', '/gates')).data as Array<{ id: string; nameEn: string }>).find((g) => g.nameEn === 'Darassa entrance')!.id
    expect((await apiAs(staff.page, 'POST', '/scans', { qr: bought.code, gateId })).data.result).toBe('ALREADY_USED')
    await staff.context.close()

    await openSection(admin, 'Attendance')
    await admin.getByTestId('range-today').click()
    const api = (await apiAs(admin, 'GET', '/analytics/attendance?range=today')).data
    expect(api.kpis.entries).toBe(baseline.kpis.entries + 1)
    expect(api.kpis.refusedScans).toBe(baseline.kpis.refusedScans + 1)
    await expect(admin.getByTestId('kpi-entries-value')).toHaveText(String(api.kpis.entries))
    await expect(admin.getByTestId('kpi-refused-value')).toHaveText(String(api.kpis.refusedScans))
    const gates = admin.getByTestId('gates-table')
    await expect(gates).toContainText('Darassa entrance')
    await expect(gates).toContainText('Main entrance')
    const darassa = api.byGate.find((g: { code: string }) => g.code === 'DARASSA')
    await expect(gates.getByRole('row', { name: /Darassa entrance/ })).toContainText(String(darassa.entries))
    // scan results include the refusal
    await expect(admin.getByTestId('bars-scan-results')).toContainText('Already used')
    await expect(admin.getByTestId('bars-scan-results')).toContainText('Let in')

    // the gate filter narrows everything to one gate
    await admin.getByTestId('filter-gate').selectOption({ label: 'Darassa entrance' })
    await expect(admin.getByTestId('kpi-entries-value')).toHaveText(String(darassa.entries))
    await expect(admin.getByTestId('gates-table').getByRole('row')).toHaveCount(3) // header, the gate, the total
    await expectNoPageOverflow(admin)
  })

  // ───────────────────────────── FLOW 5: exports ─────────────────────────────

  test('exports: the CSV holds the selected period, basis and filters, and no personal data', async () => {
    const visit = nextWeekday(addDays(TODAY, 4))
    await buyTicket(admin.request, visit, { audience: 'VISITOR', ticketType: 'ADULT', quantity: 2, name: 'Secret Customer Name' })

    await admin.goto(`${PORTAL}/analytics/reports?from=${visit}&to=${visit}&basis=visit`)
    await expect(admin.getByTestId('reports')).toBeVisible()
    const [file] = await Promise.all([admin.waitForEvent('download'), admin.getByTestId('export-sales').click()])
    expect(file.suggestedFilename()).toBe(`azharpark-sales-${visit}_${visit}-visit.csv`)
    const bytes = fs.readFileSync((await file.path())!)
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    const text = bytes.toString('utf8')
    const lines = text.replace(/^\uFEFF/, '').split('\r\n').filter(Boolean)
    expect(lines[0]).toBe('period_start,granularity,basis,ticket_type_code,ticket_type,audience_code,audience,day_type,tickets_sold,tickets_cancelled,value_egp,currency')
    const row = lines.slice(1).map((l) => l.split(',')).find((r) => r[0] === visit && r[3] === 'ADULT' && r[5] === 'VISITOR')!
    expect(row).toBeDefined()
    expect(row[2]).toBe('visit')
    expect(Number(row[8])).toBeGreaterThanOrEqual(2)
    expect(Number(row[10])).toBeGreaterThanOrEqual(2 * 150)
    for (const secret of ['Secret Customer Name', 'ops@example.com', '@', 'AZP1', 'TKT-']) expect(text).not.toContain(secret)

    // the report page for the same figures agrees with the file
    await admin.goto(`${PORTAL}/analytics/sales?from=${visit}&to=${visit}&basis=visit`)
    await expect(admin.getByTestId('sales-report')).toBeVisible() // let the page finish its own sign-in refresh before calling the API
    const api = (await apiAs(admin, 'GET', `/analytics/sales?from=${visit}&to=${visit}&basis=visit`)).data
    expect(Number(row[10]) * 100).toBeLessThanOrEqual(api.kpis.paidSalesMinor)

    // exporting with a filter on the sales page downloads the filtered file
    await admin.getByTestId('filter-audience').selectOption({ label: 'Non-Egyptian' })
    await expect(admin.getByTestId('sales-report')).toBeVisible()
    const [filtered] = await Promise.all([admin.waitForEvent('download'), admin.getByTestId('export-sales').first().click()])
    const filteredRows = fs.readFileSync((await filtered.path())!, 'utf8').replace(/^\uFEFF/, '').split('\r\n').filter(Boolean).slice(1)
    expect(filteredRows.length).toBeGreaterThan(0)
    expect(filteredRows.every((r) => r.split(',')[5] === 'VISITOR')).toBe(true)
  })

  // ─────────────────────────────── FLOW 6: who sees what ─────────────────────────────

  test('permissions: each role sees only its own analytics, in the menu, on the page and from the server', async ({ browser }) => {
    // an analyst (analytics:read) has everything
    const analyst = await signedInPage(browser, USERS.analyst)
    for (const name of ['Overview', 'Sales', 'Attendance', 'Ticket states', 'Event statistics', 'Reports']) await expect(nav(analyst.page).getByRole('link', { name, exact: true })).toBeVisible()
    expect((await apiAs(analyst.page, 'GET', '/analytics/sales?range=today')).status).toBe(200)
    await analyst.context.close()

    // operations: entry and tickets, never money or events
    const ops = await signedInPage(browser, USERS.operations)
    for (const name of ['Overview', 'Attendance', 'Ticket states', 'Reports']) await expect(nav(ops.page).getByRole('link', { name, exact: true })).toBeVisible()
    await expect(nav(ops.page).getByRole('link', { name: 'Sales', exact: true })).toHaveCount(0)
    await expect(nav(ops.page).getByRole('link', { name: 'Event statistics', exact: true })).toHaveCount(0)
    await openSection(ops.page, 'Overview')
    await expect(ops.page.getByTestId('overview')).toBeVisible()
    await expect(ops.page.getByRole('heading', { name: /^Attendance/ })).toBeVisible()
    await expect(ops.page.getByTestId('kpi-sales')).toHaveCount(0)
    await expect(ops.page.getByText('Paid sales')).toHaveCount(0)
    await ops.page.goto(`${PORTAL}/analytics/sales`)
    await expect(ops.page.getByText('You do not have access to this page.')).toBeVisible()
    expect((await apiAs(ops.page, 'GET', '/analytics/sales?range=today')).status).toBe(403)
    expect((await apiAs(ops.page, 'GET', '/analytics/export/sales?range=today')).status).toBe(403)
    expect((await apiAs(ops.page, 'GET', '/analytics/attendance?range=today')).status).toBe(200)
    await ops.page.goto(`${PORTAL}/analytics/reports`)
    await expect(ops.page.getByTestId('export-attendance')).toBeVisible()
    await expect(ops.page.getByTestId('export-sales')).toHaveCount(0)
    await ops.context.close()

    // content: only the event statistics
    const content = await signedInPage(browser, USERS.content)
    await expect(nav(content.page).getByRole('link', { name: 'Event statistics', exact: true })).toBeVisible()
    await expect(nav(content.page).getByRole('link', { name: 'Attendance', exact: true })).toHaveCount(0)
    await openSection(content.page, 'Event statistics')
    await expect(content.page.getByTestId('events-report')).toBeVisible()
    expect((await apiAs(content.page, 'GET', '/analytics/attendance?range=today')).status).toBe(403)
    await content.context.close()

    // gate staff: no analytics at all
    const staff = await signedInPage(browser, USERS.staff)
    await expect(nav(staff.page).getByRole('group', { name: 'Analytics' })).toHaveCount(0)
    await staff.page.goto(`${PORTAL}/analytics`)
    await expect(staff.page.getByText('You do not have access to this page.')).toBeVisible()
    for (const p of ['overview', 'sales', 'attendance', 'tickets', 'events']) expect((await apiAs(staff.page, 'GET', `/analytics/${p}?range=today`)).status).toBe(403)
    await staff.context.close()

    // nobody signed in: the API refuses and the portal asks for a sign-in
    expect((await admin.request.get(`${API}/analytics/overview?range=today`)).status()).toBe(401)
    expect((await admin.request.get(`${API}/analytics/export/sales?range=today`)).status()).toBe(401)
  })

  // ───────────────────────────── FLOW 7: the other reports open and fit the screen ─────────────────────────────

  test('ticket states and event statistics load, and every page fits a phone screen', async () => {
    await admin.setViewportSize({ width: 390, height: 800 })
    for (const [path, id] of [
      ['/analytics', 'overview'],
      ['/analytics/sales', 'sales-report'],
      ['/analytics/attendance', 'attendance-report'],
      ['/analytics/tickets', 'tickets-report'],
      ['/analytics/events', 'events-report'],
      ['/analytics/reports', 'reports'],
    ] as const) {
      await admin.goto(`${PORTAL}${path}?range=last30`)
      await expect(admin.getByTestId(id)).toBeVisible()
      await expectNoPageOverflow(admin)
    }
    await admin.setViewportSize({ width: 1280, height: 800 })
    await admin.goto(`${PORTAL}/analytics/tickets?range=today&basis=visit`)
    const api = (await apiAs(admin, 'GET', '/analytics/tickets?range=today&basis=visit')).data
    await expect(admin.getByTestId('kpi-total-value')).toHaveText(String(api.kpis.total))
    await expect(admin.getByTestId('kpi-used-value')).toHaveText(String(api.kpis.used))
    await expect(admin.getByTestId('ticket-states')).toBeVisible()
  })
})
