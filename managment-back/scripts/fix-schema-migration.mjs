/**
 * Migration: fix project_chat_messages schema mismatch
 * DB has: sender, message, role
 * Code expects: body, user_id, username
 * Also validates all core table linkages.
 */
import pg from 'pg';

const { Client } = pg;
const DB_URL = 'postgresql://postgres.osrcrdroyhlvrtwpybtr:Matriya2026@aws-1-eu-central-1.pooler.supabase.com:6543/postgres';

const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log('Connected to Supabase DB\n');

// ── 1. Show actual schema of project_chat_messages ────────────────────────────
console.log('═'.repeat(60));
console.log('1. ACTUAL SCHEMA — project_chat_messages');
console.log('═'.repeat(60));
const { rows: cols } = await client.query(`
  SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'project_chat_messages'
  ORDER BY ordinal_position`);
console.log(cols.map(c => `  ${c.column_name.padEnd(20)} ${c.data_type.padEnd(20)} nullable=${c.is_nullable}`).join('\n'));

// ── 2. Apply migration ────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log('2. APPLYING MIGRATION');
console.log('═'.repeat(60));

const migration = `
  ALTER TABLE public.project_chat_messages
    ADD COLUMN IF NOT EXISTS user_id  integer,
    ADD COLUMN IF NOT EXISTS username text,
    ADD COLUMN IF NOT EXISTS body     text;

  -- Migrate existing rows: copy old columns to new ones
  UPDATE public.project_chat_messages
    SET body     = COALESCE(message, ''),
        username = COALESCE(sender, 'system')
    WHERE body IS NULL;

  -- Make body and username NOT NULL now that data is migrated
  ALTER TABLE public.project_chat_messages
    ALTER COLUMN body     SET NOT NULL,
    ALTER COLUMN username SET NOT NULL;
`;

await client.query(migration);
console.log('  Migration applied.');

// ── 3. Show schema AFTER migration ───────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log('3. SCHEMA AFTER MIGRATION — project_chat_messages');
console.log('═'.repeat(60));
const { rows: colsAfter } = await client.query(`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'project_chat_messages'
  ORDER BY ordinal_position`);
console.log(colsAfter.map(c => `  ${c.column_name.padEnd(20)} ${c.data_type.padEnd(20)} nullable=${c.is_nullable}`).join('\n'));

// ── 4. Core table schemas ─────────────────────────────────────────────────────
const coreTables = ['projects','tasks','milestones','documents','project_members',
                    'project_files','project_chat_messages','project_chat_last_read'];
console.log('\n' + '═'.repeat(60));
console.log('4. ALL CORE TABLE SCHEMAS');
console.log('═'.repeat(60));
for (const t of coreTables) {
  const { rows } = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position`, [t]);
  if (rows.length === 0) { console.log(`\n  ${t}: TABLE NOT FOUND`); continue; }
  console.log(`\n  ${t}:`);
  console.log(rows.map(r => `    ${r.column_name.padEnd(24)} ${r.data_type}`).join('\n'));
}

// ── 5. JOIN proof query ───────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(60));
console.log('5. JOIN PROOF — projects → project_members → tasks → project_chat_messages');
console.log('═'.repeat(60));
const { rows: joinRows } = await client.query(`
  SELECT
    p.id::text        AS project_id,
    p.name            AS project_name,
    COUNT(DISTINCT pm.user_id)  AS member_count,
    COUNT(DISTINCT t.id)        AS task_count,
    COUNT(DISTINCT cm.id)       AS chat_message_count
  FROM public.projects p
  LEFT JOIN public.project_members pm  ON pm.project_id::text = p.id::text
  LEFT JOIN public.tasks          t    ON t.project_id::text  = p.id::text
  LEFT JOIN public.project_chat_messages cm ON cm.project_id::text = p.id::text
  GROUP BY p.id, p.name
  ORDER BY p.name
  LIMIT 10`);

if (joinRows.length === 0) {
  console.log('  No projects yet — checking tables exist...');
  const { rows: tableCheck } = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public'
    ORDER BY table_name`);
  console.log('  Tables in DB:', tableCheck.map(r=>r.table_name).join(', '));
} else {
  console.log('  project_name'.padEnd(30) + 'members  tasks  chat_msgs');
  console.log('  ' + '-'.repeat(56));
  joinRows.forEach(r => {
    console.log(`  ${String(r.project_name).padEnd(30)}${String(r.member_count).padEnd(9)}${String(r.task_count).padEnd(7)}${r.chat_message_count}`);
  });
}

await client.end();
console.log('\n✓ Schema migration and validation complete.');
