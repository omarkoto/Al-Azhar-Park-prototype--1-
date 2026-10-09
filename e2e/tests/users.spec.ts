import { expect, test, type Browser, type Page } from '@playwright/test'
import { PASSWORD, PORTAL, USERS, isSignedIn, nav, openSection, signIn, signedInPage, toast } from './helpers'

const row = (page: Page, text: string) => page.getByTestId('user-row').filter({ has: page.getByText(text, { exact: true }) })

/** Tries to sign in as someone in a throwaway browser and says whether it worked. */
async function canSignIn(browser: Browser, email: string): Promise<boolean> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, email, PASSWORD)
  const ok = await isSignedIn(page)
  await context.close()
  return ok
}

test.describe.serial('staff accounts: invite, roles, activation', () => {
  let page: Page
  let close: () => Promise<void>
  const invited = { name: 'Nour Browser', email: `nour.browser.${Date.now()}@azharpark.test` }

  test.beforeAll(async ({ browser }) => {
    const s = await signedInPage(browser, USERS.admin)
    page = s.page
    close = () => s.context.close()
    await openSection(page, 'Staff accounts')
    await expect(page.getByTestId('user-row')).toHaveCount(6)
  })
  test.afterAll(async () => {
    await close()
  })

  test('lists everyone with role, status and last sign-in, and filters by search, role and status', async () => {
    await expect(row(page, USERS.analyst)).toContainText('Analyst')
    await expect(row(page, USERS.admin)).toContainText('(you)')
    await expect(row(page, USERS.content)).toContainText(/ago|Just now/) // signed in by the earlier specs

    await page.getByLabel('Search').fill('analyst@')
    await expect(page.getByTestId('user-row')).toHaveCount(1)
    await page.getByLabel('Search').fill('')
    await expect(page.getByTestId('user-row')).toHaveCount(6)

    await page.getByLabel('Role', { exact: true }).selectOption({ label: 'Ticket staff' })
    await expect(page.getByTestId('user-row')).toHaveCount(1)
    await expect(row(page, USERS.staff)).toBeVisible()
    await page.getByLabel('Role', { exact: true }).selectOption({ label: 'All roles' })

    await page.getByLabel('Status').selectOption('false')
    await expect(page.getByText('No one matches these filters.')).toBeVisible()
    await page.getByLabel('Status').selectOption('')
    await expect(page.getByTestId('user-row')).toHaveCount(6)
  })

  test('invites a new user with a role; a duplicate e-mail is refused', async () => {
    await page.getByRole('button', { name: 'Invite user' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Full name').fill(invited.name)
    await dialog.getByLabel('E-mail').fill(invited.email)
    await dialog.getByRole('checkbox', { name: /Ticket staff/ }).check()
    await dialog.getByRole('button', { name: 'Send invitation' }).click()
    await expect(toast(page, `Invitation sent to ${invited.email}.`)).toBeVisible()
    await expect(row(page, invited.email)).toContainText('Ticket staff')
    await expect(row(page, invited.email)).toContainText('Active')
    await expect(row(page, invited.email)).toContainText('Never')

    await page.getByRole('button', { name: 'Invite user' }).click()
    const again = page.getByRole('dialog')
    await again.getByLabel('Full name').fill('Someone Else')
    await again.getByLabel('E-mail').fill(invited.email)
    await again.getByRole('checkbox', { name: /Analyst/ }).check()
    await again.getByRole('button', { name: 'Send invitation' }).click()
    await expect(again.getByText(/already exists/)).toBeVisible()
    await again.getByRole('button', { name: 'Cancel' }).click()
  })

  test('an administrator cannot hand out a role more powerful than their own', async () => {
    await page.getByRole('button', { name: 'Invite user' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('checkbox', { name: /Super administrator/ })).toBeDisabled()
    await expect(dialog.getByText(/You cannot grant this role/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel' }).click()
  })

  test('opens an account to view details, edit the name and change roles', async () => {
    await row(page, invited.email).getByRole('button', { name: /Open/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(invited.email)).toBeVisible()
    await expect(dialog.getByText('Active', { exact: true })).toBeVisible()

    await dialog.getByLabel('Full name').fill('Nour Browser Edited')
    await dialog.getByRole('button', { name: 'Save name' }).click()
    await expect(toast(page, 'Name saved.')).toBeVisible()

    await dialog.getByRole('checkbox', { name: /Ticket staff/ }).uncheck()
    await dialog.getByRole('checkbox', { name: /Analyst/ }).check()
    await dialog.getByRole('button', { name: 'Save roles' }).click()
    await expect(toast(page, /Roles saved/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(row(page, invited.email)).toContainText('Nour Browser Edited')
    await expect(row(page, invited.email)).toContainText('Analyst')
    await expect(row(page, invited.email)).not.toContainText('Ticket staff')
  })

  test('sends a password reset link', async () => {
    await row(page, USERS.operations).getByRole('button', { name: /Open/ }).click()
    await page.getByRole('button', { name: 'Send password reset' }).click()
    await expect(toast(page, 'Password reset link sent.')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  })

  test('deactivating signs the person out and blocks sign-in; activating restores it', async ({ browser }) => {
    // staff holds a live session in another browser
    const staff = await signedInPage(browser, USERS.staff)
    expect(await canSignIn(browser, USERS.staff)).toBe(true)

    await row(page, USERS.staff).getByRole('button', { name: /Open/ }).click()
    page.once('dialog', (d) => void d.accept())
    await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click()
    await expect(toast(page, 'Account deactivated.')).toBeVisible()
    await expect(page.getByRole('dialog').getByText('Deactivated', { exact: true })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()

    await page.getByLabel('Status').selectOption('false')
    await expect(page.getByTestId('user-row')).toHaveCount(1)
    await expect(row(page, USERS.staff)).toContainText('Deactivated')

    expect(await canSignIn(browser, USERS.staff)).toBe(false)
    await staff.page.reload() // their existing session is gone as well
    await expect(staff.page).toHaveURL(/\/login$/)
    await staff.context.close()

    await row(page, USERS.staff).getByRole('button', { name: /Open/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Activate' }).click()
    await expect(toast(page, 'Account activated.')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
    await page.getByLabel('Status').selectOption('')
    expect(await canSignIn(browser, USERS.staff)).toBe(true)
  })

  test('you cannot change your own account, nor manage someone with more access than you', async () => {
    await row(page, USERS.admin).getByRole('button', { name: /Open/ }).click()
    const own = page.getByRole('dialog')
    await expect(own.getByText(/This is your own account/)).toBeVisible()
    await expect(own.getByRole('button', { name: 'Deactivate' })).toHaveCount(0)
    await own.getByRole('button', { name: 'Close' }).click()

    await row(page, USERS.superAdmin).getByRole('button', { name: /Open/ }).click()
    const boss = page.getByRole('dialog')
    await expect(boss.getByText(/more access than you/)).toBeVisible()
    await expect(boss.getByRole('button', { name: 'Deactivate' })).toHaveCount(0)
    await boss.getByRole('button', { name: 'Close' }).click()
  })
})

test.describe('roles and permissions', () => {
  test('a super administrator creates a role, gives it permissions from the server catalogue, and deletes it', async ({ browser }) => {
    const { page, context } = await signedInPage(browser, USERS.superAdmin)
    await openSection(page, 'Roles & permissions')
    await expect(page.getByRole('button', { name: /Ticket staff/ })).toBeVisible()

    await page.getByRole('button', { name: 'New role' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name', { exact: true }).fill('Browser test role')
    await dialog.getByLabel('Code').fill('browser_test_role')
    await dialog.getByRole('button', { name: 'Create role' }).click()
    await expect(toast(page, /Role created/)).toBeVisible()

    await page.getByLabel('Filter permissions').fill('park:')
    await page.getByRole('checkbox', { name: /park:read/ }).check()
    await page.getByRole('button', { name: 'Save permissions' }).click()
    await expect(toast(page, 'Permissions saved: 1 added, 0 removed.')).toBeVisible()

    page.once('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: 'Delete role' }).click()
    await expect(toast(page, 'Role deleted.')).toBeVisible()
    await context.close()
  })

  test('a role change applies to a signed-in person on their next click, without signing in again', async ({ browser }) => {
    const sup = await signedInPage(browser, USERS.superAdmin)
    const analyst = await signedInPage(browser, USERS.analyst)
    await expect(nav(analyst.page).getByRole('link', { name: 'Contact details', exact: true })).toHaveCount(0)

    await openSection(sup.page, 'Roles & permissions')
    await sup.page.getByRole('button', { name: /Analyst/ }).click()
    await sup.page.getByLabel('Filter permissions').fill('contact:read')
    await sup.page.getByRole('checkbox', { name: /contact:read/ }).check()
    await sup.page.getByRole('button', { name: 'Save permissions' }).click()
    await expect(toast(sup.page, /Permissions saved/)).toBeVisible()

    // the analyst's menu is built when the page loads: a reload re-reads permissions (no new login)
    await analyst.page.reload()
    await expect(nav(analyst.page).getByRole('link', { name: 'Contact details', exact: true })).toBeVisible()
    await analyst.page.goto(`${PORTAL}/contact`)
    await expect(analyst.page.getByLabel('Phone numbers')).toBeVisible()

    // put it back
    await sup.page.getByRole('checkbox', { name: /contact:read/ }).uncheck()
    await sup.page.getByRole('button', { name: 'Save permissions' }).click()
    await expect(toast(sup.page, /Permissions saved/)).toBeVisible()
    await sup.context.close()
    await analyst.context.close()
  })
})
