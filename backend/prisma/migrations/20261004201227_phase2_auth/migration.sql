-- AlterTable
ALTER TABLE "users" ADD COLUMN     "password_changed_at" TIMESTAMPTZ(3);

-- ── Phase 2: authentication integrity ─────────────────────────────────────────────────────────────

ALTER TABLE users ADD CONSTRAINT ck_users_failed_login CHECK (failed_login_count >= 0 AND token_version >= 0);

-- cleanup of expired tokens scans by expiry
CREATE INDEX ix_refresh_tokens_expires_at ON refresh_tokens (expires_at);
CREATE INDEX ix_password_reset_tokens_expires_at ON password_reset_tokens (expires_at);

-- A refresh token's identity never changes, and revocation / rotation can never be undone.
CREATE FUNCTION azharpark_guard_refresh_tokens() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.family_id IS DISTINCT FROM OLD.family_id
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
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
CREATE TRIGGER trg_refresh_tokens_guard BEFORE UPDATE ON refresh_tokens
  FOR EACH ROW EXECUTE FUNCTION azharpark_guard_refresh_tokens();

-- A password-reset token is single use: once used it can never be un-used or changed.
CREATE FUNCTION azharpark_guard_password_reset_tokens() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.token_hash IS DISTINCT FROM OLD.token_hash
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'password_reset_tokens identity is immutable';
  END IF;
  IF OLD.used_at IS NOT NULL AND NEW.used_at IS DISTINCT FROM OLD.used_at THEN
    RAISE EXCEPTION 'a used password-reset token cannot be reused';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_password_reset_tokens_guard BEFORE UPDATE ON password_reset_tokens
  FOR EACH ROW EXECUTE FUNCTION azharpark_guard_password_reset_tokens();
