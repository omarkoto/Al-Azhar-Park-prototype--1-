# Architecture (as built — through Phase 3)

This document describes what exists today. The overall plan and rationale are in [`backend-proposal.md`](backend-proposal.md).

## Repository

```
/                 public website (Vite + React); reads live park data from the API when VITE_API_URL is set
backend/          NestJS API
portal/           staff portal (React + Vite), its own package.json
docker/           Compose (PostgreSQL, pgAdmin; Redis & MailHog behind profiles) — ready, not required
docs/             documentation
.github/workflows backend CI
```
**No npm workspaces:** `backend/`, `portal/` and the website each install on their own, so none can disturb the others' `node_modules`. Workspaces can be introduced if code is ever shared.

## Stack (versions chosen deliberately)

| Piece | Version | Why |
|---|---|---|
| NestJS | **11** | `nestjs-zod` (Zod integration) and `@nestjs/swagger` 11 target Nest 10/11; Nest 12 is not supported by that ecosystem yet |
| Prisma | **6.19** | Prisma 7 requires Node ≥ 20.19 and Prisma "latest" is currently a release candidate; 6.19 is stable on the Node 20.17 used for development |
| Zod | 4 | one validation language end to end (config, DTOs, later the portal forms) |
| Passwords | `@node-rs/argon2` (argon2id) | the `argon2` package's native binary crashes on this machine's Node 20.17; the Rust build works everywhere and uses the same algorithm/parameters (m = 19 MiB, t = 2, p = 1) |
| Logging | Pino (`nestjs-pino`) | structured JSON in production, pretty in development |
| Tests | Jest + Supertest | |
| Redis | **not used** | not needed for Phase 1; rate limiting uses the in-memory store. Redis is in Compose behind `--profile redis` for when it is needed |

## Request lifecycle

```
request ─► helmet / CORS / body limit (100 KB) ─► request-id (X-Request-Id) ─► throttler ─► route
        ─► Zod validation ─► controller ─► service ─► Prisma
response ◄─ { data, meta? }  (EnvelopeInterceptor)        errors ◄─ { error: { code, message, details?, requestId } } (AllExceptionsFilter)
```
- **`configureApp()`** (`src/app.factory.ts`) holds all HTTP configuration and is used by `main.ts` *and* the e2e tests, so tests exercise the production setup.
- **Config** is validated once at boot (`src/config/env.schema.ts`). In production the server refuses to start without strong JWT/ticket secrets, an explicit CORS allow-list, and a non-placeholder database password. Error messages name the variable but never print its value.
- **Errors**: services throw `AppException(code, message, status, details?)` for expected business errors; anything unexpected becomes a generic 500 and the cause is logged with the request id, never returned.
- **Pagination** (`src/common/dto/pagination.ts`): `?page&limit&search&sortBy&sortOrder`, limit ≤ 100, sort fields whitelisted per endpoint.
- **Logging** redacts `Authorization`, cookies, passwords and tokens; health probes are not logged.
- **Security**: Helmet (a relaxed CSP only for the Swagger UI path), CORS allow-list (never `*`), rate limiting (health exempt), `x-powered-by` removed, configurable `trust proxy`.
  Helmet sends `Cross-Origin-Resource-Policy: same-origin`; the media file route overrides it to `cross-origin` so the website can show uploaded images (done in Phase 4).

## Database workflow

- Schema changes **only** via Prisma migrations (`backend/prisma/migrations`). Never create or alter tables in pgAdmin.
- Two migrations exist: `init` (generated from `schema.prisma`) and `integrity_rules` (hand-written SQL for rules Prisma cannot express — see [`database.md`](database.md)). Prisma ignores those extras when checking drift; the tests cover them.
- Tests run against a separate `azharpark_test` database and refuse to run elsewhere.

## Decisions since the proposal

| Topic | Proposal | Now |
|---|---|---|
| QR token | random token, hash stored | **HMAC-signed payload derived from the ticket reference** — nothing secret is stored, and the QR can always be re-displayed (a hash-only design could never show the QR again). See [`ticketing.md`](ticketing.md) |
| Primary keys | UUID v7 | UUID v4 (`gen_random_uuid()`, built in to PostgreSQL 13+). Human-friendly references are separate columns; v7 can be adopted later without schema change |
| Ticket statuses | PENDING, PAID, VALID, USED, CANCELLED, EXPIRED, REFUNDED | `PAID` removed from tickets (it overlapped `VALID`); order and payment have their own statuses |
| Prices | type × audience × weekday/weekend | one `ticket_prices` table that also expresses special days, holidays and promotions without redesign |
| Payments | online + manual | `ONLINE` (provider-agnostic, never faked) and `COUNTER_SALE` cash orders |

## What comes next

Phase 2 — authentication & RBAC (done): see [`authentication.md`](authentication.md).
Phase 3 — park CMS and staff portal (done): see [`park-cms.md`](park-cms.md).
Phase 4 — restaurants, menus and media (done): see [`restaurants-media.md`](restaurants-media.md).
Phase 5 onward — events, ticketing, scanning, analytics (not started).
