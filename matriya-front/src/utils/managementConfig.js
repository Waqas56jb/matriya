/**
 * Lab ↔ Management integration (build-time env on CRA / Vercel).
 * Same Matriya JWT is accepted by the management API (forwarded to Matriya /auth/me).
 */

function trimUrl(v) {
  if (v == null || typeof v !== 'string') return '';
  const s = v.trim();
  return s ? s.replace(/\/$/, '') : '';
}

const isDev = process.env.NODE_ENV !== 'production';

/** Management backend (Express). Dev defaults match local managment-back (port 8001). */
export const MANAGEMENT_API_URL =
  trimUrl(process.env.REACT_APP_MANAGEMENT_API_URL) || (isDev ? 'http://localhost:8001' : '');

/** Management UI (Vite). Dev default matches `npm run dev` in managment-front (port 5173). */
export const MANAGEMENT_FRONT_URL =
  trimUrl(process.env.REACT_APP_MANAGEMENT_FRONT_URL) || (isDev ? 'http://localhost:5173' : '');

export function isManagementLabConfigured() {
  return Boolean(MANAGEMENT_API_URL && MANAGEMENT_FRONT_URL);
}
