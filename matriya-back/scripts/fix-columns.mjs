import { config } from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env') });

const client = new pg.Client({
  connectionString: process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const STMTS = [
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS management_plain_password TEXT NULL',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ NULL',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS is_management_user BOOLEAN NOT NULL DEFAULT false',
];

await client.connect();
console.log('Connected.');

for (const s of STMTS) {
  try {
    await client.query(s);
    console.log('OK :', s.slice(0, 80));
  } catch (e) {
    if (e.code === '42701') {
      console.log('SKIP (already exists):', s.slice(0, 60));
    } else {
      console.error('FAIL:', e.message);
    }
  }
}

await client.end();
console.log('\nAll done — restart matriya-back server.');
