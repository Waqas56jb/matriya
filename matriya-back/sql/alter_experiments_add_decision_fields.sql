-- =============================================================================
-- Migration: add MATRIYA decision-tracking fields to experiments table
-- Run once in Supabase SQL editor.
-- Safe to re-run — uses ADD COLUMN IF NOT EXISTS.
-- =============================================================================

ALTER TABLE experiments
  ADD COLUMN IF NOT EXISTS decision_shift   TEXT    NULL,
  ADD COLUMN IF NOT EXISTS breakdown_flag   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS validated        BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fast filtering on unvalidated or flagged experiments
CREATE INDEX IF NOT EXISTS idx_experiments_breakdown_flag ON experiments (breakdown_flag);
CREATE INDEX IF NOT EXISTS idx_experiments_validated      ON experiments (validated);

-- =============================================================================
-- Field semantics:
--   decision_shift  — last MATRIYA decision that touched this experiment:
--                     'GO' | 'ITERATE' | 'STOP' | NULL (not yet evaluated)
--   breakdown_flag  — TRUE when kernelV16 FSCTM fired a breakdown gate on this row
--   validated       — TRUE when a human operator or downstream pipeline confirms
--                     the experiment result matches the decision
-- =============================================================================

-- Verify the migration succeeded
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_name = 'experiments'
  AND  column_name IN ('decision_shift', 'breakdown_flag', 'validated')
ORDER  BY column_name;
