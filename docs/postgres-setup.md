# PostgreSQL setup (local) — Al-Azhar Park backend

This is the exact setup the backend expects. It is identical in Docker Compose (see the end), so nothing changes when you move to Docker later.

| Item | Value |
|---|---|
| PostgreSQL version | **16** or newer (16, 17 and 18 all work) |
| Host | `localhost` |
| Port | `5432` (use `5433` if something else already uses 5432) |
| Application database | `azharpark` |
| Test database | `azharpark_test` (used only by automated tests; its data is wiped) |
| Application role (user) | `azharpark_app` |
| Password | **you choose it** — a development-only example is shown below; never reuse it anywhere real |
| Extensions | `citext`, `btree_gist` (created by the first migration) |

## 1. Install PostgreSQL + pgAdmin

1. Download the Windows installer from <https://www.postgresql.org/download/windows/> (EnterpriseDB installer).
2. In the installer keep these components ticked: **PostgreSQL Server**, **pgAdmin 4**, **Command Line Tools**.
3. Port: `5432`. Locale: default.
4. When asked for the **`postgres` superuser password**, set one and write it down. This account is only for the one-time setup below; the application never uses it.
5. Finish. pgAdmin 4 is now in the Start menu.

## 2. Create the application role and databases (one time)

Open **pgAdmin 4** → connect to the local server as `postgres` (enter the superuser password) → right-click the server → **Query Tool**, and run:

```sql
-- 1) application role: can log in and create databases
--    (CREATEDB lets Prisma create its temporary "shadow" database during `migrate dev`)
CREATE ROLE azharpark_app LOGIN PASSWORD 'azharpark_dev_pw_CHANGE_ME' CREATEDB;

-- 2) databases, owned by that role
CREATE DATABASE azharpark      OWNER azharpark_app ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE azharpark_test OWNER azharpark_app ENCODING 'UTF8' TEMPLATE template0;
```

> Prefer a different password? Replace `azharpark_dev_pw_CHANGE_ME` above **and** in `backend/.env`.

### Extensions
The first migration runs `CREATE EXTENSION IF NOT EXISTS citext` and `btree_gist`. Both are *trusted* extensions in PostgreSQL 13+, so the database owner can create them. If your migration ever fails with *"permission denied to create extension"*, run this once as `postgres` (in the Query Tool, with the `azharpark` database selected — right-click it → Query Tool):

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
```
and do the same on `azharpark_test`.

## 3. Connection strings

Copy `backend/.env.example` to `backend/.env` and keep these values (adjust the password / port if you changed them):

```env
DATABASE_URL="postgresql://azharpark_app:azharpark_dev_pw_CHANGE_ME@localhost:5432/azharpark?schema=public"
TEST_DATABASE_URL="postgresql://azharpark_app:azharpark_dev_pw_CHANGE_ME@localhost:5432/azharpark_test?schema=public"
```

If your password contains special characters (`@ : / ? # %`), URL-encode them (e.g. `@` → `%40`).

## 4. pgAdmin connection settings

pgAdmin → right-click **Servers** → **Register → Server…**

| Tab | Field | Value |
|---|---|---|
| General | Name | `Al-Azhar Park (local)` |
| Connection | Host name/address | `localhost` |
| Connection | Port | `5432` |
| Connection | Maintenance database | `azharpark` |
| Connection | Username | `azharpark_app` |
| Connection | Password | your password (tick **Save password**) |
| SSL | SSL mode | `Prefer` (default) |

You will then see **Databases → azharpark → Schemas → public → Tables** after the first migration. Use pgAdmin only to *look at* and query data; **never create or alter tables by hand** — all schema changes are Prisma migrations in `backend/prisma/migrations`.

## 5. Create the schema and seed data

From the repository root:

```bash
cd backend
npm install
npm run db:migrate      # applies prisma/migrations to DATABASE_URL
npm run db:seed         # reference data + development users (see docs)
```

Verify in pgAdmin: `ticket_prices` should contain **8** rows (50/60/35/40 and 150/200/100/150 EGP, stored as piastres) and `opening_hours` **7** rows (09:00–22:00).

## 6. Docker Compose later (same names, same values)

`docker/docker-compose.yml` already defines PostgreSQL 16 with the **same** database name, role and password variables, plus pgAdmin (and Redis behind an optional profile). When Docker is installed:

```bash
docker compose -f docker/docker-compose.yml up -d postgres pgadmin
```
- If your local PostgreSQL service still runs on 5432, the Compose database is published on **5433** by default to avoid a clash; change `POSTGRES_PUBLISHED_PORT` in `docker/.env` if you want otherwise.
- Inside Compose the API connects to host `postgres` (the service name), not `localhost`; `docker/docker-compose.yml` sets that for you.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `password authentication failed` | wrong password in `DATABASE_URL`, or special characters not URL-encoded |
| `permission denied to create database` (`migrate dev`) | the role needs `CREATEDB`: `ALTER ROLE azharpark_app CREATEDB;` |
| `permission denied to create extension` | see *Extensions* above |
| `connection refused` | the PostgreSQL service is not running — Windows *Services* → `postgresql-x64-16` → Start; or the port differs |
| Port 5432 already in use | choose another port during install, and update `DATABASE_URL` |
