-- ============================================================
-- Access Requests — numbers that tried to message but were denied
-- Run once in Supabase SQL editor.
-- ============================================================
CREATE TABLE IF NOT EXISTS access_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  first_message TEXT,
  request_count INTEGER NOT NULL DEFAULT 1,
  first_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | approved | denied
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  note          TEXT
);

-- Unique per phone number so we upsert on conflict
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_phone ON access_requests (phone_number);
CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests (status, last_seen DESC);

-- Helper function to increment request_count on repeated attempts
CREATE OR REPLACE FUNCTION increment_access_request_count(p_phone TEXT)
RETURNS VOID LANGUAGE SQL AS $$
  UPDATE access_requests
  SET request_count = request_count + 1,
      last_seen = NOW()
  WHERE phone_number = p_phone;
$$;
