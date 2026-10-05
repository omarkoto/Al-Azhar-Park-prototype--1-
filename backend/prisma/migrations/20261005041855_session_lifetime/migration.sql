-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "session_started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- the session start (and so the absolute session lifetime) can never be moved forward
CREATE OR REPLACE FUNCTION azharpark_guard_refresh_tokens() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.family_id IS DISTINCT FROM OLD.family_id
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.session_started_at IS DISTINCT FROM OLD.session_started_at THEN
    RAISE EXCEPTION 'refresh_tokens identity is immutable';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'a revoked refresh token cannot be changed or re-activated';
  END IF;
  IF OLD.replaced_by_id IS NOT NULL AND NEW.replaced_by_id IS DISTINCT FROM OLD.replaced_by_id THEN
    RAISE EXCEPTION 'a rotated refresh token cannot be re-linked';
  END IF;
  RETURN NEW;
END $$;
