-- Events are stored as two full timestamps, so they may end after midnight (20:00 -> 01:00 the next day).
-- The only rule: an end must be after the start.
ALTER TABLE events ADD CONSTRAINT ck_events_range CHECK (ends_at IS NULL OR ends_at > starts_at);
