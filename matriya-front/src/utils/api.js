/**
 * API utility with authentication
 */
import axios from 'axios';

// Matriya API base URL — inlined at compile time by CRA. Default: deployed gold API (no localhost).
const DEFAULT_MATRIYA_API = 'https://matriya-back-gold.vercel.app';
let API_BASE_URL = (process.env.REACT_APP_API_BASE_URL || '').trim();

if (!API_BASE_URL) {
    API_BASE_URL = DEFAULT_MATRIYA_API;
    console.warn(`REACT_APP_API_BASE_URL not set; using deployed default ${DEFAULT_MATRIYA_API}`);
}

API_BASE_URL = API_BASE_URL.replace(/\/$/, '');

/**
 * Only treat 401 as "log out" when the backend signals invalid/missing **Matriya** session.
 * OpenAI/proxy/upstream issues must not use 401 for this (see matriya-back); any stray 401 without
 * these signals should not wipe the user's JWT.
 */
export function isMatriyaSessionInvalid401(error) {
    if (!error?.response || error.response.status !== 401) return false;
    const msg =
        typeof error.response.data?.error === 'string' ? error.response.data.error : '';
    if (msg === 'Incorrect username or password') return false;
    if (msg === 'Invalid authentication credentials') return true;
    if (msg === 'Authentication required') return true;
    const path = (error.config?.url || '').split('?')[0] || '';
    if (path.endsWith('/auth/me') || path === '/auth/me') return true;
    return false;
}

// Create axios instance
const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 60000, // default; heavy routes override (e.g. gpt-rag/sync, ask-matriya)
    headers: {
        'Content-Type': 'application/json'
    }
});

// Add token to requests if available
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        // Let the browser set multipart boundary + UTF-8 filenames; default JSON Content-Type breaks FormData in axios transformRequest
        if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
            delete config.headers['Content-Type'];
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Handle 401 errors (unauthorized). Single-flight: parallel failing requests must not spam reload().
let matriyaHandling401 = false;
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (isMatriyaSessionInvalid401(error)) {
            if (matriyaHandling401) {
                return Promise.reject(error);
            }
            matriyaHandling401 = true;
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.reload();
        }
        return Promise.reject(error);
    }
);

export default api;
export { API_BASE_URL };
