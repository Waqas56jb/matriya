/**
 * routes/webhook/whatsapp.js
 *
 * POST /api/webhook/whatsapp
 * Receives incoming WhatsApp messages via Twilio webhook.
 * Runs the full MATRIYA pipeline and replies with a real answer via TwiML.
 *
 * Env vars:
 *   TWILIO_AUTH_TOKEN           — enables Twilio signature check
 *   TWILIO_WEBHOOK_PUBLIC_URL   — must match URL configured in Twilio Console
 *   SUPABASE_URL, SUPABASE_KEY  — for logging to whatsapp_tasks
 *   OPENAI_API_KEY              — required for pipeline LLM call
 *   WHATSAPP_ALLOWED_FROM       — optional comma-separated allowlist
 */

import crypto from 'crypto';
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

function validateTwilioSignature(authToken, twilioSignature, url, params) {
  if (!authToken || !twilioSignature || !url || !params) return false;
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + (params[key] ?? '');
  }
  const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
  try {
    const a = Buffer.from(twilioSignature, 'utf-8');
    const b = Buffer.from(expected, 'utf-8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function getWebhookPublicUrl(req) {
  // Always derive from the actual request URL — do NOT use TWILIO_WEBHOOK_PUBLIC_URL
  // because that env var may be set to a different endpoint (/api/whatsapp/inbound).
  const host = req.get('host') || '';
  const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
  const path = (req.originalUrl || req.url || '').split('?')[0];
  return `${proto}://${host}${path}`;
}

// ─── Reply formatter ──────────────────────────────────────────────────────────

function mapAction(action_required) {
  switch ((action_required || '').toUpperCase()) {
    case 'GO':      return '✅ GO';
    case 'ITERATE': return '⚠️ WAIT';
    case 'STOP':
    default:        return '❌ NO-GO';
  }
}

function formatPipelineReply(pipelineResult) {
  const action     = pipelineResult?.decision?.action_required ?? 'STOP';
  const rawScore   = pipelineResult?.score?.emergence_score ?? 0;
  const confidence = Math.round(Math.min(Math.max(rawScore, 0), 1) * 100);
  const fullReason = (pipelineResult?.decision?.reason || '').replace(/decision\s*=\s*(GO|STOP|ITERATE)/gi, '').trim();
  const summary    = fullReason.split(/[.!?\n]/)[0].trim() || 'No summary available.';

  return (
    `✅ MATRIYA Result:\n` +
    `${mapAction(action)}\n` +
    `Confidence: ${confidence}%\n` +
    `Summary: ${summary}`
  );
}

function escapeTwiml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── GET health check ─────────────────────────────────────────────────────────

router.get('/', (_req, res) => {
  res.status(200).type('text/plain').send('WhatsApp webhook OK');
});

// ─── POST — main handler ──────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const message     = (req.body?.Body || '').trim();
  const from_number = (req.body?.From || '').trim();

  if (!message || !from_number) {
    return res.status(400).json({ received: false, error: 'Missing Body or From' });
  }

  // Twilio signature check (skipped if no auth token — dev mode)
  const authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (authToken) {
    const signature = req.get('X-Twilio-Signature') || '';
    const url = getWebhookPublicUrl(req);
    const ok = validateTwilioSignature(authToken, signature, url, req.body);
    if (!ok) {
      logger.warn('[whatsapp webhook] invalid Twilio signature');
      return res.status(403).json({ received: false, error: 'Invalid Twilio signature' });
    }
  }

  // Sender allowlist check (optional)
  const allowed = (process.env.WHATSAPP_ALLOWED_FROM || '').trim();
  if (allowed) {
    const allowSet = new Set(allowed.split(',').map(s => s.trim()).filter(Boolean));
    if (!allowSet.has(from_number)) {
      return res.status(403).json({ received: false, error: 'Sender not allowed' });
    }
  }

  logger.info(`[whatsapp webhook] inbound from=${from_number} message="${message.slice(0, 80)}"`);

  // Save to whatsapp_tasks (best-effort, non-blocking)
  try {
    const { error } = await getSupabase()
      .from(TABLE)
      .insert([{ from_number, message, status: 'PENDING' }]);
    if (error) logger.error(`[whatsapp webhook] DB insert: ${error.message}`);
  } catch (e) {
    logger.error(`[whatsapp webhook] DB insert exception: ${e.message}`);
  }

  // Run full MATRIYA pipeline → get real answer
  let replyText;
  try {
    logger.info(`[whatsapp webhook] running pipeline for: "${message.slice(0, 60)}"`);
    const pipelineResult = await runPipeline(message);
    replyText = formatPipelineReply(pipelineResult);
    logger.info(`[whatsapp webhook] pipeline done → ${replyText.replace(/\n/g, ' | ')}`);
  } catch (e) {
    logger.error(`[whatsapp webhook] pipeline error: ${e.message}`);
    replyText = `MATRIYA: שגיאה בעיבוד הבקשה. אנא נסה שנית.\n\n${e.message}`;
  }

  // Reply via TwiML — Twilio delivers this as a WhatsApp message to the sender
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeTwiml(replyText)}</Message></Response>`;
  res.set('Content-Type', 'text/xml');
  res.send(twiml);
});

export default router;
