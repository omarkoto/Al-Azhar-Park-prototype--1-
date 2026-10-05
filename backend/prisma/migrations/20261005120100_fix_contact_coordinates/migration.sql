-- A CHECK passes when it evaluates to NULL, so "latitude set, longitude NULL" slipped through the first version.
-- Be explicit: either both are NULL, or both are present and in range.
ALTER TABLE contact_information DROP CONSTRAINT ck_contact_coordinates;
ALTER TABLE contact_information ADD CONSTRAINT ck_contact_coordinates CHECK (
  (latitude IS NULL AND longitude IS NULL)
  OR (latitude IS NOT NULL AND longitude IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)
);
