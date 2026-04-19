/**
 * routes/webhook/whatsapp.js
 *
 * POST /api/webhook/whatsapp
 * Receives incoming WhatsApp messages via Twilio webhook.
 * Runs the full MATRIYA pipeline and replies with the real LLM answer via TwiML.
 *
 * Env vars:
 *   TWILIO_AUTH_TOKEN             — enables Twilio signature check (optional)
 *   TWILIO_WEBHOOK_WHATSAPP_URL   — explicit public URL for THIS endpoint (optional override)
 *                                   if not set, derived from request headers
 *   SKIP_TWILIO_SIG_CHECK         — set to "1" to bypass signature check (debug only)
 *   SUPABASE_URL, SUPABASE_KEY    — for logging to whatsapp_tasks
 *   OPENAI_API_KEY                — required for pipeline LLM call
 *   WHATSAPP_ALLOWED_FROM         — optional comma-separated sender allowlist
 */

import twilio from 'twilio';
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import logger from '../../logger.js';
import { runPipeline } from '../../agents/orchestration.js';

const router = Router();
const TABLE = 'whatsapp_tasks';

// ─── Lazy Supabase client ─────────────────────────────────────────────────────

let _sbWa = null;
function getSupabase() {
  if (_sbWa) return _sbWa;
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_KEY are required');
  _sbWa = createClient(url, key);
  return _sbWa;
}

// ─── Twilio signature validation ──────────────────────────────────────────────

/**
 * Validates X-Twilio-Signature using Twilio's official library.
 * Tries both the explicit TWILIO_WEBHOOK_WHATSAPP_URL env var and the derived request URL.
 * Returns true if TWILIO_AUTH_TOKEN is not set (dev mode) or SKIP_TWILIO_SIG_CHECK=1.
 */
function isTwilioRequestValid(req) {
  // Allow bypassing for dev/debug
  if (process.env.SKIP_TWILIO_SIG_CHECK === '1') return true;

  const authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!authToken) {
    logger.warn('[whatsapp webhook] TWILIO_AUTH_TOKEN not set — skipping sig check (dev mode)');
    return true;
  }

  const sig = (req.headers['x-twilio-signature'] || '').trim();
  if (!sig) {
    logger.warn('[whatsapp webhook] X-Twilio-Signature header missing');
    return false;
  }

  const params = req.body || {};

  // Build the request URL the same way twilioGateway.js does
  // trust proxy: 1 ensures req.protocol is "https" behind Railway/Vercel
  const derivedUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  // Try the derived URL first (most common case)
  if (twilio.validateRequest(authToken, sig, derivedUrl, params)) {
    return true;
  }

  // Fallback: try an explicit override URL if configured
  const explicit = (process.env.TWILIO_WEBHOOK_WHATSAPP_URL || '').trim();
  if (explicit && twilio.validateRequest(authToken, sig, explicit, params)) {
    return true;
  }

  logger.warn(`[whatsapp webhook] sig invalid — derivedUrl=${derivedUrl}`);
  return false;
}

// ─── Reply formatter ──────────────────────────────────────────────────────────

function mapAction(action_required) {
  switch ((action_required || '').toUpperCase()) {
    case 'GO':      return '✅ GO';
    case 'ITERATE': return '⚠️ ITERATE';
    case 'STOP':
    default:        return '❌ STOP';
  }
}

function formatPipelineReply(pipelineResult) {
  // Use the raw LLM answer (decision.reason) as the primary reply
  const rawAnswer = (pipelineResult?.decision?.reason || '').trim();
  if (rawAnswer) return rawAnswer;

  // Fallback: structured format
  const action     = pipelineResult?.decision?.action_required ?? 'STOP';
  const rawScore   = pipelineResult?.score?.emergence_score ?? 0;
  const confidence = Math.round(Math.min(Math.max(rawScore, 0), 1) * 100);
  return `MATRIYA: ${mapAction(action)} (${confidence}%)`;
}

function escapeTwiml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── GET — health check ───────────────────────────────────────────────────────

router.get('/', (_req, res) => {
  res.status(200).type('text/plain').send('WhatsApp webhook OK');
});

// ─── POST — main handler ──────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const message     = (req.body?.Body || '').trim();
  const from_number = (req.body?.From || '').trim();

  if (!message || !from_number) {
    // Still return valid TwiML so Twilio doesn't retry endlessly
    res.set('Content-Type', 'text/xml');
    return res.send('<Response></Response>');
  }

  // Twilio signature check
  if (!isTwilioRequestValid(req)) {
    return res.status(403).send('Invalid Twilio signature');
  }

  // Sender allowlist (optional)
  const allowed = (process.env.WHATSAPP_ALLOWED_FROM || '').trim();
  if (allowed) {
    const allowSet = new Set(allowed.split(',').map(s => s.trim()).filter(Boolean));
    if (!allowSet.has(from_number)) {
      res.set('Content-Type', 'text/xml');
      return res.send('<Response></Response>');
    }
  }

  logger.info(`[whatsapp webhook] from=${from_number} msg="${message.slice(0, 80)}"`);

  // Log to DB (best-effort, non-blocking)
  getSupabase()
    .from(TABLE)
    .insert([{ from_number, message, status: 'PENDING' }])
    .then(({ error }) => { if (error) logger.error(`[whatsapp webhook] DB: ${error.message}`); })
    .catch(e => logger.error(`[whatsapp webhook] DB exception: ${e.message}`));

  // Run full MATRIYA pipeline → get real LLM answer
  let replyText;
  try {
    logger.info(`[whatsapp webhook] calling runPipeline...`);
    const result = await runPipeline(message);
    replyText = formatPipelineReply(result);
    logger.info(`[whatsapp webhook] pipeline done: ${replyText.slice(0, 120)}`);
  } catch (e) {
    logger.error(`[whatsapp webhook] pipeline error: ${e.stack || e.message}`);
    replyText = `MATRIYA: שגיאה בעיבוד הבקשה. נסה שנית.\n${e.message}`;
  }

  // Deliver reply via TwiML — Twilio sends this as a WhatsApp message to the sender
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeTwiml(replyText)}</Message></Response>`;
  res.set('Content-Type', 'text/xml');
  res.send(twiml);
});

export default router;
