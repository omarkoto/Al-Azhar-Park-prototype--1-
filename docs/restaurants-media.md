# Restaurants, menus and media (Phase 4)

Staff manage the park's restaurants, their menus and their photos in the portal; the public website shows them. Events, ticketing, scanning and analytics are not part of this phase.

## What staff can do

| Area | Portal page | Permissions |
|---|---|---|
| Restaurants: name, brand, tagline, description, atmosphere, location (English + Arabic), hours, phones, reservation / website / Instagram links, on/off, order, remove | Restaurants | `restaurants:read` / `restaurants:write` |
| Photos: one main photo and a gallery of up to 20 with captions, in order | Restaurants → Photos | `restaurants:write` + `media:read` |
| Menus: any number per restaurant; each is an external **https link** or an **uploaded PDF**; active/hidden, ordered | Restaurants → Menus | `menus:read` / `menus:write` |
| Media library: upload, describe (alt text EN/AR), search, filter, delete | Media library | `media:read` / `media:write` |

Seeded access: CONTENT_MANAGER can do all of it; ADMIN too; OPERATIONS and ANALYST can only view restaurants; TICKET_STAFF nothing. The portal hides what a person cannot use, but **the API enforces every permission** (tested).

Rules worth knowing
- The web address (slug) is chosen on creation and never changes (it is part of the website's URLs); removing a restaurant keeps the record and reserves its address.
- A restaurant's hours: a closing time that is not later than the opening time means it closes **after midnight** (12:00 – 00:00, 18:00 – 01:00). The API reports `closesAfterMidnight`.
- A menu is *either* a link *or* a PDF, never both, never neither. Only https links are accepted.
- A photo or PDF **in use cannot be deleted** (409 `MEDIA_IN_USE`, naming where it is used). Remove it from the restaurant first.
- "Remove restaurant" hides it and its menus; it does not delete photos from the library.

## API

| Endpoint | Access | Notes |
|---|---|---|
| GET `/public/restaurants`, GET `/public/restaurants/:slug` | public | active restaurants only, in order, active menus only, no internal ids; cache 60 s |
| GET `/media/file/:key` | public | the stored file (see security below) |
| GET/POST `/restaurants`, GET/PUT/DELETE `/restaurants/:id` | `restaurants:read` / `:write` | PUT replaces; DELETE is a soft delete |
| PUT `/restaurants/order` | `restaurants:write` | list every id once |
| PUT `/restaurants/:id/gallery` | `restaurants:write`, `media:read` | ordered list of `{ mediaId, captionEn, captionAr }` |
| POST `/restaurants/:id/menus`, PUT `/restaurants/:id/menus/order`, PUT/DELETE `/menus/:id` | `menus:write` | |
| POST `/media` (multipart `file`, optional `altEn`, `altAr`), GET `/media`, GET/PATCH/DELETE `/media/:id` | `media:write` / `media:read` | list: `?kind=image\|pdf&search=&page=&limit=` |

All changes are audited (`restaurant.created|updated|deleted|reordered|gallery_updated`, `menu.created|updated|deleted|reordered`, `media.uploaded|updated|deleted`) with who, and old/new values.

## Upload security

- **The type is decided from the file's bytes**, never from its name or the browser's Content-Type. Only JPEG, PNG, WebP and PDF are accepted; SVG (can carry script), HTML, GIF, executables, etc. are refused (415). A declared type that disagrees with the bytes is refused too.
- **Limits:** images 8 MB (`MEDIA_MAX_IMAGE_MB`), PDFs 15 MB (`MEDIA_MAX_PDF_MB`), at most 12 000 px per side, one file per request, 40 uploads per minute per address.
- **PDFs** containing JavaScript, Launch actions, embedded files or rich media are refused (a protective heuristic, not a full malware scan).
- **Stored under a random name** (`<uuid>.<ext>`) outside any web root; the visitor's file name is only a cleaned display label. The disk path is built only from keys matching our own pattern (no path traversal; tested with encoded `../`). Files are never overwritten.
- **Served** with the stored (sniffed) Content-Type, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` (an opened file can never run anything), `Cross-Origin-Resource-Policy: cross-origin` (so the website may embed it) and a one-year immutable cache (keys never change). Deleted files return 404.
- The database repeats the main rules as CHECK constraints (types, size, key shape, relative URL).
- **Storage provider:** `MediaStorage` is an interface; the default `LocalMediaStorage` writes under `MEDIA_DIR` (default `./storage/media`, git-ignored; Docker uses a named volume). S3 / R2 / Cloudinary can replace it by binding another implementation in `MediaModule`; nothing else changes.

## Public website

`src/content/restaurantData.ts` lays the portal's restaurants over the built-in list:
- When the API returns at least one restaurant, **that list (in its order) is what visitors see**: a restaurant switched off or removed disappears, a new one appears. An empty answer or no answer keeps the built-in restaurants, so the page cannot go blank.
- Texts left empty in the portal, and photos not yet uploaded, keep the built-in wording and pictures (so the three existing restaurants look exactly as before until someone edits them). A new restaurant without a photo gets a placeholder.
- Hours are written 24-hour as before ("12:00 – 00:00"), with Arabic digits in Arabic. With several menus the restaurant page shows one button per menu, by name; with one it keeps the single "View menu" button.
- Uploaded files are loaded from the API's address. A direct visit to a portal-created restaurant's page waits for the live list instead of redirecting away.

## Known limits

- Menus are documents (a link or a PDF). The tables for structured menus (categories and dishes with prices) exist but are not used or editable yet.
- No image resizing or format conversion: photos are served as uploaded (the 8 MB limit applies). Thumbnails would need an image-processing step.
- A removed restaurant cannot be restored from the portal (the record is kept).
- Table-reservation requests (the website's form) are unchanged and not yet stored by the API.
