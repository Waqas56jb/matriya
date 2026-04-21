-- finance_signals.sql
-- Run once in Supabase SQL Editor.
-- Stores finance monitor signals written by trigger_monitor.py (matriya-finance).
-- Read by matriya-finance /api/finance/signals → served to dashboard + F STATUS WhatsApp command.

CREATE TABLE IF NOT EXISTS finance_signals (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id         TEXT        UNIQUE NOT NULL,          -- uuid from trigger_monitor.py
  instrument        TEXT        NOT NULL,                  -- e.g. "ZION", "^VIX", "COMPOSITE"
  a_value           NUMERIC,                               -- numeric signal value (pct change, yield, etc.)
  decision          TEXT,                                  -- "Act" | "Hold"
  signal_timestamp  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_type      TEXT,                                  -- e.g. "YIELD_CURVE_INVERSION", null = heartbeat
  source            TEXT,                                  -- "FRED" | "SEC_EDGAR" | "trigger_monitor_heartbeat" | "composite_rule"
  class_label       TEXT,                                  -- "Bf-s" | "Bf-m"
  composite_alert   BOOLEAN     NOT NULL DEFAULT FALSE,    -- true = structural instability warning row
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for dashboard queries (latest signals first)
CREATE INDEX IF NOT EXISTS finance_signals_timestamp_idx
  ON finance_signals (signal_timestamp DESC);

-- Index for instrument filtering
CREATE INDEX IF NOT EXISTS finance_signals_instrument_idx
  ON finance_signals (instrument);

-- Row Level Security: service role bypasses RLS automatically.
-- Enable RLS so anon cannot read secrets.
ALTER TABLE finance_signals ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (default in Supabase when using service key).
-- Anon reads blocked — signals are operator-only data.
CREATE POLICY "service_role_all" ON finance_signals
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
