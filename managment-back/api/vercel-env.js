/**
 * Runs before `server.js` when the entry is `api/index.js` (Vercel serverless).
 * - Sets VERCEL when only VERCEL_ENV / VERCEL_URL are present.
 * - Mirrors alternate Supabase env names so `server.js` sees URL + service key at module load.
 *
 * Required on Vercel (Production): SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and
 * SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY / legacy SERVICE_KEY).
 */
if ((process.env.VERCEL_ENV || process.env.VERCEL_URL) && !process.env.VERCEL) {
  process.env.VERCEL = '1';
}

const trim = (s) => (s == null ? '' : String(s).replace(/^\uFEFF/, '').trim());

if (!trim(process.env.SUPABASE_URL) && trim(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
  process.env.SUPABASE_URL = trim(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

if (!trim(process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  const fromSecret = trim(process.env.SUPABASE_SECRET_KEY);
  const fromLegacy = trim(process.env.SUPABASE_SERVICE_KEY);
  if (fromSecret) process.env.SUPABASE_SERVICE_ROLE_KEY = fromSecret;
  else if (fromLegacy) process.env.SUPABASE_SERVICE_ROLE_KEY = fromLegacy;
}
