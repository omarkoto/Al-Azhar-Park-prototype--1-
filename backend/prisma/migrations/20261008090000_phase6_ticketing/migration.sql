-- ── Phase 6: ticket purchasing ───────────────────────────────────────────────────────────────────

-- Who cancelled an order (an operational cancellation; there are no refunds)
ALTER TABLE "orders" ADD COLUMN "cancelled_by_id" UUID;
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- finding the pending orders that have run out of time
CREATE INDEX "ix_orders_status_expires" ON "orders"("status", "expires_at");

-- A switched-off price must not block a replacement: only ACTIVE standard rows are compared.
ALTER TABLE ticket_prices DROP CONSTRAINT ex_ticket_prices_no_overlap;
ALTER TABLE ticket_prices ADD CONSTRAINT ex_ticket_prices_no_overlap
  EXCLUDE USING gist (
    ticket_type_id WITH =,
    audience_id    WITH =,
    kind           WITH =,
    priority       WITH =,
    dow_mask       WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  ) WHERE (is_active AND kind = 'STANDARD');

-- The exclusion constraint only catches rows with the SAME weekday mask. Two active STANDARD prices whose weekdays
-- merely OVERLAP (for example "every day" and "weekend") on overlapping dates would make "which price applies?"
-- ambiguous, so they are refused here. An advisory lock per (type, audience) makes simultaneous inserts safe.
CREATE FUNCTION azharpark_guard_price_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_active AND NEW.kind = 'STANDARD' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.ticket_type_id::text || NEW.audience_id::text, 0));
    IF EXISTS (
      SELECT 1 FROM ticket_prices p
       WHERE p.id <> NEW.id AND p.is_active AND p.kind = 'STANDARD'
         AND p.ticket_type_id = NEW.ticket_type_id AND p.audience_id = NEW.audience_id
         AND (p.dow_mask & NEW.dow_mask) <> 0
         AND daterange(p.valid_from, p.valid_to, '[]') && daterange(NEW.valid_from, NEW.valid_to, '[]')
    ) THEN
      RAISE EXCEPTION 'overlapping standard price for the same ticket type, audience, weekdays and dates'
        USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'trg_ticket_prices_overlap';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ticket_prices_overlap BEFORE INSERT OR UPDATE ON ticket_prices
  FOR EACH ROW EXECUTE FUNCTION azharpark_guard_price_overlap();
