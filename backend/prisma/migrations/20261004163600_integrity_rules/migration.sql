-- ════════════════════════════════════════════════════════════════════════════
-- Integrity rules that Prisma's schema language cannot express.
-- These are part of the schema contract: they protect the business rules even if a bug,
-- a manual SQL session (pgAdmin) or a future module tries to break them.
-- Covered by test/db/*.db-spec.ts.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Helper: "today" for the park, always Africa/Cairo (handles Egypt's DST) ──
-- The calendar day (in Cairo) that a given instant falls on. A ticket is valid only on that day.
CREATE OR REPLACE FUNCTION azharpark_date_of(ts timestamptz) RETURNS date
LANGUAGE sql STABLE AS $$ SELECT (ts AT TIME ZONE 'Africa/Cairo')::date $$;

CREATE OR REPLACE FUNCTION azharpark_today() RETURNS date
LANGUAGE sql STABLE AS $$ SELECT azharpark_date_of(now()) $$;

-- ── List columns are never NULL ─────────────────────────────────────────────
-- An empty list is the "nothing" value. A NULL list would make rules such as cardinality(special_dates) = 0
-- evaluate to NULL and silently skip the row, so NULL is forbidden at the column level.
ALTER TABLE ticket_prices       ALTER COLUMN special_dates SET NOT NULL;
ALTER TABLE contact_information ALTER COLUMN phones        SET NOT NULL;
ALTER TABLE restaurants         ALTER COLUMN phones        SET NOT NULL;

-- ── CHECK constraints ───────────────────────────────────────────────────────

-- single-row tables
ALTER TABLE park_settings        ADD CONSTRAINT ck_park_settings_singleton        CHECK (id = 1);
ALTER TABLE contact_information  ADD CONSTRAINT ck_contact_information_singleton  CHECK (id = 1);

-- ticket configuration
-- Children under 2 do not need a ticket: no ticket type can include them.
ALTER TABLE ticket_types ADD CONSTRAINT ck_ticket_types_min_age CHECK (min_age >= 2);
ALTER TABLE ticket_types ADD CONSTRAINT ck_ticket_types_ages    CHECK (max_age IS NULL OR max_age >= min_age);
-- No free tickets: a 0 EGP price (and therefore a 0 EGP ticket) cannot exist.
ALTER TABLE ticket_prices ADD CONSTRAINT ck_ticket_prices_amount CHECK (amount_minor > 0);
ALTER TABLE ticket_prices ADD CONSTRAINT ck_ticket_prices_dow    CHECK (dow_mask BETWEEN 1 AND 127);
ALTER TABLE ticket_prices ADD CONSTRAINT ck_ticket_prices_range  CHECK (valid_to IS NULL OR valid_to >= valid_from);
ALTER TABLE ticket_prices ADD CONSTRAINT ck_ticket_prices_special
  CHECK (kind <> 'SPECIAL' OR cardinality(special_dates) > 0);

-- Two normal (STANDARD) price rows for the same type + audience + weekday set + priority must never
-- cover the same dates. This is what keeps "which price applies?" unambiguous.
-- (Special-date and promo-code rows are excluded: they intentionally layer on top by priority.)
ALTER TABLE ticket_prices ADD CONSTRAINT ex_ticket_prices_no_overlap
  EXCLUDE USING gist (
    ticket_type_id WITH =,
    audience_id    WITH =,
    kind           WITH =,
    priority       WITH =,
    dow_mask       WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  )
  WHERE (is_active AND cardinality(special_dates) = 0 AND promo_code IS NULL);

-- orders & money (integer piastres)
ALTER TABLE orders ADD CONSTRAINT ck_orders_money
  CHECK (subtotal_minor > 0 AND discount_minor >= 0 AND total_minor > 0
         AND total_minor = subtotal_minor - discount_minor);
ALTER TABLE orders ADD CONSTRAINT ck_orders_number_format CHECK (order_number ~ '^AZP-[0-9]{4}-[0-9]{6}$');
ALTER TABLE order_items ADD CONSTRAINT ck_order_items_quantity CHECK (quantity > 0);
ALTER TABLE order_items ADD CONSTRAINT ck_order_items_money
  CHECK (unit_price_minor > 0 AND line_total_minor = unit_price_minor * quantity);
ALTER TABLE payments ADD CONSTRAINT ck_payments_amount CHECK (amount_minor > 0);
ALTER TABLE menu_items ADD CONSTRAINT ck_menu_items_price CHECK (price_minor >= 0);
ALTER TABLE reference_counters ADD CONSTRAINT ck_reference_counters_value CHECK (last_value >= 0);

-- tickets & scans
ALTER TABLE tickets ADD CONSTRAINT ck_tickets_price     CHECK (price_paid_minor > 0);
ALTER TABLE tickets ADD CONSTRAINT ck_tickets_ref_format CHECK (public_ref ~ '^TKT-[0-9A-Z]{8,16}$');
ALTER TABLE tickets ADD CONSTRAINT ck_tickets_used       CHECK (status <> 'USED' OR used_at IS NOT NULL);
ALTER TABLE ticket_scans ADD CONSTRAINT ck_ticket_scans_result_reason
  CHECK ((result = 'VALID' AND reason = 'OK') OR (result = 'INVALID' AND reason <> 'OK'));

-- There are no refunds. The REFUNDED enum values still exist (so a future policy change is a small, deliberate
-- migration: drop these constraints), but no order, payment or ticket can ever hold that status.
ALTER TABLE orders   ADD CONSTRAINT ck_orders_no_refund   CHECK (status <> 'REFUNDED');
ALTER TABLE payments ADD CONSTRAINT ck_payments_no_refund CHECK (status <> 'REFUNDED');
ALTER TABLE tickets  ADD CONSTRAINT ck_tickets_no_refund  CHECK (status <> 'REFUNDED');

-- Cancelling (an admin's operational decision) must say when and why. Cancelling is not a refund.
ALTER TABLE orders  ADD CONSTRAINT ck_orders_cancel
  CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL AND btrim(cancel_reason) <> ''));
ALTER TABLE tickets ADD CONSTRAINT ck_tickets_cancel
  CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL AND btrim(cancel_reason) <> ''));

-- opening hours
ALTER TABLE opening_hours ADD CONSTRAINT ck_opening_hours_day  CHECK (day_of_week BETWEEN 0 AND 6);
ALTER TABLE opening_hours ADD CONSTRAINT ck_opening_hours_times
  CHECK (is_closed OR (opens IS NOT NULL AND closes IS NOT NULL AND closes > opens));
ALTER TABLE special_hours ADD CONSTRAINT ck_special_hours_range CHECK (date_to >= date_from);
ALTER TABLE special_hours ADD CONSTRAINT ck_special_hours_times
  CHECK (is_closed OR (opens IS NOT NULL AND closes IS NOT NULL AND closes > opens));

-- ── Append-only tables: no UPDATE, no DELETE ───────────────────────────────

CREATE OR REPLACE FUNCTION azharpark_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on "%" is not allowed: this table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER trg_audit_logs_append_only   BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION azharpark_reject_mutation();
CREATE TRIGGER trg_ticket_scans_append_only BEFORE UPDATE OR DELETE ON ticket_scans
  FOR EACH ROW EXECUTE FUNCTION azharpark_reject_mutation();

-- ── Financial history is never deleted ─────────────────────────────────────

CREATE OR REPLACE FUNCTION azharpark_reject_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Deleting rows from "%" is not allowed: order, payment and ticket history must be kept', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER trg_orders_no_delete      BEFORE DELETE ON orders      FOR EACH ROW EXECUTE FUNCTION azharpark_reject_delete();
CREATE TRIGGER trg_order_items_no_delete BEFORE DELETE ON order_items FOR EACH ROW EXECUTE FUNCTION azharpark_reject_delete();
CREATE TRIGGER trg_payments_no_delete    BEFORE DELETE ON payments    FOR EACH ROW EXECUTE FUNCTION azharpark_reject_delete();
CREATE TRIGGER trg_tickets_no_delete     BEFORE DELETE ON tickets     FOR EACH ROW EXECUTE FUNCTION azharpark_reject_delete();

-- ── Prices paid are written once ───────────────────────────────────────────
-- Changing today's ticket price inserts new ticket_prices rows; it can never rewrite what a customer paid.

CREATE OR REPLACE FUNCTION azharpark_guard_order_items() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id          IS DISTINCT FROM OLD.order_id
  OR NEW.ticket_type_id    IS DISTINCT FROM OLD.ticket_type_id
  OR NEW.audience_id       IS DISTINCT FROM OLD.audience_id
  OR NEW.ticket_price_id   IS DISTINCT FROM OLD.ticket_price_id
  OR NEW.type_name_en      IS DISTINCT FROM OLD.type_name_en
  OR NEW.type_name_ar      IS DISTINCT FROM OLD.type_name_ar
  OR NEW.audience_name_en  IS DISTINCT FROM OLD.audience_name_en
  OR NEW.audience_name_ar  IS DISTINCT FROM OLD.audience_name_ar
  OR NEW.unit_price_minor  IS DISTINCT FROM OLD.unit_price_minor
  OR NEW.currency          IS DISTINCT FROM OLD.currency
  OR NEW.quantity          IS DISTINCT FROM OLD.quantity
  OR NEW.line_total_minor  IS DISTINCT FROM OLD.line_total_minor THEN
    RAISE EXCEPTION 'order_items are immutable once created (id %)', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_order_items_immutable BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION azharpark_guard_order_items();

CREATE OR REPLACE FUNCTION azharpark_guard_orders() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_number  IS DISTINCT FROM OLD.order_number
  OR NEW.channel       IS DISTINCT FROM OLD.channel
  OR NEW.visit_date    IS DISTINCT FROM OLD.visit_date
  OR NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
  OR NEW.discount_minor IS DISTINCT FROM OLD.discount_minor
  OR NEW.total_minor   IS DISTINCT FROM OLD.total_minor
  OR NEW.currency      IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'order number, channel, visit date and amounts are immutable (order %)', OLD.order_number
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  --   PENDING_PAYMENT -> PAID | CANCELLED | EXPIRED      PAID -> CANCELLED (operational, by an admin)
  --   CANCELLED and EXPIRED are final. PAID -> REFUNDED does not exist.
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'PENDING_PAYMENT' AND NEW.status IN ('PAID', 'CANCELLED', 'EXPIRED'))
    OR (OLD.status = 'PAID'            AND NEW.status = 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'illegal order status change % -> % (order %)', OLD.status, NEW.status, OLD.order_number
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_orders_immutable BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION azharpark_guard_orders();

CREATE OR REPLACE FUNCTION azharpark_guard_payments() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_id     IS DISTINCT FROM OLD.order_id
  OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
  OR NEW.currency     IS DISTINCT FROM OLD.currency
  OR NEW.provider     IS DISTINCT FROM OLD.provider
  OR NEW.method       IS DISTINCT FROM OLD.method THEN
    RAISE EXCEPTION 'payment amount, currency, provider and method are immutable (payment %)', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- PENDING -> PAID | FAILED | CANCELLED. A PAID payment is final: money is never returned through the system.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'PENDING' AND NEW.status IN ('PAID', 'FAILED', 'CANCELLED')) THEN
    RAISE EXCEPTION 'illegal payment status change % -> % (payment %)', OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payments_immutable BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION azharpark_guard_payments();

-- ── Tickets: immutable identity/price, and a one-way status lifecycle ───────
--   PENDING   → VALID | CANCELLED | EXPIRED
--   VALID     → USED  | CANCELLED | EXPIRED
--   USED, CANCELLED and EXPIRED are final. There is no REFUNDED: the park does not refund.
-- A ticket that has been USED can therefore never become VALID again, even through a bug or manual SQL.

CREATE OR REPLACE FUNCTION azharpark_guard_tickets() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.public_ref        IS DISTINCT FROM OLD.public_ref
  OR NEW.order_id          IS DISTINCT FROM OLD.order_id
  OR NEW.order_item_id     IS DISTINCT FROM OLD.order_item_id
  OR NEW.ticket_type_id    IS DISTINCT FROM OLD.ticket_type_id
  OR NEW.audience_id       IS DISTINCT FROM OLD.audience_id
  OR NEW.visit_date        IS DISTINCT FROM OLD.visit_date
  OR NEW.price_paid_minor  IS DISTINCT FROM OLD.price_paid_minor
  OR NEW.currency          IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'ticket reference, order link, visit date and price paid are immutable (ticket %)', OLD.public_ref
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
         (OLD.status = 'PENDING' AND NEW.status IN ('VALID', 'CANCELLED', 'EXPIRED'))
      OR (OLD.status = 'VALID'   AND NEW.status IN ('USED', 'CANCELLED', 'EXPIRED'))
    ) THEN
      RAISE EXCEPTION 'illegal ticket status change % → % (ticket %)', OLD.status, NEW.status, OLD.public_ref
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_tickets_guard BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION azharpark_guard_tickets();
