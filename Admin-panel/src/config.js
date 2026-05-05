/**
 * Single source of truth for admin API base URL.
 * Set VITE_ADMIN_API_URL in .env (local) or Vercel → Environment Variables (production).
 * No trailing slash.
 */
const raw = (import.meta.env.VITE_ADMIN_API_URL || '').trim().replace(/\/$/, '');
/** Local admin-backend (default port 9000). Production: set VITE_ADMIN_API_URL in `.env.production` or Vercel. */
const DEFAULT_ADMIN_API_DEV = 'http://localhost:9000';
export const ADMIN_API_BASE = raw || (import.meta.env.DEV ? DEFAULT_ADMIN_API_DEV : '');
