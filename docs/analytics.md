# Analytics, history and exports (Phase 10)

Phase 10 adds reports on top of the data the earlier phases already keep. It adds **no database table, column, index or migration**, no new permission, no new dependency and no cache. Every figure is computed by PostgreSQL (`count`, `sum`, `group by`) at the moment it is asked for.

Three things are always reported **separately**, because they answer different questions:

| Question | Report | Source of truth |
|---|---|---|
| How much was **sold**, and for how much? | Sales | paid **orders** and the **tickets** they created (stored prices) |
| How much **money** was taken? | Sales (paid sales) | paid orders' stored totals. Payment attempts (`payments`) are not used for revenue |
| How many people **came in**? | Attendance | successful **scans** at the gates |

A ticket that was sold and never used is a sale, never an attendance. A scan that was refused is never an attendance.

## Permissions

Only the three analytics permissions that already existed in the catalogue are used. Nothing checks a role name.

| Permission | Opens |
|---|---|
| `analytics:read` | everything, including all money figures |
| `analytics:operations` | attendance (entries, refused scans, gates, scan results) and ticket states, **without any money** |
| `analytics:content` | event statistics only |

`analytics:read` also covers what the other two open. A user with none of them gets `403` from every analytics route and every export; a user who is not signed in gets `401`. Holding `orders:read`, `payments:read`, `tickets:read` or `scans:read` does **not** open analytics. The overview returns only the sections the caller may see; an operations user's responses contain no money field at all (the key is omitted, not hidden).

Routes: `GET /analytics/{overview,sales,attendance,tickets,events}` and `GET /analytics/export/{sales,attendance,tickets,gates,scans,events}`.

## Periods and the Cairo calendar

A day is a **Cairo calendar day**, whatever time zone the server or the person's computer uses. Ready-made periods are worked out on the server from the park's clock:

| Name | Period |
|---|---|
| `today`, `yesterday` | one Cairo day |
| `last7`, `last30` | the 7 / 30 days ending **today** (today included) |
| `thisMonth` | the 1st of this month to today |
| `lastMonth` | the whole previous calendar month |
| custom | `from` and `to` (both included), as `YYYY-MM-DD` |

Rules:

- Boundaries are the first instant of `from` and the first instant after `to`, in Cairo. A day with a clock change is therefore 23 or 25 hours long and every order, scan or event belongs to exactly one day. Cairo's spring change skips midnight (for example 24 April 2026 starts at 01:00); the start of such a day is its first real moment. This used a helper, `parkDayStart`, that also **fixed a latent crash** in the Phase 5 and Phase 9 code (see Known changes below).
- At 00:30 on the 8th in Cairo, "today" is the 8th even though UTC is still the 7th.
- The longest period is `ANALYTICS_MAX_RANGE_DAYS` (default **366**, valid 1 to 3660). A longer request is refused with `422 INVALID_RANGE` and a message that names the limit. A reversed range, a missing `from` or `to`, a ready-made name combined with dates, or a date that does not exist (30 February) is also refused (`422` or `400`).
- Charts group by `day`, `week` (Monday-based) or `month`. Without `groupBy`, up to 62 days is by day, up to 183 days by week, longer by month. Every series is **zero-filled**: a quiet day is a zero, never a gap.

## Sale date or visit date

Sales and ticket states can be counted by either date (`basis=sale|visit`, default `sale`). The two views of the same order are different on purpose:

| Basis | A paid order counts in the period when… | Use it to |
|---|---|---|
| **Sale date** (`sale`) | it was **placed** (its creation day in Cairo) | see money taken per day |
| **Visit date** (`visit`) | its **visit date** (the tickets' day) is in the period | plan a day: expected visitors and value for that day |

A ticket bought today for next Friday is a sale **today** and a visit **next Friday**. Over a period long enough to hold both days, both bases give the same total. "Orders placed" (see below) exists only by sale date.

The sale date is the day the order was *placed*, not the day payment completed (an order placed at 23:50 and paid at 00:10 belongs to the earlier day). This matches the Phase 9 dashboard and uses the indexed order creation time.

## Sales (`analytics:read`)

All amounts are **EGP**, in the stored **minor units** (piastres); the portal shows pounds with two decimals.

- **Paid sales**: the sum of `orders.total_minor` of orders with status `PAID` in the period. Orders waiting for payment, expired orders and cancelled-before-payment orders are **never** sales.
- **Paid orders** / **Tickets sold**: count of those orders / of the tickets they created.
- **Average paid order**: paid sales ÷ paid orders (`null` when there are none).
- **Tickets cancelled inside paid orders**: tickets of a paid order that staff later cancelled one by one. They are still part of paid sales (the order was paid in full) and are shown beside it.
- **Paid orders cancelled later**: orders that were paid and then cancelled by staff: their count, tickets and value, shown **apart** from paid sales. The system has no refund function; this is not money returned.
- **Orders placed** (sale basis, no ticket filter only): every order started in the period by outcome (paid, waiting for payment, expired, cancelled). Conversion figures can be derived from it, but none is presented as a promise.
- Breakdowns by **ticket type**, **audience** (Egyptian / resident, non-resident visitor), **weekday / weekend** (by the tickets' visit date: Friday and Saturday are the weekend, as in pricing) and by type × audience. Each breakdown adds up to the total.
- Filters: `ticketType`, `audience`, `dayType`. With a filter the figures are those of the **matching tickets** (a filtered "paid orders" is the number of paid orders that contain a matching ticket), and the response and portal say so (`filtered: true`).

**Historical prices only.** Money comes from the stored order total and the stored ticket price (`price_paid_minor`, copied at purchase). The current price list is never consulted, so changing a price changes nothing in past reports (tested: a new 999 EGP price leaves earlier sales untouched, and an order sold at an unusual stored price is reported at that stored price).

## Attendance (`analytics:operations`)

- **Entries**: successful scans (`ACCESS_GRANTED`), counted on the Cairo day of the **scan** (not the visit date). A ticket can be let in once, so entries are people in, once each. Scanning it again is a refused scan (`ALREADY_USED`).
- **Refused scans**: every other result: already used, wrong date, cancelled, expired, ticket not valid, ticket not found, unreadable code, forged or altered code, retired key. **None is an entry.**
- **Refused share** = refused ÷ all scans.
- Per **gate**: entries, refused, scans, share of entries. The busiest gate is the one with the most entries. All active gates are listed, with zero when idle; scans of a gate that was later removed appear under "Removed gate".
- Entries by **ticket type** and **audience**, from the ticket that was let in.
- Filters: `gateId`, `ticketType`, `audience`.
- Older scan rows that predate the detailed result codes are mapped from their reason (`OK` → let in, `NOT_FOUND`, `NOT_PAID` …) so history stays continuous.
- The scanned text, token fingerprint, signature, device and IP address are never returned.

## Ticket states (`analytics:operations`)

What each ticket **is now**: valid (not yet used), used, cancelled, awaiting payment, expired, selected by visit date or by the day it was ordered. The database keeps the *current* status and its timestamps; it does **not** keep a history of status changes, so these figures are a snapshot, not "how many were valid last Tuesday". Two derived figures help judge no-shows: **valid but the visit day has passed** (paid, never used) and **used, of past visit days** (a share). Today is not "passed" until it is over.

## Events (`analytics:content`)

Events are counted by the Cairo day they **start**, by status (published, coming soon, draft, cancelled, archived), with an all-time count by status, a per-day series and a per-venue count of public events. Events are **not linked to tickets** in this system (a ticket admits a visitor to the park, not to one event), so there are **no event sales, revenue or attendance figures**; none is estimated. The event list is capped at 500 rows (the export has the full list within the row limit).

## Charts

Charts are plain SVG drawn by the portal (no chart library was added). Each has a title, a text summary for screen readers (`role="img"` and `aria-label`), axis labels, a legend where there is more than one series, and an empty state. Every chart and every share bar has the **same numbers as a table** in a "View as a table" section. Colours are never the only carrier of meaning (series are named in the legend and table). Pages are checked at a phone width (390 px) with no horizontal page scroll.

## CSV exports (`GET /analytics/export/:report`)

Reports: `sales`, `attendance`, `tickets`, `gates`, `scans`, `events`. Each export follows the **same period, date basis and filters** as the page it is started from and needs the same permission as the matching report (`sales` → `analytics:read`; `events` → `analytics:content` or read; the others → `analytics:operations` or read).

- Format: UTF-8 with a byte-order mark (so Excel reads Arabic), CRLF line ends, RFC 4180 quoting (commas, quotes and line breaks inside a value are quoted). Money is `value_egp` in pounds with two decimals plus a `currency` column. Dates are ISO `YYYY-MM-DD`. Every column has a stable snake_case name.
- File name: `azharpark-<report>-<from>_<to>[-sale|-visit].csv`. Headers: `Content-Disposition: attachment`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `X-Row-Count`.
- **Spreadsheet formula injection**: any text that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe, so a spreadsheet shows it as text and never runs it. This covers every text column (event titles, gate names, venues). Tested with `=HYPERLINK(...)`, `+SUM(...)`, `-2+3` and `@cmd|...`.
- **No personal data**: rows are counts and amounts grouped by date, ticket type, audience, gate or result. There are no customer names, e-mails, phone numbers, order numbers, ticket references, QR text, token fingerprints, scanner users or IP addresses in any export (tested by searching every export for those values).
- **Size**: the export is built from aggregates, so it is small even for a year. If it would hold more than `ANALYTICS_EXPORT_MAX_ROWS` (default **100,000**, valid 100 to 1,000,000) rows it is refused with `422 EXPORT_TOO_LARGE` and a message asking for a shorter period or a filter; nothing is silently cut off. The file is written line by line from the prepared rows.
- **Audit**: every successful export is recorded as `analytics.exported` with who, the report, the period, the basis and the filters, never the data. Refused exports (no permission, too large) are not recorded as exports.

## Performance

Measured on a synthetic dataset of **200,000 paid orders, 400,000 tickets and 200,000 scans over two years** (PostgreSQL on the development machine, API in-process):

| Request | Time |
|---|---|
| Overview, today / last 30 days | 0.4 s |
| Sales, last 30 days (sale / visit date) | 0.2 s |
| Sales, 12 months (sale / visit date) | 1.0 s / 0.7 s |
| Sales, 12 months, filtered by ticket type | 2.4 s |
| Attendance, 12 months | 0.4 s |
| Ticket states, 12 months | 0.8–1.0 s |
| Events, 12 months | 0.1 s |
| CSV export of sales, a year by day | 1.9 s |

The query plans use the existing indexes (`orders(created_at)`, `orders(status, created_at)`, `tickets(visit_date, status)`, `ticket_scans(scanned_at)`). No index was added: a real park's volume is a small fraction of this, and the slowest case here is acceptable for a report. If a year-long filtered report ever becomes slow, first measure it, then consider an index on `tickets(order_id, ticket_type_id)` or a pre-aggregated daily table (a later phase, with its own migration). There is no cache and no warehouse: reports read the live tables.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `ANALYTICS_MAX_RANGE_DAYS` | 366 | the longest period a report may cover |
| `ANALYTICS_EXPORT_MAX_ROWS` | 100000 | the most rows one export may hold |

## Known changes made on the way

- **`parkDayStart` (a bug fix in earlier code).** The start of a Cairo day was computed as "00:00 Cairo". On the day Egypt moves its clocks forward there is **no** 00:00 (24 April 2026 and 30 April 2027 start at 01:00), and the old code threw for that day. The dashboard, the scan list and the event pages would have failed on those two days. `parkDayStart(date)` returns the first real instant of a day; `events/event-time.ts`, `events.service.ts`, `operations/dashboard.service.ts`, `operations/gates.service.ts` and `operations/scans-history.service.ts` now use it. Tested for normal days, skipped-midnight days, the tiling of consecutive days around both clock changes, and the 23 h and 25 h day lengths (`event-window.spec.ts`), and through the dashboard and scan list on 24 April 2026 (`analytics.e2e-spec.ts`).

## Known limitations

- Ticket states are a **snapshot**; there is no history of status changes, so "valid on a past date" cannot be reconstructed.
- Events cannot be tied to tickets, sales or attendance (no relation exists).
- Sale date is the order **placement** day; the payment completion time is not used.
- Orders placed are not shown with ticket filters or by visit date (they have no meaning there).
- The portal's ticket-type, audience and gate filters list the choices seen in the unfiltered report, so a type with no activity in the period is not offered.
- No scheduled or e-mailed reports, no PDF or Excel export, no comparison with a previous period, no forecasts (see deferred work).

## Deferred work

Scheduled / e-mailed reports, XLSX and PDF exports, period-over-period comparison, a daily summary table or cache (only if measurements justify it), a status-change history for tickets (a schema change), event-to-ticket linking (a product decision), refund and payment-provider reconciliation reports (Phase 11 and later), and retention of old data.
