# Privacy and data handling — technical controls

> This document describes the **technical** controls built into the system. It is not legal advice and it does **not** claim legal compliance (for example with Egypt's Personal Data Protection Law, No. 151 of 2020). The privacy notice text, retention periods, lawful basis and responsibilities must be decided and reviewed by the park's legal/compliance owner — see *Needs a policy decision* below.

## Data minimisation — what is collected

| Subject | Stored | Not stored |
|---|---|---|
| Ticket customer (guest, no account) | full name, email (optional for counter sales), phone (optional), country (optional) | passwords, ID/passport numbers, date of birth, address, payment card numbers |
| Contact form / reservation request | name, email, phone (optional), message | anything else |
| Portal staff | name, work email, password hash (argon2id), role | personal phone/address |
| Scans | which ticket (when the code identified one), a 12-character fingerprint of the scanned text (never the text itself), which staff member, gate, time, precise result, device/IP (for abuse investigation) | the customer's identity is reached only through the ticket |

- **QR codes carry no personal data** (only a ticket reference + signature).
- **Card data never touches this system**: online payments will be handled entirely by the payment provider; only a provider transaction id, amount and status are kept.
- Residency (Egyptian/resident vs visitor) is stored as the *ticket audience* because it determines the price — not as a nationality field.

## Consent and notice
`customers.privacy_notice_version` + `consented_at` (and the same version on contact messages) record **which notice version** the person accepted and when. The notice text itself is managed outside the code (the current version label is the system setting `privacy.noticeVersion`, seeded as `draft-0`).

## Access control
- Server-side RBAC with permissions; personal data is behind `customers:read` / `orders:read`. Ticket staff see only the fields needed at the gate (`tickets:read_entry`). Analysts do not get customer details.
- Customers reach their own order/tickets only through **expiring, hashed access tokens** — never predictable ids.
- Admin APIs are never reachable without authentication; every portal endpoint is guarded.

## Reports and exports (Phase 10)
- Analytics reports and CSV exports hold **aggregates only**: counts and amounts grouped by date, ticket type, audience, gate or scan result. They contain no customer names, e-mails, phone numbers, order numbers, ticket references, QR text, token fingerprints, scanner users or IP addresses, so exporting does not export personal data. Anonymising a customer changes no report figure.
- Access follows the existing analytics permissions: `analytics:read` (all, including money), `analytics:operations` (entry and ticket states, no money), `analytics:content` (event statistics). Every export is audited (`analytics.exported`) with the report, period and filters, never the data. See [analytics.md](analytics.md).

## Logging and audit
- Application logs redact passwords, tokens, cookies and `Authorization` headers (`REDACTED_PATHS`).
- `audit_logs` records who did what (including price changes, manual payments, cancellations, privacy actions). It is **append-only by database trigger**.
- `data_requests` records every access / deletion / anonymisation request and who handled it.

## Retention, deletion and anonymisation (mechanism)
- **Order, payment, ticket and scan records are kept** (accounting and entry history; the database refuses deletion). Personal fields can be **anonymised** instead: set `customers.full_name` to a placeholder, blank `email`/`phone`/`country`, set `anonymized_at`. Orders and tickets keep their prices and dates, so revenue and attendance figures stay correct. (Proven in `integrity.db-spec.ts`.)
- Contact messages and reservation requests have no financial role and can be deleted outright when a retention period ends.
- A scheduled retention job (Phase 11) will apply whatever periods are approved; until then **nothing is auto-deleted**.
- Refresh tokens, password-reset tokens and expired access tokens are short-lived rows that can be purged routinely.

## Transport and storage
TLS terminates at the reverse proxy / hosting platform (HSTS header already set). Passwords: argon2id. Secrets only via environment variables, validated at boot, never committed. Database backups must be encrypted and access-controlled (deployment, Phase 12).

## Needs a policy decision (leave to legal/compliance review)
1. Privacy notice and consent wording (Arabic and English) and where it is shown at checkout.
2. Retention periods for orders/tickets (anonymise after N months/years?), contact messages, scan device/IP data, audit logs.
3. Lawful basis and responsibilities (controller / processor roles, any data-protection officer, registration obligations).
4. Cross-border considerations if hosting or the e-mail provider is outside Egypt.
5. The customer-request process (who receives requests, response time, identity verification).
6. Whether phone is required for online purchases.
