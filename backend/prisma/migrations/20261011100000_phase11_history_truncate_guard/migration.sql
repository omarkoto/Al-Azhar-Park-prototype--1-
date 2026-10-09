-- Phase 11 (security hardening): the financial history tables also refuse TRUNCATE.
--
-- orders, order_items, payments and tickets already refuse DELETE (trg_*_no_delete, "order, payment and ticket history must be
-- kept") and are immutable or lifecycle-guarded on UPDATE; ticket_prices refuses UPDATE and DELETE ("price rows are history").
-- None of those row triggers fires for TRUNCATE, which empties a table without visiting its rows, so one statement could erase the
-- whole sales history. A statement-level BEFORE TRUNCATE trigger on each of the five closes that gap. It also fires when one of
-- them is emptied indirectly, by TRUNCATE ... CASCADE on a table they reference (users, customers, ticket_types ...).
--
-- Every one of these tables is already "never deleted", so refusing a bulk delete is consistent with their existing rules; no
-- business rule changes, no data is read, changed or removed, and INSERT, and the UPDATEs the lifecycle rules allow, are unaffected.
-- (audit_logs and ticket_scans were covered by 20261011090000_phase11_truncate_guard.)
--
-- Like the other triggers this guards against mistakes and application bugs, not against the table owner, who can still disable a
-- trigger on purpose. The automated test setup, which has to empty every table between tests, disables every trigger whose name ends
-- in _no_truncate for the duration of its own reset and enables them again.
--
-- Rollback (nothing depends on these triggers or on the function; no data is affected):
--   DROP TRIGGER trg_orders_no_truncate       ON orders;
--   DROP TRIGGER trg_order_items_no_truncate  ON order_items;
--   DROP TRIGGER trg_payments_no_truncate     ON payments;
--   DROP TRIGGER trg_tickets_no_truncate      ON tickets;
--   DROP TRIGGER trg_ticket_prices_no_truncate ON ticket_prices;
--   DROP FUNCTION azharpark_reject_truncate();

CREATE OR REPLACE FUNCTION azharpark_reject_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Truncating "%" is not allowed: order, payment, ticket and price history must be kept', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER trg_orders_no_truncate        BEFORE TRUNCATE ON orders        FOR EACH STATEMENT EXECUTE FUNCTION azharpark_reject_truncate();
CREATE TRIGGER trg_order_items_no_truncate   BEFORE TRUNCATE ON order_items   FOR EACH STATEMENT EXECUTE FUNCTION azharpark_reject_truncate();
CREATE TRIGGER trg_payments_no_truncate      BEFORE TRUNCATE ON payments      FOR EACH STATEMENT EXECUTE FUNCTION azharpark_reject_truncate();
CREATE TRIGGER trg_tickets_no_truncate       BEFORE TRUNCATE ON tickets       FOR EACH STATEMENT EXECUTE FUNCTION azharpark_reject_truncate();
CREATE TRIGGER trg_ticket_prices_no_truncate BEFORE TRUNCATE ON ticket_prices FOR EACH STATEMENT EXECUTE FUNCTION azharpark_reject_truncate();
