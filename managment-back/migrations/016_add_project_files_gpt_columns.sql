-- Migration 016: Add missing columns to project_files and projects
-- Required for GPT RAG sync to work correctly

ALTER TABLE project_files
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS openai_file_id TEXT,
  ADD COLUMN IF NOT EXISTS openai_synced_at TIMESTAMPTZ;

-- Backfill updated_at from created_at for existing rows
UPDATE project_files SET updated_at = created_at WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_project_files_openai_file_id
  ON project_files(openai_file_id)
  WHERE openai_file_id IS NOT NULL;
