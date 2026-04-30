-- =============================================================
-- Migration 013: Data Governance + Contract/Approval Workflow
-- Version: v1.2
-- Date: 2026-04-30
-- Branch: feature/data-governance-v1.2
-- Approved by: David
-- Rule: Additive only — no DROP, no DROP CONSTRAINT, no destructive SQL
-- =============================================================

-- -----------------------------------------------------------
-- PART A: Data Governance — augment existing tables
-- -----------------------------------------------------------

-- A1. Extend audit_log with before/after snapshots + record identity
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS record_type     TEXT,
  ADD COLUMN IF NOT EXISTS record_id       TEXT,
  ADD COLUMN IF NOT EXISTS before_value    JSONB,
  ADD COLUMN IF NOT EXISTS after_value     JSONB,
  ADD COLUMN IF NOT EXISTS reason          TEXT,
  ADD COLUMN IF NOT EXISTS approval_status TEXT;

-- A2. Governance fields on lab_experiments
ALTER TABLE lab_experiments
  ADD COLUMN IF NOT EXISTS source_table             TEXT,
  ADD COLUMN IF NOT EXISTS source_row_id            TEXT,
  ADD COLUMN IF NOT EXISTS source_file_reference    TEXT,
  ADD COLUMN IF NOT EXISTS created_by               TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by              TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_identity_status TEXT DEFAULT 'draft';

-- A3. Governance fields on experiments
ALTER TABLE experiments
  ADD COLUMN IF NOT EXISTS source_table             TEXT,
  ADD COLUMN IF NOT EXISTS source_row_id            TEXT,
  ADD COLUMN IF NOT EXISTS source_file_reference    TEXT,
  ADD COLUMN IF NOT EXISTS created_by               TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by              TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_identity_status TEXT DEFAULT 'draft';

-- A4. Governance fields on project_files
ALTER TABLE project_files
  ADD COLUMN IF NOT EXISTS created_by               TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by              TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_identity_status TEXT DEFAULT 'draft';

-- A5. Governance fields on material_library
ALTER TABLE material_library
  ADD COLUMN IF NOT EXISTS created_by               TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by              TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS evidence_identity_status TEXT DEFAULT 'draft';

-- A6. Extend project_members with granular RBAC role
--     Existing 'role' column is NOT modified — role_v2 is additive
ALTER TABLE project_members
  ADD COLUMN IF NOT EXISTS role_v2 TEXT DEFAULT 'member';
-- Valid values: owner | admin | researcher | lab_user | viewer | external

-- -----------------------------------------------------------
-- PART B: Contract / Approval Workflow — new tables
-- -----------------------------------------------------------

-- B1. Project contracts
CREATE TABLE IF NOT EXISTS project_contracts (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id   UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  description  TEXT,
  status       TEXT        NOT NULL DEFAULT 'draft',
  -- status: draft | pending_approval | approved | rejected | locked | archived
  created_by   TEXT        NOT NULL,
  reviewed_by  TEXT,
  reviewed_at  TIMESTAMPTZ,
  approved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- B2. Contract terms
CREATE TABLE IF NOT EXISTS contract_terms (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_id  UUID        NOT NULL REFERENCES project_contracts(id) ON DELETE CASCADE,
  term_key     TEXT        NOT NULL,
  term_value   TEXT        NOT NULL,
  term_type    TEXT        DEFAULT 'general',
  -- term_type: general | compliance | data_access | expiry | custom
  sort_order   INTEGER     DEFAULT 0,
  created_by   TEXT        NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- B3. Approval logs (append-only — never UPDATE or DELETE rows from this table)
CREATE TABLE IF NOT EXISTS approval_logs (
  id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  record_type     TEXT        NOT NULL,
  -- record_type: contract | experiment | file | material | formulation | decision
  record_id       TEXT        NOT NULL,
  project_id      UUID,
  action          TEXT        NOT NULL,
  -- action: submitted | approved | rejected | locked | unlocked | archived | reviewed
  previous_status TEXT,
  new_status      TEXT,
  actor           TEXT        NOT NULL,
  reason          TEXT,
  metadata        JSONB       DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_project_contracts_project  ON project_contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_project_contracts_status   ON project_contracts(status);
CREATE INDEX IF NOT EXISTS idx_contract_terms_contract    ON contract_terms(contract_id);
CREATE INDEX IF NOT EXISTS idx_approval_logs_record       ON approval_logs(record_type, record_id);
CREATE INDEX IF NOT EXISTS idx_approval_logs_project      ON approval_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_approval_logs_actor        ON approval_logs(actor);
CREATE INDEX IF NOT EXISTS idx_lab_exp_gov_status         ON lab_experiments(evidence_identity_status);
CREATE INDEX IF NOT EXISTS idx_experiments_gov_status     ON experiments(evidence_identity_status);

-- -----------------------------------------------------------
-- Rollback SQL (run ONLY if David explicitly approves rollback)
-- -----------------------------------------------------------
-- DROP TABLE IF EXISTS approval_logs;
-- DROP TABLE IF EXISTS contract_terms;
-- DROP TABLE IF EXISTS project_contracts;
-- ALTER TABLE project_members    DROP COLUMN IF EXISTS role_v2;
-- ALTER TABLE material_library   DROP COLUMN IF EXISTS evidence_identity_status, reviewed_at, reviewed_by, created_by;
-- ALTER TABLE project_files      DROP COLUMN IF EXISTS evidence_identity_status, reviewed_at, reviewed_by, created_by;
-- ALTER TABLE experiments        DROP COLUMN IF EXISTS evidence_identity_status, reviewed_at, reviewed_by, created_by, source_file_reference, source_row_id, source_table;
-- ALTER TABLE lab_experiments    DROP COLUMN IF EXISTS evidence_identity_status, reviewed_at, reviewed_by, created_by, source_file_reference, source_row_id, source_table;
-- ALTER TABLE audit_log          DROP COLUMN IF EXISTS approval_status, reason, after_value, before_value, record_id, record_type;
