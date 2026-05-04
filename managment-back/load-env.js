/**
 * Load env before server.js reads MATRIYA_BACK_URL / Supabase keys.
 * - `.env` — base (often gitignored; may contain production URLs by mistake)
 * - `.env.development` — when NODE_ENV !== 'production', overrides (e.g. MATRIYA_BACK_URL=http://localhost:8000)
 */
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(dir, '.env') });
const devEnvPath = join(dir, '.env.development');
if (process.env.NODE_ENV !== 'production' && existsSync(devEnvPath)) {
  dotenv.config({ path: devEnvPath, override: true });
}

/** Vercel/Supabase often provide `DATABASE_URL` only; lab + RAG expect `POSTGRES_URL`. */
(function mirrorDatabaseUrlToPostgres() {
  const t = (s) => (s == null ? '' : String(s).replace(/^\uFEFF/, '').trim());
  if (!t(process.env.POSTGRES_URL) && t(process.env.DATABASE_URL)) {
    process.env.POSTGRES_URL = process.env.DATABASE_URL;
  }
})();
