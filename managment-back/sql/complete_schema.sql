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
-- Columns match managment-back/server.js insert payloads exactly.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_emails (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       text        NOT NULL,
  direction        text        NOT NULL DEFAULT 'sent',  -- 'sent' | 'received'
  from_email       text,
  to_emails        text[],                               -- array of recipients
  subject          text,
  body_text        text,
  body_html        text,
  resend_email_id  text,                                 -- Resend message ID
  sent_by_user_id  text,
  sent_by_username text,
  attachments      jsonb        NOT NULL DEFAULT '[]',
  status           text         NOT NULL DEFAULT 'sent',
  error_message    text,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  sent_at          timestamptz
);

-- ─────────────────────────────────────────────
-- 7. PROJECT CHAT MESSAGES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_chat_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  text        NOT NULL,
  -- canonical fields (written and read by app)
  user_id     integer,
  username    text        NOT NULL DEFAULT '',
  body        text        NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- legacy fields kept for backward compat (app never writes/reads these)
  sender      text        NOT NULL DEFAULT '',
  message     text        NOT NULL DEFAULT '',
  role        text        NOT NULL DEFAULT 'user'
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
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

-- ─────────────────────────────────────────────
-- 16. EXPERIMENTS (canonical lab data — populated from Excel after normalization)
-- This is the primary science data layer read by the LabQueryEngine.
-- formulation JSONB: { APP, PER, MEL, "APP:PER", IFR, Nanoclay, formula }
-- results     JSONB: { expansion_ratio, char_quality, adhesion, viscosity, ... }
-- status: PASS | FAIL | PARTIAL | PENDING
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.experiments (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id  text        NOT NULL,
  project_id     text        NOT NULL,
  formulation    jsonb       NOT NULL DEFAULT '{}',
  results        jsonb       NOT NULL DEFAULT '{}',
  status         text        NOT NULL DEFAULT 'PENDING',
  validated      boolean     NOT NULL DEFAULT false,
  source         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, experiment_id)
);

CREATE INDEX IF NOT EXISTS idx_experiments_project   ON public.experiments(project_id);
CREATE INDEX IF NOT EXISTS idx_experiments_status    ON public.experiments(status);
CREATE INDEX IF NOT EXISTS idx_experiments_created   ON public.experiments(created_at DESC);

-- ─────────────────────────────────────────────
-- 17. RESEARCH SESSIONS (Supabase management layer)
-- Used by managment-back /api/projects/:projectId/research-sessions
-- Separate from matriya-back Sequelize research_sessions (FSCTM engine).
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.research_sessions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text        NOT NULL,
  name       text,
  started_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────
-- 17. LAB EXPERIMENTS
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
  -- Structured result metrics stored as typed columns for reliable numeric queries
  expansion_ratio       numeric,
  char_quality          text,
  adhesion              numeric,
  viscosity             numeric,
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
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_number      text        NOT NULL,
  message          text        NOT NULL,
  status           text        NOT NULL DEFAULT 'PENDING',
  decision         text,
  confidence       numeric,
  candidates       jsonb,
  rachel_notified  boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz
);

-- ─────────────────────────────────────────────
-- 23. ACCESS REQUESTS (matriya-back WhatsApp whitelist requests)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.access_requests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number  text        NOT NULL,
  first_message text,
  request_count integer     NOT NULL DEFAULT 1,
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  status        text        NOT NULL DEFAULT 'pending',
  reviewed_by   text,
  reviewed_at   timestamptz,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
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
-- COLUMN GUARDS
-- Add any columns that may be missing if tables were created
-- previously with an incomplete schema (ALTER ADD COLUMN IF NOT EXISTS
-- is a no-op when the column already exists — always safe to run).
-- ─────────────────────────────────────────────

-- projects
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

-- project_members
ALTER TABLE public.project_members ADD COLUMN IF NOT EXISTS role       text NOT NULL DEFAULT 'member';
ALTER TABLE public.project_members ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- project_files
ALTER TABLE public.project_files ADD COLUMN IF NOT EXISTS file_size          integer;
ALTER TABLE public.project_files ADD COLUMN IF NOT EXISTS storage_path       text;
ALTER TABLE public.project_files ADD COLUMN IF NOT EXISTS uploaded_by        text;
ALTER TABLE public.project_files ADD COLUMN IF NOT EXISTS original_name      text;
ALTER TABLE public.project_files ADD COLUMN IF NOT EXISTS folder_display_name text;
ALTER TABLE public.project_files ADD COLUMN IF NOT EXISTS ingest_error       text;
ALTER TABLE public.project_files ADD COLUMN IF NOT EXISTS source_email_id    text;

-- project_emails — patch old incomplete schema
ALTER TABLE public.project_emails ADD COLUMN IF NOT EXISTS direction        text        NOT NULL DEFAULT 'sent';
ALTER TABLE public.project_emails ADD COLUMN IF NOT EXISTS status           text        NOT NULL DEFAULT 'sent';
ALTER TABLE public.project_emails ADD COLUMN IF NOT EXISTS from_email       text;
ALTER TABLE public.project_emails ADD COLUMN IF NOT EXISTS to_emails        text[];
ALTER TABLE public.project_emails ADD COLUMN IF NOT EXISTS subject          text;
ALTER TABLE public.project_emails ADD COLUMN IF NOT EXISTS body_text        text;
ALTER TABLE public.project_emails ADD COLUMN IF NOT EXISTS body_html        text;
ALTER TABLE public.project_emails ADD COLUMN IF NOT EXISTS resend_email_id  text;
ALTER TABLE public.project_emails ADD COLUMN IF NOT EXISTS sent_by_user_id  text;
ALTER TABLE public.project_emails ADD COLUMN IF NOT EXISTS sent_by_username text;
ALTER TABLE public.project_emails ADD COLUMN IF NOT EXISTS attachments      jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.project_emails ADD COLUMN IF NOT EXISTS error_message    text;
ALTER TABLE public.project_emails ADD COLUMN IF NOT EXISTS sent_at          timestamptz;

-- tasks
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS priority    text NOT NULL DEFAULT 'בינוני';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS assigned_to text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS due_date    date;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS updated_at  timestamptz NOT NULL DEFAULT now();

-- milestones
ALTER TABLE public.milestones ADD COLUMN IF NOT EXISTS project_id     text NOT NULL DEFAULT '';
ALTER TABLE public.milestones ADD COLUMN IF NOT EXISTS description    text;
ALTER TABLE public.milestones ADD COLUMN IF NOT EXISTS due_date       date;
ALTER TABLE public.milestones ADD COLUMN IF NOT EXISTS completed_date date;
ALTER TABLE public.milestones ADD COLUMN IF NOT EXISTS updated_at     timestamptz NOT NULL DEFAULT now();

-- documents  ← THIS IS WHAT CAUSED THE ERROR
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS project_id text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS content    text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- notes
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS project_id text;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS title      text;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE public.notes ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- audit_log
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS project_id  text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS user_id     text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS username    text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS entity_id   text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS details     jsonb;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS request_id  text;

-- materials
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS aliases           text[]  NOT NULL DEFAULT '{}';
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS material_family   text;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS material_role     text;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS technology_domain text;

-- material_library
ALTER TABLE public.material_library ADD COLUMN IF NOT EXISTS project_id       text NOT NULL DEFAULT '';
ALTER TABLE public.material_library ADD COLUMN IF NOT EXISTS role_or_function text;
-- Add UNIQUE constraint required for upsert onConflict: 'project_id,name'
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'material_library_project_id_name_key'
      AND conrelid = 'public.material_library'::regclass
  ) THEN
    ALTER TABLE public.material_library ADD CONSTRAINT material_library_project_id_name_key UNIQUE (project_id, name);
  END IF;
END $$;

-- research_sessions
ALTER TABLE public.research_sessions ADD COLUMN IF NOT EXISTS project_id text NOT NULL DEFAULT '';
ALTER TABLE public.research_sessions ADD COLUMN IF NOT EXISTS name       text;
ALTER TABLE public.research_sessions ADD COLUMN IF NOT EXISTS started_at timestamptz NOT NULL DEFAULT now();

-- lab_experiments
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS experiment_version    integer     NOT NULL DEFAULT 1;
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS technology_domain     text        NOT NULL DEFAULT '';
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS formula               text;
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS materials             jsonb       NOT NULL DEFAULT '[]';
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS percentages           jsonb       NOT NULL DEFAULT '{}';
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS results               text;
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS experiment_outcome    text        NOT NULL DEFAULT 'success';
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS is_production_formula boolean     NOT NULL DEFAULT false;
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS source_file_reference text;
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS research_session_id   text;
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS updated_at            timestamptz NOT NULL DEFAULT now();
-- Structured result metrics — stored as direct numeric columns for reliable querying
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS expansion_ratio       numeric;
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS char_quality          text;
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS adhesion              numeric;
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS viscosity             numeric;

-- runs
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS features_core     text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS features_extended text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.runs ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now();

-- run_fsm_trace
ALTER TABLE public.run_fsm_trace ADD COLUMN IF NOT EXISTS run_id     uuid;
ALTER TABLE public.run_fsm_trace ADD COLUMN IF NOT EXISTS from_state text;
ALTER TABLE public.run_fsm_trace ADD COLUMN IF NOT EXISTS to_state   text;
ALTER TABLE public.run_fsm_trace ADD COLUMN IF NOT EXISTS rule_id    text;

-- import_log
ALTER TABLE public.import_log ADD COLUMN IF NOT EXISTS source_file_reference text;
ALTER TABLE public.import_log ADD COLUMN IF NOT EXISTS source_type           text;
ALTER TABLE public.import_log ADD COLUMN IF NOT EXISTS created_count         integer NOT NULL DEFAULT 0;
ALTER TABLE public.import_log ADD COLUMN IF NOT EXISTS updated_count         integer NOT NULL DEFAULT 0;
ALTER TABLE public.import_log ADD COLUMN IF NOT EXISTS error_count           integer NOT NULL DEFAULT 0;
ALTER TABLE public.import_log ADD COLUMN IF NOT EXISTS details               jsonb;

-- finance_signals
ALTER TABLE public.finance_signals ADD COLUMN IF NOT EXISTS trigger_type    text;
ALTER TABLE public.finance_signals ADD COLUMN IF NOT EXISTS source          text;
ALTER TABLE public.finance_signals ADD COLUMN IF NOT EXISTS class_label     text;
ALTER TABLE public.finance_signals ADD COLUMN IF NOT EXISTS composite_alert boolean NOT NULL DEFAULT false;

-- whatsapp_tasks (extended columns from webhook handler)
ALTER TABLE public.whatsapp_tasks ADD COLUMN IF NOT EXISTS decision         text;
ALTER TABLE public.whatsapp_tasks ADD COLUMN IF NOT EXISTS confidence       numeric;
ALTER TABLE public.whatsapp_tasks ADD COLUMN IF NOT EXISTS candidates       jsonb;
ALTER TABLE public.whatsapp_tasks ADD COLUMN IF NOT EXISTS rachel_notified  boolean NOT NULL DEFAULT false;

-- access_requests (extended columns from whitelist system)
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS phone_number  text NOT NULL DEFAULT '';
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS first_message text;
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS request_count integer NOT NULL DEFAULT 1;
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS first_seen    timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS last_seen     timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS reviewed_by   text;
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS note          text;

-- Lab row provenance (MATRIYA: structured metrics vs RAG/document context)
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS source_document_id text;
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS source_sheet text;
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS source_row_number integer;
ALTER TABLE public.lab_experiments ADD COLUMN IF NOT EXISTS provenance_status text;

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
CREATE INDEX IF NOT EXISTS idx_research_sessions_proj  ON public.research_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_research_sessions_ts    ON public.research_sessions(started_at DESC);
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
