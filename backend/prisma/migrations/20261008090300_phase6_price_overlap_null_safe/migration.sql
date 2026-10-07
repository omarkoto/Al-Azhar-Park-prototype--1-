-- A row with a NULL list column is refused by its NOT NULL constraint, which PostgreSQL checks AFTER BEFORE-triggers:
-- skip the overlap check for it so the error names the real problem (the NOT NULL), not an overlap.

CREATE OR REPLACE FUNCTION azharpark_guard_price_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active AND NEW.kind = 'STANDARD'
     AND NEW.amount_minor > 0 AND NEW.dow_mask BETWEEN 1 AND 127 AND NEW.special_dates IS NOT NULL
     AND (NEW.valid_to IS NULL OR NEW.valid_to >= NEW.valid_from) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.ticket_type_id::text || NEW.audience_id::text, 0));
    IF EXISTS (
      SELECT 1 FROM ticket_prices p
       WHERE p.id <> NEW.id AND p.is_active AND p.kind = 'STANDARD'
         AND p.ticket_type_id = NEW.ticket_type_id AND p.audience_id = NEW.audience_id
         AND (p.dow_mask & NEW.dow_mask) <> 0
         AND NOT (p.dow_mask = NEW.dow_mask AND p.priority = NEW.priority)
         AND daterange(p.valid_from, p.valid_to, '[]') && daterange(NEW.valid_from, NEW.valid_to, '[]')
    ) THEN
      RAISE EXCEPTION 'overlapping standard price for the same ticket type, audience, weekdays and dates'
        USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'trg_ticket_prices_overlap';
    END IF;
  END IF;
  RETURN NEW;
END $$;
