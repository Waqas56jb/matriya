/**
 * Import only from api/index.js (Vercel serverless entry).
 */
if ((process.env.VERCEL_ENV || process.env.VERCEL_URL) && !process.env.VERCEL) {
  process.env.VERCEL = '1';
}
