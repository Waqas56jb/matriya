/**
 * Migration runner for 013_data_governance_v1_2.sql
 * Reads POSTGRES_URL or DATABASE_URL from .env and applies the migration.
 * Does NOT print any secret values.
 */
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('ERROR: POSTGRES_URL or DATABASE_URL not set in .env');
  process.exit(1);
}

const sqlPath = path.join(__dirname, '../migrations/013_data_governance_v1_2.sql');
const sql = readFileSync(sqlPath, 'utf8');

// Strip comments so we can run clean statements
const cleanSql = sql
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n');

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

async function run() {
  try {
    await client.connect();
    console.log('Connected to database. Running migration 013...');
    await client.query(cleanSql);
    console.log('\n✓ Migration 013 applied successfully.\n');

    // Proof queries
    console.log('=== PROOF QUERIES ===\n');

    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('project_contracts','contract_terms','approval_logs')
      ORDER BY table_name;
    `);
    console.log('New tables created:');
    tables.rows.forEach(r => console.log('  ✓', r.table_name));

    const govCols = await client.query(`
      SELECT table_name, column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('lab_experiments','experiments','project_files','material_library','project_members','audit_log')
        AND column_name IN ('evidence_identity_status','source_table','source_row_id','source_file_reference','created_by','reviewed_by','reviewed_at','role_v2','before_value','after_value','record_type','record_id','reason','approval_status')
      ORDER BY table_name, column_name;
    `);
    console.log('\nGovernance columns added:');
    govCols.rows.forEach(r =>
      console.log(`  ✓ ${r.table_name}.${r.column_name} (${r.data_type}${r.column_default ? ', default: ' + r.column_default : ''})`)
    );

    const indexes = await client.query(`
      SELECT indexname, tablename
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN (
          'idx_project_contracts_project','idx_project_contracts_status',
          'idx_contract_terms_contract','idx_approval_logs_record',
          'idx_approval_logs_project','idx_approval_logs_actor',
          'idx_lab_exp_gov_status','idx_experiments_gov_status'
        )
      ORDER BY tablename, indexname;
    `);
    console.log('\nIndexes created:');
    indexes.rows.forEach(r => console.log(`  ✓ ${r.indexname} ON ${r.tablename}`));

    console.log('\n=== MIGRATION 013 COMPLETE ===');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
