/**
 * One-off: runs ONLY migrations/decision_run_v110_audit.sql (David directive).
 * Usage: node scripts/apply-decision-run-v110-audit.mjs
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../.env') });

const dbUrl = process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('ERROR: POSTGRES_URL (or POSTGRES_PRISMA_URL / SUPABASE_DB_URL) required.');
  process.exit(1);
}

const sqlPath = join(__dirname, '../migrations/decision_run_v110_audit.sql');
const sql = readFileSync(sqlPath, 'utf8');

const client = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  await client.query(sql);
  console.log('OK: decision_run_v110_audit.sql applied.');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
