/**
 * Migration: Project Initialization Proposal Engine — v1.1 (Final)
 * Creates:
 *   - proposals table (stores full proposal JSON)
 *   - source_documents link table
 *   - proposal_metrics table
 * Alters:
 *   - projects: adds goal_value, goal_status, project_type
 *
 * Run: node scripts/migrate-proposals.mjs
 */
import pg from 'pg';
import 'dotenv/config';

const { Client } = pg;
const DB_URL =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  'postgresql://postgres.osrcrdroyhlvrtwpybtr:Matriya2026@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log('Connected to Supabase DB\n');

// ── 1. Alter projects table ────────────────────────────────────────────────────
console.log('1. Altering projects table...');
await client.query(`
  ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS project_type  TEXT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS goal_value    TEXT DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS goal_status   TEXT DEFAULT 'NOT_DEFINED';
`);
console.log('   ✓ projects: project_type, goal_value, goal_status added');

// ── 2. Create proposals table ─────────────────────────────────────────────────
console.log('\n2. Creating proposals table...');
await client.query(`
  CREATE TABLE IF NOT EXISTS public.proposals (
    id           TEXT PRIMARY KEY,
    project_id   UUID NOT NULL,
    data         JSONB NOT NULL DEFAULT '{}'::jsonb,
    approved_at  TIMESTAMPTZ DEFAULT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_proposals_project_id ON public.proposals (project_id);
`);
console.log('   ✓ proposals table ready');

// ── 3. Create source_documents link table ─────────────────────────────────────
console.log('\n3. Creating source_documents link table...');
await client.query(`
  CREATE TABLE IF NOT EXISTS public.source_documents (
    id           BIGSERIAL PRIMARY KEY,
    proposal_id  TEXT NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
    item_type    TEXT NOT NULL,
    item_id      TEXT NOT NULL,
    document_id  TEXT,
    location     TEXT,
    confidence   TEXT DEFAULT 'HIGH',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_source_documents_proposal_id ON public.source_documents (proposal_id);
`);
console.log('   ✓ source_documents table ready');

// ── 4. Create proposal_metrics table ──────────────────────────────────────────
console.log('\n4. Creating proposal_metrics table...');
await client.query(`
  CREATE TABLE IF NOT EXISTS public.proposal_metrics (
    id          BIGSERIAL PRIMARY KEY,
    project_id  UUID NOT NULL,
    name        TEXT NOT NULL,
    confidence  TEXT DEFAULT 'HIGH',
    sources     JSONB DEFAULT '[]'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`);
console.log('   ✓ proposal_metrics table ready');

// ── 5. Verify ─────────────────────────────────────────────────────────────────
console.log('\n5. Verification...');
const { rows: tables } = await client.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('proposals','source_documents','proposal_metrics','projects')
  ORDER BY table_name`);
console.log('   Tables confirmed:', tables.map(r => r.table_name).join(', '));

const { rows: projCols } = await client.query(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'projects'
    AND column_name IN ('project_type','goal_value','goal_status')
  ORDER BY column_name`);
console.log('   projects new columns:', projCols.map(r => r.column_name).join(', '));

await client.end();
console.log('\n✓ Migration complete — Proposal Engine v1.1 schema ready.');
