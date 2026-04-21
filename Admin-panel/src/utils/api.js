import { ADMIN_API_BASE } from '../config.js';

function getToken() {
  return localStorage.getItem('admin_token');
}

async function req(method, path, body) {
  const token = getToken();
  const hasBody = body !== undefined && body !== null && method !== 'GET' && method !== 'DELETE';

  // Railway/Fastly CDN mangles application/json POST bodies — use form-urlencoded for all write requests
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (hasBody) headers['Content-Type'] = 'application/x-www-form-urlencoded';

  const res = await fetch(`${ADMIN_API_BASE}${path}`, {
    method,
    headers,
    body: hasBody ? new URLSearchParams(body).toString() : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** Raw fetch for non-JSON responses (e.g. CSV blob). Caller must set Authorization if needed. */
export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { ...options.headers };
  if (token && !headers.Authorization) headers.Authorization = `Bearer ${token}`;
  return fetch(`${ADMIN_API_BASE}${path}`, { ...options, headers });
}

export const api = {
  get:    (path)        => req('GET',    path),
  post:   (path, body)  => req('POST',   path, body),
  put:    (path, body)  => req('PUT',    path, body),
  patch:  (path, body)  => req('PATCH',  path, body),
  delete: (path)        => req('DELETE', path),
};
