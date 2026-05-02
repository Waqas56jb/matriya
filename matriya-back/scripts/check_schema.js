import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false }, max: 1 });
const r = await pool.query(
  `SELECT column_name, is_nullable, data_type, column_default
   FROM information_schema.columns
   WHERE table_name='project_files'
   ORDER BY ordinal_position`
);
console.log('project_files columns:');
r.rows.forEach(c => console.log(`  ${c.column_name} | nullable=${c.is_nullable} | type=${c.data_type}`));
await pool.end();
