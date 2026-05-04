/**
 * Import only from api/index.js (Vercel serverless entry).
 * Ensures process.env.VERCEL is set when Vercel injects VERCEL_ENV / VERCEL_URL only.
 */
if ((process.env.VERCEL_ENV || process.env.VERCEL_URL) && !process.env.VERCEL) {
  process.env.VERCEL = '1';
}
