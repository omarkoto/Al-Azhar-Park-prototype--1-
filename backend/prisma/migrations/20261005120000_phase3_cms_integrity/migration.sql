-- ── Phase 3: park CMS integrity ───────────────────────────────────────────────────────────────────

-- coordinates: valid ranges, given together or not at all
ALTER TABLE contact_information ADD CONSTRAINT ck_contact_coordinates CHECK (
  (latitude IS NULL AND longitude IS NULL)
  OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);
ALTER TABLE contact_information ADD CONSTRAINT ck_contact_phones_count CHECK (cardinality(phones) <= 6);
ALTER TABLE contact_information ADD CONSTRAINT ck_contact_maps_https CHECK (maps_url IS NULL OR maps_url ~ '^https://');

-- statistics are a JSON array
ALTER TABLE park_settings ADD CONSTRAINT ck_park_settings_stats_array CHECK (jsonb_typeof(stats) = 'array');

-- special hours: labels are never blank, priority is bounded, a closure is always closed
ALTER TABLE special_hours ADD CONSTRAINT ck_special_hours_labels CHECK (btrim(label_en) <> '' AND btrim(label_ar) <> '');
ALTER TABLE special_hours ADD CONSTRAINT ck_special_hours_priority CHECK (priority BETWEEN 0 AND 100);
ALTER TABLE special_hours ADD CONSTRAINT ck_special_hours_closure CHECK (kind <> 'TEMPORARY_CLOSURE' OR is_closed);

-- two ACTIVE periods with the same priority may not cover the same day (which hours apply would be ambiguous)
ALTER TABLE special_hours ADD CONSTRAINT ex_special_hours_no_overlap
  EXCLUDE USING gist (priority WITH =, daterange(date_from, date_to, '[]') WITH &&) WHERE (is_active);
