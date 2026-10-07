# Browser (end-to-end) tests

Real Google Chrome driving the real stack: **API + staff portal + public website**, against the **test database** (never your development data).

| What it covers | File |
|---|---|
| Login (wrong password, unknown account), session restoration after reload, permission-based menus, direct-URL access, the server refusing what the UI hides, logout | `tests/auth.spec.ts` |
| Editing park information and contact details, opening hours, adding / editing / deleting special hours, rejecting overlapping periods, **the public website reflecting each change**, the website keeping its own marketing copy | `tests/cms.spec.ts` |
| Media library (upload photo / PDF, refused script-as-image), creating a restaurant that closes after midnight, main photo, gallery, link and PDF menus, the website showing them with working uploaded files, reorder, hide, edit a built-in restaurant, in-use files protected | `tests/restaurants.spec.ts` |
| Events: create an event that runs past midnight, coming soon → photos → published → edited → cancelled → restored/archived with the public website checked at each step, Arabic/RTL, reordering, the empty state, the API-unavailable fallback, venues, and who may do what | `tests/events.spec.ts` |
| Ticket purchasing: live prices on the Visit page, the builder pricing weekday / weekend / non-resident visits from the server, no under-2 ticket, rejected dates (past, 91 days, closed day), checkout validation, buying → payment countdown → (development) payment → tickets, retry after a failed payment, one order per double click, tampering refused, the order in the portal (search, filter, detail, cancel with a reason, not a refund), who may see orders / types / prices, ticket types, adding a future price while an earlier order keeps the price it paid, Arabic/RTL digits, booking switched off when the API is unreachable | `tests/tickets.spec.ts` |
| Staff accounts: list, search, filter by role and status, invite, duplicate e-mail, role assignment, privilege limits, send reset, deactivate / activate (sign-in blocked and live sessions ended), self-protection; role creation and live permission changes | `tests/users.spec.ts` |

## Run it

Prerequisites: Google Chrome installed; `backend/.env` with `DATABASE_URL` / `TEST_DATABASE_URL` (see [../docs/postgres-setup.md](../docs/postgres-setup.md)); `npm install` done in `backend/`, `portal/`, the repository root and here.

```bash
cd e2e
npm install
npm test            # prepares the stack, then runs the browser tests (about 1–2 minutes)
npm run test:headed # watch the browser
npm run report      # open the HTML report of the last run (screenshots/traces of failures)
```

`npm test` first (`scripts/prepare.mjs`) builds the API, applies the migrations to the **test** database and resets + seeds it (`backend/scripts/reset-e2e-db.ts` refuses any database whose name does not contain "test"). Playwright then starts, on private ports, the API (3100), the portal (5274) and the website (5273, pointed at that API) and stops them afterwards. The seeded users all have the password `E2e-Password-2026!` (override with `E2E_PASSWORD`).

Notes
- Another Chrome build: `CHROME_PATH="C:\path\to\chrome.exe" npm test`.
- The API runs with `AUTH_RATE_LIMIT_MULTIPLIER=50` so the many sign-ins of the suite are not throttled. The setting is refused in production.
- The specs run one after another and share state; each cleans up what it changes on the public website. Every `npm test` starts from a freshly reset database, so runs are repeatable.
- Ports 3100, 5273 and 5274 must be free.
