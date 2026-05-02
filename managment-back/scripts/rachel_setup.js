import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const client = new pg.Client({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

console.log('=== CHECK EXISTING RACHEL ACCOUNT ===');
const existing = await client.query(
  `SELECT id, username, email, is_admin, is_active, created_at FROM users WHERE email=$1 OR username=$2`,
  ['rgb-lab@frescocolors.com', 'rachel.lab']
);
console.log('Found:', existing.rowCount, 'row(s)');
existing.rows.forEach(u => console.log(' ', JSON.stringify(u)));

let rachelId;

if (existing.rowCount === 0) {
  console.log('\n=== CREATING RACHEL ACCOUNT ===');
  const hashed = await bcrypt.hash('RachelLab2026!', 10);
  const ins = await client.query(
    `INSERT INTO users (username, email, hashed_password, full_name, is_admin, is_active, created_at)
     VALUES ($1,$2,$3,$4,false,true,NOW()) RETURNING id, username, email`,
    ['rachel.lab', 'rgb-lab@frescocolors.com', hashed, 'Rachel']
  );
  rachelId = ins.rows[0].id;
  console.log('  Created:', JSON.stringify(ins.rows[0]));
} else {
  rachelId = existing.rows[0].id;
  console.log('\n=== RESETTING RACHEL PASSWORD ===');
  const hashed = await bcrypt.hash('RachelLab2026!', 10);
  await client.query(
    `UPDATE users SET hashed_password=$1, username=$2, is_admin=false, is_active=true WHERE id=$3`,
    [hashed, 'rachel.lab', rachelId]
  );
  console.log('  Password reset for id:', rachelId);
}

console.log('\n=== CHECK/CREATE INT-TFX PROJECT ===');
const projCheck = await client.query(
  `SELECT id, name, description, created_at FROM projects WHERE name='INT-TFX' LIMIT 1`
);
let inttfxId;
if (projCheck.rowCount === 0) {
  // Get admin user id to set as owner
  const adminUser = await client.query(`SELECT id FROM users WHERE username='admin' OR is_admin=true ORDER BY created_at LIMIT 1`);
  const adminId = adminUser.rows[0]?.id;
  const newProj = await client.query(
    `INSERT INTO projects (name, description, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,NOW(),NOW()) RETURNING id, name`,
    ['INT-TFX', 'Real lab data only — Rachel production project', adminId]
  );
  inttfxId = newProj.rows[0].id;
  console.log('  Created INT-TFX project:', inttfxId);
  // Add admin as owner
  if (adminId) {
    await client.query(
      `INSERT INTO project_members (project_id, user_id, role, role_v2, joined_at)
       VALUES ($1,$2,'owner','owner',NOW()) ON CONFLICT DO NOTHING`,
      [inttfxId, adminId]
    );
  }
} else {
  inttfxId = projCheck.rows[0].id;
  console.log('  INT-TFX already exists:', JSON.stringify(projCheck.rows[0]));
}

console.log('\n=== CHECK INT-TFX HAS NO TEST EXPERIMENTS ===');
const labCount = await client.query(
  `SELECT COUNT(*) as cnt FROM lab_experiments WHERE project_id=$1`, [inttfxId]
);
const expCount = await client.query(
  `SELECT COUNT(*) as cnt FROM experiments WHERE project_id=$1`, [inttfxId]
);
console.log('  lab_experiments count:', labCount.rows[0].cnt);
console.log('  experiments count:    ', expCount.rows[0].cnt);

console.log('\n=== ADD RACHEL TO INT-TFX (lab_user role) ===');
const memberCheck = await client.query(
  `SELECT * FROM project_members WHERE project_id=$1 AND user_id=$2`, [inttfxId, rachelId]
);
if (memberCheck.rowCount === 0) {
  await client.query(
    `INSERT INTO project_members (project_id, user_id, role, role_v2, joined_at)
     VALUES ($1,$2,'member','lab_user',NOW())`,
    [inttfxId, rachelId]
  );
  console.log('  Rachel added to INT-TFX as lab_user');
} else {
  await client.query(
    `UPDATE project_members SET role='member', role_v2='lab_user' WHERE project_id=$1 AND user_id=$2`,
    [inttfxId, rachelId]
  );
  console.log('  Rachel already member — role updated to lab_user');
}

console.log('\n=== ALSO ADD RACHEL TO MATRIYA-BACK (auth/users) ===');
// matriya-back shares the same DB
console.log('  (same DB — rachel account is already visible to matriya-back)');

console.log('\n=== SUMMARY ===');
console.log('  rachel.lab user id :', rachelId);
console.log('  INT-TFX project id :', inttfxId);
console.log('  password           : RachelLab2026!');

await client.end();
