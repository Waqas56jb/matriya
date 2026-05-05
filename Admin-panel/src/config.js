/**
 * Single source of truth for admin API base URL.
 * Set VITE_ADMIN_API_URL in .env (local) or Vercel → Environment Variables (production).
 * No trailing slash.
 *
 * Production must not use an empty base: relative `/api/...` calls are answered by the SPA host
 * and Vercel’s catch-all rewrite serves `index.html` (HTML) instead of the admin API (JSON).
 */
const raw = (import.meta.env.VITE_ADMIN_API_URL || '').trim().replace(/\/$/, '');
/** Deployed admin API — keep identical to admin-backend `ADMIN_BACK_PUBLIC_URL` and Admin-panel `vercel.json` `/api` proxy. */
export const ADMIN_BACKEND_PUBLIC_URL = 'https://matriya-admin-backend.vercel.app';

export const ADMIN_API_BASE = raw || ADMIN_BACKEND_PUBLIC_URL;
