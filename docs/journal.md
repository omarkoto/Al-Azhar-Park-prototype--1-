# Journal (website "News") from the portal

Staff write the park's Journal stories in the portal; the website shows the published ones as cards, and **Read more** opens the full article. The backend is the source of truth and enforces what the public can see.

**Coming soon** was already portal-driven: create an event in **Events** (photo, short and detailed description, date and time, location) and set its status to *Coming soon*. See [events.md](events.md). Only the Journal needed a new module.

## What an article has

| Field | Used for |
|---|---|
| Title (EN/AR) | card and article heading |
| Tag (EN/AR), one per article | label on the card |
| Short description (EN/AR), 10–300 characters | text on the card |
| Article (EN/AR), up to 20,000 characters | the full text; a blank line starts a new paragraph |
| Date wording (EN/AR), optional | free text such as "Autumn 2026" or "1990s"; not shown when empty |
| Cover photo | picture on the card and at the top of the article (from the media library) |
| Gallery (up to 30 photos, optional captions) | pictures under the article |
| Featured | highlights the article |
| Web address (slug) | `/news/<slug>`; locked once the article has been public |

The text is plain text. The website renders it as text, never as HTML, so typed markup is shown as typed.

## Lifecycle

| Status | Public? |
|---|---|
| `DRAFT` | no (portal only) |
| `PUBLISHED` | yes: card in the Journal and its own page |
| `ARCHIVED` | no |

Allowed changes (anything else is `409 INVALID_STATUS_CHANGE`):

```
DRAFT     → PUBLISHED, ARCHIVED
PUBLISHED → DRAFT, ARCHIVED
ARCHIVED  → DRAFT
```

A new article is always a draft; saving content never changes status. An archived article is restored as a draft first. The first publish sets `publishedAt`; the public list is newest first.

## Using it in the portal

1. **Park & content → Journal → Add an article.**
2. Fill in English and Arabic (the card preview updates as you type), then **Create article**.
3. Open the **Photos** tab: choose the cover (upload or pick from the library) and, optionally, gallery photos.
4. **Publish.** The panel warns about a missing cover or very short text before you do.

## API

| Method and path | Permission |
|---|---|
| `GET /public/journal`, `GET /public/journal/:slug` | none (published only; `Cache-Control: public, max-age=60`) |
| `GET /journal`, `GET /journal/:id` | `journal:read` |
| `POST /journal`, `PUT /journal/:id` | `journal:write` |
| `PUT /journal/:id/gallery` | `journal:write` and `media:read` |
| `PUT /journal/:id/status` | `journal:publish` |

Seeded roles: Super admin (all), Admin and Content manager (read, write, publish), Analyst (read). Operations and ticket staff have none. Every change is written to the audit log (the article text itself is not copied into it).

## Website behaviour

- When the API answers, its published list **is** the Journal, so an empty list shows an empty Journal.
- When the API is not configured or unreachable, the website falls back to its built-in articles.
- A photo used as a Journal cover or in a gallery cannot be deleted from the media library (`409 MEDIA_IN_USE`).
- The development seed creates the six built-in articles (create-only; it never overwrites edits).

## Database

Migration `20261012090000_journal_articles`: enum `journal_status`, tables `journal_articles` and `journal_article_media`, index `ix_journal_status_published`, CHECKs `ck_journal_slug`, `ck_journal_texts` and `ck_journal_published_at`. Cover is `ON DELETE SET NULL`; gallery rows are removed with their article. The rollback steps are in the migration file's header.
