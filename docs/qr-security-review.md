# QR code security review (Phase 1)

Scope: the QR payload scheme in `backend/src/common/security/ticket-qr.ts`, ticket references, and the scan claim.

## Design
- Payload: `AZP1.<ticket ref>.<key id>.<signature>`. Signature = first 128 bits of HMAC-SHA256 over the string `AZP1|<key id>|<ticket ref>` (the version tag keeps it separate from other uses of the secret), base64url, 22 characters.
- Nothing secret is stored: the signature is recomputed from the ticket reference and the server key. `tickets.qr_key_id` records which key signed it, so keys can be rotated without invalidating old tickets.
- The signature only proves the code was issued by us. **It is not authorization**: entry still requires the database check (status VALID, visit date today, atomic claim).

## Findings
| # | Topic | Result |
|---|-------|--------|
| 1 | Forgery | HMAC-SHA256 with a server secret; 128-bit tag is not guessable. OK |
| 2 | Comparison | `timingSafeEqual`; length checked first. OK |
| 3 | Malleability | **Found and fixed**: base64url of 128 bits has spare bits, so several spellings decoded to one signature. Verification now requires the canonical encoding; tested that exactly one spelling is accepted. |
| 4 | Parsing | Max 64 chars and a strict regex run before any database access, so junk never reaches SQL. OK |
| 5 | Ticket reference entropy | 10 Crockford base32 chars = 50 bits, generated with a CSPRNG, unbiased (256 % 32 = 0). The signature, not the reference, is what protects against guessing. OK |
| 6 | Replay / screenshots | A copied QR works until the first scan; the first scan wins atomically and later ones are refused (`ALREADY_USED`). Proved with 50 parallel claims. Residual risk: someone who scans a copy before the real holder. Mitigations: gate staff see ticket details; optional holder name. |
| 7 | Wrong date | Enforced in the same atomic UPDATE, DST-aware. OK |
| 8 | Key rotation | Key ring by id; unknown or retired ids are rejected. OK |
| 9 | Logging | Only a 12-hex SHA-256 fingerprint of a payload is stored in `ticket_scans`, never the full code. OK |
| 10 | Abuse of the scan endpoint | **Built in Phase 8**: `POST /scans` needs `scans:create` (fail closed), has its own configurable per-address rate limit (`SCAN_RATE_LIMIT_PER_MINUTE`), validates the gate, and rejects malformed codes before any ticket lookup. See [scanner.md](scanner.md). |
| 11 | Key used for a code (Phase 8) | The key id in a scanned code must be the key that signed that ticket (`tickets.qr_key_id`); a genuine signature made with another key of the ring does not open it. |

## Conclusion
No open defects in the Phase 1 scheme. Item 10 (the scan endpoint) was delivered in Phase 8.
