-- =============================================================================
-- Migration: add pipeline result columns to whatsapp_tasks for audit trail
-- Run once in Supabase SQL editor. Safe to re-run.
-- =============================================================================

ALTER TABLE whatsapp_tasks
  ADD COLUMN IF NOT EXISTS decision      TEXT    NULL,
  ADD COLUMN IF NOT EXISTS confidence    INTEGER NULL,
  ADD COLUMN IF NOT EXISTS candidates    JSONB   NULL,
  ADD COLUMN IF NOT EXISTS rachel_notified BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for filtering by decision type
CREATE INDEX IF NOT EXISTS idx_whatsapp_tasks_decision ON whatsapp_tasks (decision);

-- Verify migration
SELECT column_name, data_type
FROM   information_schema.columns
WHERE  table_name = 'whatsapp_tasks'
ORDER  BY ordinal_position;
