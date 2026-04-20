/**
 * WhatsApp finance operator commands (STATUS / WATCHLIST / LOG / HELP).
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

export function resolveShadowSignalsLogPath() {
  const env = (process.env.FINANCE_SHADOW_SIGNALS_PATH || '').trim();
  return env || defaultShadowSignalsPath();
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
    if (lines === null) return 'Log not found.';
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
      'Commands:',
      'STATUS — last 5 signals',
      'WATCHLIST — monitored instruments',
      'LOG — last 10 entries',
      'DETAIL [ID] — signal detail',
      'CLOSE [ID] — close signal',
      'HELP — this list'
    ].join('\n');
  }

  if (cmd === 'LOG') {
    const lines = parseNdjsonTail(logPath, 10);
    if (lines === null) return 'Log not found.';
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

/** Finance commands that return TwiML (not the lab pipeline). */
export const FINANCE_WHATSAPP_COMMANDS = ['STATUS', 'WATCHLIST', 'LOG', 'HELP'];

export function isFinanceWhatsappCommand(trimmedBody) {
  const cmd = String(trimmedBody || '').trim().toUpperCase();
  return FINANCE_WHATSAPP_COMMANDS.includes(cmd);
}

/**
 * @param {import('express').Response} res
 * @param {string} incomingBody trimmed
 */
export function sendFinanceCommandTwiml(res, incomingBody) {
  const reply = buildFinanceCommandReply(incomingBody);
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeTwiml(reply)}</Message></Response>`;
  res.set('Content-Type', 'text/xml');
  return res.status(200).send(xml);
}
