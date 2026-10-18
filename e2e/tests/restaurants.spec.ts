import { expect, test, type Page } from '@playwright/test'
import { SITE, USERS, freshSitePage, nav, openSection, signedInPage, toast } from './helpers'

// a real 1×1 PNG, so the browser can actually draw it
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n')
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>')

const uploadInput = (page: Page) => page.getByTestId('media-file-input').first()

/**
 * Photos, PDFs and restaurants: from uploading in the portal to a visitor seeing the result on the website.
 * The steps share state and clean up after themselves, so they run in order.
 */
test.describe.serial('media library and restaurants', () => {
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

  test('the media library accepts photos and PDFs, and refuses a script disguised as an image', async () => {
    await openSection(page, 'Media library')
    await expect(page.getByText('Nothing here yet.')).toBeVisible()

    await uploadInput(page).setInputFiles({ name: 'terrace.png', mimeType: 'image/png', buffer: PNG })
    await expect(toast(page, 'Uploaded “terrace.png”.')).toBeVisible()
    await uploadInput(page).setInputFiles({ name: 'lunch-menu.pdf', mimeType: 'application/pdf', buffer: PDF })
    await expect(toast(page, 'Uploaded “lunch-menu.pdf”.')).toBeVisible()
    await expect(page.getByTestId('media-item')).toHaveCount(2)

    // the browser-side hint stops the obvious wrong file; the server would refuse it anyway
    await uploadInput(page).setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: SVG })
    await expect(toast(page, /not a JPEG, PNG, WebP or PDF/)).toBeVisible()
    // a script renamed .png and sent as image/png reaches the server, which looks at the bytes and refuses it
    await uploadInput(page).setInputFiles({ name: 'evil.png', mimeType: 'image/png', buffer: Buffer.from('<html><script>alert(1)</script></html>'.padEnd(60)) })
    await expect(toast(page, /Only JPEG, PNG and WebP images and PDF files/)).toBeVisible()
    await expect(page.getByTestId('media-item')).toHaveCount(2)

    await page.getByLabel('Type').selectOption('pdf')
    await expect(page.getByTestId('media-item')).toHaveCount(1)
    await page.getByLabel('Type').selectOption('')
  })

  test('descriptions can be added to a photo', async () => {
    await page.getByRole('button', { name: 'Describe terrace.png' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Not used anywhere yet.')).toBeVisible()
    await dialog.getByLabel('Description (English)').fill('The lakeside terrace')
    await dialog.getByLabel('Description (Arabic)').fill('تراس البحيرة')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(toast(page, 'Saved.')).toBeVisible()
  })

  test('creates a restaurant that closes after midnight, with its web address suggested from the name', async () => {
    await openSection(page, 'Restaurants')
    await expect(page.getByTestId('restaurant-row')).toHaveCount(3)
    await page.getByRole('link', { name: 'Add a restaurant' }).click()

    await page.getByLabel('Name (English)').fill('Rooftop Grill')
    await expect(page.getByLabel('Web address')).toHaveValue('rooftop-grill')
    await page.getByLabel('Name (Arabic)').fill('شواء الأسطح')
    await page.getByLabel('Tagline (English)').fill('Grills above the city')
    await page.getByLabel('Description (English)').fill('Charcoal grills with a view of the Citadel.')
    await page.getByLabel('Description (Arabic)').fill('مشويات على الفحم مع إطلالة على القلعة.')
    await page.getByLabel('Opens').fill('18:00')
    await page.getByLabel('Closes').fill('01:00')
    await page.getByLabel('Phone numbers').fill('0100 555 6666')
    await page.getByLabel('Instagram').fill('https://www.instagram.com/rooftop.grill/')

    // invalid input is explained next to the field and nothing is created
    await page.getByLabel('Website', { exact: true }).fill('http://not-secure.example')
    await page.getByRole('button', { name: 'Create restaurant' }).click()
    await expect(page.getByText('must be an https link')).toBeVisible()
    await page.getByLabel('Website', { exact: true }).fill('')

    await page.getByRole('button', { name: 'Create restaurant' }).click()
    await expect(toast(page, /Restaurant created/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Rooftop Grill' })).toBeVisible()
    await expect(page.getByLabel('Web address')).toBeDisabled() // cannot be changed afterwards
  })

  test('adds a main photo, a gallery photo and two menus (a link and an uploaded PDF)', async () => {
    await page.getByRole('tab', { name: 'photos' }).click()
    await page.getByRole('button', { name: 'Choose photo' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Choose' }).first().click()
    await expect(toast(page, 'Main photo set.')).toBeVisible()
    await expect(page.getByTestId('hero-preview')).toBeVisible()

    await page.getByRole('button', { name: 'Add photo' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Choose' }).first().click()
    await page.getByLabel('Caption (English)').fill('Evening on the roof')
    await page.getByRole('button', { name: 'Save gallery' }).click()
    await expect(toast(page, 'Gallery saved.')).toBeVisible()

    await page.getByRole('tab', { name: 'menus' }).click()
    await page.getByRole('button', { name: 'Add a menu' }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name (English)').fill('Dinner menu')
    await dialog.getByLabel('Name (Arabic)').fill('قائمة العشاء')
    await dialog.getByLabel('Link to the menu').fill('http://insecure.example/menu.pdf')
    await dialog.getByRole('button', { name: 'Save menu' }).click()
    await expect(dialog.getByText('must be an https link')).toBeVisible()
    await dialog.getByLabel('Link to the menu').fill('https://example.com/dinner.pdf')
    await dialog.getByRole('button', { name: 'Save menu' }).click()
    await expect(page.getByTestId('menu-row')).toHaveCount(1)

    await page.getByRole('button', { name: 'Add a menu' }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name (English)').fill('Lunch menu')
    await dialog.getByLabel('Name (Arabic)').fill('قائمة الغداء')
    await dialog.getByLabel('A PDF I upload').check()
    await dialog.getByRole('button', { name: 'Choose or upload a PDF' }).click()
    await page.getByRole('dialog').last().getByRole('button', { name: 'Choose' }).first().click()
    await expect(dialog.getByText('Chosen: lunch-menu.pdf')).toBeVisible()
    await dialog.getByRole('button', { name: 'Save menu' }).click()
    await expect(page.getByTestId('menu-row')).toHaveCount(2)
  })

  test('the website shows the new restaurant: name, hours after midnight, photo, gallery and both menus', async ({ browser }) => {
    const site = await freshSitePage(browser, '/restaurants')
    await expect(site.getByRole('heading', { name: 'Rooftop Grill' })).toBeVisible({ timeout: 15_000 })
    await expect(site.getByText('18:00 – 01:00')).toBeVisible()
    // only the restaurant that has an Instagram address gets a Reserve button; the built-in ones have none and show none
    await expect(site.getByRole('link', { name: 'Reserve a table' })).toHaveCount(1)
    await site.goto(`${SITE}/restaurants/hilltop`)
    await expect(site.getByRole('heading', { name: 'Hill-Top Restaurant' }).first()).toBeVisible({ timeout: 15_000 })
    await expect(site.getByRole('link', { name: 'Reserve a table' })).toHaveCount(0)
    await expect(site.getByRole('button', { name: 'Reserve a table' })).toHaveCount(0)
    await site.goto(`${SITE}/restaurants`)

    await site.goto(`${SITE}/restaurants/rooftop-grill`)
    await expect(site.getByRole('heading', { name: 'Rooftop Grill' }).first()).toBeVisible({ timeout: 15_000 })
    await expect(site.getByText('Charcoal grills with a view of the Citadel.')).toBeVisible()
    // "Reserve a table" goes straight to the restaurant's own Instagram: no form, no booking stored
    await expect(site.getByRole('link', { name: 'Reserve a table' })).toHaveAttribute('href', 'https://www.instagram.com/rooftop.grill/')
    await expect(site.getByRole('button', { name: 'Reserve a table' })).toHaveCount(0)
    await expect(site.getByRole('link', { name: 'Dinner menu' })).toHaveAttribute('href', 'https://example.com/dinner.pdf')
    const lunch = site.getByRole('link', { name: 'Lunch menu' })
    await expect(lunch).toHaveAttribute('href', /localhost:3100\/api\/v1\/media\/file\/.+\.pdf$/)
    // the uploaded photos really load from the API (not just a URL in the page)
    await expect.poll(async () => site.evaluate(() => [...document.images].filter((i) => i.src.includes('/api/v1/media/file/') && i.naturalWidth > 0).length)).toBeGreaterThanOrEqual(2)
    await site.context().close()
  })

  test('the uploaded menu PDF is served safely to visitors', async ({ request }) => {
    const list = await request.get('http://localhost:3100/api/v1/public/restaurants/rooftop-grill')
    const body = (await list.json()).data
    const pdf = body.menus.find((m: { kind: string }) => m.kind === 'pdf')
    const file = await request.get(`http://localhost:3100${pdf.url}`)
    expect(file.status()).toBe(200)
    expect(file.headers()['content-type']).toMatch(/application\/pdf/)
    expect(file.headers()['x-content-type-options']).toBe('nosniff')
    expect(file.headers()['content-security-policy']).toMatch(/sandbox/)
  })

  test('a photo or PDF that is in use cannot be deleted from the library', async () => {
    await openSection(page, 'Media library')
    page.once('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: 'Delete lunch-menu.pdf' }).click()
    await expect(toast(page, /still used by: menu “Lunch menu” of Rooftop Grill/)).toBeVisible()
  })

  test('reordering puts the restaurant first on the website; turning it off hides it', async ({ browser }) => {
    await openSection(page, 'Restaurants')
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Move Rooftop Grill up' }).click()
    await expect(page.getByTestId('restaurant-row').first()).toContainText('Rooftop Grill')
    let site = await freshSitePage(browser, '/restaurants')
    await expect(site.getByRole('heading', { level: 2 }).first()).toHaveText('Rooftop Grill', { timeout: 15_000 })
    await site.context().close()

    await page.getByRole('link', { name: 'Open Rooftop Grill' }).click()
    await page.getByLabel('Show this restaurant on the website').uncheck()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Saved.')).toBeVisible()
    site = await freshSitePage(browser, '/restaurants')
    await expect(site.getByRole('heading', { name: 'Hill-Top Restaurant' })).toBeVisible({ timeout: 15_000 })
    await expect(site.getByRole('heading', { name: 'Rooftop Grill' })).toHaveCount(0)
    await site.context().close()
  })

  test('a built-in restaurant can be edited in the portal and the website shows the change', async ({ browser }) => {
    await openSection(page, 'Restaurants')
    await page.getByRole('link', { name: 'Open Hill-Top Restaurant' }).click()
    await page.getByLabel('Tagline (English)').fill('Fatimid-style dining (edited in the browser test)')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Saved.')).toBeVisible()
    const site = await freshSitePage(browser, '/restaurants')
    await expect(site.getByText('Fatimid-style dining (edited in the browser test)')).toBeVisible({ timeout: 15_000 })
    // its built-in photo is kept because no photo was uploaded for it
    await expect(site.locator('img[src*="restaurant-hilltop"]').first()).toBeVisible()
    await site.context().close()
  })

  test('clean up: remove the test restaurant, restore the tagline, delete the test files', async () => {
    await openSection(page, 'Restaurants')
    await page.getByRole('link', { name: 'Open Hill-Top Restaurant' }).click()
    await page.getByLabel('Tagline (English)').fill('Fatimid-style dining above Old Cairo')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Saved.')).toBeVisible()

    await openSection(page, 'Restaurants')
    await page.getByRole('link', { name: 'Open Rooftop Grill' }).click()
    page.once('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: 'Remove restaurant' }).click()
    await expect(toast(page, 'Restaurant removed.')).toBeVisible()
    await expect(page.getByTestId('restaurant-row')).toHaveCount(3)

    await openSection(page, 'Media library')
    page.on('dialog', (d) => void d.accept())
    for (const name of ['terrace.png', 'lunch-menu.pdf']) {
      await page.getByRole('button', { name: `Delete ${name}` }).click()
      await expect(toast(page, 'Deleted.')).toBeVisible()
    }
    await expect(page.getByTestId('media-item')).toHaveCount(0)
    await expect(nav(page).getByRole('link', { name: 'Media library', exact: true })).toBeVisible()
  })
})
