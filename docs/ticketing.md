# Ticketing — design decisions

Phase 1 delivered the data model and its guarantees. The flows below are implemented in Phases 6–8.

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

- Maximum advance booking (default 90 days; setting `booking.maxAdvanceDays`).
- Children under 2 (the website says child = 2–8).
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
