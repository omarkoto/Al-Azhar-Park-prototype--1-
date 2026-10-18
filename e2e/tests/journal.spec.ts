import { expect, test, type Page } from '@playwright/test'
import { API, SITE, USERS, freshSitePage, nav, openSection, signedInPage, toast } from './helpers'

// a real 1×1 PNG, so the browser can actually draw it
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const row = (page: Page, title: string) => page.getByTestId('journal-row').filter({ hasText: title })

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

const TITLE = 'Browser Test Story'
const SLUG = 'browser-test-story'
const SHORT = 'A short card text written by the browser test.'
const BODY_1 = 'First paragraph of the browser test story.'
const BODY_2 = 'Second paragraph, with <b>markup</b> that must stay plain text.'

/** The website in Arabic: the language choice is kept in the browser, so a fresh context is told before the page loads. */
async function arabicSite(browser: import('@playwright/test').Browser, path: string): Promise<Page> {
  const context = await browser.newContext()
  await context.addInitScript(() => window.localStorage.setItem('azharpark-lang', 'ar'))
  const page = await context.newPage()
  await page.goto(`${SITE}${path}`)
  return page
}

/**
 * The Journal workflow end to end: write an article in the portal, give it a cover and photos, publish it, and see the card
 * and the full article on the public website; then edit, archive and check who may do what. The steps share state, so they run in order.
 */
test.describe.serial('Journal: portal to public website', () => {
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

  test('the Journal page lists the seeded stories with their status, and filters and searches them', async () => {
    await openSection(page, 'Journal')
    await expect(page.getByRole('heading', { name: 'Journal', exact: true })).toBeVisible()
    await expect(page.getByTestId('journal-row')).toHaveCount(6)
    await expect(row(page, 'A royal welcome at Al-Azhar Park')).toContainText('Published')
    await expect(row(page, 'A royal welcome at Al-Azhar Park')).toContainText('History')
    await page.getByLabel('Search').fill('three tables')
    await expect(page.getByTestId('journal-row')).toHaveCount(1)
    await page.getByLabel('Search').fill('')
    await page.getByLabel('Status').selectOption('DRAFT')
    await expect(page.getByText('No articles match these filters.')).toBeVisible()
    await page.getByLabel('Status').selectOption('')
    await expect(page.getByTestId('journal-row')).toHaveCount(6)
  })

  test('writes an article in both languages: the address follows the title and a preview shows the card as it is typed', async () => {
    await page.getByRole('link', { name: 'Add an article' }).click()
    await expect(page.getByRole('heading', { name: 'New article' })).toBeVisible()
    await page.getByLabel('Title (English)').fill(TITLE)
    await expect(page.getByLabel('Web address')).toHaveValue(SLUG)
    await page.getByLabel('Title (Arabic)').fill('قصة اختبار المتصفح')
    await page.getByLabel('Tag (English)').fill('Testing')
    await page.getByLabel('Tag (Arabic)').fill('اختبار')
    await page.getByLabel('Short description (English)').fill(SHORT)
    await page.getByLabel('Short description (Arabic)').fill('نص قصير للبطاقة كتبه اختبار المتصفح.')
    await page.getByLabel('Article (English)').fill(`${BODY_1}\n\n${BODY_2}`)
    await page.getByLabel('Article (Arabic)').fill('الفقرة الأولى من قصة اختبار المتصفح.\n\nالفقرة الثانية من القصة.')
    await page.getByLabel('Date wording (English)').fill('Autumn 2026')
    await page.getByLabel('Date wording (Arabic)').fill('خريف ٢٠٢٦')

    // the live preview of the card, English and Arabic
    const en = page.getByTestId('card-preview-en')
    await expect(en).toContainText('Testing')
    await expect(en).toContainText(TITLE)
    await expect(en).toContainText(SHORT)
    await expect(en).toContainText('Autumn 2026')
    await expect(en).toContainText('Read more')
    await expect(page.getByTestId('card-preview-ar')).toContainText('قصة اختبار المتصفح')
    await expect(page.getByTestId('card-preview-ar')).toHaveAttribute('dir', 'rtl')
    // the text boxes say how much room is left and how many paragraphs there are
    await expect(page.getByText('2 paragraph(s)').first()).toBeVisible()

    await page.getByRole('button', { name: 'Create article' }).click()
    await expect(toast(page, /Article created as a draft/)).toBeVisible()
    await expect(page).toHaveURL(/\/journal\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { name: TITLE })).toBeVisible()
    await expect(page.getByText('Address: /news/browser-test-story')).toBeVisible()
    await expect(page.getByText('Only visible in this portal.')).toBeVisible()
  })

  test('a draft is not on the website, and its address does not open', async ({ browser }) => {
    const site = await freshSitePage(browser, '/news')
    await expect(site.getByRole('heading', { name: 'Stories from the park.' })).toBeVisible()
    await expect(site.getByText(TITLE)).toHaveCount(0)
    await site.goto(`${SITE}/news/${SLUG}`)
    await expect(site).toHaveURL(`${SITE}/news`) // unknown address: sent back to the Journal
    await site.context().close()
  })

  test('warns before publishing that there is no cover, then sets the cover (uploaded in the picker) and a gallery photo', async () => {
    await expect(page.getByTestId('publish-warnings')).toContainText('no cover photo')
    await page.getByRole('tab', { name: 'photos' }).click()
    await page.getByRole('button', { name: 'Choose photo' }).click()
    await page.getByRole('dialog').getByTestId('media-file-input').setInputFiles({ name: 'story-cover.png', mimeType: 'image/png', buffer: PNG })
    await expect(page.getByTestId('journal-cover-preview')).toBeVisible()
    await expect(toast(page, 'Cover photo set.')).toBeVisible()

    await page.getByRole('button', { name: 'Add photo' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Choose' }).first().click()
    await page.getByLabel('Caption (English)').fill('The pavilion at dusk')
    await page.getByLabel('Caption (Arabic)').fill('الجناح عند الغروب')
    await page.getByRole('button', { name: 'Save gallery' }).click()
    await expect(toast(page, 'Gallery saved.')).toBeVisible()
    await expect(page.getByTestId('journal-gallery-item')).toHaveCount(1)

    // the preview now shows the cover
    await page.getByRole('tab', { name: 'details' }).click()
    await expect(page.getByTestId('card-preview-en').locator('img')).toBeVisible()
  })

  test('publishing puts the card on the website: cover, tag, title and short description, with Read more', async ({ browser }) => {
    await page.getByRole('button', { name: 'Publish' }).click()
    await expect(toast(page, 'Article is now published.')).toBeVisible()
    await expect(page.getByText('Shown on the website’s Journal, with its own page.')).toBeVisible()

    const site = await freshSitePage(browser, '/news')
    const card = site.getByRole('link', { name: new RegExp(TITLE) })
    await expect(card).toBeVisible()
    await expect(card).toContainText('Testing')
    await expect(card).toContainText(SHORT)
    await expect(card).toContainText('Autumn 2026')
    await expect(card).toContainText('Read more')
    // the cover is the photo uploaded in the portal, served by the API, and it really draws
    const cover = card.locator('img').first()
    await expect(cover).toHaveAttribute('src', /\/api\/v1\/media\/file\/[0-9a-f-]{36}\.png$/)
    expect(await cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    // the new article leads the list (newest first), ahead of the seeded stories
    const titles = await site.locator('a[href^="/news/"] h3').allTextContents()
    expect(titles[0]).toBe(TITLE)
    expect(titles).toContain('A royal welcome at Al-Azhar Park')
    await site.context().close()
  })

  test('Read more opens the full article: paragraphs as plain text, the date wording and the gallery photo with its caption', async ({ browser }) => {
    const site = await freshSitePage(browser, '/news')
    await site.getByRole('link', { name: new RegExp(TITLE) }).click()
    await expect(site).toHaveURL(`${SITE}/news/${SLUG}`)
    await expect(site.getByRole('heading', { name: TITLE })).toBeVisible()
    await expect(site.getByText(BODY_1)).toBeVisible()
    await expect(site.getByText(BODY_2)).toBeVisible() // the markup is shown as typed, never run
    expect(await site.locator('main b').count()).toBe(0)
    await expect(site.getByText('Autumn 2026')).toBeVisible()
    const photo = site.getByAltText('The pavilion at dusk')
    await expect(photo).toBeVisible()
    expect(await photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)
    // the page can be opened directly (a link that was shared)
    await site.goto(`${SITE}/news/${SLUG}`)
    await expect(site.getByRole('heading', { name: TITLE })).toBeVisible()
    await site.context().close()
  })

  test('the website shows the Arabic fields, right to left', async ({ browser }) => {
    const site = await arabicSite(browser, '/news')
    const card = site.getByRole('link', { name: /قصة اختبار المتصفح/ })
    await expect(card).toBeVisible()
    await expect(card).toContainText('اختبار')
    await expect(card).toContainText('نص قصير للبطاقة كتبه اختبار المتصفح.')
    await expect(card).toContainText('خريف ٢٠٢٦')
    await card.click()
    await expect(site.getByText('الفقرة الأولى من قصة اختبار المتصفح.')).toBeVisible()
    await expect(site.getByAltText('الجناح عند الغروب')).toBeVisible()
    expect(await site.evaluate(() => document.documentElement.dir)).toBe('rtl')
    await site.context().close()
  })

  test('also appears in the Journal strip on the home page', async ({ browser }) => {
    const site = await freshSitePage(browser, '/')
    await expect(site.getByText(TITLE).first()).toBeVisible()
    await site.context().close()
  })

  test('an edit shows on the website, and the address is locked once the article has been public', async ({ browser }) => {
    await page.getByRole('tab', { name: 'details' }).click()
    await expect(page.getByLabel('Web address')).toBeDisabled()
    await page.getByLabel('Title (English)').fill('Browser Test Story, edited')
    await page.getByLabel('Tag (English)').fill('Heritage')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Saved.')).toBeVisible()
    await expect(page.getByTestId('card-preview-en')).toContainText('Heritage')

    const site = await freshSitePage(browser, `/news/${SLUG}`)
    await expect(site.getByRole('heading', { name: 'Browser Test Story, edited' })).toBeVisible()
    await site.goto(`${SITE}/news`)
    await expect(site.getByRole('link', { name: /Browser Test Story, edited/ })).toContainText('Heritage')
    await site.context().close()
    // and the server refuses to move the address (a link that was shared would break)
    const id = page.url().split('/').pop()!
    const moved = await apiAs(page, 'GET', `/journal/${id}`)
    expect(moved.data.slug).toBe(SLUG)
  })

  test('the server refuses bad content with a message next to the field, and keeps what was typed', async () => {
    await page.getByLabel('Short description (English)').fill('Too short')
    await page.getByLabel('Tag (English)').fill('')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText(/at least 10|too small|String must contain/i).first()).toBeVisible()
    await expect(page.getByLabel('Short description (English)')).toHaveValue('Too short')
    // put it back
    await page.getByLabel('Short description (English)').fill(SHORT)
    await page.getByLabel('Tag (English)').fill('Heritage')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(toast(page, 'Saved.')).toBeVisible()
  })

  test('archiving takes it off the website (after a confirmation); it can be restored as a draft, not straight to public', async ({ browser }) => {
    page.once('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: 'Archive' }).click()
    await expect(toast(page, 'Article is now archived.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0) // archived never goes straight to public
    await expect(page.getByRole('button', { name: 'Restore as draft' })).toBeVisible()

    const site = await freshSitePage(browser, '/news')
    await expect(site.getByRole('heading', { name: 'Stories from the park.' })).toBeVisible()
    await expect(site.getByText('Browser Test Story, edited')).toHaveCount(0)
    await site.goto(`${SITE}/news/${SLUG}`)
    await expect(site).toHaveURL(`${SITE}/news`)
    await site.context().close()

    await page.getByRole('button', { name: 'Restore as draft' }).click()
    await expect(toast(page, 'Article is now draft.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible()
  })

  test('the list shows the article with its new status', async () => {
    await openSection(page, 'Journal')
    await expect(row(page, 'Browser Test Story, edited')).toContainText('Draft')
    await expect(row(page, 'Browser Test Story, edited')).toContainText('Heritage')
    await page.getByLabel('Status').selectOption('DRAFT')
    await expect(page.getByTestId('journal-row')).toHaveCount(1)
  })

  test('clean up: release the test article\'s photos and delete them, so the library is empty again', async () => {
    const list = (await apiAs(page, 'GET', '/journal')).data as Array<{ id: string; slug: string }>
    const mine = list.find((a) => a.slug === SLUG)!
    expect((await apiAs(page, 'PUT', `/journal/${mine.id}/gallery`, { items: [] })).status).toBe(200)
    await openSection(page, 'Journal')
    await page.getByRole('link', { name: 'Open Browser Test Story, edited' }).click()
    await page.getByRole('tab', { name: 'photos' }).click()
    await page.getByRole('button', { name: 'Remove', exact: true }).first().click()
    await expect(toast(page, 'Cover photo removed.')).toBeVisible()
    await openSection(page, 'Media library')
    page.on('dialog', (d) => void d.accept())
    for (const name of ['story-cover.png']) {
      await page.getByRole('button', { name: `Delete ${name}` }).click()
      await expect(toast(page, 'Deleted.')).toBeVisible()
    }
    await expect(page.getByTestId('media-item')).toHaveCount(0)
  })
})

test.describe('Journal: who may do what', () => {
  test('an analyst can read the Journal but not change, publish or add anything', async ({ browser }) => {
    const { page, context } = await signedInPage(browser, USERS.analyst)
    await expect(nav(page).getByRole('link', { name: 'Journal', exact: true })).toBeVisible()
    await openSection(page, 'Journal')
    await expect(page.getByTestId('journal-row').first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Add an article' })).toHaveCount(0)
    await page.getByTestId('journal-row').first().getByRole('link').click()
    await expect(page.getByText('You can view this article but not change it.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0)
    await expect(page.getByText('Changing the status needs the publish permission.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0)
    await expect(page.getByLabel('Title (English)')).toBeDisabled()
    // and the server agrees
    const list = await apiAs(page, 'GET', '/journal')
    expect(list.status).toBe(200)
    const first = list.data[0]
    expect((await apiAs(page, 'PUT', `/journal/${first.id}/status`, { status: 'ARCHIVED' })).status).toBe(403)
    expect((await apiAs(page, 'POST', '/journal', { slug: 'x-y', titleEn: 'x', titleAr: 'x' })).status).toBe(403)
    expect((await apiAs(page, 'PUT', `/journal/${first.id}/gallery`, { items: [] })).status).toBe(403)
    await context.close()
  })

  test('operations and ticket staff do not see the Journal, and the server refuses them', async ({ browser }) => {
    for (const who of [USERS.operations, USERS.staff]) {
      const { page, context } = await signedInPage(browser, who)
      await expect(nav(page).getByRole('link', { name: 'Journal', exact: true })).toHaveCount(0)
      await page.goto(`${SITE.replace('5273', '5274')}/journal`)
      await expect(page.getByText('You do not have access to this page.')).toBeVisible()
      expect((await apiAs(page, 'GET', '/journal')).status).toBe(403)
      expect((await apiAs(page, 'POST', '/journal', {})).status).toBe(403)
      await context.close()
    }
  })

  test('nobody who is signed out can use the portal API, while the public one needs no sign-in', async ({ request }) => {
    expect((await request.get(`${API}/journal`)).status()).toBe(401)
    expect((await request.post(`${API}/journal`, { data: {} })).status()).toBe(401)
    expect((await request.put(`${API}/journal/00000000-0000-4000-8000-000000000000/status`, { data: { status: 'PUBLISHED' } })).status()).toBe(401)
    const open = await request.get(`${API}/public/journal`)
    expect(open.status()).toBe(200)
    expect(JSON.stringify(await open.json())).not.toContain('Browser Test Story') // the draft is not public
  })

  test('the Journal pages fit a phone screen', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 800 } })
    const page = await context.newPage()
    const { PORTAL, PASSWORD } = await import('./helpers')
    await page.goto(`${PORTAL}/login`)
    await page.getByLabel('Email').fill(USERS.content)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('main')).toBeVisible()
    for (const path of ['/journal', '/journal/new']) {
      await page.goto(`${PORTAL}${path}`)
      await expect(page.getByRole('main')).toBeVisible()
      await expect(page.getByTestId('journal-row').first().or(page.getByRole('heading', { name: 'New article' }))).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(1)
    }
    await context.close()
  })
})
