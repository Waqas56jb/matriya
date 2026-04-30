-- Migration 015: Add missing columns
-- openai_vector_store_id to projects (needed for GPT RAG status)
-- username to project_join_requests (needed for join requests)

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS openai_vector_store_id TEXT;

ALTER TABLE project_join_requests
  ADD COLUMN IF NOT EXISTS username TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_openai_vector_store_id
  ON projects(openai_vector_store_id)
  WHERE openai_vector_store_id IS NOT NULL;
