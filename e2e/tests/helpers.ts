import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

export const PORTAL = 'http://localhost:5274'
export const SITE = 'http://localhost:5273'
export const API = 'http://localhost:3100/api/v1'
/** the password scripts/reset-e2e-db.ts gives every seeded user */
export const PASSWORD = process.env.E2E_PASSWORD ?? 'E2e-Password-2026!'

export const USERS = {
  superAdmin: 'superadmin@azharpark.test',
  admin: 'admin@azharpark.test',
  operations: 'operations@azharpark.test',
  staff: 'staff@azharpark.test',
  content: 'content@azharpark.test',
  analyst: 'analyst@azharpark.test',
} as const

export const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' })

/**
 * The reliable "signed in" signal: the app has left /login (it only does so once the session exists) and shows a protected page,
 * which has the <main> landmark the login page lacks. A heading is NOT reliable: the login page itself says "Welcome back", so
 * waiting for /^Welcome/ returned while still on the login page, before sign-in had finished.
 */
export async function expectSignedIn(page: Page, timeout = 10_000): Promise<void> {
  await expect(page).not.toHaveURL(/\/login/, { timeout })
  await expect(page.getByRole('main')).toBeVisible({ timeout })
}

/** The same signal as a yes/no, for a sign-in that is expected to fail (a deactivated account stays on the login page). */
export const isSignedIn = (page: Page, timeout = 6000): Promise<boolean> => expectSignedIn(page, timeout).then(() => true, () => false)

/** Signs in through the real login form. */
export async function signIn(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto(`${PORTAL}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

export async function signedInPage(browser: Browser, email: string): Promise<{ page: Page; context: BrowserContext }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, email)
  await expectSignedIn(page)
  return { page, context }
}

export async function openSection(page: Page, name: string): Promise<void> {
  await nav(page).getByRole('link', { name, exact: true }).click()
}

/** Toast messages appear in a live region at the bottom of the screen. */
export const toast = (page: Page, text: string | RegExp) => page.getByText(text).first()

/** A fresh browser context, so the website's own HTTP cache never hides a change that was just saved. */
export async function freshSitePage(browser: Browser, path = '/'): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto(`${SITE}${path}`)
  return page
}
