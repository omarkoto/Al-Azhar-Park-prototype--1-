-- Phase 11 (security hardening): the append-only tables also refuse TRUNCATE.
--
-- audit_logs and ticket_scans already refuse UPDATE and DELETE (row triggers from 20261004163600_integrity_rules). Those triggers do
-- not fire for TRUNCATE, which empties a table without visiting its rows, so anyone with table privileges could erase the whole
-- audit trail or scan history in one statement. A statement-level BEFORE TRUNCATE trigger closes that gap. It also fires when the
-- table is emptied indirectly, by TRUNCATE ... CASCADE on a table they reference (for example users).
--
-- It reuses azharpark_reject_mutation(), whose message ("TRUNCATE on "audit_logs" is not allowed: this table is append-only")
-- already names the operation. No data is read, changed or removed, and INSERT is unaffected.
--
-- Like the existing triggers this is a guard against mistakes and application bugs, not against the table owner, who can still
-- disable a trigger on purpose (ALTER TABLE ... DISABLE TRIGGER). Production should not run the application as a role that owns
-- the tables (a deployment matter for a later phase). The automated test setup, which has to empty every table between tests,
-- disables these two triggers for the duration of its own reset and enables them again.
--
-- Rollback (nothing else depends on these triggers; no data is affected):
--   DROP TRIGGER trg_audit_logs_no_truncate   ON audit_logs;
--   DROP TRIGGER trg_ticket_scans_no_truncate ON ticket_scans;

CREATE TRIGGER trg_audit_logs_no_truncate   BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION azharpark_reject_mutation();
CREATE TRIGGER trg_ticket_scans_no_truncate BEFORE TRUNCATE ON ticket_scans
  FOR EACH STATEMENT EXECUTE FUNCTION azharpark_reject_mutation();
