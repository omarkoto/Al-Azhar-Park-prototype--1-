-- Phase 8: the precise result shown to the gate scanner (for example INVALID_SIGNATURE or RETIRED_KEY) is kept with
-- each scan. The coarse `reason` enum stays as it was, so older rows and reports keep their meaning.
ALTER TABLE "ticket_scans" ADD COLUMN "detail" TEXT;
ALTER TABLE "ticket_scans" ADD CONSTRAINT ck_ticket_scans_detail
  CHECK (detail IS NULL OR detail IN ('ACCESS_GRANTED','INVALID_QR','INVALID_SIGNATURE','RETIRED_KEY','TICKET_NOT_FOUND','TICKET_NOT_VALID','ALREADY_USED','WRONG_DATE','CANCELLED','EXPIRED'));
