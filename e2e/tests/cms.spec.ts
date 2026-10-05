import { expect, test, type Page } from '@playwright/test'
import { USERS, freshSitePage, openSection, signedInPage, toast } from './helpers'

/**
 * The content workflow end to end: a content manager edits the park's information in the portal, and the public
 * website shows it. The steps share state (and clean up after themselves), so they run in order.
 */
test.describe.serial('park content: portal edits reach the public website', () => {
  let page: Page
  let close: () => Promise<void>
  let originalPhones = ''

  test.beforeAll(async ({ browser }) => {
    const s = await signedInPage(browser, USERS.content)
    page = s.page
    close = () => s.context.close()
  })
  test.afterAll(async () => {
    await close()
  })

  test('park information: a missing Arabic name is refused by the server, then the edit saves', async () => {
    await openSection(page, 'Park information')
    const tagline = page.getByLabel('Tagline (English)')
    await expect(tagline).toHaveValue(/green heart/)
    await tagline.fill('The green heart of historic Cairo (edited in the browser test)')
    await page.getByLabel('Name (Arabic)').fill('')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Please fix the highlighted fields.')).toBeVisible()
    await expect(page.getByRole('alert').first()).toBeVisible() // the field-level message

    await page.getByLabel('Name (Arabic)').fill('حديقة الأزهر')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Park information saved.')).toBeVisible()
  })

  test('park information: statistics can be edited and removed', async () => {
    await openSection(page, 'Park information')
    await expect(page.getByLabel('Value')).toHaveCount(4)
    await page.getByRole('button', { name: 'Add a statistic' }).click()
    await expect(page.getByLabel('Value')).toHaveCount(5)
    await page.getByRole('button', { name: 'Remove statistic 5' }).click()
    await expect(page.getByLabel('Value')).toHaveCount(4)
  })

  test('contact details: an unsafe map link is refused, then phones, coordinates and Facebook save', async () => {
    await openSection(page, 'Contact details')
    const phones = page.getByLabel('Phone numbers')
    originalPhones = await phones.inputValue()
    await phones.fill(`${originalPhones}\n0100 999 8888`)
    await page.getByLabel('Google Maps link').fill('http://evil.example')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('must be an https link')).toBeVisible()

    await page.getByLabel('Google Maps link').fill('https://www.google.com/maps?cid=13021591783999119538')
    await page.getByLabel('Latitude').fill('30.0405')
    await page.getByLabel('Longitude').fill('31.2655')
    await page.getByLabel('Facebook').fill('https://www.facebook.com/alazharpark')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Contact details saved.')).toBeVisible()
  })

  test('opening hours: a closing time before opening is refused, then Friday saves', async () => {
    await openSection(page, 'Opening hours')
    const friday = { opens: page.locator('input[type=time]').nth(2 * 5), closes: page.locator('input[type=time]').nth(2 * 5 + 1) }
    await friday.closes.fill('08:00')
    await page.getByRole('button', { name: 'Save weekly hours' }).click()
    await expect(page.getByText('must close after it opens')).toBeVisible()

    await friday.closes.fill('23:30')
    await page.getByRole('button', { name: 'Save weekly hours' }).click()
    await expect(toast(page, 'Weekly hours saved.')).toBeVisible()
  })

  test('special hours: add a period, reject an overlapping one, edit the first', async () => {
    await openSection(page, 'Opening hours')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Type').selectOption('SPECIAL_HOURS')
    await dialog.getByLabel('First day').fill('2031-03-01')
    await dialog.getByLabel('Last day').fill('2031-03-30')
    await dialog.getByLabel('Opens').fill('10:00')
    await dialog.getByLabel('Closes').fill('23:30')
    await dialog.getByLabel('Name (English)').fill('Ramadan browser test')
    await dialog.getByLabel('Name (Arabic)').fill('رمضان')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Ramadan browser test')).toBeVisible()

    // an overlapping period with the same priority is refused, and the message says which one it clashes with
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    const clash = page.getByRole('dialog')
    await clash.getByLabel('First day').fill('2031-03-10')
    await clash.getByLabel('Last day').fill('2031-03-12')
    await clash.getByLabel('Name (English)').fill('Clashing period')
    await clash.getByLabel('Name (Arabic)').fill('تعارض')
    await clash.getByRole('button', { name: 'Save' }).click()
    await expect(clash.getByText(/Ramadan browser test.*already uses priority/)).toBeVisible()
    // a different priority is fine for the same days
    await clash.getByLabel(/Priority/).fill('50')
    await clash.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Clashing period')).toBeVisible()

    // edit the first period
    await page.getByRole('listitem').filter({ hasText: 'Ramadan browser test' }).getByRole('button', { name: 'Edit' }).click()
    const edit = page.getByRole('dialog')
    await edit.getByLabel('Name (English)').fill('Ramadan browser test (edited)')
    await edit.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Ramadan browser test (edited)')).toBeVisible()
  })

  test('the public website shows the new phone, hours, special period, directions and social link', async ({ browser }) => {
    const site = await freshSitePage(browser, '/contact')
    await expect(site.getByText('0100 999 8888').first()).toBeVisible({ timeout: 15_000 })
    await expect(site.locator('footer').getByText('0100 999 8888')).toBeVisible()
    await expect(site.getByRole('link', { name: /directions/i }).first()).toHaveAttribute('href', /destination=30\.0405,31\.2655/)
    await expect(site.locator('footer a[aria-label=Facebook]')).toHaveAttribute('href', 'https://www.facebook.com/alazharpark')

    await site.goto('http://localhost:5273/tickets')
    await expect(site.getByText(/Ramadan browser test \(edited\)/)).toBeVisible({ timeout: 15_000 })
    const body = await site.locator('body').innerText()
    expect(body).toMatch(/Friday/)
    expect(body).toMatch(/11:30\s?PM/)
    await site.context().close()
  })

  test('the website keeps its own marketing copy: the CMS tagline does not replace it', async ({ browser }) => {
    const site = await freshSitePage(browser, '/')
    await expect(site.getByText('A garden above a thousand years of city.')).toBeVisible({ timeout: 15_000 })
    await expect(site.getByText('edited in the browser test')).toHaveCount(0)
    await site.context().close()
  })

  test('clean up: restore phones, Friday hours, remove the test periods', async () => {
    await openSection(page, 'Contact details')
    await page.getByLabel('Phone numbers').fill(originalPhones)
    await page.getByLabel('Facebook').fill('')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Contact details saved.')).toBeVisible()

    await openSection(page, 'Opening hours')
    await page.locator('input[type=time]').nth(2 * 5 + 1).fill('22:00')
    await page.getByRole('button', { name: 'Save weekly hours' }).click()
    await expect(toast(page, 'Weekly hours saved.')).toBeVisible()

    page.on('dialog', (d) => void d.accept())
    for (const name of ['Clashing period', 'Ramadan browser test (edited)']) {
      await page.getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: 'Delete' }).click()
      await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0)
    }
  })
})
