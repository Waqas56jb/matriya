import bcrypt from 'bcrypt';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const pool = new pg.Pool({
  connectionString: process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 1
});

const RACHEL_EMAIL    = 'rgb-lab@frescocolors.com';
const RACHEL_USERNAME = 'rachel.lab';
const RACHEL_PASS     = 'RachelLab2026!';
const RACHEL_NAME     = 'Rachel';
const PROJECT_NAME    = 'INT-TFX';
const PROJECT_DESC    = 'Real lab data only — Rachel production project';

console.log('=== STEP 1: Check / create Rachel account ===');
const ex = await pool.query(
  'SELECT id, username, email, is_admin, is_active FROM users WHERE email=$1 OR username=$2',
  [RACHEL_EMAIL, RACHEL_USERNAME]
);
console.log('Existing rows:', ex.rowCount);
ex.rows.forEach(r => console.log(' ', JSON.stringify(r)));

const hashed = await bcrypt.hash(RACHEL_PASS, 10);
let rachelId;

if (ex.rowCount === 0) {
  const ins = await pool.query(
    `INSERT INTO users (username, email, hashed_password, full_name, is_admin, is_active, created_at)
     VALUES ($1, $2, $3, $4, false, true, NOW()) RETURNING id, username, email`,
    [RACHEL_USERNAME, RACHEL_EMAIL, hashed, RACHEL_NAME]
  );
  rachelId = ins.rows[0].id;
  console.log('Created:', JSON.stringify(ins.rows[0]));
} else {
  rachelId = ex.rows[0].id;
  await pool.query(
    'UPDATE users SET hashed_password=$1, username=$2, is_admin=false, is_active=true WHERE id=$3',
    [hashed, RACHEL_USERNAME, rachelId]
  );
  console.log('Password reset for id:', rachelId);
}

console.log('\n=== STEP 2: Check / create INT-TFX project ===');
const pq = await pool.query('SELECT id, name FROM projects WHERE name=$1 LIMIT 1', [PROJECT_NAME]);
let inttfxId = pq.rows[0]?.id;

if (!inttfxId) {
  const np = await pool.query(
    `INSERT INTO projects (name, description, created_at, updated_at)
     VALUES ($1, $2, NOW(), NOW()) RETURNING id, name`,
    [PROJECT_NAME, PROJECT_DESC]
  );
  inttfxId = np.rows[0].id;
  console.log('Created INT-TFX project:', inttfxId);
} else {
  console.log('INT-TFX already exists:', JSON.stringify(pq.rows[0]));
}

console.log('\n=== STEP 3: Verify INT-TFX is clean (no test data) ===');
const le = await pool.query('SELECT COUNT(*) AS c FROM lab_experiments WHERE project_id=$1', [inttfxId]);
const ee = await pool.query('SELECT COUNT(*) AS c FROM experiments WHERE project_id=$1', [inttfxId]);
console.log('  lab_experiments count:', le.rows[0].c);
console.log('  experiments count:    ', ee.rows[0].c);
const isClean = (Number(le.rows[0].c) === 0 && Number(ee.rows[0].c) === 0);
console.log('  Clean:', isClean ? 'YES' : 'NO — has existing data');

console.log('\n=== STEP 4: Add Rachel to INT-TFX as lab_user ===');
const mc = await pool.query(
  'SELECT id FROM project_members WHERE project_id=$1 AND user_id=$2',
  [inttfxId, rachelId]
);
if (mc.rowCount === 0) {
  await pool.query(
    `INSERT INTO project_members (project_id, user_id, role, role_v2)
     VALUES ($1, $2, 'member', 'lab_user')`,
    [inttfxId, rachelId]
  );
  console.log('  Rachel added to INT-TFX as lab_user');
} else {
  await pool.query(
    `UPDATE project_members SET role='member', role_v2='lab_user' WHERE project_id=$1 AND user_id=$2`,
    [inttfxId, rachelId]
  );
  console.log('  Rachel membership updated to lab_user');
}

console.log('\n=== SUMMARY ===');
console.log('  rachel.lab user_id : ', rachelId);
console.log('  INT-TFX project_id : ', inttfxId);
console.log('  temp password      : ', RACHEL_PASS);
console.log('  is_admin           :  false');
console.log('  role_v2            :  lab_user');
console.log('  INT-TFX clean      : ', isClean ? 'YES' : 'NO');

await pool.end();
