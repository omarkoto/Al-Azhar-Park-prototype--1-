# Database

PostgreSQL 16+ · Prisma 6 · 38 tables · schema in `backend/prisma/schema.prisma`, migrations in `backend/prisma/migrations`.

## Conventions

- **Internal ids** are UUIDs and are never shown to customers. **Customer-facing references** are separate columns:
  - Order number `AZP-2026-000123` — gap-free yearly sequence from `reference_counters` (atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`; proven with 40 simultaneous requests).
  - Ticket reference `TKT-8F3K2LQ7ZP` — random, ≥ 50 bits (Crockford base32), unique.
- **Money** is an integer in minor units (piastres): `50 EGP = 5000`. Never floats.
- **Dates a visitor picks** (visit date, price validity, special hours) are `date` values in **Africa/Cairo**. The helper `azharpark_today()` returns today's Cairo date (handles Egypt's DST).
- Instants are `timestamptz`. Tables/columns are `snake_case`; enums are PostgreSQL enums.
- Bilingual content uses `*_en` / `*_ar` columns.
- Soft delete (`deleted_at`) on content only (ticket types, events, venues, restaurants, menus, media). **Never** on financial or entry history.

## Tables

| Group | Tables |
|---|---|
| Access | `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `refresh_tokens`, `password_reset_tokens` (see [authentication.md](authentication.md)) |
| Customers & privacy | `customers`, `data_requests` |
| Ticket configuration | `ticket_audiences`, `ticket_types`, `ticket_prices`, `gates` |
| Sales | `orders`, `order_items`, `payments`, `order_access_tokens`, `reference_counters` |
| Tickets & entry | `tickets`, `ticket_scans` |
| Park content | `park_settings`, `contact_information`, `opening_hours`, `special_hours` |
| Events | `venues`, `events`, `event_media` |
| Restaurants | `restaurants`, `restaurant_media`, `menus`, `menu_categories`, `menu_items` |
| Files | `media` (metadata only — binaries live in the storage provider, never in PostgreSQL) |
| Operations | `contact_messages`, `reservation_requests`, `notifications`, `audit_logs`, `system_settings` |

## Status models (explicitly separate)

| Entity | Statuses |
|---|---|
| **Order** | `PENDING_PAYMENT` → `PAID` / `CANCELLED` / `EXPIRED`; **no refund state is reachable** (`REFUNDED` exists in the enum but a CHECK and a trigger block it); an admin may `CANCEL` with a reason (cancel is not a refund) · plus `channel`: `ONLINE` or `COUNTER_SALE` |
| **Payment** | `PENDING` → `PAID` / `FAILED` / `CANCELLED`; a paid payment is final (no reversal, no refund) · plus `method`: `ONLINE` or `CASH`, and `recorded_by` for manual payments |
| **Ticket** | `PENDING` → `VALID` / `CANCELLED` / `EXPIRED`; `VALID` → `USED` / `CANCELLED` / `EXPIRED`. `USED`, `CANCELLED`, `EXPIRED` are final. Cancelling requires `cancelled_at` and a `cancel_reason` |

A **PAID order produces VALID tickets**; a successful scan moves **VALID → USED atomically**.

## Pricing model

`ticket_prices` row = *this ticket type, for this audience, on these weekdays, between these dates, costs this much*.

| Need | How it is expressed |
|---|---|
| Normal weekday / weekend prices | `kind = STANDARD`, `dow_mask` = 31 (Sun–Thu) or 96 (Fri–Sat) |
| Holiday / special-day price | `kind = SPECIAL`, `special_dates = {…}`, higher `priority` |
| Promotion | `kind = PROMOTIONAL`, optional `promo_code`, highest `priority` |
| New audience or product | a new row in `ticket_audiences` / `ticket_types` — no schema change |
| Price change | close the old row (`valid_to`) and insert a new one. Rows are history |

`dow_mask` bits: Sun = 1, Mon = 2, Tue = 4, Wed = 8, Thu = 16, Fri = 32, Sat = 64.

**Which price applies** (implemented in Phase 6): among active rows for (type, audience) whose date range contains the visit date, whose weekday bit matches, whose `special_dates` is empty or contains the date, and whose `promo_code` is empty or equals the supplied code — take the highest `priority`, then rows with `special_dates`, then the latest `valid_from`, then the newest. No match ⇒ not for sale that day.

**The initial price list is seed data** (`prisma/seed-data/catalog.ts`), inserted as eight `ticket_prices` rows. No business logic contains a price. The seed never overwrites rows an administrator has changed.

| | Weekday (Sun–Thu) | Weekend (Fri–Sat) |
|---|---|---|
| Egyptian / resident — adult | 50 | 60 |
| Egyptian / resident — child | 35 | 40 |
| Non-resident visitor — adult | 150 | 200 |
| Non-resident visitor — child | 100 | 150 |

### Historical prices can never change
- `order_items` stores the price used (`unit_price_minor`, names, which `ticket_price_id`), and `tickets.price_paid_minor` stores it per ticket.
- Database triggers reject any `UPDATE` of those columns, so a bug or a manual SQL session cannot rewrite what a customer paid.

## Opening hours

- `opening_hours`: one row per weekday (0 = Sunday … 6 = Saturday), each with its own `opens`/`closes` or `is_closed`. Seeded Sun–Sat 09:00–22:00.
- `special_hours`: date ranges that override the weekly hours — `HOLIDAY`, `TEMPORARY_CLOSURE`, `SPECIAL_HOURS` (Ramadan, events…). Overlaps resolved by `priority`.
- Editing Friday, adding a holiday or a closure needs no schema change.

## Integrity rules enforced by the database (`integrity_rules` migration)

Covered by 87 database tests (`backend/test/db`).

| Rule | Mechanism |
|---|---|
| No two standard prices for the same type + audience + weekdays + priority may overlap in dates | `EXCLUDE USING gist` constraint (needs `btree_gist`) |
| A `SPECIAL` price must list its dates; amounts ≥ 0; valid weekday mask; end ≥ start | `CHECK` |
| List columns are never `NULL` | `NOT NULL` (a `NULL` would silently bypass the rules above — found and fixed by the tests) |
| Order totals = subtotal − discount; line total = price × quantity; quantity > 0 | `CHECK` |
| Order numbers `AZP-YYYY-NNNNNN`, ticket refs `TKT-XXXXXXXX…` | `CHECK` (regex) |
| Orders, order items, payments, tickets can never be deleted | `BEFORE DELETE` trigger |
| Price paid, order amounts, payment amount/method, ticket reference/visit date/order link are immutable | `BEFORE UPDATE` triggers |
| Ticket status only moves forward (a `USED` ticket can never become `VALID`) | `BEFORE UPDATE` trigger |
| `USED` requires a `used_at` timestamp | `CHECK` |
| `audit_logs` and `ticket_scans` are append-only (no update, no delete) | `BEFORE UPDATE OR DELETE` trigger |
| A scan result must be consistent (`VALID` ⇔ reason `OK`) | `CHECK` |
| Single-row tables (`park_settings`, `contact_information`) | `CHECK (id = 1)` |
| Opening hours: closing after opening (unless closed); special range ordered | `CHECK` |
| Prices, ticket types, audiences and customers referenced by orders cannot be deleted | foreign keys `ON DELETE RESTRICT` |

Privacy anonymisation is an `UPDATE` of the `customers` row (allowed); orders and tickets keep their history.

## Indexes (highlights)

`tickets(public_ref)` unique · `tickets(visit_date, status)` · `orders(order_number)` unique · `orders(status, created_at)` · `customers(email)` · `ticket_scans(scanned_at)`, `(scanned_by_id, scanned_at)`, `(gate_id, scanned_at)` · `events(status, starts_at)` · `audit_logs(created_at)`, `(entity, entity_id)`, `(user_id, created_at)` · `ticket_prices(ticket_type_id, audience_id, valid_from)`.

## Looking at the data (pgAdmin)

Register the server as described in [`postgres-setup.md`](postgres-setup.md). After `npm run db:seed` you should see: 47 permissions, 6 roles, 8 `ticket_prices`, 7 `opening_hours`, 2 `gates`, 6 dev `users`. Use pgAdmin to look and query; never to change the schema.

## Phase 2 additions (authentication)

Migration `20261004201227_phase2_auth`:

- `users.password_changed_at` (set on every change/reset).
- `ck_users_failed_login`: `failed_login_count >= 0` and `token_version >= 0`.
- Trigger `trg_refresh_tokens_guard`: a refresh token's hash, user, family and expiry never change; once revoked it can never be re-activated; once rotated its successor link cannot change.
- Trigger `trg_password_reset_tokens_guard`: a reset token's hash, user and expiry never change; once used it can never be un-used.
- Indexes on `refresh_tokens(expires_at)` and `password_reset_tokens(expires_at)` for the future purge job.
- Seed: `ADMIN` now also holds `tickets:read_entry`, `scans:read_own`, `analytics:operations` and `analytics:content`, so an administrator can grant every role except SUPER_ADMIN.

Migration `20261005041840_session_lifetime`: `refresh_tokens.session_started_at` (inherited by every rotated token, immutable via the guard trigger) enforces the absolute 30-day session limit.
