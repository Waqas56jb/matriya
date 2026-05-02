/**
 * Staging checklist (David): after Supabase DDL (migrations/decision_run_v110_audit.sql),
 * hit POST /decision/run and run the proof SELECT on the same DB the API uses.
 *
 * Step 3: POST /decision/run — uses input.type "lab" (no research session required; still
 *         persists decision_run_v11_audit with session_id null).
 * Step 4: SELECT id, decision, decision_run_v11_audit ... LIMIT 5
 *
 * Env:
 *   MATRIYA_API_BASE — API root, no trailing slash (default http://127.0.0.1:8000)
 *   POSTGRES_URL | POSTGRES_PRISMA_URL | SUPABASE_DB_URL | DATABASE_URL — must match the API DB
 *   STAGING_DECISION_PROJECT_ID, STAGING_DECISION_MODEL_ID — optional strings for contract body
 */

import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const base = (
  process.env.MATRIYA_API_BASE ||
  process.env.API_BASE_URL ||
  'http://127.0.0.1:8000'
).replace(/\/$/, '');

const conn =
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL ||
  '';

const body = {
  input: { type: 'lab', data: {} },
  context: {
    project_id: process.env.STAGING_DECISION_PROJECT_ID || 'staging-validation',
    model_id: process.env.STAGING_DECISION_MODEL_ID || 'smoke-1.1.0'
  }
};

console.log(`POST ${base}/decision/run (lab scope — audit row expected)\n`);
let res;
try {
  res = await axios.post(`${base}/decision/run`, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000,
    validateStatus: () => true
  });
} catch (e) {
  console.error('Request failed:', e.message);
  process.exit(1);
}

console.log('HTTP', res.status);
console.log(JSON.stringify(res.data, null, 2));

if (res.status !== 200) {
  console.error('\n/decision/run did not return 200 — fix API or URL before SQL proof.');
  process.exit(1);
}

if (!conn) {
  console.warn(
    '\nNo POSTGRES_URL / POSTGRES_PRISMA_URL / SUPABASE_DB_URL / DATABASE_URL — skipped proof SELECT.'
  );
  process.exit(0);
}

const local = /localhost|127\.0\.0\.1/i.test(conn);
const pool = new pg.Pool({
  connectionString: conn,
  ssl: local ? false : { rejectUnauthorized: false },
  max: 1
});

try {
  const r = await pool.query(`
    SELECT id, decision, decision_run_v11_audit
    FROM decision_audit_log
    WHERE decision_run_v11_audit IS NOT NULL
    ORDER BY id DESC
    LIMIT 5
  `);
  console.log('\n--- Proof query (decision_run_v11_audit IS NOT NULL, LIMIT 5) ---\n');
  for (const row of r.rows) {
    console.log(JSON.stringify(row, null, 2));
  }
  if (r.rows.length === 0) {
    console.error(
      '\nZero rows: migration not applied on this DB, or API is using a different database than this connection string.'
    );
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
