-- =============================================================================
-- experiments table — full schema per David's spec
-- Run in Supabase SQL Editor.
-- Safe to run on a fresh DB (CREATE IF NOT EXISTS) or existing table (ALTER).
-- =============================================================================

-- Step 1: Create the table if it does not exist at all
CREATE TABLE IF NOT EXISTS experiments (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     TEXT        NOT NULL,
  experiment_id  TEXT        UNIQUE NOT NULL,
  date           DATE        NULL,
  operator       TEXT        NULL,
  formulation    JSONB       NULL,
  conditions     JSONB       NULL,
  results        JSONB       NULL,
  outcome        TEXT        NULL,
  status         TEXT        NULL CHECK (status IN ('PASS','FAIL','PARTIAL','PENDING')),
  decision_shift BOOLEAN     NOT NULL DEFAULT FALSE,
  breakdown_flag BOOLEAN     NOT NULL DEFAULT FALSE,
  validated      BOOLEAN     NOT NULL DEFAULT FALSE,
  notes          TEXT        NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Step 2: Add missing columns to tables that already existed before this migration
ALTER TABLE experiments
  ADD COLUMN IF NOT EXISTS project_id     TEXT        NULL,
  ADD COLUMN IF NOT EXISTS experiment_id  TEXT        NULL,
  ADD COLUMN IF NOT EXISTS date           DATE        NULL,
  ADD COLUMN IF NOT EXISTS operator       TEXT        NULL,
  ADD COLUMN IF NOT EXISTS formulation    JSONB       NULL,
  ADD COLUMN IF NOT EXISTS conditions     JSONB       NULL,
  ADD COLUMN IF NOT EXISTS results        JSONB       NULL,
  ADD COLUMN IF NOT EXISTS outcome        TEXT        NULL,
  ADD COLUMN IF NOT EXISTS status         TEXT        NULL,
  ADD COLUMN IF NOT EXISTS notes          TEXT        NULL;

-- Step 3: Fix decision_shift column type (earlier migration added it as TEXT)
-- Convert TEXT → BOOLEAN safely (NULL stays NULL, any existing value becomes FALSE)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'experiments'
      AND column_name = 'decision_shift'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE experiments
      ALTER COLUMN decision_shift DROP DEFAULT,
      ALTER COLUMN decision_shift TYPE BOOLEAN
        USING COALESCE(decision_shift::boolean, FALSE),
      ALTER COLUMN decision_shift SET DEFAULT FALSE,
      ALTER COLUMN decision_shift SET NOT NULL;
  END IF;
END $$;

-- Step 4: Indexes
CREATE INDEX IF NOT EXISTS idx_experiments_project_id    ON experiments (project_id);
CREATE INDEX IF NOT EXISTS idx_experiments_status        ON experiments (status);
CREATE INDEX IF NOT EXISTS idx_experiments_decision_shift ON experiments (decision_shift);
CREATE INDEX IF NOT EXISTS idx_experiments_breakdown_flag ON experiments (breakdown_flag);
CREATE INDEX IF NOT EXISTS idx_experiments_validated      ON experiments (validated);

-- =============================================================================
-- PASS verification — confirm columns exist with correct types
-- =============================================================================
SELECT column_name, data_type, is_nullable, column_default
FROM   information_schema.columns
WHERE  table_name = 'experiments'
ORDER  BY ordinal_position;
