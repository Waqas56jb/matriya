-- ============================================================
-- MATRIYA — Seed Data: Sample Lab Experiments
-- ============================================================
-- Run this in Supabase SQL Editor AFTER running complete_schema.sql.
-- Replace 'YOUR-PROJECT-ID' with the actual project_id UUID from your projects table.
--
-- To find your project_id run:
--   SELECT id, name FROM public.projects LIMIT 10;
-- ============================================================

DO $$
DECLARE
  v_project_id text := (SELECT id::text FROM public.projects ORDER BY created_at LIMIT 1);
BEGIN
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'No project found. Create a project first in the Management UI.';
  END IF;

  -- Insert 10 seed experiments with realistic lab data
  INSERT INTO public.lab_experiments
    (project_id, experiment_id, formula, percentages, results, experiment_outcome,
     expansion_ratio, char_quality, adhesion, viscosity,
     technology_domain, source_file_reference, updated_at)
  VALUES
    (v_project_id, 'EXP-001', 'APP/PER/MEL baseline formula',
     '{"APP": 30, "PER": 15, "MEL": 10, "IFR": 55, "APP:PER": 2.0}',
     '{"notes": "baseline run"}', 'success',
     14.2, 'GOOD', 85.0, 1200.0,
     'intumescent', 'seed_data', now()),

    (v_project_id, 'EXP-002', 'High APP ratio formulation',
     '{"APP": 35, "PER": 12, "MEL": 8, "IFR": 55, "APP:PER": 2.92}',
     '{"notes": "high APP"}', 'success',
     18.7, 'EXCELLENT', 90.0, 1350.0,
     'intumescent', 'seed_data', now()),

    (v_project_id, 'EXP-003', 'Low PER trial',
     '{"APP": 28, "PER": 10, "MEL": 12, "IFR": 50, "APP:PER": 2.8}',
     '{"notes": "lower PER"}', 'partial',
     9.4, 'FAIR', 72.0, 980.0,
     'intumescent', 'seed_data', now()),

    (v_project_id, 'EXP-004', 'Nanoclay enhanced formula',
     '{"APP": 30, "PER": 15, "MEL": 10, "Nanoclay": 3, "IFR": 55, "APP:PER": 2.0}',
     '{"notes": "nanoclay addition"}', 'success',
     21.3, 'EXCELLENT', 92.0, 1480.0,
     'intumescent', 'seed_data', now()),

    (v_project_id, 'EXP-005', 'High MEL variant',
     '{"APP": 25, "PER": 15, "MEL": 18, "IFR": 58, "APP:PER": 1.67}',
     '{"notes": "increased MEL"}', 'failure',
     6.1, 'POOR', 58.0, 760.0,
     'intumescent', 'seed_data', now()),

    (v_project_id, 'EXP-006', 'Optimal production formula',
     '{"APP": 32, "PER": 14, "MEL": 11, "IFR": 57, "APP:PER": 2.29}',
     '{"notes": "production candidate"}', 'production_formula',
     23.8, 'EXCELLENT', 95.0, 1560.0,
     'intumescent', 'seed_data', now()),

    (v_project_id, 'EXP-007', 'Reduced IFR test',
     '{"APP": 20, "PER": 10, "MEL": 8, "IFR": 38, "APP:PER": 2.0}',
     '{"notes": "reduced loading"}', 'partial',
     11.5, 'FAIR', 68.0, 890.0,
     'intumescent', 'seed_data', now()),

    (v_project_id, 'EXP-008', 'Viscosity optimized formula',
     '{"APP": 30, "PER": 16, "MEL": 10, "IFR": 56, "APP:PER": 1.875}',
     '{"notes": "viscosity control"}', 'success',
     17.9, 'GOOD', 88.0, 1100.0,
     'intumescent', 'seed_data', now()),

    (v_project_id, 'EXP-009', 'High expansion ratio target',
     '{"APP": 38, "PER": 13, "MEL": 9, "Nanoclay": 5, "IFR": 60, "APP:PER": 2.92}',
     '{"notes": "max expansion test"}', 'success',
     27.1, 'EXCELLENT', 94.0, 1620.0,
     'intumescent', 'seed_data', now()),

    (v_project_id, 'EXP-010', 'Adhesion failure analysis',
     '{"APP": 22, "PER": 18, "MEL": 14, "IFR": 54, "APP:PER": 1.22}',
     '{"notes": "adhesion study"}', 'failure',
     8.3, 'POOR', 41.0, 650.0,
     'intumescent', 'seed_data', now())

  ON CONFLICT (project_id, experiment_id) DO UPDATE SET
    expansion_ratio = EXCLUDED.expansion_ratio,
    char_quality    = EXCLUDED.char_quality,
    adhesion        = EXCLUDED.adhesion,
    viscosity       = EXCLUDED.viscosity,
    percentages     = EXCLUDED.percentages,
    experiment_outcome = EXCLUDED.experiment_outcome,
    updated_at      = now();

  RAISE NOTICE 'Seed complete: 10 experiments inserted/updated for project %', v_project_id;
END $$;

-- Verify the seed worked:
SELECT experiment_id, percentages->>'APP' AS APP, percentages->>'PER' AS PER,
       expansion_ratio, char_quality, adhesion, viscosity, experiment_outcome
FROM   public.lab_experiments
WHERE  source_file_reference = 'seed_data'
ORDER  BY experiment_id;
