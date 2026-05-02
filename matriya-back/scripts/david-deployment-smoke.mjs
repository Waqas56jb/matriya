/**
 * Live smoke: GET /health + David's 3× POST /decision/run + optional DB COUNT/LIMIT 5.
 *
 *   MATRIYA_API_BASE=https://your-matriya-api   (no trailing slash)
 *   POSTGRES_URL same as API (optional — for SQL proof)
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
  ''
).replace(/\/$/, '');
if (!base) {
  console.error('Set MATRIYA_API_BASE (e.g. production matriya-back URL).');
  process.exit(1);
}

const conn =
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.DATABASE_URL ||
  '';

const payloads = [
  {
    label: 'TEST 1 — basic lab row',
    body: {
      mode: 'lab',
      data: {
        rows: [
          {
            experiment_id: 'TEST-001',
            APP: 30,
            PER: 10,
            MEL: 5,
            nanoclay: 2,
            IFR: 25,
            expansion: 80,
          },
        ],
      },
    },
  },
  {
    label: 'TEST 2 — guard (minimal row)',
    body: {
      mode: 'lab',
      data: { rows: [{ experiment_id: 'TEST-002' }] },
    },
  },
  {
    label: 'TEST 3 — strong row',
    body: {
      mode: 'lab',
      data: {
        rows: [
          {
            experiment_id: 'TEST-003',
            APP: 32,
            PER: 14,
            MEL: 6,
            nanoclay: 3,
            IFR: 30,
            expansion: 95,
            char_quality: 'GOOD',
          },
        ],
      },
    },
  },
];

console.log(`Base: ${base}\n`);

const h = await axios.get(`${base}/health`, { timeout: 90000, validateStatus: () => true });
console.log('GET /health — HTTP', h.status);
console.log(JSON.stringify(h.data, null, 2));
if (h.status !== 200) {
  console.error('FAIL /health !== 200');
  process.exit(1);
}

const responses = [];

for (const p of payloads) {
  console.log(`\n${p.label}`);
  const res = await axios.post(`${base}/decision/run`, p.body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 120000,
    validateStatus: () => true,
  });
  console.log('HTTP', res.status);
  console.log(JSON.stringify(res.data, null, 2));
  if (res.status !== 200) {
    console.error(`FAIL HTTP ${res.status}`);
    process.exit(1);
  }
  responses.push(res.data);
}

function assert(ok, msg) {
  if (!ok) throw new Error(msg);
}

try {
  assert(responses[0].error === null && responses[0].decision !== 'SYSTEM_ERROR', 'TEST 1 not valid');
  assert(responses[1].decision === 'STOP', 'TEST 2 not STOP');
  assert(responses[2].decision !== 'STOP' && responses[2].confidence > 0, 'TEST 3 expectation');
  console.log('\nCLI expectations OK for TEST 1–3');
} catch (e) {
  console.error('\nCLI expectation FAIL:', e.message);
  process.exit(1);
}

if (!conn) {
  console.warn('\nNo POSTGRES_* — skipping DB queries.');
  process.exit(0);
}

const local = /localhost|127\.0\.0\.1/i.test(conn);
const pool = new pg.Pool({
  connectionString: conn,
  ssl: local ? false : { rejectUnauthorized: false },
  max: 1,
});

try {
  const top = await pool.query(`
    SELECT id, decision, decision_run_v11_audit
    FROM decision_audit_log
    ORDER BY id DESC
    LIMIT 5
  `);
  console.log('\n--- DB: last 5 decision_audit_log rows ---');
  for (const r of top.rows) {
    console.log(JSON.stringify({ id: r.id, decision: r.decision, has_audit_json: !!r.decision_run_v11_audit }));
  }

  const c = await pool.query(`
    SELECT COUNT(*)::int AS n FROM decision_audit_log WHERE decision_run_v11_audit IS NOT NULL
  `);
  console.log('\nCOUNT decision_run_v11_audit NOT NULL:', c.rows[0]?.n ?? 0);
} finally {
  await pool.end();
}
