import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });
const pool = new pg.Pool({ connectionString: process.env.POSTGRES_URL, ssl: { rejectUnauthorized: false }, max: 1 });

console.log('=== projects columns ===');
const p = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='projects' ORDER BY ordinal_position`);
p.rows.forEach(c => console.log(' ', c.column_name));

console.log('\n=== project_join_requests columns ===');
const j = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='project_join_requests' ORDER BY ordinal_position`);
j.rows.forEach(c => console.log(' ', c.column_name));

await pool.end();
