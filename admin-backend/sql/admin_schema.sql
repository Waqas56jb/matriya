-- ============================================================
-- MATRIYA Admin Backend — Supabase SQL Schema
-- Run this once in your Supabase SQL editor.
-- ============================================================

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          VARCHAR(255) NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           VARCHAR(50)  NOT NULL DEFAULT 'admin',
  is_active      BOOLEAN      NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login     TIMESTAMPTZ
);

-- Admin audit log — immutable, no DELETE allowed via RLS
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email  VARCHAR(255),
  action       TEXT NOT NULL,
  body         TEXT,
  ip           VARCHAR(64),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- System-wide configuration key-value store
CREATE TABLE IF NOT EXISTS admin_config (
  key         VARCHAR(100) PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  VARCHAR(255)
);

-- Seed default config values
INSERT INTO admin_config (key, value) VALUES
  ('system_prompt',         'You are MATRIYA, a deterministic research decision engine. Output structured JSON only.'),
  ('stop_threshold',        '0'),
  ('iterate_min',           '1'),
  ('iterate_max',           '69'),
  ('go_threshold',          '70'),
  ('finance_cron_schedule', '0 7 * * *'),
  ('daily_pipeline_limit',  '100'),
  ('whitelist_enabled',     'true'),
  ('rachel_enabled',        'true')
ON CONFLICT (key) DO NOTHING;

-- User sessions table (for live session tracking)
-- user_id is a plain UUID — no FK constraint so this works regardless of users table structure
CREATE TABLE IF NOT EXISTS user_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID,
  ip_address      VARCHAR(64),
  device          TEXT,
  browser         TEXT,
  logged_in_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  logout_reason   TEXT
);

-- System logs table (error/warn/info logs from all services)
CREATE TABLE IF NOT EXISTS system_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level       VARCHAR(20) NOT NULL DEFAULT 'info',
  service     VARCHAR(100),
  message     TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_log_email    ON admin_audit_log (admin_email);
CREATE INDEX IF NOT EXISTS idx_audit_log_created  ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user      ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active    ON user_sessions (is_active, last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_logs_level  ON system_logs (level, created_at DESC);

-- Columns to add to existing `users` table (run manually if users table already exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS status            VARCHAR(20) DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at       TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reject_reason     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS block_reason      TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at        TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_by        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_token     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_revoked_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS force_logout       BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS force_logout_at   TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login        TIMESTAMPTZ;

-- Columns to add to whatsapp_tasks (audit fields)
ALTER TABLE whatsapp_tasks ADD COLUMN IF NOT EXISTS resent_at  TIMESTAMPTZ;
ALTER TABLE whatsapp_tasks ADD COLUMN IF NOT EXISTS twilio_sid TEXT;
ALTER TABLE whatsapp_tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
