/**
 * routes/webhook/whatsapp.js
 *
 * POST /api/webhook/whatsapp
 *
 * Receives incoming WhatsApp messages via Twilio webhook.
 *
 * Flow:
 *   1. Validate Twilio signature (skipped if SKIP_TWILIO_SIG_CHECK=1)
 *   2. Save message to whatsapp_tasks (status = PENDING)
 *   3. Return IMMEDIATE TwiML acknowledgment (< 2s — well within Twilio's 15s timeout)
 *   4. whatsappPipeline.js polling loop picks up PENDING rows every 30s,
 *      runs the full RAG pipeline, sends the real answer to DAVID_WHATSAPP,
 *      and marks the row DONE.
 *
 * Env vars:
 *   TWILIO_AUTH_TOKEN            — enables signature check
 *   SKIP_TWILIO_SIG_CHECK        — "1" to bypass signature check (debug)
 *   TWILIO_WEBHOOK_WHATSAPP_URL  — explicit URL override for this endpoint
 *   SUPABASE_URL, SUPABASE_KEY
 *   WHATSAPP_ALLOWED_FROM        — optional comma-separated sender allowlist
 */

import twilio from 'twilio';
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import logger from '../../logger.js';

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

// ─── Signature validation ─────────────────────────────────────────────────────

function isTwilioRequestValid(req) {
  if (process.env.SKIP_TWILIO_SIG_CHECK === '1') return true;

  const authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!authToken) {
    logger.warn('[whatsapp webhook] TWILIO_AUTH_TOKEN not set — skipping sig check');
    return true;
  }

  const sig = (req.headers['x-twilio-signature'] || '').trim();
  if (!sig) return false;

  const params = req.body || {};

  // Derive URL from request (trust proxy: 1 is set in server.js)
  const derivedUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  if (twilio.validateRequest(authToken, sig, derivedUrl, params)) return true;

  // Fallback: try explicit override URL
  const explicit = (process.env.TWILIO_WEBHOOK_WHATSAPP_URL || '').trim();
  if (explicit && twilio.validateRequest(authToken, sig, explicit, params)) return true;

  logger.warn(`[whatsapp webhook] signature invalid for url=${derivedUrl}`);
  return false;
}

// ─── GET — health check ───────────────────────────────────────────────────────

router.get('/', (_req, res) => {
  res.status(200).type('text/plain').send('WhatsApp webhook OK');
});

// ─── POST — main handler ──────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const message     = (req.body?.Body || '').trim();
  const from_number = (req.body?.From || '').trim();

  // Empty body — acknowledge silently
  if (!message || !from_number) {
    res.set('Content-Type', 'text/xml');
    return res.send('<Response></Response>');
  }

  // Signature check
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

  logger.info(`[whatsapp webhook] inbound from=${from_number} msg="${message.slice(0, 80)}"`);

  // Save to whatsapp_tasks (PENDING) — polled every 30s by whatsappPipeline.js
  try {
    const { error } = await getSupabase()
      .from(TABLE)
      .insert([{ from_number, message, status: 'PENDING' }]);
    if (error) logger.error(`[whatsapp webhook] DB insert: ${error.message}`);
    else logger.info('[whatsapp webhook] saved to whatsapp_tasks PENDING');
  } catch (e) {
    logger.error(`[whatsapp webhook] DB exception: ${e.message}`);
  }

  // Immediate TwiML acknowledgment — Twilio delivers this instantly to the sender.
  // The REAL answer is sent asynchronously by whatsappPipeline.js via Twilio Messages API.
  const ack = '✅ MATRIYA: הודעתך התקבלה. עיבוד בתהליך — תשובה תגיע תוך דקה.';
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${ack}</Message></Response>`;
  res.set('Content-Type', 'text/xml');
  res.send(twiml);
});

export default router;
