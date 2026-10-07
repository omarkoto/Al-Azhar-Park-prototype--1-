-- Price history is append-only. A price row says "this ticket costs this much from this date"; what it costs,
-- for whom, and from when is written once. Only closing it (valid_to), switching it off (is_active) and notes
-- can change afterwards. A new price is a NEW row, so a past price (and every order that used it) never changes.

CREATE OR REPLACE FUNCTION azharpark_guard_ticket_prices() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ticket_type_id IS DISTINCT FROM OLD.ticket_type_id
  OR NEW.audience_id    IS DISTINCT FROM OLD.audience_id
  OR NEW.kind           IS DISTINCT FROM OLD.kind
  OR NEW.amount_minor   IS DISTINCT FROM OLD.amount_minor
  OR NEW.currency       IS DISTINCT FROM OLD.currency
  OR NEW.priority       IS DISTINCT FROM OLD.priority
  OR NEW.dow_mask       IS DISTINCT FROM OLD.dow_mask
  OR NEW.special_dates  IS DISTINCT FROM OLD.special_dates
  OR NEW.promo_code     IS DISTINCT FROM OLD.promo_code
  OR NEW.valid_from     IS DISTINCT FROM OLD.valid_from THEN
    RAISE EXCEPTION 'a price row cannot be edited (id %): add a new price instead', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_ticket_prices_immutable BEFORE UPDATE ON ticket_prices
  FOR EACH ROW EXECUTE FUNCTION azharpark_guard_ticket_prices();

CREATE OR REPLACE FUNCTION azharpark_reject_price_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'price rows are history and cannot be deleted (id %): switch the price off instead', OLD.id
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER trg_ticket_prices_no_delete BEFORE DELETE ON ticket_prices
  FOR EACH ROW EXECUTE FUNCTION azharpark_reject_price_delete();
