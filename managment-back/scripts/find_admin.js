import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const client = new pg.Client({ connectionString: process.env.POSTGRES_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query(`SELECT id, username, is_admin FROM users ORDER BY id LIMIT 30`);
console.log('All users:', JSON.stringify(rows, null, 2));

await client.end();
