-- ============================================================
-- MATRIYA Management System — Complete Supabase Schema
-- Generated from code evidence (grep of all .from() calls)
-- Safe to re-run: all statements use IF NOT EXISTS
-- Run once in Supabase SQL Editor
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. PROJECTS (core — everything depends on this)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.projects (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 2. PROJECT MEMBERS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_members (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id     text        NOT NULL,
  role        text        NOT NULL DEFAULT 'member',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

-- ─────────────────────────────────────────────
-- 3. PROJECT JOIN REQUESTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_join_requests (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id     text        NOT NULL,
  status      text        NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 4. USER CACHE (auth proxy cache from matriya-back)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_cache (
  user_id    text        PRIMARY KEY,
  username   text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 5. PROJECT FILES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_files (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   text        NOT NULL,
  file_name    text        NOT NULL,
  file_url     text,
  file_type    text,
  file_size    integer,
  storage_path text,
  uploaded_by  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 6. PROJECT EMAILS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_emails (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          text        NOT NULL,
  from_email          text,
  to_email            text,
  subject             text,
  body_text           text,
  direction           text        NOT NULL DEFAULT 'outbound',
  status              text        NOT NULL DEFAULT 'draft',
  provider_message_id text,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);

-- ─────────────────────────────────────────────
-- 7. PROJECT CHAT MESSAGES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_chat_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text        NOT NULL,
  sender      text        NOT NULL,
  message     text        NOT NULL,
  role        text        NOT NULL DEFAULT 'user',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 8. PROJECT CHAT LAST READ
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_chat_last_read (
  project_id   text        NOT NULL,
  user_id      text        NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

-- ─────────────────────────────────────────────
-- 9. TASKS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text        NOT NULL,
  title       text        NOT NULL,
  description text,
  status      text        NOT NULL DEFAULT 'לביצוע',
  priority    text        NOT NULL DEFAULT 'בינוני',
  assigned_to text,
  due_date    date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 10. MILESTONES  (code uses "milestones" — NOT "project_milestones")
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.milestones (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     text        NOT NULL,
  title          text        NOT NULL,
  description    text,
  due_date       date,
  completed_date date,
  status         text        NOT NULL DEFAULT 'pending',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 11. DOCUMENTS  (code uses "documents" — not "project_documents")
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.documents (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text        NOT NULL,
  title      text        NOT NULL,
  content    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 12. NOTES  (code uses "notes" — NOT "project_notes")
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text        NOT NULL,
  title      text,
  content    text        NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 13. AUDIT LOG  (code uses "audit_log" — NOT "activity_log")
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text,
  user_id     text,
  username    text,
  action      text        NOT NULL,
  entity_type text,
  entity_id   text,
  details     jsonb,
  request_id  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 14. MATERIALS (global catalog)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.materials (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id       text        UNIQUE NOT NULL,
  material_name     text        NOT NULL,
  aliases           text[]      NOT NULL DEFAULT '{}',
  material_family   text,
  material_role     text,
  technology_domain text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 15. MATERIAL LIBRARY (per-project materials)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.material_library (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       text        NOT NULL,
  name             text        NOT NULL,
  role_or_function text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 16. LAB EXPERIMENTS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lab_experiments (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            text        NOT NULL,
  experiment_id         text        NOT NULL,
  experiment_version    integer     NOT NULL DEFAULT 1,
  technology_domain     text        NOT NULL DEFAULT '',
  formula               text,
  materials             jsonb       NOT NULL DEFAULT '[]',
  percentages           jsonb       NOT NULL DEFAULT '{}',
  results               text,
  experiment_outcome    text        NOT NULL DEFAULT 'success',
  is_production_formula boolean     NOT NULL DEFAULT false,
  source_file_reference text,
  research_session_id   text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, experiment_id)
);

-- ─────────────────────────────────────────────
-- 17. IMPORT LOG
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.import_log (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            text        NOT NULL,
  source_file_reference text,
  source_type           text,
  created_count         integer     NOT NULL DEFAULT 0,
  updated_count         integer     NOT NULL DEFAULT 0,
  error_count           integer     NOT NULL DEFAULT 0,
  details               jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 18. RUNS (FSM feature-tagged runs)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.runs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        text        NOT NULL,
  status            text        NOT NULL DEFAULT 'draft',
  features_core     text[]      NOT NULL DEFAULT '{}',
  features_extended text[]      NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 19. RUN FSM TRACE
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.run_fsm_trace (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid        NOT NULL,
  from_state text,
  to_state   text,
  rule_id    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 20. SHAREPOINT DISPLAY NAMES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sharepoint_display_names (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   text        NOT NULL,
  path         text        NOT NULL,
  display_name text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, path)
);

-- ─────────────────────────────────────────────
-- 21. WHATSAPP WHITELIST (safe: already exists)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_whitelist (
  phone      text        PRIMARY KEY,
  label      text,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 22. WHATSAPP TASKS  (code uses "whatsapp_tasks" — NOT "whatsapp_task_queue")
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_tasks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_number  text        NOT NULL,
  message      text        NOT NULL,
  status       text        NOT NULL DEFAULT 'PENDING',
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

-- ─────────────────────────────────────────────
-- 23. ACCESS REQUESTS (matriya-back)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.access_requests (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text        NOT NULL,
  status       text        NOT NULL DEFAULT 'pending',
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz
);

-- ─────────────────────────────────────────────
-- 24. TWILIO TICKETS (matriya-back WhatsApp gateway)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.twilio_tickets (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number     text        NOT NULL,
  direction        text        NOT NULL,
  message          text,
  pipeline_result  jsonb,
  action_package   jsonb,
  parent_ticket_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 25. FINANCE SIGNALS (matriya-finance trigger_monitor)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.finance_signals (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id         text        UNIQUE NOT NULL,
  instrument        text        NOT NULL,
  a_value           numeric,
  decision          text,
  signal_timestamp  timestamptz NOT NULL DEFAULT now(),
  trigger_type      text,
  source            text,
  class_label       text,
  composite_alert   boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_projects_updated        ON public.projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_members_project ON public.project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user    ON public.project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_files_project   ON public.project_files(project_id);
CREATE INDEX IF NOT EXISTS idx_project_emails_project  ON public.project_emails(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_project   ON public.project_chat_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project           ON public.tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_milestones_project      ON public.milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_documents_project       ON public.documents(project_id);
CREATE INDEX IF NOT EXISTS idx_notes_project           ON public.notes(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_project       ON public.audit_log(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created       ON public.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_library_proj   ON public.material_library(project_id);
CREATE INDEX IF NOT EXISTS idx_lab_experiments_project ON public.lab_experiments(project_id);
CREATE INDEX IF NOT EXISTS idx_lab_experiments_eid     ON public.lab_experiments(experiment_id);
CREATE INDEX IF NOT EXISTS idx_import_log_project      ON public.import_log(project_id);
CREATE INDEX IF NOT EXISTS idx_runs_project            ON public.runs(project_id);
CREATE INDEX IF NOT EXISTS idx_run_fsm_trace_run       ON public.run_fsm_trace(run_id);
CREATE INDEX IF NOT EXISTS idx_sharepoint_dn_project   ON public.sharepoint_display_names(project_id);
CREATE INDEX IF NOT EXISTS idx_finance_signals_ts      ON public.finance_signals(signal_timestamp DESC);

-- ─────────────────────────────────────────────
-- VERIFICATION QUERY
-- Run this after to confirm all tables exist:
-- ─────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
