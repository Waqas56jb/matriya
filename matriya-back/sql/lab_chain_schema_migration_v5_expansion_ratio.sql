-- =============================================================================
-- MIGRATION v5 — outcomes: add expansion_ratio column
-- Intumescent expansion ratio is a core intumescent measurement (how many times
-- the coating expands when heated). It belongs alongside viscosity in outcomes.
-- Idempotent. Safe to run multiple times.
-- =============================================================================

ALTER TABLE outcomes ADD COLUMN IF NOT EXISTS expansion_ratio NUMERIC(6,2) NULL;

COMMENT ON COLUMN outcomes.expansion_ratio IS
  'Intumescent expansion ratio (dimensionless multiple), e.g. 23.8 means 23.8× volume expansion on heating';

-- =============================================================================
-- SEED: Backfill expansion_ratio into existing BASE-003 production runs
-- so the version_comparison test returns expansion_ratio channel data.
--
-- The two run UUIDs below come from the seeded production_runs rows that
-- the Lab Bridge already returns for BASE-003 versions 003.1 / 003.2.
-- We UPDATE outcomes where the linked measurement belongs to those runs.
-- If those exact UUIDs differ in your DB, replace them or run:
--   SELECT pr.id, pr.batch_id, f.base_id, f.version
--   FROM production_runs pr JOIN formulations f ON f.id = pr.formulation_id
--   WHERE f.base_id = 'BASE-003' ORDER BY f.version;
-- =============================================================================

-- Update outcomes for runs linked to BASE-003 / version 003.1 (baseline)
UPDATE outcomes o
SET expansion_ratio = 19.4
FROM measurements m
JOIN production_runs pr ON pr.id = m.production_run_id
JOIN formulations f     ON f.id  = pr.formulation_id
WHERE m.id = o.measurement_id
  AND f.base_id = 'BASE-003'
  AND f.version = '003.1'
  AND o.expansion_ratio IS NULL;

-- Update outcomes for runs linked to BASE-003 / version 003.2 (compare run)
UPDATE outcomes o
SET expansion_ratio = 23.8
FROM measurements m
JOIN production_runs pr ON pr.id = m.production_run_id
JOIN formulations f     ON f.id  = pr.formulation_id
WHERE m.id = o.measurement_id
  AND f.base_id = 'BASE-003'
  AND f.version = '003.2'
  AND o.expansion_ratio IS NULL;

-- Verify the backfill:
SELECT
  f.base_id,
  f.version,
  pr.run_origin,
  o.expansion_ratio,
  o.v6,
  o.v12
FROM outcomes o
JOIN measurements m     ON m.id = o.measurement_id
JOIN production_runs pr ON pr.id = m.production_run_id
JOIN formulations f     ON f.id  = pr.formulation_id
WHERE f.base_id = 'BASE-003'
ORDER BY f.version;
