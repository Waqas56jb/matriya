/**
 * Single source of truth for admin API base URL.
 * Set VITE_ADMIN_API_URL in .env (local) or Vercel → Environment Variables (production).
 * No trailing slash.
 */
const raw = (import.meta.env.VITE_ADMIN_API_URL || '').trim().replace(/\/$/, '');
export const ADMIN_API_BASE = raw || 'http://localhost:9000';
