import * as fs from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { API, SITE, USERS, nav, openSection, signedInPage } from './helpers'

/** Calls the API as the signed-in person (refresh cookie → access token), for setting up or checking state. */
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
/** The first date on or after `from` that falls on `dow` (0 = Sunday … 6 = Saturday). */
const nextDow = (from: string, dow: number) => {
  for (let i = 0; i < 7; i += 1) if (new Date(`${addDays(from, i)}T00:00:00Z`).getUTCDay() === dow) return addDays(from, i)
  return from
}

let TODAY = ''
let THURSDAY = ''
let FRIDAY = ''

const money = (n: number) => `${n} LE`

async function freshPage(browser: Browser, path: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto(`${SITE}${path}`)
  return page
}

/** Chooses a date and quantities in the ticket builder on the Visit page. */
async function chooseTickets(page: Page, o: { date: string; visitor?: boolean; adults?: number; children?: number }) {
  await page.goto(`${SITE}/tickets`)
  await expect(page.getByTestId('ticket-row').first()).toBeVisible()
  if (o.visitor) await page.getByRole('radio', { name: /Non-Egyptian/ }).click()
  else await page.getByRole('radio', { name: /Egyptian/ }).click()
  await page.getByLabel('Visit date').fill(o.date)
  await expect(page.getByTestId('ticket-price').first()).toContainText('LE')
  const adults = o.adults ?? 2
  // the builder starts with two adults
  for (let i = 2; i < adults; i += 1) await page.getByRole('button', { name: /^\+ Adult/ }).click()
  for (let i = adults; i < 2; i += 1) await page.getByRole('button', { name: /^− Adult/ }).click()
  for (let i = 0; i < (o.children ?? 0); i += 1) await page.getByRole('button', { name: /^\+ Child/ }).click()
}

async function addToCartAndCheckout(page: Page) {
  await page.getByRole('button', { name: 'Add to cart' }).click()
  await expect(page.getByRole('button', { name: /Added/ })).toBeVisible()
  await page.goto(`${SITE}/checkout`)
  await expect(page.getByTestId('quote-line').first()).toBeVisible()
}

async function fillDetails(page: Page, o: { name?: string; email?: string; phone?: string; terms?: boolean } = {}) {
  await page.getByLabel('Full name').fill(o.name ?? 'Mona Hassan')
  await page.getByLabel('Email').fill(o.email ?? 'mona@example.com')
  await page.getByLabel('Phone').fill(o.phone ?? '+201001234567')
  if (o.terms !== false) await page.getByRole('checkbox').check()
}

/** Buys tickets through the website and lands on the order page, still waiting for payment. */
async function placeOrder(page: Page, o: Parameters<typeof chooseTickets>[1] & { name?: string; email?: string }) {
  await chooseTickets(page, o)
  await addToCartAndCheckout(page)
  await fillDetails(page, o)
  await page.getByRole('button', { name: 'Place order and pay' }).click()
  await expect(page.getByTestId('order-status')).toHaveText('Waiting for payment')
  return (await page.getByTestId('order-number').textContent())!.trim()
}

const orderRow = (page: Page, orderNumber: string) => page.getByTestId('order-row').filter({ hasText: orderNumber })

test.describe.serial('ticket purchasing: website, payment and portal', () => {
  let admin: Page
  let closeAdmin: () => Promise<void>
  let firstOrder = ''
  // the first customer's browser keeps their private order key, so it can look at the order again later
  let customer: Page | null = null

  test.beforeAll(async ({ browser }) => {
    const s = await signedInPage(browser, USERS.admin)
    admin = s.page
    closeAdmin = () => s.context.close()
    const res = await admin.request.get(`${API}/public/tickets/catalog`)
    TODAY = (await res.json()).data.today
    THURSDAY = nextDow(addDays(TODAY, 1), 4)
    FRIDAY = nextDow(addDays(TODAY, 1), 5)
  })
  test.afterAll(async () => {
    await customer?.context().close()
    await closeAdmin()
  })

  test('the Visit page shows the live prices from the park\'s server', async ({ browser }) => {
    const page = await freshPage(browser, '/tickets')
    await expect(page.getByText(/the same ones used at checkout/)).toBeVisible()
    const cells = page.locator('table td')
    for (const price of ['50 LE', '60 LE', '35 LE', '40 LE', '150 LE', '200 LE', '100 LE']) await expect(cells.filter({ hasText: new RegExp(`^${price}$`) }).first()).toBeVisible()
    await expect(cells.filter({ hasText: /^150 LE$/ })).toHaveCount(2) // visitor adult weekday and visitor child weekend
    await page.context().close()
  })

  test('the ticket builder prices weekday, weekend and non-resident visits from the server', async ({ browser }) => {
    const page = await freshPage(browser, '/tickets')
    await expect(page.getByTestId('ticket-row')).toHaveCount(2)
    await page.getByLabel('Visit date').fill(THURSDAY)
    await expect(page.getByTestId('ticket-price').first()).toHaveText(/^50 LE per ticket$/)
    await expect(page.getByTestId('ticket-total')).toHaveText(money(100)) // two adults
    await page.getByRole('button', { name: /^\+ Child/ }).click()
    await expect(page.getByTestId('ticket-total')).toHaveText(money(135))

    await page.getByLabel('Visit date').fill(FRIDAY)
    await expect(page.getByTestId('ticket-price').first()).toHaveText(/^60 LE per ticket$/)
    await expect(page.getByTestId('ticket-total')).toHaveText(money(2 * 60 + 40))

    await page.getByRole('radio', { name: /Non-Egyptian/ }).click()
    await expect(page.getByTestId('ticket-price').first()).toHaveText(/^200 LE per ticket$/)
    await expect(page.getByTestId('ticket-total')).toHaveText(money(2 * 200 + 150))
    await page.getByLabel('Visit date').fill(THURSDAY)
    await expect(page.getByTestId('ticket-price').first()).toHaveText(/^150 LE per ticket$/)
    await expect(page.getByTestId('ticket-total')).toHaveText(money(2 * 150 + 100))
    await page.context().close()
  })

  test('there is no ticket for children under 2, and the rules are explained', async ({ browser }) => {
    const page = await freshPage(browser, '/tickets')
    await expect(page.getByTestId('ticket-row')).toHaveCount(2)
    await expect(page.getByTestId('ticket-row').nth(0)).toContainText('Adult')
    await expect(page.getByTestId('ticket-row').nth(1)).toContainText('Child (2–8 years)')
    await expect(page.getByTestId('ticket-row').filter({ hasText: /infant|baby|free/i })).toHaveCount(0)
    const notes = page.getByTestId('booking-notes')
    await expect(notes).toContainText('Children under 2 enter free and do not need a ticket.')
    await expect(notes).toContainText('valid only on the visit date you choose')
    await expect(notes).toContainText('non-refundable')
    await expect(notes).toContainText('30 minutes to pay')
    await page.context().close()
  })

  test('dates that cannot be booked are explained: the past, too far ahead, a closed day', async ({ browser }) => {
    const page = await freshPage(browser, '/tickets')
    await expect(page.getByTestId('ticket-row').first()).toBeVisible()
    const date = page.getByLabel('Visit date')
    await expect(date).toHaveAttribute('min', TODAY)
    await expect(date).toHaveAttribute('max', addDays(TODAY, 90))

    await date.fill(addDays(TODAY, 91))
    await expect(page.getByTestId('day-problem')).toContainText('too far ahead')
    await expect(page.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
    await date.fill(addDays(TODAY, 90))
    await expect(page.getByTestId('day-problem')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add to cart' })).toBeEnabled()
    await date.fill(addDays(TODAY, -1))
    await expect(page.getByTestId('day-problem')).toContainText('already passed')

    // a closure entered in the portal closes sales for that day
    const closed = addDays(TODAY, 20)
    const made = await apiAs(admin, 'POST', '/special-hours', { kind: 'TEMPORARY_CLOSURE', dateFrom: closed, dateTo: closed, labelEn: 'Browser test closure', labelAr: 'إغلاق تجريبي', priority: 5 })
    expect(made.status).toBe(201)
    try {
      await date.fill(closed)
      await expect(page.getByTestId('day-problem')).toContainText('closed')
      await expect(page.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
    } finally {
      expect((await apiAs(admin, 'DELETE', `/special-hours/${made.data.id}`)).status).toBe(200)
    }
    await date.fill(addDays(TODAY, 21))
    await expect(page.getByTestId('day-problem')).toHaveCount(0)
    await page.context().close()
  })

  test('checkout re-prices on the server and checks the details before placing an order', async ({ browser }) => {
    const page = await freshPage(browser, '/tickets')
    await chooseTickets(page, { date: THURSDAY, adults: 2, children: 1 })
    await addToCartAndCheckout(page)
    await expect(page.getByTestId('quote-date')).toContainText('Egyptian')
    await expect(page.getByTestId('quote-line')).toHaveCount(2)
    await expect(page.getByTestId('quote-total')).toHaveText(money(135))

    await page.getByRole('button', { name: 'Place order and pay' }).click()
    await expect(page.getByText('Please enter your full name.')).toBeVisible()
    await expect(page.getByText('Please enter a valid email address.')).toBeVisible()
    await expect(page.getByText('Please accept the booking terms to continue.')).toBeVisible()
    await page.getByLabel('Full name').fill('Mona Hassan')
    await page.getByLabel('Email').fill('not-an-email')
    await page.getByLabel('Phone').fill('abc')
    await page.getByRole('button', { name: 'Place order and pay' }).click()
    await expect(page.getByText('Please enter a valid email address.')).toBeVisible()
    await expect(page.getByText('Please enter a valid phone number.')).toBeVisible()
    await expect(page).toHaveURL(/\/checkout$/)
    await page.context().close()
  })

  test('a customer buys tickets, sees the payment countdown, pays, and gets tickets valid on the chosen date only', async ({ browser }) => {
    const page = await freshPage(browser, '/tickets')
    customer = page
    firstOrder = await placeOrder(page, { date: THURSDAY, adults: 2, children: 1 })
    expect(firstOrder).toMatch(/^AZP-\d{4}-\d{6}$/)

    await expect(page.getByTestId('order-total')).toHaveText(money(135))
    await expect(page.getByTestId('order-line')).toHaveCount(2)
    await expect(page.getByTestId('order-visit-date')).toContainText(new Date(`${THURSDAY}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }))
    await expect(page.getByText(/Complete the payment within \d\d:\d\d/)).toBeVisible()
    await expect(page.getByTestId('order-tickets')).toHaveCount(0) // no tickets until paid
    // the development stand-in is clearly labelled as such
    await expect(page.getByTestId('mock-payment')).toContainText('development only')

    await page.reload() // the private key is kept in the address and in this browser
    await expect(page.getByTestId('order-status')).toHaveText('Waiting for payment')

    await page.getByTestId('mock-pay').click()
    await expect(page.getByTestId('order-status')).toHaveText(/Payment received/)
    await expect(page.getByTestId('order-ticket')).toHaveCount(3)
    await expect(page.getByTestId('order-ticket').first()).toContainText(/TKT-[0-9A-Z]{10}/)
    await expect(page.getByText(/valid on .* only\. Tickets are non-refundable\./)).toBeVisible()
    await expect(page.getByTestId('mock-payment')).toHaveCount(0)
    await expect(page.getByTestId('order-total')).toHaveText(money(135))

    // the cart was emptied by placing the order
    await page.goto(`${SITE}/checkout`)
    await expect(page.getByText('Your cart is empty')).toBeVisible()
  })

  test('the paid order page shows every ticket with its QR code, and the ticket PDF downloads', async () => {
    const page = customer!
    await page.goto(`${SITE}/orders/${firstOrder}`) // the key is kept in this browser
    await expect(page.getByTestId('order-ticket')).toHaveCount(3)
    await expect(page.getByTestId('ticket-status')).toHaveText(['Valid', 'Valid', 'Valid'])
    await expect(page.getByTestId('ticket-qr')).toHaveCount(3)
    // each code is a real image, different for every ticket
    const sources = await page.getByTestId('ticket-qr').evaluateAll((imgs) => (imgs as HTMLImageElement[]).map((i) => ({ src: i.src.slice(0, 40), data: i.src.length, w: i.naturalWidth })))
    for (const s of sources) {
      expect(s.src).toMatch(/^data:image\/png;base64,/)
      expect(s.w).toBeGreaterThan(100)
    }
    const refs = await page.getByTestId('ticket-ref').allTextContents()
    expect(new Set(refs).size).toBe(3)
    for (const ref of refs) expect(ref).toMatch(/^TKT-[0-9A-Z]{10}$/)

    // all tickets as one PDF
    const [all] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-all').click()])
    expect(all.suggestedFilename()).toBe(`al-azhar-park-${firstOrder}.pdf`)
    const allBytes = fs.readFileSync((await all.path())!)
    expect(allBytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect((allBytes.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length).toBe(3)
    expect(allBytes.toString('latin1')).toContain('/Subtype /Image')

    // one ticket
    const [one] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-ticket').first().click()])
    expect(one.suggestedFilename()).toBe(`${refs[0]}.pdf`)
    const oneBytes = fs.readFileSync((await one.path())!)
    expect((oneBytes.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length).toBe(1)

    // the private key travels in a header: it is not in the address of the download, and without it nothing downloads
    const noKey = await page.request.get(`${API}/public/orders/${firstOrder}/tickets/pdf`)
    expect(noKey.status()).toBe(404)
    const wrongKey = await page.request.get(`${API}/public/orders/${firstOrder}/tickets/${refs[0]}/pdf`, { headers: { 'X-Order-Token': 'z'.repeat(43) } })
    expect(wrongKey.status()).toBe(404)
  })

  test('opening the order page without its private key shows nothing about the order', async ({ browser }) => {
    const page = await freshPage(browser, `/orders/${firstOrder}`)
    await expect(page.getByTestId('order-not-found')).toBeVisible()
    await expect(page.getByText('Mona Hassan')).toHaveCount(0)
    await page.goto(`${SITE}/orders/${firstOrder}#k=${'x'.repeat(43)}`)
    await expect(page.getByTestId('order-not-found')).toBeVisible()
    await page.context().close()
  })

  test('a failed payment can be tried again; pressing Place order twice makes one order', async ({ browser }) => {
    const before = (await apiAs(admin, 'GET', '/orders?limit=100')).data.length
    const page = await freshPage(browser, '/tickets')
    await chooseTickets(page, { date: FRIDAY, adults: 1, children: 0 })
    await addToCartAndCheckout(page)
    await fillDetails(page, { name: 'Omar Said', email: 'omar@example.com' })
    const place = page.getByRole('button', { name: 'Place order and pay' })
    await place.dblclick()
    await expect(page.getByTestId('order-status')).toHaveText('Waiting for payment')
    expect((await apiAs(admin, 'GET', '/orders?limit=100')).data.length).toBe(before + 1)

    await page.getByTestId('mock-fail').click()
    await expect(page.getByText('The payment did not go through. You can try again.')).toBeVisible()
    await expect(page.getByTestId('order-status')).toHaveText('Waiting for payment')
    await page.getByTestId('pay-again').click()
    await expect(page.getByTestId('mock-pay')).toBeVisible()
    await page.getByTestId('mock-pay').click()
    await expect(page.getByTestId('order-status')).toHaveText(/Payment received/)
    await expect(page.getByTestId('order-total')).toHaveText(money(60))
    await page.context().close()
  })

  test('the server refuses prices, totals and invalid tickets sent by a tampering client', async ({ browser }) => {
    const page = await freshPage(browser, '/tickets')
    const post = (path: string, data: unknown) => page.request.post(`${API}${path}`, { data })
    const base = { visitDate: THURSDAY, audience: 'RESIDENT', items: [{ ticketType: 'ADULT', quantity: 1 }] }
    expect((await post('/public/orders/quote', { ...base, totalMinor: 1 })).status()).toBe(400)
    expect((await post('/public/orders/quote', { ...base, items: [{ ticketType: 'ADULT', quantity: 1, unitPriceMinor: 1 }] })).status()).toBe(400)
    expect((await post('/public/orders/quote', { ...base, items: [{ ticketType: 'INFANT', quantity: 1 }] })).status()).toBe(422)
    expect((await post('/public/orders/quote', { ...base, items: [{ ticketType: 'ADULT', quantity: -1 }] })).status()).toBe(400)
    expect((await post('/public/orders/quote', { ...base, items: [{ ticketType: 'ADULT', quantity: 500 }] })).status()).toBe(422)
    expect((await post('/public/orders/quote', { ...base, visitDate: addDays(TODAY, -1) })).status()).toBe(422)
    expect((await post('/public/orders/quote', { ...base, visitDate: addDays(TODAY, 91) })).status()).toBe(422)
    const quote = await post('/public/orders/quote', base)
    expect(quote.status()).toBe(200)
    expect((await quote.json()).data.totalMinor).toBe(5000)
    // the mock payment endpoint refuses a payment that does not exist
    expect((await post('/public/payments/mock/mock_nothing/complete', { outcome: 'SUCCESS' })).status()).toBe(404)
    await page.context().close()
  })

  test('the confirmation e-mail was queued and sent once; staff can resend it, and admins can see its status', async ({ browser }) => {
    const ops = await signedInPage(browser, USERS.operations)
    await openSection(ops.page, 'Orders')
    await ops.page.getByLabel('Search').fill(firstOrder)
    await ops.page.getByRole('button', { name: `Open order ${firstOrder}` }).click()
    const detail = ops.page.getByTestId('order-detail')
    await expect(detail.getByTestId('order-ticket')).toHaveCount(3)
    await expect(detail.getByTestId('order-ticket').first()).toContainText('valid')
    await expect(detail).toContainText('Ticket e-mail')
    // operations may resend but is not shown the delivery log (that needs the notifications permission)
    await expect(detail.getByTestId('email-row')).toHaveCount(0)
    await detail.getByRole('button', { name: 'Resend e-mail' }).click()
    await expect(ops.page.getByText('The ticket e-mail was sent.').first()).toBeVisible()
    await ops.context.close()

    // the administrator sees both messages, each sent, and nothing private
    await openSection(admin, 'Orders')
    await admin.getByLabel('Search').fill(firstOrder)
    await admin.getByRole('button', { name: `Open order ${firstOrder}` }).click()
    const adminDetail = admin.getByTestId('order-detail')
    await expect(adminDetail.getByTestId('email-row')).toHaveCount(2)
    for (const row of await adminDetail.getByTestId('email-row').all()) {
      await expect(row).toContainText('mona@example.com')
      await expect(row).toContainText('Sent')
    }
    await expect(adminDetail).not.toContainText('#k=')
    await admin.getByRole('button', { name: 'Close' }).click()
  })

  test('a single ticket can be cancelled by staff with a reason; the customer\'s page stops showing its code', async ({ browser }) => {
    const ops = await signedInPage(browser, USERS.operations)
    await openSection(ops.page, 'Orders')
    await ops.page.getByLabel('Search').fill(firstOrder)
    await ops.page.getByRole('button', { name: `Open order ${firstOrder}` }).click()
    const detail = ops.page.getByTestId('order-detail')
    const target = (await detail.getByTestId('order-ticket').first().locator('span.font-mono').textContent())!.trim()
    await detail.getByRole('button', { name: `Cancel ticket ${target}` }).click()
    await expect(ops.page.getByText('It is not a refund').first()).toBeVisible()
    await detail.getByRole('button', { name: 'Confirm ticket cancellation' }).click()
    await expect(ops.page.getByText('Say why the order is being cancelled.')).toBeVisible()
    await detail.getByLabel('Reason (required)').fill('Bought twice by mistake')
    await detail.getByRole('button', { name: 'Confirm ticket cancellation' }).click()
    await expect(ops.page.getByText('Ticket cancelled.').first()).toBeVisible()
    await expect(detail.getByTestId('order-ticket').first()).toContainText('cancelled')
    await expect(detail.getByRole('button', { name: `Cancel ticket ${target}` })).toHaveCount(0)
    await ops.context.close()

    await customer!.reload()
    await expect(customer!.getByTestId('ticket-status').first()).toHaveText('Cancelled')
    await expect(customer!.getByTestId('ticket-qr')).toHaveCount(2)
    await expect(customer!.getByTestId('ticket-no-qr')).toHaveCount(1)
    await expect(customer!.getByTestId('download-ticket')).toHaveCount(2)
    const gone = await customer!.request.get(`${API}/public/orders/${firstOrder}/tickets/${target}/pdf`, { headers: { 'X-Order-Token': (await customer!.evaluate((n) => localStorage.getItem(`azharpark-order-${n}`), firstOrder))! } })
    expect(gone.status()).toBe(404)
  })

  test('staff see the order in the portal with the right details, and cancelling needs a reason (it is not a refund)', async ({ browser }) => {
    const { page, context } = await signedInPage(browser, USERS.operations)
    await openSection(page, 'Orders')
    await expect(orderRow(page, firstOrder)).toContainText('Paid')
    await expect(orderRow(page, firstOrder)).toContainText('135 EGP')
    await expect(orderRow(page, firstOrder)).toContainText('Mona Hassan')

    await page.getByLabel('Search').fill('omar@example.com')
    await expect(page.getByTestId('order-row')).toHaveCount(1)
    await page.getByLabel('Search').fill(firstOrder)
    await expect(page.getByTestId('order-row')).toHaveCount(1)
    await page.getByLabel('Status').selectOption('CANCELLED')
    await expect(page.getByText('No orders match.')).toBeVisible()
    await page.getByLabel('Status').selectOption('PAID')
    await expect(orderRow(page, firstOrder)).toBeVisible()

    await page.getByRole('button', { name: `Open order ${firstOrder}` }).click()
    const detail = page.getByTestId('order-detail')
    await expect(detail).toContainText('Visit date')
    await expect(detail).toContainText('Adult')
    await expect(detail).toContainText('Child (2–8 years)')
    await expect(detail.getByTestId('order-total')).toHaveText('135 EGP')
    await expect(detail).toContainText('mona@example.com')
    await expect(detail).toContainText('MOCK')
    await expect(detail).toContainText('Paid') // the payment
    await detail.getByRole('button', { name: 'Cancel this order' }).click()
    await expect(page.getByText('It is not a refund')).toBeVisible()
    await detail.getByRole('button', { name: 'Confirm cancellation' }).click()
    await expect(page.getByText('Say why the order is being cancelled.')).toBeVisible()
    await detail.getByLabel('Reason (required)').fill('Park closed by the governor for a state visit')
    await detail.getByRole('button', { name: 'Confirm cancellation' }).click()
    await expect(page.getByText('Order cancelled.').first()).toBeVisible()
    await expect(detail).toContainText('Cancelled')
    await expect(detail).toContainText('Park closed by the governor for a state visit')
    await expect(detail).toContainText('Dev Operations')
    await expect(detail.getByRole('button', { name: 'Cancel this order' })).toHaveCount(0)
    await context.close()

    // the customer's own browser now shows the cancellation; a browser without the key still sees nothing
    await customer!.goto(`${SITE}/orders/${firstOrder}`)
    await expect(customer!.getByTestId('order-status')).toHaveText('This order was cancelled')
    await expect(customer!.getByText('The park cancelled this order')).toBeVisible()
    await expect(customer!.getByTestId('order-ticket')).toHaveCount(0) // no usable ticket for a cancelled order
    await expect(customer!.getByTestId('ticket-qr')).toHaveCount(0)
    const stranger = await freshPage(browser, `/orders/${firstOrder}`)
    await expect(stranger.getByTestId('order-not-found')).toBeVisible()
    await stranger.context().close()
  })

  test('permissions decide what each staff member sees: orders, ticket types and prices', async ({ browser }) => {
    const staff = await signedInPage(browser, USERS.staff)
    await expect(nav(staff.page).getByRole('link', { name: 'Ticket types', exact: true })).toBeVisible()
    await expect(nav(staff.page).getByRole('link', { name: 'Orders', exact: true })).toHaveCount(0)
    await expect(nav(staff.page).getByRole('link', { name: 'Ticket prices', exact: true })).toHaveCount(0)
    await staff.page.goto('http://localhost:5274/orders')
    await expect(staff.page.getByText('You do not have access to this page.')).toBeVisible()
    await staff.context.close()

    const ops = await signedInPage(browser, USERS.operations)
    await expect(nav(ops.page).getByRole('link', { name: 'Orders', exact: true })).toBeVisible()
    await expect(nav(ops.page).getByRole('link', { name: 'Ticket types', exact: true })).toBeVisible()
    await expect(nav(ops.page).getByRole('link', { name: 'Ticket prices', exact: true })).toHaveCount(0)
    await openSection(ops.page, 'Ticket types')
    await expect(ops.page.getByRole('button', { name: 'Add a ticket type' })).toHaveCount(0) // read only
    await ops.context.close()

    const analyst = await signedInPage(browser, USERS.analyst)
    await openSection(analyst.page, 'Orders')
    await expect(analyst.page.getByTestId('order-row').first()).toBeVisible()
    await expect(analyst.page.getByRole('columnheader', { name: 'Customer' })).toHaveCount(0) // no customers:read
    await expect(analyst.page.getByText('Mona Hassan')).toHaveCount(0)
    await analyst.page.getByRole('button', { name: `Open order ${firstOrder}` }).click()
    await expect(analyst.page.getByTestId('order-detail')).toContainText('135 EGP')
    await expect(analyst.page.getByRole('button', { name: 'Cancel this order' })).toHaveCount(0) // no orders:cancel
    await expect(analyst.page.getByText('mona@example.com')).toHaveCount(0)
    await analyst.page.getByRole('button', { name: 'Close' }).click()
    await openSection(analyst.page, 'Ticket prices')
    await expect(analyst.page.getByRole('button', { name: 'Add a new price' })).toHaveCount(0) // read only
    await expect(analyst.page.getByTestId('price-matrix-row')).toHaveCount(4)
    await analyst.context.close()
  })

  test('ticket types: both are listed, and a ticket for children under 2 cannot be created', async () => {
    await openSection(admin, 'Ticket types')
    await expect(admin.getByTestId('ticket-type-row')).toHaveCount(2)
    await expect(admin.getByTestId('ticket-type-row').nth(0)).toContainText('Ages 9+')
    await expect(admin.getByTestId('ticket-type-row').nth(1)).toContainText('Ages 2–8')
    await expect(admin.getByText(/Children under 2 enter free/)).toBeVisible()
    await admin.getByRole('button', { name: 'Add a ticket type' }).click()
    const dialog = admin.getByRole('dialog')
    await dialog.getByLabel('Name (English)').fill('Infant')
    await dialog.getByLabel('Name (Arabic)').fill('رضيع')
    await dialog.getByLabel('Code').fill('INFANT')
    await dialog.getByLabel('Youngest age').fill('1')
    await dialog.getByRole('button', { name: 'Save ticket type' }).click()
    await expect(dialog.getByText(/Children under 2 enter free and do not need a ticket/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(admin.getByTestId('ticket-type-row')).toHaveCount(2)
    // an age range that is already taken is refused by the server
    await admin.getByRole('button', { name: 'Edit Child (2–8 years)' }).click()
    await expect(admin.getByRole('dialog')).toContainText('already been sold')
    await expect(admin.getByRole('dialog').getByLabel('Youngest age')).toBeDisabled()
    await admin.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  })

  test('prices: a new price applies from its date; orders already placed keep the price they paid', async ({ browser }) => {
    await openSection(admin, 'Ticket prices')
    await expect(admin.getByTestId('price-matrix-row')).toHaveCount(4)
    await expect(admin.getByTestId('price-matrix-row').filter({ hasText: 'Egyptian' }).filter({ hasText: 'Adult' })).toContainText('50 EGP')
    await expect(admin.getByTestId('price-matrix-row').filter({ hasText: 'Egyptian' }).filter({ hasText: 'Adult' })).toContainText('60 EGP')

    const from = nextDow(addDays(TODAY, 40), 0) // a Sunday well ahead, so today's orders are not affected
    await admin.getByRole('button', { name: 'Add a new price' }).click()
    const dialog = admin.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Add price' }).click()
    await expect(dialog.getByText('Choose a ticket type.')).toBeVisible()
    await dialog.getByLabel('Ticket type').selectOption({ label: 'Adult' })
    await dialog.getByLabel('For').selectOption({ label: 'Egyptian' })
    await dialog.getByLabel('Days').selectOption('WEEKDAY')
    await dialog.getByLabel('Price (EGP)').fill('0')
    await dialog.getByRole('button', { name: 'Add price' }).click()
    await expect(dialog.getByText(/above 0 EGP/)).toBeVisible()
    await dialog.getByLabel('Price (EGP)').fill('75.5')
    await dialog.getByLabel('Starts on').fill(addDays(TODAY, -1))
    await dialog.getByRole('button', { name: 'Add price' }).click()
    await expect(dialog.getByText(/today or later/)).toBeVisible()
    await dialog.getByLabel('Starts on').fill(from)
    await expect(dialog.getByText(/will end on/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Add price' }).click()
    await expect(admin.getByText('New price added.').first()).toBeVisible()

    const upcoming = admin.getByTestId('price-row').filter({ hasText: '75.50 EGP' })
    await expect(upcoming).toContainText('Upcoming')
    // the old price now ends the day before the new one starts (it stays current until then) and keeps its sales count
    const old = admin.getByTestId('price-row').filter({ hasText: 'Adult' }).filter({ hasText: 'Egyptian' }).filter({ hasText: 'Weekdays' }).filter({ hasText: /(?<![\d.])50 EGP/ })
    await expect(old).toHaveCount(1)
    await expect(old).toContainText('Current')
    await expect(old).not.toContainText('open ended')
    // the orders made earlier used it: the page shows exactly as many sales as the server counts (other specs may have sold some too)
    const prices = (await apiAs(admin, 'GET', '/prices')).data as Array<{ ticketType: { code: string }; audience: { code: string }; days: string; amountMinor: number; timesUsed: number }>
    const sold = prices.find((p) => p.ticketType.code === 'ADULT' && p.audience.code === 'RESIDENT' && p.days === 'WEEKDAY' && p.amountMinor === 5000)!.timesUsed
    expect(sold).toBeGreaterThanOrEqual(1)
    await expect(old).toContainText(`sold ${sold}×`)

    // the website: before the new price starts, the old one; from its first day, the new one
    const site = await freshPage(browser, '/tickets')
    await site.getByLabel('Visit date').fill(addDays(from, -3)) // a Thursday before
    await expect(site.getByTestId('ticket-price').first()).toHaveText(/^50 LE per ticket$/)
    await site.getByLabel('Visit date').fill(from)
    await expect(site.getByTestId('ticket-price').first()).toHaveText(/^75\.5 LE per ticket$/)
    await expect(site.getByTestId('ticket-total')).toHaveText('151 LE')

    // the order bought earlier still shows exactly what was paid
    const orders = (await apiAs(admin, 'GET', '/orders?limit=100')).data as Array<{ id: string; orderNumber: string }>
    const id = orders.find((o) => o.orderNumber === firstOrder)!.id
    const detail2 = (await apiAs(admin, 'GET', `/orders/${id}`)).data
    expect(detail2.totalMinor).toBe(13500)
    expect(detail2.items.find((i: { typeNameEn: string }) => i.typeNameEn === 'Adult').unitPriceMinor).toBe(5000)
    await site.context().close()

    // switch the new price off again: the ticket cannot be sold on those dates without a price
    admin.once('dialog', (d) => void d.accept())
    await admin.getByRole('button', { name: /Switch off Adult Egyptian 75.50 EGP/ }).click()
    await expect(admin.getByText('Price switched off.').first()).toBeVisible()
    await expect(upcoming).toContainText('Switched off')
  })

  test('Plan my day sells the same tickets at the same server prices', async ({ browser }) => {
    const page = await freshPage(browser, '/plan')
    // the plan starts with two adults on tomorrow's date: the total comes from the server's price list
    const total = page.locator('p.font-display', { hasText: /LE$/ }).first()
    await expect(total).toHaveText(/^\d+(\.\d+)? LE$/)
    const planTotal = (await total.textContent())!.trim()
    await page.locator('input[type=date]').fill(THURSDAY)
    await expect(total).toHaveText('100 LE') // 2 adults × 50 LE on a weekday
    await page.getByRole('button', { name: /Add tickets to cart/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Checkout' }).click()
    await expect(page.getByTestId('quote-total')).toHaveText('100 LE')
    await expect(page.getByTestId('quote-date')).toContainText('Egyptian')
    expect(planTotal).toMatch(/LE$/)
    await page.context().close()
  })

  test('the site is bilingual: Arabic reads right to left, with Arabic digits', async ({ browser }) => {
    const page = await freshPage(browser, '/tickets')
    await expect(page.getByTestId('ticket-row').first()).toBeVisible()
    await page.locator('button:visible', { hasText: 'العربية' }).first().click()
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await page.getByLabel('تاريخ الزيارة').fill(THURSDAY)
    await expect(page.getByTestId('ticket-price').first()).toContainText('٥٠')
    await expect(page.getByTestId('ticket-total')).toContainText('١٠٠ جنيه')
    await expect(page.getByTestId('booking-notes')).toContainText('يدخل الأطفال دون سن ٢ مجانًا')
    await expect(page.getByTestId('booking-notes')).toContainText('غير قابلة للاسترداد')
    await page.getByRole('button', { name: 'أضف إلى السلة' }).click()
    await page.goto(`${SITE}/checkout`)
    await expect(page.getByTestId('quote-total')).toContainText('١٠٠ جنيه')
    await expect(page.getByRole('button', { name: 'إتمام الطلب والدفع' })).toBeVisible()
    await page.getByRole('button', { name: 'إتمام الطلب والدفع' }).click()
    await expect(page.getByText('يُرجى إدخال اسمك الكامل.')).toBeVisible()
    await page.context().close()
  })

  test('Arabic customers get an Arabic order page, Arabic ticket cards and an Arabic PDF', async ({ browser }) => {
    const context = await browser.newContext()
    await context.addInitScript(() => window.localStorage.setItem('azharpark-lang', 'ar'))
    const page = await context.newPage()
    await page.goto(`${SITE}/tickets`)
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByTestId('ticket-row').first()).toBeVisible()
    await page.getByLabel('تاريخ الزيارة').fill(THURSDAY)
    await expect(page.getByTestId('ticket-total')).toContainText('جنيه')
    await page.getByRole('button', { name: 'أضف إلى السلة' }).click()
    await page.goto(`${SITE}/checkout`)
    await expect(page.getByTestId('quote-line').first()).toBeVisible()
    await page.locator('input[name=fullName]').fill('منى حسن')
    await page.locator('input[name=email]').fill('mona.ar@example.com')
    await page.locator('input[name=phone]').fill('٠١٠٠١٢٣٤٥٦٧٨')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: 'إتمام الطلب والدفع' }).click()
    await expect(page.getByTestId('order-status')).toHaveText('في انتظار الدفع')
    await page.getByTestId('mock-pay').click()
    await expect(page.getByTestId('order-status')).toHaveText(/تم استلام الدفع/)
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByTestId('order-ticket')).toHaveCount(2)
    await expect(page.getByTestId('ticket-status').first()).toHaveText('صالحة')
    await expect(page.getByTestId('ticket-qr')).toHaveCount(2)
    await expect(page.getByTestId('order-total')).toContainText('جنيه')
    await expect(page.getByText(/كل تذكرة صالحة يوم .* فقط/)).toBeVisible()
    await expect(page.getByTestId('download-all')).toHaveText('تنزيل كل التذاكر (PDF)')

    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-all').click()])
    const bytes = fs.readFileSync((await pdf.path())!)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(bytes.toString('latin1')).toMatch(/Cairo/) // the Arabic font is embedded
    expect((bytes.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length).toBe(2)
    await context.close()
  })

  test('when the booking service cannot be reached the site says so, and shows no pretend confirmation', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.route('**/public/tickets/catalog**', (route) => route.abort())
    await page.goto(`${SITE}/tickets`)
    await expect(page.getByTestId('booking-unavailable')).toContainText('Online booking is not available right now')
    await expect(page.getByRole('button', { name: 'Add to cart' })).toHaveCount(0)
    await context.close()
  })
})
