# Events and Coming soon (Phase 5)

Staff create and manage events and venues in the portal; the public website shows the ones that are public. The backend is the source of truth and **enforces** what the public can see; the website only displays what the API returns.

## Lifecycle

| Status | Public? | Where it appears |
|---|---|---|
| `DRAFT` | no | portal only |
| `COMING_SOON` | yes | the website's "Coming soon" section / strip, with its own page |
| `PUBLISHED` | yes | the events listing, with its own page |
| `CANCELLED` | no | portal only |
| `ARCHIVED` | no | portal only |

Allowed changes (anything else is refused with `409 INVALID_STATUS_CHANGE`):

```
DRAFT        → COMING_SOON, PUBLISHED, ARCHIVED
COMING_SOON  → PUBLISHED, DRAFT, CANCELLED, ARCHIVED
PUBLISHED    → COMING_SOON, DRAFT, CANCELLED, ARCHIVED
CANCELLED    → DRAFT, ARCHIVED
ARCHIVED     → DRAFT
```

- A new event is always a **draft**. Creating or editing content never changes the status (a `status` sent with the content is ignored); only `PUT /events/:id/status` does, and it needs `events:publish`.
- A cancelled or archived event cannot jump to the public: it is **restored as a draft first**.
- The first time an event becomes public its `publishedAt` is set and never changes. From then on its **web address (slug) is locked** (links to it would break). Before that it can be changed.
- Existing databases keep their data: the unused `COMPLETED` status became `ARCHIVED`, and `COMING_SOON` was added (migration `20261007090000_phase5_events`).

## Public visibility (tested at the API)

`GET /public/events` returns only `PUBLISHED`; `GET /public/events/coming-soon` only `COMING_SOON`; `GET /public/events/:slug` returns a `PUBLISHED` or `COMING_SOON` event and **404 for everything else** (draft, cancelled, archived, unknown). By default the listing shows published events that have not finished yet; `?when=past` or `?when=all` include earlier ones (their own pages keep working). No internal fields leave the API: no ids, `createdAt`/`updatedAt`/`publishedAt`, creator, sort order or audit data.

## Date and time

- An event has an **event date** (a Cairo calendar day) and an optional **start time and end time**, entered and shown as the park's local (Africa/Cairo) wall-clock time. Stored as two timestamps (`starts_at`, `ends_at`, `timestamptz`), so daylight saving is handled correctly and the same data supports calendar entries.
- Start and end come **together or not at all**. With neither, the event is **date-only** (stored as midnight, no end).
- **Cross-midnight events are supported**: an end time earlier than the start time means the event ends the next day (`20:00 – 01:00`). It still belongs to the day it starts on. The API returns `crossesMidnight`.
- Rejected with a clear message: only one of start/end; equal start and end; longer than **18 hours** (also a database CHECK); a wall-clock time that does not exist because clocks go forward (e.g. 00:30 on the last Friday of April). A time that happens twice when clocks go back resolves to its first occurrence.
- For multi-day or specially worded events the editor can fill **date wording** and **time wording** (English/Arabic, e.g. "8 Feb – 9 Mar 2027", "Nightly, 8:00 PM – 1:00 AM"); these replace the computed text on the website.
- This is separate from the park's weekly opening hours, which still cannot cross midnight (see [park-cms.md](park-cms.md)). The rules live in `backend/src/modules/events/event-time.ts` and `ticketing/rules/event-window.ts`.

## Venues

Reusable places (`venues` table, reused from Phase 1; added `address_en/ar` and `is_active`). Events point to a venue (`venue_id`); the website shows the venue's name. An optional free-text "other location" exists for places that are not venues, and the venue wins when both are set.

- Create / edit (English + Arabic name, description, address, capacity) / **switch off** / reorder / delete.
- A switched-off venue cannot be chosen for new events; events that already use it keep it.
- A venue **cannot be deleted while any event uses it** (`409 VENUE_IN_USE`); switch it off, or move the events first. Deleting an unused venue is a soft delete.
- The venue's address (slug) is fixed after creation.

## Photos

Reuses the Phase 4 media library, `MediaStorage` and all its rules (byte inspection, size limits, protected-while-in-use, audit). One **hero image** (`hero_media_id`) and a **gallery** (`event_media`, up to 30, ordered, with English/Arabic captions). Only existing image files can be assigned. A photo used by an event cannot be deleted from the library (`409 MEDIA_IN_USE`, naming the event). Without a hero image the website uses a neutral picture (or the built-in picture for a built-in event).

## Ordering

Deterministic everywhere: `sort_order`, then date (`starts_at`), then creation time, then id. Reordering is `PUT /events/order` with every event id exactly once (`422 ORDER_MISMATCH` otherwise); new events go last. The portal offers the arrows only on the whole, unfiltered list.

## API

| Endpoint | Permission | Notes |
|---|---|---|
| GET `/events` (`?status=&search=&page=&limit=`), GET `/events/:id` | `events:read` | every status, in display order |
| POST `/events`, PUT `/events/:id` | `events:write` | create as draft; replace content |
| PUT `/events/:id/status` | `events:publish` | allowed changes only |
| PUT `/events/order` | `events:write` | |
| PUT `/events/:id/gallery` | `events:write` + `media:read` | |
| GET `/venues`, GET `/venues/:id` | `venues:read` | with how many events use each |
| POST `/venues`, PUT `/venues/:id`, PUT `/venues/order`, DELETE `/venues/:id` | `venues:write` | |
| GET `/public/events`, `/public/events/coming-soon`, `/public/events/:slug` | public | cache 60 s |

Permissions follow the existing `resource:action` model; roles are data, nothing checks role names. Seeded: CONTENT_MANAGER and ADMIN have all of them; OPERATIONS can read/edit events and read venues but **cannot change status**; ANALYST can read events and venues; TICKET_STAFF none. `events:publish` covers every status change (publish, coming soon, cancel, archive, restore).

## Validation (server side)

English and Arabic title (2–150), short description (10–300) and description (10–6000) are required; slug lower-case letters/digits/single hyphens, unique; date a real calendar date; times `HH:MM`; venue must exist and be active (or already the event's venue); hero/gallery must be existing images; no control characters. The database repeats the key rules as CHECK constraints (slug, titles, end after start, at most 18 hours).

## Audit

Every change is recorded with actor, request id, and old/new values: `event.created`, `event.updated`, `event.published`, `event.coming_soon`, `event.cancelled`, `event.archived`, `event.restored`, `event.unpublished`, `event.reordered`, `event.venue_changed`, `event.hero_changed`, `event.gallery_updated`, `venue.created|updated|activated|deactivated|reordered|deleted`.

## Public website

- **Events page**: a "What's on" section (published events, then coming soon) above the existing venue-hire content, which is unchanged. With no events it shows a designed empty state.
- **Home**: the "Coming soon" strip uses the API's coming-soon events; with none, it hides itself.
- **Event page** `/events/:slug` (direct URLs work, including for a published event that has already happened): hero, description, gallery, date, time, venue, add-to-calendar. English/Arabic with right-to-left layout and Arabic digits.
- **Fallback**: when the API is not configured or not reachable, the site keeps its built-in coming-soon events, so nothing breaks. When the API answers, its list is authoritative.
- The existing marketing copy and design are untouched.

## Seed (development)

Ramadan Nights (coming soon, with its multi-day wording and a 20:00 – 01:00 evening), Cairo Jazz Nights (published, venue Open Area) and Artisan Market Days (coming soon), plus the three venues. Created once; editors' changes are never overwritten. The seed is idempotent.

## Known limits

- No hard delete of events (archive instead) and no recurring-event or multi-date model: use date wording for runs.
- Photos are served as uploaded (no resizing).
- Ticketing for events, reminders and e-mail are later phases.
