# Security review and hardening (Phase 11)

Phase 11 reviewed the whole system for security weaknesses and fixed the confirmed ones with the smallest changes that preserve the established architecture and business rules. It was a code and configuration review plus automated tests on local infrastructure with synthetic data. **It was not a penetration test**, nothing was tested against a deployed system, and nothing here is a claim that the application is completely secure or compliant with any standard.

## Method and scope

Read in full: the HTTP bootstrap, global guards and pipes, the environment schema, authentication (login, sessions, refresh rotation, cookies, password handling, reset), RBAC (guards, decorators, user and role management, privilege rules), ticket purchasing (pricing, orders, idempotency, access tokens), payments, QR signing and verification, the gate scanner, media upload and serving, the audit service, logging, the exception filter and the analytics and export code (reviewed in Phase 10). Skimmed or sampled: events, park, restaurants, ticket delivery and PDFs, the website booking pages and the portal API client, the Docker files and migration triggers. Dependency advisories were checked with `npm audit` against the npm advisory database (lockfiles only; container images and operating-system packages were not scanned).

Not inspected: any running deployment, reverse-proxy or hosting headers, backups, infrastructure for Phases 12 and 13.

## Confirmed findings and fixes

No Critical or High vulnerability was confirmed. Seven Low-to-Medium findings were fixed; one more (the PDF name-escape bypass) was a "potential" issue that a test confirmed and that was then fixed.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| S-01 | Medium | `NODE_ENV` defaulted to `development`. A server started without it would use the mock payment provider (the public route `POST /public/payments/mock/:txnId/complete` could mark any order paid) and the development secrets that are public in the repository. Only reachable through a deployment mistake. | `NODE_ENV` is **required** (no default). A missing or invalid value stops start-up with a clear message that never echoes the value. |
| S-02 | Low | Production accepted placeholder, development, repeated-pattern, low-entropy and shared secrets (only the length was checked). | In production each of `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TICKET_TOKEN_PEPPER` and every `TICKET_QR_KEYS` secret must pass `secretProblem()` (`src/config/secret-quality.ts`): no development values, no placeholder words (change-me, example, password, secret …), at least 10 distinct characters, not a repeated pattern, at least 3 bits of entropy per character. The two JWT secrets must differ from each other and from the ticket pepper and QR keys; a QR key may equal the pepper (the pepper is key 1 by default) but two QR keys may not be equal. Secrets made as `.env.example` recommends (48 random bytes, base64url) pass with a wide margin. |
| S-03 | Low | Swagger/OpenAPI was on by default in production. | `SWAGGER_ENABLED` unset means on in development and test and **off in production**; production must opt in explicitly. |
| S-04 | Low | The request log wrote the full URL including the query, so staff searches (`/orders?search=mona@example.com`) put customer e-mail addresses and phone numbers in the logs. | Only the path is logged (`pathOnly()`); method, path, status and request id remain. |
| S-05 | Low | An `Idempotency-Key` could be 8 characters, and a replay returns a fresh order access token to whoever presents the key with matching details. | A **new** order needs a key of 16 to 100 characters (the website sends a random UUID). An order that already exists under an older 8 to 15 character key can still be replayed (nothing that worked is lost), but a short key never creates an order. Same payload returns the same order; a different payload is still `409 IDEMPOTENCY_KEY_REUSED`; simultaneous requests still create exactly one order. |
| S-06 | Low | Uploads were buffered in memory up to a fixed 101 MB whatever `MEDIA_MAX_IMAGE_MB` / `MEDIA_MAX_PDF_MB` said. | The limits come from the configuration and are applied **while the file arrives**: once the first bytes show the kind (image or PDF) the upload is stopped the moment it passes that kind's limit; a file of unknown kind is held to the smaller limit; a request that already declares more than the larger limit plus the multipart envelope is refused before any of it is collected (its body is read and discarded, for at most 10 seconds, so the sender receives the `413`). The type and size are still checked again by `MediaService`. |
| S-07 | Low | `TRUNCATE` is not stopped by the row triggers that make `audit_logs` and `ticket_scans` append-only, nor by the delete and update guards on `orders`, `order_items`, `payments`, `tickets` and `ticket_prices`, so a whole history could be erased in one statement by anyone with table privileges. The application has no such code path. | Two migrations add statement-level `BEFORE TRUNCATE` triggers: `20261011090000_phase11_truncate_guard` (`audit_logs`, `ticket_scans`) and `20261011100000_phase11_history_truncate_guard` (the five financial history tables). See "Migrations" below. |
| (PDF) | Low | The uploaded-PDF check for active content (`/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/RichMedia`) was a plain substring search, so name escapes such as `/J#61vaScript` (which every PDF reader resolves to `/JavaScript`) were not seen. A test confirmed it. | `pdfRiskyFeature()` also searches the file with `#xx` escapes resolved. |

## Migrations (S-07)

### 1. `20261011090000_phase11_truncate_guard` (audit trail and scan history)

- `backend/prisma/migrations/20261011090000_phase11_truncate_guard/migration.sql`: two `CREATE TRIGGER … BEFORE TRUNCATE … FOR EACH STATEMENT EXECUTE FUNCTION azharpark_reject_mutation()` statements (the function that already guards UPDATE and DELETE; its message now reads, for example, `TRUNCATE on "audit_logs" is not allowed: this table is append-only`).
- No data is read, changed or removed; INSERT is unaffected. The triggers also fire when a table is emptied indirectly by `TRUNCATE … CASCADE` on a table it references (for example `users`), so those statements are refused too.
- **Rollback:** `DROP TRIGGER trg_audit_logs_no_truncate ON audit_logs; DROP TRIGGER trg_ticket_scans_no_truncate ON ticket_scans;` Nothing depends on them and no data is affected. Prisma migrations are forward-only, so a rollback is a new migration with those two statements (or run by hand on a database that is then marked with `prisma migrate resolve`).
- Like the existing triggers this guards against mistakes and application bugs, **not against the table owner**, who can still disable a trigger on purpose.
### 2. `20261011100000_phase11_history_truncate_guard` (orders, order_items, payments, tickets, ticket_prices)

Each of these tables already refuses DELETE (`trg_*_no_delete`: "order, payment and ticket history must be kept"; for prices "price rows are history") and is immutable or lifecycle-guarded on UPDATE, so a bulk delete is already outside the rules and a TRUNCATE guard is consistent with all five; no table has semantics that conflict with it. The migration adds `azharpark_reject_truncate()` (message: `Truncating "orders" is not allowed: order, payment, ticket and price history must be kept`) and one statement-level `BEFORE TRUNCATE` trigger per table. No business rule changes, no data is read, changed or removed, INSERT and the lifecycle UPDATEs are unaffected, and `TRUNCATE … CASCADE` from a referenced table (`customers`, `users`, `ticket_types`, `gates` …) is refused as a whole. A plain `TRUNCATE` of a table that other tables reference is refused earlier by PostgreSQL's own foreign-key check.

- **Rollback** (no data is affected; nothing else uses these):
  `DROP TRIGGER trg_orders_no_truncate ON orders; DROP TRIGGER trg_order_items_no_truncate ON order_items; DROP TRIGGER trg_payments_no_truncate ON payments; DROP TRIGGER trg_tickets_no_truncate ON tickets; DROP TRIGGER trg_ticket_prices_no_truncate ON ticket_prices; DROP FUNCTION azharpark_reject_truncate();` As with every Prisma migration this is forward-only: a rollback is a new migration with those statements.
- Deliberately not guarded: tables that are not history (customers, whose personal fields are meant to be anonymised; reference data; tokens and sessions) and `reference_counters` (emptying it would only make new order numbers collide with the unique constraint, which fails the order instead of duplicating one).

### Test and reset scripts (both migrations)

The automated tests and `scripts/reset-e2e-db.ts` empty every table between runs with `TRUNCATE`. They find every trigger named `*_no_truncate` in the catalogue, disable them, truncate and enable them again inside one transaction (`test/helpers/db.ts`, `scripts/reset-e2e-db.ts`), so a guard is never left off, even if the reset fails half way (tested), and a guard added later is handled without editing the helpers.

## Tests added (regression and hardening)

| Area | Test files |
|---|---|
| `NODE_ENV` required, invalid values, production never falls back to mock payments, Swagger default, secret quality, secret reuse | `src/config/env.hardening.spec.ts`, `src/config/secret-quality.spec.ts` (fixtures in `env.schema.spec.ts` and `app-config.service.spec.ts` were updated to set `NODE_ENV` and use real-looking secrets; no assertion was weakened) |
| Query strings never logged; headers and bodies never logged; health probes quiet; redaction paths actually redact | `src/common/logging/logger.config.spec.ts` (runs a real HTTP request through the real logging configuration) |
| Idempotency key length boundaries (15 / 16 / 100 / 101), allowed characters, legacy short-key replay, same key twice or three times at once, access key after replay | `test/e2e/ticketing.e2e-spec.ts` (two existing keys of 14 and 15 characters were lengthened to valid ones), `src/lib/booking.test.ts` (the website's keys, with and without `crypto.randomUUID`) |
| Upload limits (configured boundary, one byte over, per type, unknown type, early refusal, wrong field, permissions) | `src/modules/media/upload-limits.spec.ts`, `test/e2e/media-limits.e2e-spec.ts` |
| PDF name escapes | `src/modules/media/media-sniff.spec.ts`, `test/e2e/media.e2e-spec.ts` |
| Append-only tables (`audit_logs`, `ticket_scans`): INSERT works; UPDATE, DELETE, TRUNCATE, `TRUNCATE … CASCADE`, multi-table TRUNCATE refused; triggers present and enabled; test reset restores them | `test/db/append-only.db-spec.ts` |
| Financial history tables (`orders`, `order_items`, `payments`, `tickets`, `ticket_prices`): INSERT and lifecycle UPDATE still work; DELETE and illegal UPDATE still refused with the same messages; every form of TRUNCATE refused; each table's own guard proven to fire (the others switched off inside a rolled-back transaction); `CASCADE` from referenced tables and multi-table statements refused; reset empties everything and leaves all seven guards enabled | `test/db/history-truncate.db-spec.ts` |
| Browser tests wait for a reliable signed-in signal | `e2e/tests/helpers.ts` (`expectSignedIn`, `isSignedIn`), see "Browser test helper" below |

## Browser test helper

The Chrome tests decided that a sign-in had succeeded by waiting for a heading starting with "Welcome". The restyled login page has the heading "Welcome back", so those waits returned while the page was still the login page, before the sign-in had finished (observed: 5 failures and 15 tests not run, all caused by a missing refresh cookie at that moment, not by the API). The tests now use `expectSignedIn(page)`: the app has left `/login` (it only does so once the session exists) and shows a protected page, which has the `<main>` landmark the login page lacks; `isSignedIn(page)` is the yes/no form for sign-ins that are expected to fail. The dashboard's own heading is matched as `/^Welcome,/`. The login design was not touched.

## What the review found sound

Verified by reading the code and by the existing tests (not re-proved here): fail-closed global guards (throttle, then authentication, then permissions; a route with no annotation is refused); access tokens pinned to HS256 with issuer, audience and claim checks and a live session check on every request; rotating single-use refresh tokens with reuse detection and an absolute session lifetime; `httpOnly`, `SameSite=Strict`, `__Secure-` prefixed refresh cookie scoped to the auth routes plus an `Origin` check; argon2id passwords, equalised work for unknown or locked accounts; privilege-escalation rules for users and roles; server-side pricing with no client amounts; payment confirmation that re-checks order, amount, currency and state and is idempotent; atomic one-statement ticket consumption with the Cairo visit-date check; HMAC QR codes with constant-time comparison and canonical encoding; magic-byte upload validation, random storage names, traversal guard, sandboxing headers on served files; `https:`-only stored links; no raw SQL with user input, no redirects, no outbound requests, no `innerHTML`-style sinks in the website or portal.

## Remaining risks and limits (not fixed, or only partly)

- **Only the seven history tables are TRUNCATE-guarded.** Other tables can still be emptied by someone with table privileges; for the ones that are not history that is intended (see Migrations).
- **The table owner can switch any of these triggers off.** The application should not connect as the owner of the tables in production (a deployment task).
- **The PDF check is best effort.** It looks at the file as written; active content hidden inside a compressed object stream is invisible to it. Making it robust means inflating PDF streams and parsing the file, a substantial change that was not made. Uploaded files are always served with `nosniff` and a sandboxing Content-Security-Policy, and only users with `media:write` can upload.
- **Dependency advisories were reported, not upgraded** (upgrades were out of scope): `deepmerge-ts` (high, stack exhaustion when merging recursive objects) reached through the Prisma CLI's configuration loader, not reachable from network input; `js-yaml` (moderate, CPU use on YAML merge keys) reached through `@nestjs/swagger`, and no untrusted YAML is parsed; development-only tools (`handlebars` via ts-jest, `vitest`/`tinypool`, `braces`) are not shipped. Production dependencies of the website and portal have no advisories. Re-run `npm audit` before each release.
- **Rate limiting is in memory per process.** With more than one API instance each has its own counters. Behind a reverse proxy `TRUST_PROXY` must be set to the number of proxies, otherwise every client shares the proxy's address.
- **Account lockout** (5 wrong passwords, 15 minutes) lets anyone lock a known account for a while; this is the usual trade-off against guessing.
- **Possible response-time differences** (an existing account's password-reset request does extra work) were not measured; the response text is identical and the route is limited to 5 requests a minute per address.
- **Some audit entries are written just after the change commits**, not in the same transaction (user and role changes, order creation). Payment confirmation, scans and ticket cancellation are audited inside their transactions.
- **No audit-log read endpoint exists**; the trail is read from the database.
- **Personal data in operational tables** (IP address and user agent in refresh-token, scan and audit rows; the e-mail typed at a failed sign-in) is kept indefinitely and expired tokens are never purged. Retention periods are a policy decision, see [privacy-and-data-handling.md](privacy-and-data-handling.md).
- **Idempotency replay returns a new access key.** With the 16 character minimum the key is no longer guessable by design, but anyone who knows the key and the exact order details can obtain one. Replays of orders created under an older short key stay possible while those orders exist.
- **The development Docker stack** (`docker/docker-compose.yml`) publishes PostgreSQL and an unauthenticated, unused Redis on all host interfaces and sets `SWAGGER_ENABLED` to true explicitly (an explicit opt-in is honoured in production too); the backend `Dockerfile` uses `node:22` while the project is pinned to Node 20.17. It is a development convenience, to be revisited in the deployment phases.
- **Website and portal hosting headers** (CSP, HSTS, `Referrer-Policy`, `X-Frame-Options`) are set by whatever serves those static sites, which does not exist yet; the API sets its own with Helmet.

## Configuration assumptions

- `NODE_ENV` is set explicitly everywhere the API runs (`backend/.env`, the Dockerfile and compose file, the browser-test configuration, and Jest do already).
- A copied `.env` that sets `SWAGGER_ENABLED=true` turns Swagger on in production too (found while testing a real production boot: `backend/.env` sets it for development). `.env.example` now leaves the line commented out.
- A production start-up refuses: missing or weak secrets, shared secrets, the mock payment provider, the log e-mail provider, SMTP without its settings, non-HTTPS or empty CORS origins, a rate-limit multiplier above 1, and the placeholder database password. Swagger is off unless `SWAGGER_ENABLED=true`.

## Required production follow-up (outside Phase 11)

Generate the three secrets (and QR keys) with the command in `.env.example` and keep them in the host's secret store; set `NODE_ENV=production`, HTTPS-only `CORS_ORIGINS`, `PUBLIC_SITE_URL`, `TRUST_PROXY`, a real `PAYMENT_PROVIDER` and SMTP; run the API as a database role that does not own the tables; terminate TLS and add HSTS and a Content-Security-Policy for the website and portal; use a shared store for rate limits if more than one instance runs; ship logs without query strings (the application no longer writes them) and restrict who can read them; encrypted, access-controlled database backups; decide the retention periods; run dependency, container and operating-system scans; and have the deployed system penetration-tested.

## Not verified

Behaviour in any deployed environment; the proxy and TLS set-up; the hosting platform's headers; container images and operating-system packages; load and denial-of-service resistance; the real payment provider and webhook (not built); real e-mail delivery; compliance with any specific standard or regulation.
