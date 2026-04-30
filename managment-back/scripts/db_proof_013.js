/**
 * DB proof queries for migration 013 (v1.2)
 * Reads connection from POSTGRES_URL env — no secrets printed.
 */
import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const client = new pg.Client({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
await client.connect();

console.log('=== QUERY 1: New tables ===');
const q1 = await client.query(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema='public'
   AND table_name IN ('project_contracts','contract_terms','approval_logs')
   ORDER BY table_name`
);
q1.rows.forEach(r => console.log(' ', r.table_name));

console.log('\n=== QUERY 2: experiments governance columns ===');
const q2 = await client.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='experiments'
   AND column_name IN (
     'source_table','source_row_id','source_file_reference',
     'created_by','reviewed_by','reviewed_at','evidence_identity_status'
   ) ORDER BY column_name`
);
q2.rows.forEach(r => console.log(' ', r.column_name));

console.log('\n=== QUERY 3: audit_log governance columns ===');
const q3 = await client.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='audit_log'
   AND column_name IN (
     'record_type','record_id','before_value','after_value','reason','approval_status'
   ) ORDER BY column_name`
);
q3.rows.forEach(r => console.log(' ', r.column_name));

console.log('\n=== QUERY 4: project_contracts (last 3) ===');
const q4 = await client.query(
  `SELECT id, project_id, title, status, created_by, approved_at, created_at
   FROM project_contracts ORDER BY created_at DESC LIMIT 3`
);
q4.rows.forEach(r => console.log(' ', JSON.stringify(r)));
console.log('  row_count:', q4.rowCount);

console.log('\n=== QUERY 5: contract_terms (last 5) ===');
const q5 = await client.query(
  `SELECT id, contract_id, term_key, term_type, sort_order, created_by, created_at
   FROM contract_terms ORDER BY created_at DESC LIMIT 5`
);
q5.rows.forEach(r => console.log(' ', JSON.stringify(r)));
console.log('  row_count:', q5.rowCount);

console.log('\n=== QUERY 6: approval_logs (last 10) ===');
const q6 = await client.query(
  `SELECT id, record_type, record_id, project_id, action,
          previous_status, new_status, actor, reason, created_at
   FROM approval_logs ORDER BY created_at DESC LIMIT 10`
);
q6.rows.forEach(r => console.log(' ', JSON.stringify(r)));
console.log('  row_count:', q6.rowCount);

await client.end();
console.log('\n=== PROOF COMPLETE ===');
