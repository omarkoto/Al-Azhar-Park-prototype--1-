import { expect, test, type Page } from '@playwright/test'
import { API, SITE, USERS, freshSitePage, nav, openSection, signedInPage, toast } from './helpers'

// a real 1×1 PNG, so the browser can actually draw it
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const row = (page: Page, title: string) => page.getByTestId('event-row').filter({ hasText: title })

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

/**
 * The events workflow end to end: create → coming soon → photos → published → edited → cancelled, with the public
 * website checked at every step. The steps share state and clean up after themselves, so they run in order.
 */
test.describe.serial('events: portal to public website', () => {
  let page: Page
  let close: () => Promise<void>

  test.beforeAll(async ({ browser }) => {
    const s = await signedInPage(browser, USERS.content)
    page = s.page
    close = () => s.context.close()
  })
  test.afterAll(async () => {
    await close()
  })

  test('the Events page lists the seeded events with their status, and filters and searches them', async () => {
    await openSection(page, 'Events')
    await expect(page.getByTestId('event-row')).toHaveCount(3)
    await expect(row(page, 'Jazz Evenings on the Lawn')).toContainText('Published')
    await expect(row(page, 'Ramadan Nights')).toContainText('Coming soon')
    await expect(row(page, 'Ramadan Nights')).toContainText('Nightly') // the editors' own wording wins over the computed time

    await page.getByLabel('Status').selectOption('PUBLISHED')
    await expect(page.getByTestId('event-row')).toHaveCount(1)
    await page.getByLabel('Status').selectOption('DRAFT')
    await expect(page.getByText('No events match these filters.')).toBeVisible()
    await page.getByLabel('Status').selectOption('')
    await page.getByLabel('Search').fill('market')
    await expect(page.getByTestId('event-row')).toHaveCount(1)
    await page.getByLabel('Search').fill('')
    await expect(page.getByTestId('event-row')).toHaveCount(3)
  })

  test('creates an event that runs past midnight; mistakes are explained, and it starts as a draft', async () => {
    await page.getByRole('link', { name: 'Add an event' }).click()
    await page.getByLabel('Title (English)').fill('Browser Test Concert')
    await expect(page.getByLabel('Web address')).toHaveValue('browser-test-concert')
    await page.getByLabel('Title (Arabic)').fill('حفل اختبار المتصفح')
    await page.getByLabel('Short description (English)').fill('A late concert written by the browser test.')
    await page.getByLabel('Short description (Arabic)').fill('حفل موسيقي متأخر كتبه اختبار المتصفح.')
    await page.getByLabel('Description (English)', { exact: true }).fill('Live music under the Citadel skyline.\n\nBring a blanket.')
    await page.getByLabel('Description (Arabic)', { exact: true }).fill('موسيقى حية تحت أفق القلعة، ويُفضّل إحضار بطانية.')
    await page.getByLabel('Date', { exact: true }).fill('2027-05-14')

    // equal times are refused by the server, with the message next to the field
    await page.getByLabel('Starts').fill('20:00')
    await page.getByLabel('Ends').fill('20:00')
    await page.getByRole('button', { name: 'Create event' }).click()
    await expect(page.getByText('The end time must differ from the start time.').first()).toBeVisible()

    // 20:00 → 01:00: the form explains that it ends after midnight
    await page.getByLabel('Ends').fill('01:00')
    await expect(page.getByText('Ends after midnight, at 01:00 the next day (5 hours long).')).toBeVisible()
    await page.getByLabel('Venue').selectOption({ label: 'Open Area' })
    await page.getByRole('button', { name: 'Create event' }).click()
    await expect(toast(page, /Event created as a draft/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Browser Test Concert' })).toBeVisible()
    await expect(page.getByText('Only visible in this portal.')).toBeVisible()
  })

  test('a draft is not public: not in any list, and its address does not exist', async ({ browser }) => {
    const site = await freshSitePage(browser, '/events')
    await expect(site.getByTestId('whats-on')).toBeVisible({ timeout: 15_000 })
    await expect(site.getByText('Browser Test Concert')).toHaveCount(0)
    await site.goto(`${SITE}/events/browser-test-concert`)
    await expect(site).toHaveURL(`${SITE}/`, { timeout: 15_000 }) // unknown address: back to the home page
    await site.context().close()
  })

  test('marking it coming soon puts it in the public Coming soon section, with its own page', async ({ browser }) => {
    await page.getByRole('button', { name: 'Mark as coming soon' }).click()
    await expect(toast(page, 'Event is now coming soon.')).toBeVisible()

    const site = await freshSitePage(browser, '/events')
    const soon = site.getByTestId('events-coming-soon')
    await expect(soon.getByText('Browser Test Concert')).toBeVisible({ timeout: 15_000 })
    await expect(site.getByTestId('events-published').getByText('Browser Test Concert')).toHaveCount(0)

    await soon.getByTestId('event-card').filter({ hasText: 'Browser Test Concert' }).click()
    await expect(site).toHaveURL(/\/events\/browser-test-concert$/)
    await expect(site.getByRole('heading', { name: 'Browser Test Concert' }).first()).toBeVisible()
    await expect(site.getByText('Bring a blanket.')).toBeVisible()
    // 20:00 → 01:00, shown the way the site writes times, with the venue
    await expect(site.getByText(/8:00\s?PM\s?–\s?1:00\s?AM/)).toBeVisible()
    await expect(site.getByText('Open Area').first()).toBeVisible()
    await site.context().close()
  })

  test('adds a main photo (uploaded in the picker) and a gallery photo from the media library', async () => {
    await page.getByRole('tab', { name: 'photos' }).click()
    await page.getByRole('button', { name: 'Choose photo' }).click()
    const picker = page.getByRole('dialog')
    await picker.getByTestId('media-file-input').setInputFiles({ name: 'concert-hero.png', mimeType: 'image/png', buffer: PNG })
    await expect(page.getByTestId('event-hero-preview')).toBeVisible()
    await expect(toast(page, 'Main photo set.')).toBeVisible()

    await page.getByRole('button', { name: 'Add photo' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Choose' }).first().click()
    await page.getByLabel('Caption (English)').fill('The stage at dusk')
    await page.getByLabel('Caption (Arabic)').fill('المسرح عند الغروب')
    await page.getByRole('button', { name: 'Save gallery' }).click()
    await expect(toast(page, 'Gallery saved.')).toBeVisible()
  })

  test('publishing moves it to the public listing; the page shows the uploaded photos from the API', async ({ browser }) => {
    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(toast(page, 'Event is now published.')).toBeVisible()

    const site = await freshSitePage(browser, '/events')
    const published = site.getByTestId('events-published')
    await expect(published.getByText('Browser Test Concert')).toBeVisible({ timeout: 15_000 })
    await expect(site.getByTestId('events-coming-soon').getByText('Browser Test Concert')).toHaveCount(0)
    await expect(published.getByTestId('event-card').first()).toContainText('Jazz Evenings on the Lawn') // the seeded one keeps its place

    await published.getByTestId('event-card').filter({ hasText: 'Browser Test Concert' }).click()
    await expect(site.getByRole('heading', { name: 'Browser Test Concert' }).first()).toBeVisible()
    await expect.poll(async () => site.evaluate(() => [...document.images].filter((i) => i.src.includes('/api/v1/media/file/') && i.naturalWidth > 0).length)).toBeGreaterThanOrEqual(2)
    // the direct address works from a cold start too
    await site.goto(`${SITE}/events/browser-test-concert`)
    await expect(site.getByRole('heading', { name: 'Browser Test Concert' }).first()).toBeVisible({ timeout: 15_000 })
    await site.context().close()
  })

  test('the website shows the Arabic fields, right to left', async ({ browser }) => {
    const site = await freshSitePage(browser, '/events/browser-test-concert')
    await expect(site.getByRole('heading', { name: 'Browser Test Concert' }).first()).toBeVisible({ timeout: 15_000 })
    await site.locator('button:visible', { hasText: 'العربية' }).first().click()
    await expect(site.getByRole('heading', { name: 'حفل اختبار المتصفح' }).first()).toBeVisible()
    await expect(site.getByText('موسيقى حية تحت أفق القلعة')).toBeVisible()
    await expect(site.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(site.getByText(/٨:٠٠.*١:٠٠/)).toBeVisible() // Arabic digits for 8:00 PM – 1:00 AM
    await site.context().close()
  })

  test('editing the event changes what the public sees; the address is locked once it has been public', async ({ browser }) => {
    await page.getByRole('tab', { name: 'details' }).click()
    await expect(page.getByLabel('Web address')).toBeDisabled()
    await page.getByLabel('Title (English)').fill('Browser Test Concert (edited)')
    await page.getByLabel('Ends').fill('00:30')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Saved.')).toBeVisible()

    const site = await freshSitePage(browser, '/events/browser-test-concert')
    await expect(site.getByRole('heading', { name: 'Browser Test Concert (edited)' }).first()).toBeVisible({ timeout: 15_000 })
    await expect(site.getByText(/8:00\s?PM\s?–\s?12:30\s?AM/)).toBeVisible()
    await site.context().close()
  })

  test('moving it back to coming soon, then cancelling, changes its public visibility each time', async ({ browser }) => {
    await page.getByRole('button', { name: 'Mark as coming soon' }).click()
    await expect(toast(page, 'Event is now coming soon.')).toBeVisible()
    let site = await freshSitePage(browser, '/events')
    await expect(site.getByTestId('events-coming-soon').getByText('Browser Test Concert (edited)')).toBeVisible({ timeout: 15_000 })
    await expect(site.getByTestId('events-published').getByText('Browser Test Concert')).toHaveCount(0)
    await site.context().close()

    page.once('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: 'Cancel event' }).click()
    await expect(toast(page, 'Event is now cancelled.')).toBeVisible()
    site = await freshSitePage(browser, '/events')
    await expect(site.getByTestId('whats-on')).toBeVisible({ timeout: 15_000 })
    await expect(site.getByText('Browser Test Concert')).toHaveCount(0)
    await site.goto(`${SITE}/events/browser-test-concert`)
    await expect(site).toHaveURL(`${SITE}/`, { timeout: 15_000 })
    await site.context().close()
  })

  test('a cancelled event cannot jump back to the public; it is restored as a draft first', async () => {
    await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mark as coming soon' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Restore as draft' }).click()
    await expect(toast(page, 'Event is now draft.')).toBeVisible()
    page.once('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: 'Archive' }).click()
    await expect(toast(page, 'Event is now archived.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Restore as draft' })).toBeVisible()
  })

  test('reorders events: the public listing follows', async ({ browser }) => {
    await openSection(page, 'Events')
    await expect(page.getByTestId('event-row')).toHaveCount(4)
    await page.getByRole('button', { name: 'Move Jazz Evenings on the Lawn up' }).click()
    await expect(page.getByTestId('event-row').first()).toContainText('Jazz Evenings on the Lawn')
    await page.getByRole('button', { name: 'Move Darb Al-Ahmar Artisan Weekend up' }).click()
    await page.getByRole('button', { name: 'Move Darb Al-Ahmar Artisan Weekend up' }).click()
    await expect(page.getByTestId('event-row').first()).toContainText('Darb Al-Ahmar Artisan Weekend')
    const site = await freshSitePage(browser, '/events')
    await expect(site.getByTestId('events-coming-soon').getByTestId('event-card').first()).toContainText('Darb Al-Ahmar Artisan Weekend', { timeout: 15_000 })
    await site.context().close()
    // filters hide the arrows: the order is only changed on the whole list
    await page.getByLabel('Status').selectOption('COMING_SOON')
    await expect(page.getByRole('button', { name: /Move .* up/ })).toHaveCount(0)
    await page.getByLabel('Status').selectOption('')
  })

  test('with no events at all, the website shows a polished empty state (and the page still works)', async ({ browser }) => {
    // archive everything that is public (through the API, as this person), keeping a note of how to put it back
    const list = (await apiAs(page, 'GET', '/events?limit=100')).data as Array<{ id: string; status: string }>
    const publicOnes = list.filter((e) => e.status === 'PUBLISHED' || e.status === 'COMING_SOON')
    for (const e of publicOnes) expect((await apiAs(page, 'PUT', `/events/${e.id}/status`, { status: 'ARCHIVED' })).status).toBe(200)

    const site = await freshSitePage(browser, '/events')
    await expect(site.getByTestId('events-empty')).toBeVisible({ timeout: 15_000 })
    await expect(site.getByRole('link', { name: 'Plan your visit' })).toBeVisible()
    await expect(site.getByText('Sunken Garden').first()).toBeVisible() // the rest of the page is intact
    const answered = site.waitForResponse((r) => r.url().includes('/public/events/coming-soon'))
    await site.goto(`${SITE}/`)
    await answered
    await expect(site.getByRole('heading', { name: /Coming soon to the park/ })).toHaveCount(0) // the strip hides itself
    await site.context().close()

    for (const e of publicOnes) {
      expect((await apiAs(page, 'PUT', `/events/${e.id}/status`, { status: 'DRAFT' })).status).toBe(200)
      expect((await apiAs(page, 'PUT', `/events/${e.id}/status`, { status: e.status })).status).toBe(200)
    }
  })

  test('if the API is unreachable the website keeps its built-in coming-soon events', async ({ browser }) => {
    const context = await browser.newContext()
    await context.route('**/api/v1/public/**', (route) => route.abort())
    const site = await context.newPage()
    await site.goto(`${SITE}/events`)
    await expect(site.getByTestId('events-coming-soon').getByText('Ramadan Nights in the Garden')).toBeVisible({ timeout: 15_000 })
    await site.goto(`${SITE}/events/cairo-jazz-nights`)
    await expect(site.getByRole('heading', { name: 'Jazz Evenings on the Lawn' }).first()).toBeVisible()
    await context.close()
  })

  test('venues: create, edit, switch off (no longer offered for new events), reorder; a venue in use cannot be deleted', async () => {
    await openSection(page, 'Venues')
    await expect(page.getByTestId('venue-row')).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Delete Open Area' })).toBeDisabled() // the published jazz event uses it

    await page.getByRole('button', { name: 'Add a venue' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name (English)').fill('Rose Terrace')
    await expect(dialog.getByLabel('Web address')).toHaveValue('rose-terrace')
    await dialog.getByLabel('Name (Arabic)').fill('شرفة الورد')
    await dialog.getByLabel('Capacity (people)').fill('120')
    await dialog.getByRole('button', { name: 'Save venue' }).click()
    await expect(page.getByTestId('venue-row')).toHaveCount(4)
    await expect(page.getByTestId('venue-row').last()).toContainText('up to 120 people')

    await page.getByRole('button', { name: 'Edit Rose Terrace' }).click()
    const edit = page.getByRole('dialog')
    await edit.getByLabel('Active (can be chosen for new events)').uncheck()
    await edit.getByRole('button', { name: 'Save venue' }).click()
    await expect(page.getByTestId('venue-row').last()).toContainText('Switched off')

    await openSection(page, 'Events')
    await page.getByRole('link', { name: 'Add an event' }).click()
    await expect(page.getByLabel('Venue').locator('option', { hasText: 'Rose Terrace' })).toHaveCount(0) // switched off: not offered
    await expect(page.getByLabel('Venue').locator('option', { hasText: 'Open Area' })).toHaveCount(1)

    await openSection(page, 'Venues')
    await page.getByRole('button', { name: 'Move Rose Terrace up' }).click()
    await expect(page.getByTestId('venue-row').nth(2)).toContainText('Rose Terrace')
    page.once('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: 'Delete Rose Terrace' }).click()
    await expect(toast(page, 'Venue deleted.')).toBeVisible()
    await expect(page.getByTestId('venue-row')).toHaveCount(3)
  })

  test('clean up: delete the test event record\'s photos from the library', async () => {
    // the test event is archived (kept as a record); release its photos so the library is empty again
    const list = (await apiAs(page, 'GET', '/events?limit=100')).data as Array<{ id: string; slug: string }>
    const mine = list.find((e) => e.slug === 'browser-test-concert')!
    expect((await apiAs(page, 'PUT', `/events/${mine.id}/gallery`, { items: [] })).status).toBe(200)
    const detail = (await apiAs(page, 'GET', `/events/${mine.id}`)).data
    expect(detail.hero).not.toBeNull()
    await openSection(page, 'Events')
    await page.getByRole('link', { name: 'Open Browser Test Concert (edited)' }).click()
    await page.getByRole('tab', { name: 'photos' }).click()
    await page.getByRole('button', { name: 'Remove', exact: true }).first().click()
    await expect(toast(page, 'Main photo removed.')).toBeVisible()
    await openSection(page, 'Media library')
    page.on('dialog', (d) => void d.accept())
    for (const name of ['concert-hero.png']) {
      await page.getByRole('button', { name: `Delete ${name}` }).click()
      await expect(toast(page, 'Deleted.')).toBeVisible()
    }
    await expect(page.getByTestId('media-item')).toHaveCount(0)
  })
})

test.describe('events: who may do what', () => {
  test('operations can edit events but cannot change their status', async ({ browser }) => {
    const { page, context } = await signedInPage(browser, USERS.operations)
    await openSection(page, 'Events')
    await expect(page.getByRole('link', { name: 'Add an event' })).toBeVisible()
    await page.getByRole('link', { name: 'Open Jazz Evenings on the Lawn' }).click()
    await expect(page.getByLabel('Title (English)')).toBeEnabled()
    await expect(page.getByText('Changing the status needs the publish permission.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0)
    // the server agrees, whatever the page shows
    const ev = (await apiAs(page, 'GET', '/events?search=jazz')).data[0]
    expect((await apiAs(page, 'PUT', `/events/${ev.id}/status`, { status: 'ARCHIVED' })).status).toBe(403)
    await context.close()
  })

  test('an analyst can only look; ticket staff have no Events section at all', async ({ browser }) => {
    const analyst = await signedInPage(browser, USERS.analyst)
    await openSection(analyst.page, 'Events')
    await expect(analyst.page.getByTestId('event-row')).toHaveCount(4) // the three seeded events and the archived test event
    await expect(analyst.page.getByRole('link', { name: 'Add an event' })).toHaveCount(0)
    await analyst.page.getByRole('link', { name: 'Open Jazz Evenings on the Lawn' }).click()
    await expect(analyst.page.getByText('You can view this event but not change it.')).toBeVisible()
    await expect(analyst.page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
    const denied = await apiAs(analyst.page, 'POST', '/events', { slug: 'x-event', titleEn: 'x' })
    expect([400, 403]).toContain(denied.status)
    await openSection(analyst.page, 'Venues')
    await expect(analyst.page.getByRole('button', { name: 'Add a venue' })).toHaveCount(0)
    await analyst.context.close()

    const staff = await signedInPage(browser, USERS.staff)
    await expect(nav(staff.page).getByRole('link', { name: 'Events', exact: true })).toHaveCount(0)
    await staff.page.goto('http://localhost:5274/events')
    await expect(staff.page.getByText('You do not have access to this page')).toBeVisible()
    await staff.context.close()
  })
})
