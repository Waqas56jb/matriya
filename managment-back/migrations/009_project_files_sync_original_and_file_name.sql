-- Repair legacy rows where only one of (file_name, original_name) was populated.
-- Run in Supabase SQL Editor if uploads list filenames as blank while DB has values.
-- Requires columns file_name + original_name (add file_name via ALTER if missing).

UPDATE project_files
SET original_name = file_name
WHERE (original_name IS NULL OR trim(original_name) = '')
  AND file_name IS NOT NULL AND trim(file_name) <> '';

UPDATE project_files
SET file_name = original_name
WHERE (file_name IS NULL OR trim(file_name) = '')
  AND original_name IS NOT NULL AND trim(original_name) <> '';
