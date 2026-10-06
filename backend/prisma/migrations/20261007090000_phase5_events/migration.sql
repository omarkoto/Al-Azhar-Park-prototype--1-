-- ── Phase 5: events and coming soon ──────────────────────────────────────────────────────────────

-- Lifecycle: COMPLETED (never used) becomes ARCHIVED, and COMING_SOON is added. Existing rows keep their values.
ALTER TYPE "event_status" RENAME VALUE 'COMPLETED' TO 'ARCHIVED';
ALTER TYPE "event_status" ADD VALUE 'COMING_SOON' AFTER 'DRAFT';

-- Venues: an active flag and an address
ALTER TABLE "venues" ADD COLUMN "address_en" TEXT,
ADD COLUMN "address_ar" TEXT,
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- Ordering of the portal and public lists
CREATE INDEX "ix_events_status_sort" ON "events"("status", "sort_order");

-- Integrity
ALTER TABLE events ADD CONSTRAINT ck_events_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80);
ALTER TABLE events ADD CONSTRAINT ck_events_titles CHECK (btrim(title_en) <> '' AND btrim(title_ar) <> '');
-- an event is at most 18 hours long (an evening that runs past midnight is fine; multi-day events use a date label)
ALTER TABLE events ADD CONSTRAINT ck_events_duration CHECK (ends_at IS NULL OR ends_at - starts_at <= interval '18 hours');
ALTER TABLE venues ADD CONSTRAINT ck_venues_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60);
ALTER TABLE venues ADD CONSTRAINT ck_venues_names CHECK (btrim(name_en) <> '' AND btrim(name_ar) <> '');
