/**
 * Short, user-facing messages for OpenAI / billing errors.
 * Avoids dumping raw API error strings into the UI.
 */

function normalizeErrorText(raw) {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && raw.message) return String(raw.message);
  try { return JSON.stringify(raw); } catch { return String(raw); }
}

/**
 * @param {string} text — error body or message
 * @returns {string|null} friendly message, or null to use caller's default
 */
export function getOpenAiFriendlyMessage(text) {
  const s = normalizeErrorText(text).toLowerCase();

  if (/incorrect api key|invalid api key|wrong api key|api key provided/i.test(s)) {
    return 'OpenAI API key is invalid. Please configure a valid key on the server.';
  }

  if (/insufficient_quota|quota|rate limit|billing|exceeded your current quota|too many requests|429/.test(s)) {
    return 'OpenAI quota or billing issue. Check your OpenAI account or try again later.';
  }

  return null;
}

/**
 * @param {unknown} err — axios error or Error
 * @param {string} fallback — shown if no OpenAI-specific message found
 */
export function formatApiErrorForUser(err, fallback) {
  const raw =
    err?.response?.data?.error ||
    err?.response?.data?.detail ||
    (typeof err?.response?.data === 'string' ? err.response.data : '') ||
    err?.message ||
    '';
  const friendly = getOpenAiFriendlyMessage(raw);
  if (friendly) return friendly;
  const s = normalizeErrorText(raw).trim();
  return s || fallback || 'An unexpected error occurred.';
}
