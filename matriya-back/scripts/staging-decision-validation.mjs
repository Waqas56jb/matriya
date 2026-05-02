/**
 * David staging / prod checklist (WhatsApp):
 *   5. GET /health — expect HTTP 200
 *   6. POST /decision/run ×3 with valid payloads (migration must be applied first)
 *      SQL:
 *      SELECT id, decision, decision_run_v11_audit ... LIMIT 5;
 *      SELECT COUNT(*) FROM decision_audit_log WHERE decision_run_v11_audit IS NOT NULL;
 *
 * Prerequisites: DDL in migrations/decision_run_v110_audit.sql on the SAME DB as the API.
 *
 * Env:
 *   MATRIYA_API_BASE | API_BASE_URL — API root, no trailing slash
 *   POSTGRES_URL | POSTGRES_PRISMA_URL | SUPABASE_DB_URL | DATABASE_URL — for SQL (must match API DB)
 *   STAGING_RESEARCH_SESSION_ID — optional UUID; if set, call #3 uses type "question" (real loop path).
 *       If unset, call #3 is another bounded "lab" invocation with distinct context (still valid §2.3).
 *   STAGING_DECISION_PROJECT_ID — optional prefix for synthetic project ids
 */

import axios from 'axios';
import crypto from 'crypto';
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

const projPrefix =
  process.env.STAGING_DECISION_PROJECT_ID || 'staging-proof';

async function decisionRun(payload, label) {
  console.log(`\n--- POST /decision/run (${label}) ---`);
  const res = await axios.post(`${base}/decision/run`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 300000,
    validateStatus: () => true,
  });
  console.log(`HTTP ${res.status}`);
  if (res.status !== 200) {
    console.error(JSON.stringify(res.data, null, 2));
    throw new Error(`${label}: expected HTTP 200, got ${res.status}`);
  }
  console.log(JSON.stringify(res.data, null, 2));
  return res.data;
}

console.log(`\nTarget API: ${base}\n`);

const local = conn ? /localhost|127\.0\.0\.1/i.test(conn) : false;
const pool = conn
  ? new pg.Pool({
      connectionString: conn,
      ssl: local ? false : { rejectUnauthorized: false },
      max: 1,
    })
  : null;

// Step 5 — /health → 200 OK
console.log('--- Step 5: GET /health ---');
let health;
try {
  health = await axios.get(`${base}/health`, { timeout: 60000, validateStatus: () => true });
} catch (e) {
  console.error('Health request failed:', e.message);
  if (pool) await pool.end().catch(() => {});
  process.exit(1);
}
console.log(`HTTP ${health.status}`);
console.log(JSON.stringify(health.data, null, 2));
if (health.status !== 200) {
  console.error('\nExpected 200 OK on /health — fix POSTGRES_URL / deploy / DB before continuing.');
  if (pool) await pool.end().catch(() => {});
  process.exit(1);
}

let countBefore = null;
if (pool) {
  const b = await pool.query(`
    SELECT COUNT(*)::int AS n FROM decision_audit_log WHERE decision_run_v11_audit IS NOT NULL
  `);
  countBefore = b.rows[0]?.n ?? 0;
  console.log(`\n--- COUNT before 3× /decision/run: ${countBefore}`);
}

// Step 6 — three /decision/run calls (“real” distinct contract inputs)

const uuid = crypto.randomUUID();
const sessionQuestion = process.env.STAGING_RESEARCH_SESSION_ID?.trim();

const payloads = [];

payloads.push({
  label: '1/3 bounded lab',
  body: {
    input: { type: 'lab', data: {} },
    context: { project_id: `${projPrefix}:${uuid}`, model_id: 'run-1bounded' },
  },
});

payloads.push({
  label: '2/3 bounded message',
  body: {
    input: { type: 'message', data: { note: 'staging smoke message path' } },
    context: { project_id: `${projPrefix}:${uuid}`, model_id: 'run-2bounded' },
  },
});

if (sessionQuestion) {
  payloads.push({
    label: '3/3 question + research loop (needs valid session)',
    body: {
      input: {
        type: 'question',
        data: {
          session_id: sessionQuestion,
          query:
            process.env.STAGING_DECISION_QUERY ||
            'List formulation constraints referenced in uploaded lab documents.',
        },
      },
      context: { project_id: `${projPrefix}:question`, model_id: 'run-3loop' },
    },
  });
} else {
  payloads.push({
    label: '3/3 bounded lab (distinct hash — set STAGING_RESEARCH_SESSION_ID for question path)',
    body: {
      input: { type: 'lab', data: { iteration: 'third-call' } },
      context: { project_id: `${projPrefix}:${uuid}`, model_id: 'run-3bounded' },
    },
  });
}

for (const p of payloads) {
  await decisionRun(p.body, p.label);
}

if (!pool) {
  console.warn('\nNo DB URL in env — skipped SQL proof. Set POSTGRES_URL (same DB as API).');
  process.exit(0);
}

try {
  const countAfterR = await pool.query(`
    SELECT COUNT(*)::int AS n
    FROM decision_audit_log
    WHERE decision_run_v11_audit IS NOT NULL
  `);
  const countAfter = countAfterR.rows[0]?.n ?? 0;
  const delta = countBefore != null ? countAfter - countBefore : countAfter;

  console.log('\n--- COUNT(*) decision_run_v11_audit IS NOT NULL (after run) ---');
  console.log(JSON.stringify({ n: countAfter, delta_from_script: delta }, null, 2));

  if (countBefore != null && delta < 3) {
    console.error(
      `\nExpected +3 new audit rows from this script — delta=${delta} (wrong DB vs API, or persist failed).`
    );
    process.exitCode = 1;
  }

  const top = await pool.query(`
    SELECT id, decision, decision_run_v11_audit
    FROM decision_audit_log
    WHERE decision_run_v11_audit IS NOT NULL
    ORDER BY id DESC
    LIMIT 5
  `);
  console.log('\n--- Latest 5 rows (same as Supabase checklist) ---\n');
  for (const row of top.rows) {
    console.log(JSON.stringify(row, null, 2));
  }

  console.log('\nDone — screenshots: /health 200 + this terminal + COUNT + LIMIT 5 in SQL Editor if preferred.');
} finally {
  await pool.end();
}
