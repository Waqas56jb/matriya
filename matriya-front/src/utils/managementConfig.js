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

const DEFAULT_MGMT_API = 'https://matriya-managment-backend.vercel.app';
const DEFAULT_MGMT_FRONT = 'https://matriya-managment-frontend.vercel.app';

/** Management backend (Express). Dev fallback uses deployed API when env is unset. */
export const MANAGEMENT_API_URL =
  trimUrl(process.env.REACT_APP_MANAGEMENT_API_URL) || (isDev ? DEFAULT_MGMT_API : '');

/** Management UI (Vite). Dev fallback uses deployed front when env is unset. */
export const MANAGEMENT_FRONT_URL =
  trimUrl(process.env.REACT_APP_MANAGEMENT_FRONT_URL) || (isDev ? DEFAULT_MGMT_FRONT : '');

export function isManagementLabConfigured() {
  return Boolean(MANAGEMENT_API_URL && MANAGEMENT_FRONT_URL);
}
