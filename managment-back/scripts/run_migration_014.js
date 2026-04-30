import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const client = new pg.Client({
  connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

await client.connect();
console.log('Connected to DB');

const sql = fs.readFileSync(path.join(__dirname, '../migrations/014_add_storage_path_to_project_files.sql'), 'utf8');
console.log('Running migration 014...');
await client.query(sql);
console.log('Migration 014 applied successfully');

// Verify
const r = await client.query(
  `SELECT column_name, is_nullable, data_type FROM information_schema.columns
   WHERE table_name='project_files' AND column_name='storage_path'`
);
if (r.rowCount > 0) {
  console.log('VERIFIED: storage_path column exists:', JSON.stringify(r.rows[0]));
} else {
  console.error('ERROR: storage_path column still missing after migration');
}

await client.end();
