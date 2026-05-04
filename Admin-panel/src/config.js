/**
 * Single source of truth for admin API base URL.
 * Set VITE_ADMIN_API_URL in .env (local) or Vercel → Environment Variables (production).
 * No trailing slash.
 */
const raw = (import.meta.env.VITE_ADMIN_API_URL || '').trim().replace(/\/$/, '');
/** Production builds must set VITE_ADMIN_API_URL (e.g. in `.env.production` or Vercel). */
export const ADMIN_API_BASE =
  raw || (import.meta.env.DEV ? 'http://localhost:9000' : '');
