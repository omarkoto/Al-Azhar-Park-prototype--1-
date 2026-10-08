# The staff portal as an operations system (Phase 9)

The portal is where the park is run day to day. Phase 9 added no new business rules and **no database change**: it turned the existing pages into one coherent system, and added the operational views that the earlier phases had permissions for but no screen (the dashboard, tickets, scans and gates).

Authorization is always by **permission** (`resource:action`), never by role name. The menu hides what a person cannot use, but that is convenience only: every endpoint checks the permission again on the server and fails closed.

## Menu

| Group | Page | Opens with |
|---|---|---|
| (top) | **Dashboard** (`/`) | any signed-in user (it shows only the sections they may see) |
| **Operations** | Orders `/orders` | `orders:read` |
| | Tickets `/tickets` | `tickets:read` |
| | Gate scanner `/scanner` | `scans:create` |
| | Scans `/scans` | `scans:read` (everyone's) or `scans:read_own` (yours) |
| | Gates `/gates` | `gates:read` (changes need `gates:write`) |
| **Analytics** | Overview `/analytics` | `analytics:read`, `analytics:operations` or `analytics:content` (shows only the sections allowed) |
| | Sales `/analytics/sales` | `analytics:read` |
| | Attendance `/analytics/attendance` | `analytics:read` or `analytics:operations` |
| | Ticket states `/analytics/tickets` | `analytics:read` or `analytics:operations` |
| | Event statistics `/analytics/events` | `analytics:read` or `analytics:content` |
| | Reports `/analytics/reports` | any analytics permission (each download needs its own report's permission) |
| **Park & content** | Park information, Contact details, Opening hours, Events, Venues, Restaurants, Media library | `park:read`, `contact:read`, `hours:read`, `events:read`, `venues:read`, `restaurants:read`, `media:read` |
| **Tickets & pricing** | Ticket types, Ticket prices | `ticket-types:read`, `pricing:read` |
| **Administration** | Staff accounts, Roles & permissions | `users:read`, `roles:read` |

A group with nothing the person may open is not shown. Existing routes did not change; `/tickets`, `/scans`, `/gates` and the dashboard are new. The menu lives in `portal/src/lib/navigation.ts` (with tests).

## Dashboard (`GET /dashboard`)

One request, computed on the server, **today in Cairo time** (`Africa/Cairo`, day boundaries are Cairo midnight, DST-aware, never the browser's). The page refreshes it every 30 seconds. Each section is included only if the caller holds the permission that already protects that data:

| Section | Needs | Contents |
|---|---|---|
| `park` | `park:read` or `hours:read` | open / not open yet / closed for today / closed today, today's hours, the special entry that changed them, when **online sales** stop today (closing time minus the cut-off, from the same opening-hours tables as the ticket sales), the coming special dates (30 days) |
| `orders` | `orders:read` | orders **created today** by status, `revenueMinor` = the **stored totals** of today's paid orders (never recalculated from current prices; a cancelled order is not counted), and unpaid orders waiting right now |
| `tickets` | `tickets:read` | tickets whose **visit date is today** by state: sold (valid + used), valid, used, cancelled, not paid, expired |
| `entry` | `scans:read` or `scans:read_own` | today's scans: let in, refused (split by reason), the ten latest. With only `scans:read_own`, your own scans and no staff names |
| `gates` | `gates:read` or `scans:create` | every gate with active / switched off; today's entries per gate only with `scans:read` |
| `events` | `events:read` | today's events and the next six (draft, coming soon and published; cancelled and archived are left out) |
| `activity` | `audit:read` | the latest 12 changes: what, on what, by whom. Never the values; sign-in noise is left out |

A user with none of these gets an empty dashboard (no error, no data). It is operational, not analytical: counts for today and the latest few records. Trends, charts and reports are Phase 10.

Definitions worth knowing: *today's orders* are those **placed** today; *today's tickets* are those **for visiting** today (a ticket bought last week for today counts here, not in today's orders).

## Tickets (`GET /tickets`, `GET /tickets/:id`, `GET /tickets/:id/pdf`)

Needs `tickets:read`. Search by ticket or order number (not case sensitive); filter by status, visit date, ticket type, audience; paged (20 per page, server side). The list and detail carry **no customer details**. The detail adds the order, the payment state (with `payments:read`), whether a QR code was issued, when it was used and by whom and the gate history of that ticket (both with `scans:read`).

The page is **read only**: reference, type, audience, visit date and price are immutable (database triggers), and the state moves only through payment, a cancellation (from the order page, with a reason) and the gate scan. There is no route to set a status.

`GET /tickets/:id/pdf` needs `tickets:read` **and** `tickets:resend` (the people who re-deliver tickets). It carries the live QR code, so every download is audited (`ticket.pdf_downloaded`). Only valid or used tickets have one.

## Scans (`GET /scans`)

`scans:read` shows every scan and who made it; `scans:read_own` only your own. Filter by result (let in / refused), gate and Cairo day, search by ticket number, paged. The scanned text, its fingerprint, the signature, the client address and the device are never returned.

## Gates (`GET/POST /gates`, `PUT /gates/:id`, `PUT /gates/:id/active`)

- `GET /gates` (`gates:read`): every gate, active or not; with `scans:read` also today's entries and refusals, total scans and the last scan.
- `POST /gates`, `PUT /gates/:id`, `PUT /gates/:id/active` need `gates:write`. A code is capital letters, digits and underscores, unique, and **fixed once created**; names (English and Arabic) can change.
- **Switching a gate off** means new scans cannot use it (the scan endpoint refuses it with `GATE_INACTIVE`, and the scanner no longer offers it). Scans already made there are kept and still point to it. A gate is never deleted. The portal warns before the last active gate is switched off.
- Phase 8's rule stands: any staff member with `scans:create` may use any active gate. There is no staff-to-gate assignment.
- Audit: `gate.created`, `gate.updated` (old and new names), `gate.activated`, `gate.deactivated`. Switching to the state a gate already has changes nothing and writes nothing.

## Orders

Phase 6 already had the order list and detail; Phase 9 added finding an order **by one of its tickets** and deep links (`/orders?search=…`, used by the ticket page). Cancellation is unchanged: a reason is required, who and when are recorded, nothing is refunded, a used ticket blocks it.

## Park, events, restaurants, users, roles

Unchanged pages, now reachable from the grouped menu. The dashboard links to opening hours and events; events on the dashboard show draft / coming soon / published. "Reserve a table" still goes to the restaurant's Instagram link entered in the portal; there is no booking system.

## Analytics (Phase 10)

The Analytics group holds the period picker (Today, Yesterday, Last 7 days, Last 30 days, This month, Previous month, Custom range), the *Count by* choice (sale date or visit date) and the filters, all kept in the address bar so a report can be bookmarked or sent. A custom range is checked in the portal before the server is asked (both dates, start not after end, within the configured maximum) and the server checks again. Charts are SVG with a table alternative for each. Every definition (revenue, sale date versus visit date, attendance, ticket states, gate and scan metrics, Cairo-day rules, export format and privacy, limits) is in [analytics.md](analytics.md).

## Audit

Everything staff change is audited through the existing audit service. Phase 9 added `gate.*` and `ticket.pdf_downloaded`; Phase 10 adds `analytics.exported` (who, which report, period, basis, filters; never the data); ticket and order cancellation, event and restaurant changes, price and ticket-type changes, user and role changes were already audited in earlier phases. Reading pages (dashboard, lists) is not audited.

## Layout

The content area is wider (up to 72 rem) and every table sits in its own scrolling box, so no page becomes wider than the screen. Checked at 1366, 1024, 820 and 700 px; below 768 px the menu opens from a button. The gate scanner keeps its own large layout for gate stations.

## Limits and deferred work

- **Analytics, charts and CSV exports were added in Phase 10**: see [analytics.md](analytics.md). **Not built:** forecasting, scheduled reports. **Not built (other):** a settings page (the settings permissions exist, but nothing edits settings yet; same-day cut-off, advance days and order expiry are changed in the database), a customers page, staff-to-gate assignment, a "recent scans" screen on the scanner, per-gate daily limits.
- The dashboard has no caching: each refresh runs a handful of small indexed queries (grouped counts by day range, latest ten rows). If it ever becomes slow, add a cache or a small pre-aggregated table then, with measurements (the day-range queries already use the existing indexes on creation time, visit date and scan time).
- "Revenue today" is by when the order was **placed**; an order placed at 23:50 and paid at 00:10 counts for the earlier day.
- Staff see operations figures for "today" in Cairo even if their own device is in another time zone.
