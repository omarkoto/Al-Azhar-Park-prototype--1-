# Authentication and authorization (Phase 2)

Portal staff sign in with e-mail and password. Everything except the public routes is closed by default.

## Sign-in flow

```
POST /auth/login ──► access token (JWT, 15 min)  +  refresh token (opaque, 7 days)
                           │                              │
      Authorization: Bearer │                              │ httpOnly cookie  (or JSON body if the
                           ▼                              ▼   client sends  X-Token-Delivery: body)
                     every API call              POST /auth/refresh ──► NEW access + NEW refresh token
                                                       (the old refresh token is now dead)
POST /auth/logout  ──► ends this session          POST /auth/logout-all ──► ends every session
```

- **Access token**: HS256 JWT, issuer and audience checked, algorithm pinned. Claims: `sub` (user), `tv` (token version), `sid` (session). It carries **no roles or permissions**.
- **Every request** re-reads the user, `isActive`, `tokenVersion`, the session and the user's *current* permissions from PostgreSQL. So deactivating a user, ending a session or editing a role takes effect on the very next request, not 15 minutes later.
- **Refresh token**: 256 random bits, stored only as an HMAC-SHA256 hash (keyed with `JWT_REFRESH_SECRET`). Delivered as an `HttpOnly`, `SameSite=Strict`, host-only cookie limited to the path `/api/v1/auth`; in production it is also `Secure` and named `__Secure-azp_refresh`. Body delivery (`X-Token-Delivery: body`) is an optional development/non-browser mode.
- **Session lifetime**: access token 15 min; each refresh token 7 days (rotated on use); **absolute session maximum 30 days** (`SESSION_MAX_DAYS`). Every rotated token inherits the original login time (`refresh_tokens.session_started_at`, immutable in the database), a token never outlives the session end, and after 30 days the refresh is refused, the session is revoked (`auth.session.expired`) and the user must sign in again.
- **Rotation + reuse detection**: each refresh token works once. Using it revokes it and issues a successor in the same *family* (= one login session). Presenting an already-rotated token means a copy leaked, so the **whole family is revoked** (including the newest token and the access token tied to it) and `auth.token.reuse_detected` is audited. Two simultaneous refreshes with one token: exactly one wins and the session is then closed. A token that was merely logged out is *not* treated as theft.

## Production architecture (website, portal, API)

```
alazharpark.com          public website  ─┐  browser calls with fetch(..., credentials: 'include')
admin.alazharpark.com    portal           ├─► api.alazharpark.com  (CORS_ORIGINS = both origins, https only)
                                          ┘
```

All three share the registrable domain, so the browser treats them as **same-site**: a `SameSite=Strict` cookie set by the API host is sent when the portal calls the API. Nothing is weakened for this:

- the cookie is host-only (no `Domain`), so only `api.alazharpark.com` ever receives it, and only on `/api/v1/auth/*`;
- CORS is an explicit https allow-list (no wildcard; production refuses an `http://` origin), with credentials;
- a cookie-borne `refresh`/`logout` from a browser whose `Origin` is not on the list is refused (`ORIGIN_NOT_ALLOWED`), a second defence besides SameSite;
- the access token travels in the `Authorization` header (never a cookie), so it cannot be forged by cross-site requests;
- if the portal were ever hosted on a different registrable domain, `SameSite=Strict` would stop working by design. That would need a deliberate redesign (not a quiet downgrade to `SameSite=None`).

Behind a reverse proxy set `TRUST_PROXY` to the number of proxy hops so rate limiting and the audit log see real client addresses.

## Account protection

| Measure | Behaviour |
|---|---|
| Password hashing | Argon2id (`@node-rs/argon2`, m=19 MiB, t=2, p=1) |
| Password policy | 12–128 chars, not a common password, not repetitive, must not contain the e-mail name or the person's name |
| Brute force | per-address throttle (login 10/min, forgot 5/min, reset 10/min, refresh/logout 30/min) **and** per-account lock: 5 wrong passwords → locked 15 min |
| Enumeration | wrong password, unknown e-mail, locked and inactive accounts all return the same `INVALID_CREDENTIALS`; an unknown e-mail still pays one Argon2 verification; `forgot-password` always answers identically |
| Password change / reset | every session ends and every access token dies (`tokenVersion` bumped) |
| Reset tokens | 30 min, single use, stored hashed, newest link only, one per minute per account, none for inactive accounts |
| Logging | passwords, tokens, cookies and `Authorization` are redacted; a password typed into the e-mail box is not audited |

The password-reset e-mail is sent through a `PasswordLinkNotifier`. **No e-mail provider exists yet** (notifications phase): in development the token is logged; in production a warning is logged and nothing is sent. The e-mail provider abstraction is built in the later notifications phase; no stand-in production e-mail system is provided.

## Authorization

Permissions are `resource:action` strings (46 seeded). **Code never compares role names.**

- Global guards, in order: throttler → `JwtAuthGuard` (authentication) → `PermissionsGuard` (authorization).
- `@Public()` opts a route out. `@RequirePermissions('a:b', 'c:d')` needs **all** listed. `@AnyAuthenticated()` = any signed-in user.
- **Fail closed**: a route with none of those annotations is refused (403) even for a super administrator, so a forgotten annotation can never expose an endpoint.
- A user's permissions are the union over their roles. Roles are data: a new role works as soon as it has permissions.
- **Anti-escalation**: you can only grant a role, or manage a person, whose permissions you already hold. ADMIN therefore cannot create a SUPER_ADMIN or touch one. You cannot deactivate yourself or change your own roles. (The seed guarantees ADMIN covers every role except SUPER_ADMIN, tested.)
- Deactivating a user, or changing their roles, ends all their sessions immediately.

| Role | Intent |
|---|---|
| SUPER_ADMIN | everything (all permissions, including `roles:write`, `settings:write`) |
| ADMIN | users, content, pricing, ticketing, analytics; no role/system-settings management |
| OPERATIONS | orders, tickets, scanning, operational analytics, hours/events |
| TICKET_STAFF | scan tickets and sell at the booth only |
| CONTENT_MANAGER | website content only |
| ANALYST | read-only |

## Endpoints

| Method and path | Access | Purpose |
|---|---|---|
| POST `/auth/login` | public, 10/min | sign in |
| POST `/auth/refresh` | public, 30/min | rotate refresh token, new access token |
| POST `/auth/logout` | public, 30/min | end this session (idempotent) |
| POST `/auth/logout-all` | signed in | end every session |
| GET `/auth/me` | signed in | profile, roles, effective permissions |
| POST `/auth/change-password` | signed in, 10/min | change own password (ends all sessions) |
| POST `/auth/forgot-password` | public, 5/min | request a reset link (always the same answer) |
| POST `/auth/reset-password` | public, 10/min | set a password with a reset/invite token |
| GET `/users`, GET `/users/:id` | `users:read` | list (search, role, active, paging) / read |
| POST `/users` | `users:write` | invite: random unusable password + one-time link |
| PATCH `/users/:id` | `users:write` | change name |
| POST `/users/:id/activate` · `/deactivate` | `users:write` | activate / deactivate |
| PUT `/users/:id/roles` | `users:write` | replace roles |
| POST `/users/:id/send-password-reset` | `users:write` | send a reset link |
| GET `/roles` | `roles:read` | roles with permissions and user counts |
| GET `/permissions` | `permissions:read` | permission catalogue |

## Audit events (append-only `audit_logs`)

`auth.login.success|failed|locked|blocked`, `auth.logout`, `auth.logout_all`, `auth.token.refreshed`, `auth.token.reuse_detected`, `auth.password.changed`, `auth.password.reset_requested|reset_completed`, `user.created|updated|activated|deactivated|roles_changed|password_reset_sent`. Each row has actor, entity, IP, user agent and request id. No secrets are ever stored.

## Known limits

- Sign-in lock is per account (counter resets when the lock starts), plus per-IP throttling. Throttle counters are in memory (one server); a Redis store is needed before running several instances.
- Expired token rows are not purged yet (a scheduled clean-up arrives with the jobs phase).
- No multi-factor authentication.
