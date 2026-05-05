/**
 * CLI: same four booleans as GET /api/diag/env-david (David checklist). No secret output.
 * Usage (from managment-back): node scripts/print-env-david-booleans.mjs
 */
import '../load-env.js';

const t = (s) => (s == null ? '' : String(s).replace(/^\uFEFF/, '').trim());
const serviceStrict = t(
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY
);
const out = {
  SUPABASE_URL: Boolean(t(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL)),
  SUPABASE_ANON_KEY: Boolean(t(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)),
  SUPABASE_SERVICE_ROLE_KEY: Boolean(serviceStrict),
  OPENAI_API_KEY: Boolean(t(process.env.OPENAI_API_KEY)),
};
console.log(JSON.stringify(out, null, 2));
