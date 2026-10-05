import { expect, test } from '@playwright/test'
import { API, PORTAL, PASSWORD, USERS, nav, signIn, signedInPage } from './helpers'

test.describe('login, session and navigation', () => {
  test('a wrong password is refused with a clear message and stays on the login page', async ({ page }) => {
    await signIn(page, USERS.content, 'not-the-password-1')
    await expect(page.getByRole('alert')).toContainText(/incorrect/i)
    await expect(page).toHaveURL(/\/login$/)
  })

  test('anyone not signed in is sent to the login page', async ({ page }) => {
    await page.goto(`${PORTAL}/park`)
    await expect(page).toHaveURL(/\/login$/)
  })

  test('signing in shows the welcome page and only the sections the role may use', async ({ browser }) => {
    const { page, context } = await signedInPage(browser, USERS.content)
    await expect(page.getByRole('heading', { name: 'Welcome, Dev' })).toBeVisible()
    for (const name of ['Park information', 'Contact details', 'Opening hours']) await expect(nav(page).getByRole('link', { name, exact: true })).toBeVisible()
    await expect(nav(page).getByRole('link', { name: 'Staff accounts' })).toHaveCount(0)
    await expect(nav(page).getByRole('link', { name: 'Roles & permissions' })).toHaveCount(0)
    await context.close()
  })

  test('the session survives a page reload (restored from the refresh cookie, nothing stored in the page)', async ({ browser }) => {
    const { page, context } = await signedInPage(browser, USERS.content)
    await page.reload()
    await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible()
    await expect(page).not.toHaveURL(/login/)
    // the access token is never written to browser storage
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))
    expect(stored).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/)
    await context.close()
  })

  test('each role sees its own menu: super administrator everything, analyst only what it may read', async ({ browser }) => {
    const sup = await signedInPage(browser, USERS.superAdmin)
    for (const name of ['Park information', 'Contact details', 'Opening hours', 'Staff accounts', 'Roles & permissions']) {
      await expect(nav(sup.page).getByRole('link', { name, exact: true })).toBeVisible()
    }
    await sup.context.close()

    const analyst = await signedInPage(browser, USERS.analyst)
    await expect(nav(analyst.page).getByRole('link', { name: 'Park information', exact: true })).toBeVisible()
    for (const name of ['Contact details', 'Opening hours', 'Staff accounts', 'Roles & permissions']) {
      await expect(nav(analyst.page).getByRole('link', { name, exact: true })).toHaveCount(0)
    }
    await analyst.page.goto(`${PORTAL}/contact`)
    await expect(analyst.page.getByText('You do not have access to this page')).toBeVisible()
    await analyst.page.goto(`${PORTAL}/users`)
    await expect(analyst.page.getByText('You do not have access to this page')).toBeVisible()
    await analyst.context.close()
  })

  test('the server refuses what the menu hides: an analyst calling the API directly is rejected', async ({ browser }) => {
    const { page, context } = await signedInPage(browser, USERS.analyst)
    const result = await page.evaluate(
      async ({ api }) => {
        const refreshed = await fetch(`${api}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        const token = (await refreshed.json()).data.accessToken as string
        const call = async (method: string, path: string, body?: unknown) =>
          (await fetch(`${api}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).status
        return {
          readPark: await call('GET', '/park'),
          writePark: await call('PUT', '/park', { nameEn: 'Hacked', nameAr: 'x', stats: [] }),
          readUsers: await call('GET', '/users'),
          grantRole: await call('POST', '/users', { email: 'x@y.test', fullName: 'X Y', roleCodes: ['SUPER_ADMIN'] }),
        }
      },
      { api: API },
    )
    expect(result).toEqual({ readPark: 200, writePark: 403, readUsers: 403, grantRole: 403 })
    await context.close()
  })

  test('signing out ends the session for real: reload and protected pages go to the login page', async ({ browser }) => {
    const { page, context } = await signedInPage(browser, USERS.content)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.reload()
    await expect(page).toHaveURL(/\/login$/)
    await page.goto(`${PORTAL}/park`)
    await expect(page).toHaveURL(/\/login$/)
    await context.close()
  })

  test('an unknown account gets the same generic message as a wrong password (no account probing)', async ({ page }) => {
    await signIn(page, 'nobody@azharpark.test', PASSWORD)
    await expect(page.getByRole('alert')).toContainText(/incorrect/i)
  })
})
