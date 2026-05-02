-- Decision Engine Contract v1.1 /decision/run — audit append-only support (David GO 3 May 2026)
-- Apply on Supabase Postgres before relying on nullable session_id + decision_run_v11_audit.
-- Commit #4 (engine): schema migration required for §6 DecisionAuditLog fields.

ALTER TABLE decision_audit_log ALTER COLUMN session_id DROP NOT NULL;

ALTER TABLE decision_audit_log
  ADD COLUMN IF NOT EXISTS decision_run_v11_audit JSONB DEFAULT NULL;

COMMENT ON COLUMN decision_audit_log.decision_run_v11_audit IS
  'v1.1 decision/run snapshot: trace_id, input_hash, engine_version, decision, fsctm_state, confidence, data_grade, data_source, timestamp UTC, cache_hit';
