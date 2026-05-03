/**
 * Vercel serverless shim (import only from api/index.js).
 *
 * Normalize `process.env.VERCEL` when Vercel actually injects VERCEL_ENV / VERCEL_URL.
 * Do NOT set VERCEL here for non-Vercel hosts — that would skip Express listen and break Railway/Docker.
 */
if ((process.env.VERCEL_ENV || process.env.VERCEL_URL) && !process.env.VERCEL) {
  process.env.VERCEL = '1';
}
