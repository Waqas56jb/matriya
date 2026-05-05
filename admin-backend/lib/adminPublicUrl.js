/**
 * Canonical browser-facing URL for this admin API (no trailing slash).
 * Set ADMIN_BACK_PUBLIC_URL on Vercel if the hostname changes.
 */
export function getAdminBackendPublicUrl() {
  const fromEnv = (process.env.ADMIN_BACK_PUBLIC_URL || '').trim().replace(/\/$/, '');
  return fromEnv || 'https://matriya-admin-backend.vercel.app';
}
