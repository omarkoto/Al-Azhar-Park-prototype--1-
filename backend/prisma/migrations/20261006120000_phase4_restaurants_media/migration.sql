-- ── Phase 4: restaurants, menus, media ───────────────────────────────────────────────────────────

-- media: only the four recognised types, bounded size and dimensions, a site-relative URL
ALTER TABLE media ADD CONSTRAINT ck_media_mime CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));
ALTER TABLE media ADD CONSTRAINT ck_media_size CHECK (size_bytes > 0 AND size_bytes <= 104857600);
ALTER TABLE media ADD CONSTRAINT ck_media_dimensions CHECK (
  (width IS NULL OR width BETWEEN 1 AND 12000) AND (height IS NULL OR height BETWEEN 1 AND 12000)
);
ALTER TABLE media ADD CONSTRAINT ck_media_url CHECK (url LIKE '/%');
ALTER TABLE media ADD CONSTRAINT ck_media_key CHECK (storage_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$');

-- restaurants
ALTER TABLE restaurants ADD CONSTRAINT ck_restaurants_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 60);
ALTER TABLE restaurants ADD CONSTRAINT ck_restaurants_names CHECK (btrim(name_en) <> '' AND btrim(name_ar) <> '');
-- opening and closing time come together; a closing time not after the opening time means "after midnight" (12:00 - 00:00)
ALTER TABLE restaurants ADD CONSTRAINT ck_restaurants_hours CHECK ((opens_at IS NULL) = (closes_at IS NULL));
ALTER TABLE restaurants ADD CONSTRAINT ck_restaurants_phones CHECK (cardinality(phones) <= 6);
ALTER TABLE restaurants ADD CONSTRAINT ck_restaurants_urls CHECK (
  (reservation_url IS NULL OR reservation_url ~ '^https://')
  AND (website_url IS NULL OR website_url ~ '^https://')
  AND (instagram_url IS NULL OR instagram_url ~ '^https://')
);

-- menus: a menu is an external https link OR an uploaded PDF
ALTER TABLE menus ADD CONSTRAINT ck_menus_source CHECK (external_url IS NOT NULL OR pdf_media_id IS NOT NULL);
ALTER TABLE menus ADD CONSTRAINT ck_menus_external_https CHECK (external_url IS NULL OR external_url ~ '^https://');
ALTER TABLE menus ADD CONSTRAINT ck_menus_names CHECK (btrim(name_en) <> '' AND btrim(name_ar) <> '');
