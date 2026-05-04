/** David checklist — SELECT proof after migration + /decision/run (run manually). */
import pg from 'pg';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../.env') });

const c = new pg.Client({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const r = await c.query(`
  SELECT id, decision, decision_run_v11_audit
  FROM decision_audit_log
  ORDER BY id DESC
  LIMIT 5
`);
console.log(JSON.stringify(r.rows, null, 2));
const v11 = await c.query(`
  SELECT id, decision, decision_run_v11_audit
  FROM decision_audit_log
  WHERE response_type = 'decision_run_v1.1' AND decision_run_v11_audit IS NOT NULL
  ORDER BY id DESC
  LIMIT 3
`);
console.log('--- rows with v1.1 audit JSON (not null) ---');
console.log(JSON.stringify(v11.rows, null, 2));
await c.end();
