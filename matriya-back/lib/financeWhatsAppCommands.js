/**
 * WhatsApp finance operator commands (STATUS / WATCHLIST / LOG / HELP).
 * Prefixed form "F STATUS" etc. avoids routing single letter "F" or finance text to the lab pipeline.
 * Reads matriya-finance shadow signals NDJSON; path override via FINANCE_SHADOW_SIGNALS_PATH.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default: repo sibling matriya-finance (works in monorepo checkout). */
export function defaultShadowSignalsPath() {
  return path.join(__dirname, '..', '..', 'matriya-finance', 'Layer3_Shadow_Signals.ndjson');
}

/**
 * First existing path wins: explicit env → sibling matriya-finance → bundled matriya-back/data.
 * Railway often deploys only matriya-back; sibling repo is missing unless you set FINANCE_SHADOW_SIGNALS_PATH.
 */
export function resolveShadowSignalsLogPath() {
  const env = (process.env.FINANCE_SHADOW_SIGNALS_PATH || '').trim();
  if (env) return env;

  const candidates = [
    defaultShadowSignalsPath(),
    path.join(__dirname, '..', 'data', 'Layer3_Shadow_Signals.ndjson'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return candidates[1];
}

function escapeTwiml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseNdjsonTail(filePath, maxLines) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    const tail = lines.slice(-maxLines);
    const rows = [];
    for (const line of tail) {
      try {
        rows.push(JSON.parse(line));
      } catch {
        /* skip bad line */
      }
    }
    return rows;
  } catch (e) {
    logger.warn(`[financeWhatsAppCommands] read ${filePath}: ${e.message}`);
    return null;
  }
}

/**
 * @param {string} body trimmed inbound Body
 * @returns {string} plain text (will be wrapped in TwiML Message)
 */
export function buildFinanceCommandReply(body) {
  const cmd = String(body || '').trim().toUpperCase();
  const logPath = resolveShadowSignalsLogPath();

  if (cmd === 'STATUS') {
    const lines = parseNdjsonTail(logPath, 5);
    if (lines === null) {
      return 'Log not readable. Set FINANCE_SHADOW_SIGNALS_PATH on the server (see server logs for path).';
    }
    if (lines.length === 0) return 'No signals yet.';
    return lines
      .map((s) => {
        const dot = s?.decision === 'Act' ? '🔴' : '🟢';
        const inst = s?.instrument ?? '?';
        const a = s?.A ?? '?';
        const dec = s?.decision ?? '?';
        const ts = (s?.signal_timestamp || '').slice(0, 10);
        return `${dot} ${inst} | A=${a} | ${dec} | ${ts}`;
      })
      .join('\n');
  }

  if (cmd === 'WATCHLIST') {
    return [
      '📋 WATCHLIST',
      'ZION (bank, Bf-s)',
      'CMA (bank, Bf-s)',
      '^TNX (rates, Bf-m)',
      'BUND (rates, Bf-m)',
      '^VIX (stress, Bf-m)',
      'MOVE (stress, Bf-m)'
    ].join('\n');
  }

  if (cmd === 'HELP') {
    return [
      'Finance commands (use F + space so lab does not intercept):',
      'F STATUS — last 5 signals (legacy: STATUS)',
      'F WATCHLIST — list (legacy: WATCHLIST)',
      'F LOG — last 10 entries (legacy: LOG)',
      'F HELP — this list (legacy: HELP)'
    ].join('\n');
  }

  if (cmd === 'LOG') {
    const lines = parseNdjsonTail(logPath, 10);
    if (lines === null) {
      return 'Log not readable. Set FINANCE_SHADOW_SIGNALS_PATH on the server (see server logs for path).';
    }
    if (lines.length === 0) return 'No signals yet.';
    return lines
      .map((s) => {
        const id = s?.signal_id ?? '?';
        const inst = s?.instrument ?? '?';
        const dec = s?.decision ?? '?';
        const ts = (s?.signal_timestamp || '').slice(0, 10);
        return `${id} | ${inst} | ${dec} | ${ts}`;
      })
      .join('\n');
  }

  return 'Unknown command. Send HELP for list.';
}

/** Finance commands that return TwiML (not the lab pipeline), without F prefix. */
export const FINANCE_WHATSAPP_COMMANDS = ['STATUS', 'WATCHLIST', 'LOG', 'HELP'];

/**
 * Inbound body after trim → uppercase inner command for buildFinanceCommandReply.
 * "F STATUS" → "STATUS"; legacy "status" → "STATUS".
 */
export function normalizeFinanceCommandBody(trimmedBody) {
  const upper = String(trimmedBody || '').trim().toUpperCase();
  if (upper.startsWith('F ')) return upper.slice(2).trim();
  return upper;
}

/** True if message should be handled as finance (not lab / RAG pipeline). */
export function isFinanceWhatsappCommand(trimmedBody) {
  const upper = String(trimmedBody || '').trim().toUpperCase();
  if (upper.startsWith('F ')) return true;
  return FINANCE_WHATSAPP_COMMANDS.includes(upper);
}

/**
 * @param {import('express').Response} res
 * @param {string} incomingBody trimmed
 */
export function sendFinanceCommandTwiml(res, incomingBody) {
  const inner = normalizeFinanceCommandBody(incomingBody);
  const reply = buildFinanceCommandReply(inner);
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeTwiml(reply)}</Message></Response>`;
  res.set('Content-Type', 'text/xml');
  return res.status(200).send(xml);
}
