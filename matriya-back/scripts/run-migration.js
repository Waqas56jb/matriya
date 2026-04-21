/**
 * One-time migration runner — adds columns introduced after initial schema.
 * Usage: node scripts/run-migration.js
 * Safe to run multiple times (all DDL uses IF NOT EXISTS).
 */
import pg from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config as dotenvConfig } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from the project root (one level above scripts/)
dotenvConfig({ path: join(__dirname, '../.env') });

const dbUrl = process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('ERROR: No database URL found in env (POSTGRES_URL / SUPABASE_DB_URL).');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
});

const MIGRATIONS = [
  join(__dirname, '../sql/management_user_columns.sql'),
];

async function run() {
  await client.connect();
  console.log('Connected to database.');

  for (const file of MIGRATIONS) {
    const sql = readFileSync(file, 'utf8');
    const label = file.split(/[\\/]/).pop();
    console.log(`\nRunning: ${label}`);
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));

    for (const stmt of statements) {
      try {
        await client.query(stmt);
        console.log(`  OK: ${stmt.slice(0, 80).replace(/\n/g, ' ')}…`);
      } catch (e) {
        if (e.code === '42701') {
          console.log(`  SKIP (already exists): ${stmt.slice(0, 60)}…`);
        } else {
          console.error(`  FAIL: ${e.message}`);
          throw e;
        }
      }
    }
  }

  console.log('\nMigration complete.');
  await client.end();
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
