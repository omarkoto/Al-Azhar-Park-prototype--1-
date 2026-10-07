# Ticketing — design decisions

Phase 1 delivered the data model and its guarantees. Online purchase, pricing and orders are implemented in Phase 6 (see [Online purchase](#online-purchase-phase-6)); tickets with QR codes/PDF and e-mail are Phase 7, scanning is Phase 8.

## Channels and payment

| | ONLINE | COUNTER_SALE |
|---|---|---|
| Who creates it | the customer, on the website | a staff member at the booth (portal) |
| Initial order status | `PENDING_PAYMENT` | `PAID` (created and paid in one action) |
| Payment | provider-agnostic `PaymentProvider` (Paymob later). **Never marked paid unless the provider confirms.** No fake gateway | `CASH`, recorded by the staff member (`payments.recorded_by`) |
| Tickets | created `PENDING`; become `VALID` when the order is `PAID` | created `VALID` immediately |
| Customer data | name + email (+ phone optional) | optional |

A pending online order **expires** after `orders.pendingExpiryMinutes` (system setting, default 30): the order becomes `EXPIRED` and its tickets `EXPIRED`.

### Counter-sale screen (Phase 7/9)
Deliberately minimal for use under time pressure: **Adult / Child · Egyptian-resident / Visitor · visit date · quantity → total → Cash → Generate → Print/download.**
One server transaction: price lookup → order (`COUNTER_SALE`, `PAID`) → cash payment → `VALID` tickets → audit entry.
Needs only the `counter-sales:create` permission, which `TICKET_STAFF` has. It does **not** give access to prices, other orders or settings (there are no refunds). Marking an *existing* order as paid is a different permission (`payments:record_cash`, held by ADMIN/OPERATIONS only). Every manual payment is written to the audit log.

## Prices
See [`database.md`](database.md#pricing-model). The server **always** recomputes the price; whatever the browser shows is only a preview and the client-supplied price is ignored. The price used is copied onto the order item and the ticket.

## Online purchase (Phase 6)

The website sells tickets through the API; the portal manages ticket types, prices and orders. **Everything about money and dates is decided on the server**; the website only sends *a visit date, an audience and a quantity per ticket type*, and displays what comes back. Phase 6 builds no PDF, QR image, e-mail, wallet pass or scanning (Phases 7–8).

### Business rules as implemented

| Rule | Where it is enforced |
|---|---|
| Adult = 9+, Child = 2–8; **under 2 free, no ticket, no 0 EGP ticket** | `ticket_types.min_age >= 2` (CHECK); the API and the portal form refuse a type below 2; there is no under-2 type to choose; every amount is `> 0` (CHECK) |
| Resident (`RESIDENT`) vs non-resident (`VISITOR`) prices; weekday Sun–Thu, weekend Fri–Sat | `ticket_prices` rows (`dow_mask` 31 / 96) read by `selectPrice()` — **no price is written in code** |
| Visit date: not in the past, at most **90 days** ahead (`booking.maxAdvanceDays`), park open that day | `evaluateSale()` over the opening-hours tables → `DATE_IN_THE_PAST`, `DATE_TOO_FAR_AHEAD`, `PARK_CLOSED` |
| Same-day sales stop **1 hour before closing** (`booking.sameDayCutoffMinutesBeforeClose`); exclusive: 21:00:00 is closed, 20:59:59 open | the same function, using today's weekly or special hours → `SALES_CLOSED_FOR_TODAY` |
| Unpaid orders expire after **30 minutes** (`orders.pendingExpiryMinutes`) | `OrderLifecycleService` (see *Expiry*) |
| Most tickets in one order: 50 (`booking.maxTicketsPerOrder`) | `TOO_MANY_TICKETS` |
| Capacity: unlimited (`capacity.dailyLimit` = null); a number switches the check on | `SOLD_OUT`; one buyer per day at a time while a limit is on (advisory lock) |
| **Price immutability**: the price paid is copied onto the order item and each ticket and never recalculated | `order_items` and `tickets` price columns are write-once (triggers); `ticket_prices` rows cannot be edited or deleted (trigger) |
| **No refunds** | no refund endpoint, status or permission; `REFUNDED` is refused by CHECK + trigger |
| A ticket is valid only on its visit date | `tickets.visit_date` (immutable) — the scan rule is Phase 8 |

### Public API (no login)

| Endpoint | Purpose |
|---|---|
| `GET /public/tickets/catalog[?date=]` | audiences, ticket types, booking rules, the price list, and — for a date — opening hours, whether it can be booked (and why not) and the prices that apply that day. `Cache-Control: no-store` |
| `POST /public/orders/quote` | prices a selection. Body: `visitDate`, `audience`, `items: [{ticketType, quantity}]`. **Unknown fields (a price, a total) are rejected, not ignored** |
| `POST /public/orders` | creates the order. Adds `customer {fullName, email, phone?}`, `acceptTerms: true`, `locale`. Optional `Idempotency-Key` header. Returns the order, the **access key** (shown once) and the payment to make. 10 per minute per address |
| `GET /public/orders/:orderNumber` | the customer's own order; needs the key in header `X-Order-Token`. A wrong number, wrong/expired/revoked key all give the same `404` |
| `POST /public/orders/:orderNumber/payments` | start or resume payment for an unpaid order (a new attempt after a failed one) |
| `POST /public/payments/mock/:txnId/complete` | **development only**; does not exist (404) unless the mock provider is on |

Error codes the website explains to the visitor: `DATE_IN_THE_PAST`, `DATE_TOO_FAR_AHEAD`, `PARK_CLOSED`, `SALES_CLOSED_FOR_TODAY`, `INVALID_TICKET_TYPE`, `INVALID_AUDIENCE`, `PRICE_NOT_AVAILABLE`, `TOO_MANY_TICKETS`, `SOLD_OUT`, `PAYMENT_NOT_AVAILABLE`, `IDEMPOTENCY_KEY_REUSED`, `ORDER_EXPIRED`.

### How an order is created

One database transaction: re-check the date → read the audience and ticket types (must be active) → choose each price with `selectPrice()` (a ticket with no price **cannot** be sold; never for 0) → capacity check (only when a limit is set) → customer (name, e-mail, optional phone, the privacy-notice version and the time they agreed) → order number `AZP-<year>-<6 digits>` from `reference_counters` → order `PENDING_PAYMENT` with `expires_at = now + 30 min` → one order item per ticket type (names and **exact unit price** copied) → one `PENDING` ticket per person (unguessable `TKT-` reference) → access key (only an HMAC hash is stored). If anything fails, nothing is kept. Then a payment attempt is started for exactly the order total.

`Idempotency-Key`: a repeated request with the same key and the same content returns the same order (`200`, with a fresh access key); with different content it is refused (`409`). Two simultaneous requests with one key create one order.

### Payment and its lifecycle

```
order   PENDING_PAYMENT ──paid──▶ PAID ──admin cancel──▶ CANCELLED
              │ └──admin cancel──▶ CANCELLED
              └──30 minutes──────▶ EXPIRED            (CANCELLED and EXPIRED are final; no REFUNDED)
payment PENDING ──▶ PAID | FAILED | CANCELLED          (amount, currency, provider are immutable)
ticket  PENDING ──▶ VALID | CANCELLED | EXPIRED         (VALID → USED is a Phase 8 scan)
```

`PaymentProvider` is the only seam to a payment company: it starts a payment for an exact amount (`createCharge`); the company's answer comes back through `PaymentsService.confirm()` which never trusts it blindly:

- unknown payment → `404`; names a different order → `409 ORDER_MISMATCH`; amount or currency differs from the order → `409 AMOUNT_MISMATCH` (stays unpaid). Each refusal is audited as `payment.rejected`;
- already paid → `200 ALREADY_PAID`, nothing changes (duplicate confirmations are harmless); failed/cancelled/expired payments can **never** become paid;
- the order must still be waiting and not expired; the payment, the order and the tickets change in one transaction using conditional updates, so ten simultaneous confirmations produce exactly one transition (proved by a test);
- a failed payment leaves the order waiting, so the customer can try again until it expires.

**Mock provider (development only).** `PAYMENT_PROVIDER=mock` (the default outside production) lets a tester press "pay" or "fail" on the order page. The page labels it "development only", it takes no money, and **production refuses to start with it** (the environment check). With `PAYMENT_PROVIDER=none` (the production default today) the catalog says `onlinePayment: false` and `POST /public/orders` returns `503 PAYMENT_NOT_AVAILABLE` — there is no fake gateway in production. **Adding Paymob later** = one `PaymentProvider` subclass plus a webhook endpoint that verifies Paymob's signature and calls `confirm()` with the amount it reports; no order code changes.

**Expiry.** An unpaid order past `expires_at` becomes `EXPIRED` (tickets `EXPIRED`, waiting payment `CANCELLED`, audit `order.expired`). It happens when the order is read, when a payment is confirmed, and by a one-minute background sweep; correctness never depends on the sweep. Expired tickets stop counting towards capacity. If a provider reports success for an order that has already expired, the confirmation is refused (`ORDER_EXPIRED`, audited) and the payment is *not* recorded as paid — a real provider's late payment would then need manual reconciliation (see known limits).

### Portal

| Page | Permission | What |
|---|---|---|
| Orders | `orders:read` | search (order number; name/e-mail/phone only with `customers:read`), filter by status and visit date, detail (items, amounts, visit date, payments with `payments:read`, tickets with `tickets:read`, customer with `customers:read`) |
| Cancel an order | `orders:cancel` | needs a reason (min. 5 characters); allowed for an unpaid or paid order with no used ticket; its tickets stop working; records who, when and why; audit `order.cancelled`. **It is not a refund** — the payment record stays as it was and nothing is paid back |
| Ticket types | `ticket-types:read` / `ticket-types:write` (new) | create, rename, switch on/off, reorder. Never deleted. Age range must be 2+, must not overlap another active type, and is **locked once the type has been sold** |
| Ticket prices | `pricing:read` / `pricing:write` | what visitors pay now (weekday/weekend per audience and type), full history with status (current / upcoming / ended / switched off) and how often each price was sold |

**Changing a price never edits a row.** "Add a new price" creates a row starting on a chosen date (today or later) and ends the previous row with the same days the day before. Amounts cannot be edited and rows cannot be deleted — a database trigger refuses both. A price can be switched off and on; the database refuses two active prices that cover the same ticket, audience, day and date (an exclusion constraint for identical day sets plus a trigger for day sets that merely share a day, with a per-ticket advisory lock so two editors at once cannot both succeed). Orders keep the price they were sold at, whatever happens to the price list afterwards.

Audit actions: `order.created`, `order.expired`, `order.cancelled`, `payment.confirmed`, `payment.failed`, `payment.rejected`, `price.created`, `price.activated`, `price.deactivated`, `ticket_type.created`, `ticket_type.updated`, `ticket_type.activated`, `ticket_type.deactivated`, `ticket_type.reordered`.

### Website

- **Visit page** — the ticket builder (audience, date limited to today…+90 days, quantities per ticket type) shows the day type, opening hours, today's cut-off time, any reason a date cannot be booked, and the prices the server returns for that date. The static price table is replaced by the live price list when the API answers.
- **Plan my day** — uses the same prices and rules.
- **Cart** — remembers *what* was chosen (audience, ticket type, quantity, date), never an authoritative price. One order is for one date and one audience.
- **Checkout** — asks the server for a fresh quote, collects name, e-mail, optional phone and the booking terms (valid only on the selected date, non-refundable), then places the order. A repeat press cannot create a second order (idempotency key).
- **Order page** (`/orders/AZP-…#k=…`) — the private key is kept in the address and in the browser. It shows the payment countdown, the (development) payment buttons, then the tickets (references only — QR and PDF come later), the visit date and the rules. It also shows an expired or cancelled order, and "not found" without the key.
- Every notice (free under 2, valid only on the chosen date, no refunds, 30-minute hold) is shown before payment. English and Arabic (right to left, Arabic digits).
- When the API is not configured or cannot be reached, booking is **switched off with a clear message** — the previous demo "confirmation" that pretended to reserve tickets is gone.

### Known limits

- A payment that a real provider takes **after** the order expired cannot be applied automatically (the lifecycle forbids it); it needs manual reconciliation in the provider's dashboard. The mock provider cannot hit this.
- The customer's access key is the only way back to an order until e-mail delivery exists (Phase 7); losing the page and the browser data loses the way in.
- No discount or promo-code input yet (the price model supports special-date and promotional rows, the purchase does not offer them).
- Rate limits are per address; behind a proxy `TRUST_PROXY` must be set so the real address is seen.

## Ticket identity, QR code and customer access

- Ticket reference `TKT-XXXXXXXXXX`: random, unguessable, shown to the customer. The database UUID is never exposed.
- **QR payload:** `AZP1.<ticket reference>.<signature>` where `signature = base64url(HMAC-SHA256(key, "AZP1|" + reference))` truncated.
  - It contains **no customer data**.
  - Forging a QR needs the server key (`TICKET_TOKEN_PEPPER`); knowing or guessing a reference is not enough.
  - `tickets.qr_key_id` records which key signed it, so keys can be rotated without invalidating old tickets.
  - Nothing secret is stored, so the QR can always be shown again.
- **Customer access without an account:** after purchase the API returns an **order access token** (random, expiring, stored only as a hash in `order_access_tokens`) used in a link such as `/tickets/view?token=…`. It shows the ticket(s), QR, order details and the PDF download — immediately after payment, and again later from the link. Email is an *additional* delivery channel, never the only one. A lost link can be re-issued (previous tokens are revoked).

## Scanning (Phase 8)

```sql
UPDATE tickets
   SET status = 'USED', used_at = now(), used_by_id = $staff
 WHERE id = $id AND status = 'VALID' AND visit_date = azharpark_today()
RETURNING id;      -- exactly one row ⇒ this scan admitted the visitor
```
- Claim and the `ticket_scans` row are written in one transaction. Zero rows ⇒ the ticket is refused with the specific reason (`ALREADY_USED`, `CANCELLED`, `EXPIRED`, `WRONG_DATE`, `NOT_PAID`, or `NOT_FOUND`/`INVALID_TOKEN` for unknown or forged codes). Every attempt is recorded, including invalid ones.
- **Proved in Phase 1** against real PostgreSQL: 50 simultaneous claims on one ticket ⇒ exactly one succeeds; 40 simultaneous staff scans ⇒ 1 `VALID` + 39 `ALREADY_USED`, all 40 attempts recorded; 20 tickets × 3 scanners ⇒ each ticket admitted exactly once; cancel-vs-scan races end in exactly one terminal state.
- The ticket lifecycle trigger makes `USED → VALID` impossible even by hand.

## Open questions (defaults assumed until you decide)

(Maximum advance booking = 90 days and children under 2 = free, no ticket, are decided — see the final rules below.)

- Rescheduling (default: not supported in v1).
- Production email provider and sender domain.

## Final business rules (decided)

1. **Children under 2 need no ticket.** No 0 EGP ticket exists: `ticket_types.min_age >= 2` and every amount (price, order, item, payment, ticket) is `> 0` by CHECK constraint.
2. **No daily capacity limit now.** Setting `capacity.dailyLimit` is `null` (unlimited). Setting a number enforces it for PENDING/VALID/USED tickets of that visit date; cancelling frees a place. No schema change is needed.
3. **Same-day sales stop 1 hour before closing**, computed from the configured opening hours (`opening_hours` + `special_hours`) and `booking.sameDayCutoffMinutesBeforeClose` (60). Closing 22:00 → last sale 20:59:59.
4. **No refunds.** `REFUNDED` cannot be inserted or reached (CHECK + trigger) and there is no refund permission. An admin can cancel an order or ticket with a reason; the recorded payment stays `PAID` and the system never moves money.
5. **A ticket is valid only on its visit date** (Africa/Cairo). The scan claim includes `visit_date = azharpark_date_of(now())` so it is enforced atomically in the database.
6. **Opening hours** default to 09:00–22:00 every day; each weekday, holiday, Ramadan period or closure is data editable from the portal.

Proved by `backend/test/db/business-rules.db-spec.ts` and the pure rule specs in `backend/src/modules/ticketing/rules/`.
