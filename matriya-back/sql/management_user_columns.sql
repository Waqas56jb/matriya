-- Management panel users: admin-visible password copy + flags (run on Supabase / same DB as matriya-back users).
-- Safe to run multiple times (IF NOT EXISTS).

ALTER TABLE users ADD COLUMN IF NOT EXISTS management_plain_password TEXT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_management_user BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.management_plain_password IS 'Last password as set by admin or reset (display in admin UI only; login still uses hashed_password).';
COMMENT ON COLUMN users.password_updated_at IS 'Last time password was changed (management flow).';
COMMENT ON COLUMN users.is_management_user IS 'True if account is provisioned for Management panel (not Matriya-only self signup).';
