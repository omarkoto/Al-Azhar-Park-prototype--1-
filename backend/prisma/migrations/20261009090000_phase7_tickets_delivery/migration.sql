-- Phase 7: ticket delivery.
-- orders.locale: which language the customer used, so the confirmation e-mail and ticket PDF default to it.
ALTER TABLE "orders" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "orders" ADD CONSTRAINT ck_orders_locale CHECK (locale IN ('en', 'ar'));

-- notifications act as the e-mail outbox: a unique key per message purpose (no duplicate sends) and a retry time.
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" TEXT;
ALTER TABLE "notifications" ADD COLUMN "next_attempt_at" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");
CREATE INDEX "notifications_related_order_id_idx" ON "notifications"("related_order_id");
ALTER TABLE "notifications" ADD CONSTRAINT ck_notifications_attempts CHECK (attempts >= 0);
