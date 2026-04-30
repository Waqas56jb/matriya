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
const sql = fs.readFileSync(path.join(__dirname, '../migrations/015_add_missing_columns.sql'), 'utf8');

try {
  await pool.query(sql);
  console.log('Migration 015 applied successfully.');

  const { rows: pr } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='projects' AND column_name='openai_vector_store_id'`
  );
  console.log('projects.openai_vector_store_id exists:', pr.length > 0);

  const { rows: jr } = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name='project_join_requests' AND column_name='username'`
  );
  console.log('project_join_requests.username exists:', jr.length > 0);
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exit(1);
} finally {
  await pool.end();
}
