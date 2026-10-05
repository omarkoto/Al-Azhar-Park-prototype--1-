# Park CMS and staff portal (Phase 3)

Staff edit the park's contact details, opening hours and headline information in the **portal**; the **public website** reads them from the API. Nothing about these values is hard-coded in the website any more (the built-in text remains only as a fallback).

```
portal (admin.alazharpark.com) ──PUT /park /contact /opening-hours /special-hours──►  API  ──►  PostgreSQL
public website (alazharpark.com) ◄────────────── GET /public/site (cache 60 s) ──────┘
```

## What is editable

| Area | Fields | Permission (read / write) |
|---|---|---|
| Park information | name, tagline, description (EN + AR), up to 8 statistics (value + EN/AR label) | `park:read` / `park:write` |
| Contact | address EN/AR, up to 6 phones, fax, e-mail, Google Maps link, latitude/longitude, 6 social links | `contact:read` / `contact:write` |
| Weekly hours | per weekday: opens, closes, or closed | `hours:read` / `hours:write` |
| Special hours | holiday, special hours (Ramadan…), temporary closure: dates, hours, EN/AR name and note, priority, active | `hours:read` / `hours:write` |
| Roles | create/rename roles, assign permissions | `roles:read` / `roles:write` |

Seeded access: CONTENT_MANAGER edits all four content areas; OPERATIONS edits hours; ADMIN edits everything except roles; SUPER_ADMIN everything; ANALYST can only view park information; TICKET_STAFF has none.

## One source of truth for hours

The weekly and special hours are the **same tables the ticket-sales rules read**. Changing Friday's closing time to 23:30 moves the same-day cut-off to 22:30; adding a closure makes that date unbookable. This is proved by tests (`park.e2e-spec.ts`, `business-rules.db-spec.ts`).

- Special periods: when several cover a day, the highest `priority` wins. Two **active** periods with the **same priority** may not share a day (409 `SPECIAL_HOURS_OVERLAP`); this is enforced by the API and by a database exclusion constraint, so two simultaneous edits cannot both succeed.
- A temporary closure is always closed. A day open means opens < closes (same day, 24-hour times, no overnight).
- Times are the park's wall-clock time (Africa/Cairo); a date's day is its Cairo day.

## API

| Endpoint | Access | Notes |
|---|---|---|
| GET `/public/site` | public | park, contact, weekly hours, all active special periods that have not ended yet (no look-ahead limit), today's resolved hours. `Cache-Control: public, max-age=60`. No ids, priorities or editor identities |
| GET/PUT `/park` | `park:read` / `park:write` | PUT replaces the whole record |
| GET/PUT `/contact` | `contact:read` / `contact:write` | empty strings become null |
| GET/PUT `/opening-hours` | `hours:read` / `hours:write` | PUT needs all 7 days |
| GET `/special-hours?when=upcoming\|past\|all`, POST, PUT/DELETE `/special-hours/:id` | `hours:read` / `hours:write` | |
| GET `/roles`, `/roles/:id`, `/permissions` | `roles:read`, `permissions:read` | the portal builds its role editor from this catalogue |
| POST `/roles`, PATCH `/roles/:id`, PUT `/roles/:id/permissions`, DELETE `/roles/:id` | `roles:write` | see below |

Validation (Zod, server-side; the portal only displays the messages): phone = digits/space/`+()-`, 6–25 chars, no duplicates; e-mail valid; map link `https` on google.com / goo.gl / maps.app.goo.gl; latitude −90…90 and longitude −180…180, together or not at all; social links `https`; text without control characters; lengths bounded. The database repeats the critical rules as CHECK constraints (coordinates, https map link, ≤ 6 phones, hours order, label not blank, priority 0–100, closures closed, no overlap).

**Audit** (append-only): `park.updated`, `contact.updated`, `hours.weekly_updated`, `hours.special_created|updated|deleted`, `role.created|updated|permissions_changed|deleted`, each with actor, request id, and old/new values. Failed validation writes nothing.

## Role and permission management

- Roles are data. `PUT /roles/:id/permissions` replaces a role's permissions; because every request re-reads permissions from the database, the change applies to every holder on their **next request**, with no re-login (tested).
- Rules: you may only grant permissions you hold yourself; you may not edit a role containing permissions you lack; built-in roles can be edited but not deleted; a role with holders cannot be deleted; the role code never changes; the last way to hold `roles:write` cannot be removed (409 `LAST_ADMINISTRATOR`, inactive users do not count).
- The portal does not hard-code the 46 permissions: it loads `/permissions` and groups them by resource.

## Public website integration

`src/content/siteData.ts` lays live values over the built-in `SiteContent` (statistics, address, phones, fax, e-mail, today's hours, weekly hours, special periods, map and directions links, social icons). Anything the API omits or leaves empty keeps the built-in text, and if `VITE_API_URL` is unset or the API is unreachable the site behaves exactly as before. Hours are shown in the visitor's language with Arabic-Indic digits in Arabic. Data is refreshed every 5 minutes. Park name/tagline/description are stored and editable but the current pages use their own marketing copy, so they are not yet overlaid (nothing in the site displays them).

## Portal (`portal/`)

React + Vite + Tailwind, its own `package.json`. Pages: Home, Park information, Contact details, Opening hours (weekly + special periods), Staff accounts, Roles & permissions, Login. See [portal/README.md](../portal/README.md). Security: the access token lives only in memory; the refresh token is the httpOnly cookie ([authentication.md](authentication.md)); all concurrent 401s share one refresh call (a second parallel refresh would look like token theft); menu items are hidden by permission but the server is the authority.

## Staff accounts page

`/users` (needs `users:read`; changing things needs `users:write`): list with search, role filter, active/deactivated filter and paging; **invite** a person (name, e-mail, roles) who receives a one-time link to choose their own password; open an account to see e-mail, status (active / deactivated / locked), last sign-in and creation date; edit the name; **assign roles**; **activate / deactivate**; **send a password reset** (also clears a lock). Roles you cannot grant (they contain permissions you lack) are disabled, you cannot change yourself, and someone with more access than you is view-only. These are hints: **the API enforces every rule** (`users:write`, the anti-escalation rule, no self-changes) whatever the page shows, which the browser suite checks by calling the API directly as an analyst.

## Browser tests

See [../e2e/README.md](../e2e/README.md).

## Known limits

- Portal is English-only; content fields are bilingual (Arabic inputs are right-to-left).
- Park name/tagline/description are not yet displayed by the site (see above).
- **Park opening hours cannot cross midnight** (see "Time model"): opens < closes on the same day is enforced everywhere.

## Time model (cross-midnight)

- **Park opening hours** (`opening_hours`, `special_hours`) are wall-clock times of one day with `opens < closes` (a database CHECK, the API validation, the sales rules and the website formatter all assume it). The normal hours are 09:00–22:00 every day. Supporting a park that closes after midnight (for example 10:00–01:00) is a larger change, deliberately not made now: it needs a "closes next day" flag in both tables, the same-day cut-off rule to compare against the next-day closing, the "belongs to which day" rule for tickets sold late, and the website formatter. Until then the latest closing time is 23:59.
- **Events** are different and already support crossing midnight: `events.starts_at` and `ends_at` are full timestamps (`timestamptz`), guarded by `ck_events_range` (an end must be after the start). `eventWindow(date, '20:00', '01:00')` (in `backend/src/modules/ticketing/rules/event-window.ts`) turns what an editor types into the two timestamps: an end time not later than the start time means "the next day". An event belongs to the day it starts on. It is correct across daylight-saving changes (a wall-clock time that is skipped is refused; one that happens twice uses its first occurrence). The Events phase will use this helper.
