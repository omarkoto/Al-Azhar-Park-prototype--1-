# Tickets, QR codes and delivery (Phase 7)

Phase 6 takes the order and the payment. Phase 7 turns a **paid order** into tickets the customer can use: a signed QR code, a PDF, a private page and an e-mail. Phase 8 reads the QR code at the gate and uses the ticket up: see [scanner.md](scanner.md).

```
PAID order ─▶ tickets VALID ─▶ QR (signed) ─▶ order page + PDF download
                         └────▶ confirmation e-mail (outbox, retried, never blocks payment)
```

## Ticket lifecycle

| Status | Meaning | Set by |
|---|---|---|
| `PENDING` | created with the order, **not usable**: no QR, no PDF, nothing in the e-mail | order creation |
| `VALID` | the order is paid; the QR is shown and the PDF contains it | payment confirmation |
| `USED` | admitted at the gate | the gate scan (Phase 8; a database constraint requires `used_at`) |
| `CANCELLED` | withdrawn by staff, with a reason | portal |
| `EXPIRED` | the order was not paid in time | the 30-minute expiry |

Allowed moves are enforced by a database trigger (`PENDING → VALID | CANCELLED | EXPIRED`, `VALID → USED | CANCELLED | EXPIRED`). **`CANCELLED → VALID` and `USED → VALID` are impossible**, even with hand-written SQL. There is no refunded status.

A ticket's reference, order, ticket type, audience, **visit date and price paid** are immutable (trigger); tickets cannot be deleted. The portal has no way to edit any of them after payment, and no "mark as paid" shortcut: an order becomes paid only through `PaymentsService.confirm()`.

## Paid order → tickets (finalization)

Phase 1 and 6 already create the order's tickets as `PENDING`, with their unguessable `TKT-…` references, the exact price paid and the visit date, in the order's own transaction. Phase 7 **finalizes** them when the payment is confirmed. Creating the rows up front means finalization is a single conditional update, which is what makes it idempotent:

```sql
-- inside the payment transaction, together with the payment and the order
UPDATE tickets SET status = 'VALID', issued_at = now(), qr_key_id = <active key> WHERE order_id = $1 AND status = 'PENDING';
```

A repeated or simultaneous confirmation finds nothing left to update and changes nothing: no second set of tickets, no new references. Proved by tests (8 parallel confirmations → one set of tickets, one e-mail). Only after the transaction commits is the e-mail queued.

## QR code security

Reuses the Phase 1 design (`common/security/ticket-qr.ts`); no second scheme.

```
AZP1.<ticket reference>.<key id>.<signature>            e.g. AZP1.TKT-8F3K2LQ7ZP.1.q3x…(22 characters)
signature = first 128 bits of HMAC-SHA256(key, "AZP1|<key id>|<ticket reference>"), base64url
```

- **No personal data.** The code holds only the reference, the key id and the signature: no name, e-mail, price or date. (The visit date is not in the code on purpose: whether a ticket may enter *today* is decided from the database, which cannot be altered by editing a QR.)
- **Cryptographically checked.** `QrService.verify()` rejects malformed text first (length, shape) before any crypto or database work, picks the key by id, and compares signatures in constant time. Only the one canonical spelling of a signature is accepted.
- **Tamper tests** (all fail): another ticket reference with the same signature, a changed reference character, an edited/truncated/extended signature, another ticket's signature replayed, a different key id, a different version, an appended date, lower case, padding, whitespace, empty or huge input.
- **Key rotation.** `TICKET_QR_KEYS` (JSON id → secret) and `TICKET_QR_ACTIVE_KEY_ID`; default is key 1 = `TICKET_TOKEN_PEPPER`. A ticket records the key that signed it (`tickets.qr_key_id`, set when it becomes valid), so after a rotation old tickets still verify; removing a key from the ring retires every ticket signed with it.
- **Nothing secret is stored.** The code is re-derived from the reference whenever it is shown, so it is deterministic and can always be displayed again.
- **Image.** PNG, error-correction level Q (about a quarter of the code may be damaged), 4-module quiet zone, whole-pixel modules, 600 px in the PDF and 360 px on the website. Tests decode the image with a QR reader library and verify the signature.

Presenting a code to the server, checking the ticket's status and date and marking it used is the gate scan (Phase 8): `ScansService` calls `QrService.verify()` and then claims the ticket atomically. See [scanner.md](scanner.md).

## Ticket PDF

`GET /public/orders/:orderNumber/tickets/pdf` (all valid tickets) and `GET /public/orders/:orderNumber/tickets/:ref/pdf` (one), optional `?lang=en|ar` (default: the language the customer ordered in). One A5 page per ticket: park name, order number, ticket reference, visit date, ticket type and audience, price paid, the QR code, the visitor instructions and the no-refund notice. A cancelled or used ticket would be stamped, but only valid (or used) tickets are listed.

- Built **only from the stored ticket records**; the request chooses at most a ticket and a language, so the price, date and type cannot be changed through it.
- English and **Arabic (right to left)** with the Cairo font (SIL Open Font License, in `backend/assets/fonts`). PDFKit joins Arabic letters but does not reorder mixed text, so `rtl-text.ts` lays out Arabic lines itself (Arabic words, numbers that still read left to right, mirrored brackets, word wrapping). The Arabic output was checked visually and by tests.
- **Private.** Never stored as media (no row in the media library, no file on disk: it is made on request), served as an attachment with `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.

## Private order access

Unchanged from Phase 6 and kept compatible: the page is `/orders/AZP-…#k=<key>`.

- The key is 256 random bits. The database stores only its HMAC hash (`order_access_tokens`); it expires 8 days after the visit date and can be revoked.
- It travels **in a header** (`X-Order-Token`), never in a query string, so it does not reach server or proxy logs; the part after `#` is not sent to any server at all. The site keeps it in this browser's storage too. The log redaction list includes the header.
- A wrong order number, a wrong, expired or revoked key and an order id all give the same `404`: nobody can learn which orders exist. Orders are looked up by their number plus the key, never by database id; the PDF routes use the same check, and a ticket reference only works inside its own order.
- Rate limits: 60 order views and 30 PDF downloads per minute per address.
- The key is never written to the audit log or the notification outbox.

## E-mail delivery

- **Provider abstraction** (`EmailProvider`): `log` (development only: prints the message, refused in production), `smtp` (any SMTP service: `EMAIL_SMTP_URL`, `EMAIL_FROM`; the URL is a secret and never logged), `none` (production default until configured: sending fails visibly and waits for a retry). `PUBLIC_SITE_URL` sets the address used in the link.
- **Outbox.** Messages are rows in `notifications` (existing table; Phase 7 added `dedupe_key` (unique) and `next_attempt_at`, and `orders.locale`). The confirmation has the key `order_confirmation:<order id>`, so repeating the payment confirmation can never queue a second one. The row holds the recipient, the order number and the language, **no secret**.
- **The link.** Each attempt creates a fresh private access key (hash stored) and puts `…/orders/AZP-…#k=<key>` in the e-mail. The e-mail itself carries the order summary and the rules: **never a QR, a signature or a ticket reference**; the link leads to the tickets and PDF. No attachment is sent (a link is safer and is always up to date; attaching PDFs can be added behind the same provider interface).
- **Failure never touches the payment.** Queueing happens after the payment transaction has committed and is wrapped so it cannot throw; a send failure marks the row `FAILED` with a short, credential-free error and schedules a retry (2, 4, 8, 16 minutes). After 5 attempts it stays failed until staff press *Resend*. A one-minute background job (`OrderExpiryScheduler`, off in tests) retries due messages.
- **No duplicates.** Each attempt is claimed with a conditional update, so two workers cannot send the same attempt; repeated confirmations are absorbed by the unique key. (If the process dies after the mail service accepted a message and before the row is marked sent, one retry would send it again: delivery is at-least-once.) A message is never sent for an order that is no longer paid.
- **Language.** English or Arabic (right to left), the language the customer used when ordering.

## Portal

| What | Permission |
|---|---|
| Order detail shows each ticket with its status and price | `tickets:read` |
| Cancel one ticket (reason required, audited `ticket.cancelled`; the order and its payment are untouched; not a refund; a used ticket cannot be cancelled) | `tickets:cancel` |
| Cancel the whole order (Phase 6) | `orders:cancel` |
| See e-mail status: sent, failed (attempt n of 5, next try / will not be retried, the error) | `notifications:read` |
| **Resend e-mail** (paid orders only; a new message, audited `order.email_resent`, with a fresh link; the first stays on record) | `tickets:resend` |

Seeded: ADMIN has all of these; OPERATIONS can read/cancel/resend but not see the delivery log; ANALYST can only read; TICKET_STAFF none.

## Wallet

The existing `AddToWallet` button and `lib/wallet.ts` are **kept and not shown on the order page**. Apple Wallet passes and Google Wallet "save" links must be signed with the park's own certificates/issuer account, which needs provider infrastructure that does not exist yet (the helper expects a server at `VITE_WALLET_API_URL`). Wallet is therefore **deferred**; it can be added later on top of the same signed QR credential without changing anything above.

## Audit

`ticket.cancelled`, `order.email_resent`, `order.cancelled`, `order.created`, `order.expired`, `payment.confirmed`/`failed`/`rejected`, price and ticket-type changes. Customer page views and PDF downloads are not audited. Never recorded: private order keys, QR payloads or signatures, SMTP credentials.

## Security review summary

| Scenario | Result |
|---|---|
| Guess another ticket reference / order id / order number | `404`, identical to a wrong key |
| Download another customer's PDF (their key, a made-up key, no key, key in the query string, a ticket of another order, path tricks in the reference) | `404` |
| Modify the QR (ticket id, signature, key id, add a date) / replay another ticket's signature | verification fails |
| Repeat payment confirmation / repeat finalization (also 8 at once) | one set of tickets, one e-mail |
| Repeat e-mail sending (repeated confirmation, two workers on one attempt) | one message |
| E-mail outage | payment and tickets unaffected; failure recorded; retried; visible to staff |
| Tickets for an unpaid, expired or cancelled order | no QR, no PDF, no e-mail |
| Edit a paid ticket's price, date or reference | refused by the database |

## What Phase 7 left for Phase 8 (now built)

QR scanning and the scanner screen, the gate check (existence, status, visit date, already used) and marking a ticket `USED` are documented in [scanner.md](scanner.md). Gate analytics are still not built.

## Known limits

- No PDF attachment in the e-mail (link only).
- Wallet passes are deferred (above).
- The customer's private link is the only way back to a ticket; a customer who loses the e-mail and the browser data needs the park to resend it from the portal.
- Order e-mails are in the language of the order; the PDF can be downloaded in either.
