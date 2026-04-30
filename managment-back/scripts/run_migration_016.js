import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!url) { console.error('POSTGRES_URL not set'); process.exit(1); }

const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1 });
const sql = fs.readFileSync(path.join(__dirname, '../migrations/016_add_project_files_gpt_columns.sql'), 'utf8');

try {
  await pool.query(sql);
  console.log('Migration 016 applied successfully.');

  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name='project_files'
     AND column_name IN ('updated_at','display_name','openai_file_id','openai_synced_at')
     ORDER BY column_name`
  );
  console.log('New columns in project_files:');
  rows.forEach(r => console.log(' ', r.column_name));
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
