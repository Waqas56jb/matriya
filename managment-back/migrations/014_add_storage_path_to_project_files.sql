-- Migration 014: Add storage_path column to project_files
-- Rule: Additive only — no DROP, no destructive SQL
-- Reason: upload handler uses storage_path to track Supabase Storage location;
--         column was missing causing all file uploads to fail after insert.

ALTER TABLE project_files
  ADD COLUMN IF NOT EXISTS storage_path TEXT;

CREATE INDEX IF NOT EXISTS idx_project_files_storage_path ON project_files(storage_path) WHERE storage_path IS NOT NULL;
