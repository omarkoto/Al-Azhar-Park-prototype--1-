# Gate scanner and entry validation (Phase 8)

A visitor shows the QR code from their ticket (phone or paper). Gate staff scan it in the portal. **The server decides**: it checks the code, finds the ticket, checks it may enter today, uses it up in one atomic step, records the scan and answers. The screen only shows that answer.

```
QR text ─▶ POST /scans {qr, gateId} ─▶ permission ─▶ gate ─▶ code check ─▶ ticket ─▶ atomic VALID→USED ─▶ scan record ─▶ ACCESS_GRANTED | reason
```

No second QR format and no second validation path: the code is the Phase 7 one (`AZP1.<ticket reference>.<key id>.<signature>`), checked by the same `QrService.verify()` / `verifyQrPayload` with the same key ring.

## API

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /scans/gates` | `scans:create` | the **active** gates (`id`, `code`, `nameEn`, `nameAr`), for the gate picker |
| `POST /scans` | `scans:create` | body `{ "qr": "<text read from the code>", "gateId": "<uuid>" }`, nothing else (extra fields are refused) |

`POST /scans` answers **200** for every outcome that concerns a ticket, including a refusal: a refused ticket is a normal gate event, not a server error. A gate that does not exist (`404 GATE_NOT_FOUND`), a switched-off gate (`422 GATE_INACTIVE`), a bad body (`400`), no permission (`403`), no login (`401`) and the rate limit (`429`) are errors.

```jsonc
{ "data": {
    "result": "ACCESS_GRANTED",          // see the table below
    "granted": true,
    "message": "Access granted.",        // safe to show; says what happened to the ticket, never how codes are checked
    "scanId": "…", "scannedAt": "2026-10-07T10:00:00.000Z",
    "gate": { "id": "…", "code": "MAIN", "nameEn": "Main entrance", "nameAr": "…" },
    "ticket": { "ref": "TKT-8F3K2LQ7ZP", "visitDate": "2026-10-07", "typeNameEn": "Adult", "typeNameAr": "…", "audienceNameEn": "…", "audienceNameAr": "…" },
    "usedAt": "…"                        // only for ALREADY_USED: when it was first used
} }
```

The scanner is told only what it needs: the ticket reference, visit date, type and audience. **Never** the customer's name, e-mail, phone, the price, the order number, or anything about the signature.

## Validation order

1. **Authenticate** (JWT) and **authorize** (`scans:create`; the global guards fail closed). Roles are never compared by name.
2. **Gate**: it must exist and be active. (The existing model has no staff-to-gate assignment, and Phase 8 does not invent one: any staff member with `scans:create` may work at any active gate. The gate is recorded on every scan.)
3. **Code shape** (length, exact format) **then key and signature**, in constant time: all before any ticket lookup. A malformed or forged code never reaches the ticket table.
4. **Ticket lookup** by the reference inside the code. The key id in the code must be **the key that signed that ticket** (`tickets.qr_key_id`): a genuine signature made with another key of the ring does not open it.
5. **Atomic consumption** — one statement, not "read, check, write":

   ```sql
   UPDATE tickets SET status = 'USED', used_at = $now, used_by_id = $staff
    WHERE id = $id AND status = 'VALID' AND visit_date = azharpark_date_of($now)
   RETURNING id;
   ```

   Exactly one row back means *this* scan admitted the visitor. The scan record is written in the same transaction.
6. If no row came back, the ticket is read again to say **why** it was refused, using the same rule that `evaluateScan()` states (`rules/scan-validity.ts`), and that refusal is recorded too.

`$now` is the application's clock (a test can set it); the date comes from the database function `azharpark_date_of()`, which is the **Cairo** calendar day, DST-aware, never the server's or UTC's. Tests cover 23:59:59, 00:00:01 and 00:30 Cairo (when UTC is still the previous day) and the last-Friday-of-October clock change.

## Results

| `result` | Meaning | Stored `reason` |
|---|---|---|
| `ACCESS_GRANTED` | the ticket was valid, for today, and has now been used | `OK` |
| `ALREADY_USED` | used before (also the loser of two simultaneous scans); `usedAt` says when | `ALREADY_USED` |
| `WRONG_DATE` | valid ticket, but its visit date is not today (Cairo) | `WRONG_DATE` |
| `CANCELLED` | cancelled by staff (the ticket or its whole order) | `CANCELLED` |
| `EXPIRED` | the order was never paid in time | `EXPIRED` |
| `TICKET_NOT_VALID` | not valid yet: the order is unpaid (`PENDING`) | `NOT_PAID` |
| `TICKET_NOT_FOUND` | a correctly signed code for a ticket that does not exist | `NOT_FOUND` |
| `INVALID_SIGNATURE` | the signature does not match, or it is not the ticket's key | `INVALID_TOKEN` |
| `INVALID_QR` | not in the ticket format at all (junk, wrong length, extra parts) | `INVALID_TOKEN` |
| `RETIRED_KEY` | signed with a key id that is no longer in the key ring | `INVALID_TOKEN` |

`INVALID_QR` and `INVALID_SIGNATURE` show the same sentence, so a forger learns nothing from the difference; staff and the audit trail still see the precise code. Existing lifecycle terms were kept: the `ScanReason` enum is unchanged and a new column `ticket_scans.detail` (migration `20261010090000_phase8_scan_detail`, with a CHECK on the ten codes) keeps the precise result.

## Concurrency guarantee

Of any number of scans of one ticket at the same moment, **exactly one** is `ACCESS_GRANTED`; the others are `ALREADY_USED`. This rests on the single conditional `UPDATE` above (PostgreSQL serializes writers of one row and re-checks the `WHERE` after the first commits), not on application code. Proved by the Phase 1 database test (50 simultaneous claims) and by Phase 8 end-to-end tests (12 simultaneous HTTP scans from two accounts and two gates, and two gate screens in Chrome). A used ticket cannot go back: the lifecycle trigger refuses `USED → VALID` and `USED → CANCELLED`, and ticket price, date, reference and type are immutable. Scans never change them.

## Scan records and privacy

Every attempt that reaches the code check gets one row in `ticket_scans` (append-only: the database refuses updates and deletes): the ticket id when the code identified one, the **12-character SHA-256 fingerprint** of the scanned text, the staff member, the gate, the time, the result, the precise code, the client address and (shortened) user agent.

- **The scanned text is never stored**, nor its signature, in any table or log. The fingerprint lets repeated attempts with the same code be recognised without being able to rebuild it. A test searches every table for the code and for its signature.
- Successful entries are also written to the audit log (`ticket.scanned`: ticket reference, gate, scan id). Refusals are in `ticket_scans` and in the structured log as a line with the code, reference and fingerprint only.
- A failure of the gate request itself (bad gate, no permission, rate limit) is not a scan and is not recorded as one.

## Rate limit

The scan route has its **own** limit, counted per client address and **configurable**: `SCAN_RATE_LIMIT_PER_MINUTE` (default 300, about five scans a second). It uses the existing throttler as a second named throttler that applies only to the scan route; that route is not counted by the general limit, and other routes do not use up the scan allowance. Behind a proxy set `TRUST_PROXY` so each gate is its own address. Guessing a code is not a realistic attack anyway (128-bit signature), so the limit mainly stops abuse and runaway clients. Tested with a limit of 6 (`429 RATE_LIMITED` on the 7th).

## The portal screen (`/scanner`)

Visible to anyone with `scans:create` (ticket staff, operations, administrators).

1. **Choose the gate** (only active gates are offered; the choice is remembered on that device; a gate that is switched off while someone is working sends them back to the picker).
2. **Camera**: the browser asks for the camera, reads QR codes about eight times a second with the small `jsqr` library, and sends the text to the server. It does not interpret or trust it. The camera is released when the screen is left or a newer start replaces it. If permission is refused, there is no camera or the page is not secure, a plain message says so and the manual entry remains.
3. **Manual entry**: a code box for typing, for pasting, or for a handheld scanner that types the code and presses Enter. It has the cursor whenever the screen is ready.
4. **Result**: a full-width panel. **ACCESS GRANTED** is green; everything else is red, starting with "ACCESS DENIED" and then the reason in capitals (TICKET ALREADY USED, WRONG VISIT DATE, TICKET CANCELLED, TICKET EXPIRED, INVALID TICKET, TICKET NOT FOUND …), then the ticket reference, visit date, type, gate and time. **Scan next ticket** has the focus.
5. **One at a time**: while a code is being checked or a result is on screen, nothing else is submitted. The camera does not re-submit a ticket still held in front of it for four seconds after its answer; a code someone typed is always deliberate.
6. **If the check itself fails** (network, server) the screen says **COULD NOT CHECK** and that the result is *not known*: the ticket may have been let in before the connection dropped, so the operator scans again, and sees "already used" if it went through. "Check again" retries without reloading.

## What is deliberately not in Phase 8

Scan history and statistics screens, entry analytics, staff-to-gate assignment, offline scanning, undoing an entry, manual override of a refusal, scanning for events or restaurants. (Future ideas, not built: a "recent scans" list on the scanner screen, per-gate counters, an optional "un-scan" with a reason and an audit entry, hardware-scanner debounce settings.)

## Known limits

- A copied QR (a screenshot) works until the first scan; the first scan wins (see `qr-security-review.md`).
- The rate limit is per client address, so many gates behind one address without `TRUST_PROXY` share an allowance.
- The date rule uses the server's idea of "now" (passed into the database function); servers should keep their clocks synchronized.
- Camera quality and lighting decide how fast a code is read; the manual entry is always available.
