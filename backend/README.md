# Al-Azhar Park — Backend (NestJS · PostgreSQL · Prisma)

REST API for the public website, the internal portal, ticketing and QR validation.
Phase 1 (foundation) is complete; see [`docs/architecture.md`](../docs/architecture.md) for what exists and what comes next.

## First-time setup

1. **PostgreSQL** — follow [`docs/postgres-setup.md`](../docs/postgres-setup.md) (database `azharpark`, role `azharpark_app`, test database `azharpark_test`).
2. **Environment**
   ```bash
   cd backend
   cp .env.example .env        # then set the password in DATABASE_URL / TEST_DATABASE_URL
   npm install
   ```
3. **Schema + data**
   ```bash
   npm run db:migrate          # apply migrations
   npm run db:seed             # reference data + development users (see below)
   ```
4. **Run**
   ```bash
   npm run start:dev           # http://localhost:3000/api/v1  ·  docs: http://localhost:3000/api/docs
   ```

Node 22 LTS is the production target. Node ≥ 20.17 works for development (a few dependencies print an engine warning on 20.17 – it is only a warning).

## Commands

| Command | What it does |
|---|---|
| `npm run start:dev` | API with hot reload |
| `npm run build` / `npm start` | compile to `dist/` / run the build |
| `npm run lint` · `lint:fix` · `format` | ESLint / Prettier |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | **unit** tests (no database) |
| `npm run test:e2e` | HTTP tests of the real app against the **test** database |
| `npm run test:db` | schema rules + concurrency tests against the **test** database |
| `npm run test:all` | all three |
| `npm run check` | lint → typecheck → all tests → build (what CI runs) |
| `npm run db:migrate` | `prisma migrate deploy` (apply pending migrations) |
| `npm run db:migrate:dev` | create + apply a new migration while developing |
| `npm run db:seed` | idempotent seed |
| `npm run db:reset` | **destructive**: drop, re-migrate (development only) |
| `npm run db:studio` | Prisma Studio (a quick data browser; pgAdmin is the main tool) |

The tests wipe tables in `TEST_DATABASE_URL`; they refuse to run unless that database's name contains `test`.

## Development logins (seeded, development only)

All use the password in `SEED_DEV_PASSWORD` (default `ChangeMe-Dev-2026!`). They are never created in production and use the reserved `.test` domain.

| Email | Role |
|---|---|
| `superadmin@azharpark.test` | SUPER_ADMIN |
| `admin@azharpark.test` | ADMIN |
| `operations@azharpark.test` | OPERATIONS |
| `staff@azharpark.test` | TICKET_STAFF |
| `content@azharpark.test` | CONTENT_MANAGER |
| `analyst@azharpark.test` | ANALYST |

(Login itself arrives in Phase 2.)

## Authentication

See [docs/authentication.md](../docs/authentication.md). Sign in at `POST /api/v1/auth/login`; every other route needs `Authorization: Bearer <access token>` unless marked public. Outside production the JWT secrets fall back to labelled dev-only values; production requires real ones.

## Layout

```
backend/
├─ prisma/
│  ├─ schema.prisma            data model (38 tables)
│  ├─ migrations/              SQL migrations — the only way the schema changes
│  ├─ seed.ts · seed-lib.ts    seeding (reference data vs development data)
│  └─ seed-data/               permissions & roles, prices, hours, sample content
├─ src/
│  ├─ main.ts · app.factory.ts · app.module.ts
│  ├─ config/                  validated environment (env.schema.ts)
│  ├─ common/                  errors, response envelope, filters, pagination, logging, security helpers
│  ├─ prisma/                  database module
│  ├─ health/                  /health and /health/ready
│  └─ modules/                 feature modules arrive here, one per domain (Phase 2+)
└─ test/
   ├─ e2e/                     HTTP behaviour of the real app
   ├─ db/                      constraints, immutability, double-scan concurrency
   └─ helpers/
```
