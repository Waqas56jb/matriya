/**
 * Single source of truth for admin API base URL.
 * Set VITE_ADMIN_API_URL in .env (local) or Vercel → Environment Variables (production).
 * No trailing slash.
 *
 * Production must not use an empty base: relative `/api/...` calls are answered by the SPA host
 * and Vercel’s catch-all rewrite serves `index.html` (HTML) instead of the admin API (JSON).
 */
const raw = (import.meta.env.VITE_ADMIN_API_URL || '').trim().replace(/\/$/, '');
/** Local admin-backend (default port 9000). */
const DEFAULT_ADMIN_API_DEV = 'http://localhost:9000';
/** Keep in sync with `vercel.json` → rewrites → `/api/*` proxy destination. */
const PRODUCTION_ADMIN_API_URL = 'https://matriya-admin-backend.vercel.app';

export const ADMIN_API_BASE =
  raw || (import.meta.env.DEV ? DEFAULT_ADMIN_API_DEV : PRODUCTION_ADMIN_API_URL);
