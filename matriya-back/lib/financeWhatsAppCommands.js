/**
 * WhatsApp finance operator commands (F STATUS / F WATCHLIST / F LOG / F HELP).
 * Prefixed form "F STATUS" etc. avoids routing to the lab/RAG pipeline.
 *
 * Signal data is read via HTTP from matriya-finance /api/finance/signals
 * (Railway deploys matriya-back and matriya-finance as separate containers —
 * they cannot share a filesystem, so NDJSON file access is not possible).
 *
 * Required env var in matriya-back:
 *   FINANCE_API_URL — base URL of matriya-finance service
 *                     e.g. https://matriya-finance.up.railway.app
 *
 * Watchlist v2 — 10 instruments:
 *   ZION, CMA, KRE             (bank equity / regional banks, Bf-s)
 *   ^TNX, BUND                 (rates 10Y US/DE, Bf-m)
 *   ^VIX, MOVE                 (stress indices, Bf-m)
 *   HYG                        (credit spread, Bf-m)
 *   DXY                        (dollar liquidity, Bf-m)
 *   GLD                        (flight-to-safety, Bf-m)
 */

import logger from '../logger.js';

// ─── Finance API base URL ─────────────────────────────────────────────────────

function financeApiUrl() {
  return (process.env.FINANCE_API_URL || '').trim().replace(/\/$/, '');
}

// ─── HTTP fetch of signals from matriya-finance ───────────────────────────────

/**
 * Fetches signals from matriya-finance /api/finance/signals.
 * Returns array of signal objects, or null on error.
 * @returns {Promise<Array|null>}
 */
async function fetchSignalsFromApi() {
  const base = financeApiUrl();
  if (!base) {
    logger.warn('[financeWhatsAppCommands] FINANCE_API_URL is not set — cannot fetch signals');
    return null;
  }
  try {
    const res = await fetch(`${base}/api/finance/signals`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      logger.warn(`[financeWhatsAppCommands] /api/finance/signals responded ${res.status}`);
      return null;
    }
    const json = await res.json();
    // Server returns { ok, signals: [...] }
    if (Array.isArray(json.signals)) return json.signals;
    if (Array.isArray(json)) return json;
    return null;
  } catch (e) {
    logger.error(`[financeWhatsAppCommands] fetchSignalsFromApi: ${e.message}`);
    return null;
  }
}

// ─── TwiML helper ─────────────────────────────────────────────────────────────

function escapeTwiml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Watchlist v2 (10 instruments) ────────────────────────────────────────────

const WATCHLIST_V2 = [
  'ZION  (bank equity,    Bf-s)',
  'CMA   (bank equity,    Bf-s)',
  'KRE   (regional banks, Bf-s)',
  '^TNX  (rates 10Y US,   Bf-m)',
  'BUND  (rates 10Y DE,   Bf-m)',
  '^VIX  (stress index,   Bf-m)',
  'MOVE  (stress index,   Bf-m)',
  'HYG   (credit spread,  Bf-m)',
  'DXY   (USD liquidity,  Bf-m)',
  'GLD   (flight-safety,  Bf-m)',
];

// ─── Command reply builder (async) ────────────────────────────────────────────

/**
 * Build reply text for a finance command.
 * @param {string} cmd — inner command after F prefix, e.g. "STATUS"
 * @returns {Promise<string>}
 */
export async function buildFinanceCommandReply(cmd) {
  const command = String(cmd || '').trim().toUpperCase();

  if (command === 'STATUS') {
    const signals = await fetchSignalsFromApi();
    if (signals === null) {
      const base = financeApiUrl();
      return base
        ? `Cannot reach finance service (${base}). Check Railway deployment.`
        : 'FINANCE_API_URL is not set on this server. Add it to Railway env vars.';
    }
    if (signals.length === 0) return 'No signals yet.';
    const tail = signals.slice(-5);
    return tail
      .map((s) => {
        const dot = s?.decision === 'Act' ? '🔴' : '🟢';
        const inst = s?.instrument ?? '?';
        const a = s?.a_value ?? s?.A ?? '?';
        const dec = s?.decision ?? '?';
        const ts = (s?.signal_timestamp || '').slice(0, 10);
        return `${dot} ${inst} | A=${a} | ${dec} | ${ts}`;
      })
      .join('\n');
  }

  if (command === 'WATCHLIST') {
    return ['📋 WATCHLIST (v2 — 10 sensors)', ...WATCHLIST_V2].join('\n');
  }

  if (command === 'LOG') {
    const signals = await fetchSignalsFromApi();
    if (signals === null) {
      const base = financeApiUrl();
      return base
        ? `Cannot reach finance service (${base}). Check Railway deployment.`
        : 'FINANCE_API_URL is not set on this server. Add it to Railway env vars.';
    }
    if (signals.length === 0) return 'No signals yet.';
    const tail = signals.slice(-10);
    return tail
      .map((s) => {
        const id = (s?.signal_id ?? '?').slice(0, 8);
        const inst = s?.instrument ?? '?';
        const dec = s?.decision ?? '?';
        const ts = (s?.signal_timestamp || '').slice(0, 10);
        return `${id} | ${inst} | ${dec} | ${ts}`;
      })
      .join('\n');
  }

  if (command === 'HELP') {
    return [
      'Finance commands (prefix F + space):',
      'F STATUS    — last 5 signals',
      'F WATCHLIST — 10 monitored instruments',
      'F LOG       — last 10 log entries',
      'F HELP      — this list',
    ].join('\n');
  }

  return 'Unknown finance command. Send F HELP for list.';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Finance commands (inner, after F prefix stripped). */
export const FINANCE_WHATSAPP_COMMANDS = ['STATUS', 'WATCHLIST', 'LOG', 'HELP'];

/**
 * Normalise inbound body to inner command.
 * "F STATUS" → "STATUS";  "f status" → "STATUS";  legacy "STATUS" → "STATUS".
 */
export function normalizeFinanceCommandBody(trimmedBody) {
  const upper = String(trimmedBody || '').trim().toUpperCase();
  if (upper.startsWith('F ')) return upper.slice(2).trim();
  return upper;
}

/** True if the message should be handled as a finance command (not the lab pipeline). */
export function isFinanceWhatsappCommand(trimmedBody) {
  const upper = String(trimmedBody || '').trim().toUpperCase();
  if (upper.startsWith('F ')) return true;
  return FINANCE_WHATSAPP_COMMANDS.includes(upper);
}

/**
 * Sends TwiML response for a finance command.
 * Async because signal fetch is HTTP.
 *
 * @param {import('express').Response} res
 * @param {string} incomingBody trimmed
 */
export async function sendFinanceCommandTwiml(res, incomingBody) {
  const inner = normalizeFinanceCommandBody(incomingBody);
  const reply = await buildFinanceCommandReply(inner);
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeTwiml(reply)}</Message></Response>`;
  res.set('Content-Type', 'text/xml');
  return res.status(200).send(xml);
}
