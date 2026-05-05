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

/** Local defaults when REACT_APP_* are unset (npm start + local managment-back / managment-front). */
const DEFAULT_MGMT_API_DEV = 'http://localhost:8001';
const DEFAULT_MGMT_FRONT_DEV = 'http://localhost:5173';

/** Management backend (Express). */
export const MANAGEMENT_API_URL =
  trimUrl(process.env.REACT_APP_MANAGEMENT_API_URL) || (isDev ? DEFAULT_MGMT_API_DEV : '');

/** Management UI (Vite). */
export const MANAGEMENT_FRONT_URL =
  trimUrl(process.env.REACT_APP_MANAGEMENT_FRONT_URL) || (isDev ? DEFAULT_MGMT_FRONT_DEV : '');

export function isManagementLabConfigured() {
  return Boolean(MANAGEMENT_API_URL && MANAGEMENT_FRONT_URL);
}
