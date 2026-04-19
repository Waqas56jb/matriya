/**
 * routes/webhook/whatsapp.js
 *
 * POST /api/webhook/whatsapp
 *
 * Flow:
 *   1. Validate Twilio signature
 *   2. Run full MATRIYA pipeline inline (RAG + kernel gate)
 *   3. Return TwiML with the REAL decision — no acknowledgment, no echo
 *   4. Also save to whatsapp_tasks if table exists (best-effort audit log)
 *
 * Pipeline timeout: 13s race — if LLM/RAG takes longer, returns a
 * "still processing" message and the result is sent via polling loop.
 */

import twilio from 'twilio';
import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import logger from '../../logger.js';
import { runPipeline } from '../../agents/orchestration.js';

const router = Router();
const TABLE = 'whatsapp_tasks';
const PIPELINE_TIMEOUT_MS = 13000; // Twilio's hard limit is 15s

// ─── Supabase (optional — for audit logging only) ─────────────────────────────

let _sbWa = null;
function tryGetSupabase() {
  if (_sbWa) return _sbWa;
  try {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (url && key) _sbWa = createClient(url, key);
  } catch (_) {}
  return _sbWa;
}

async function saveTask(from_number, message, status = 'PENDING') {
  try {
    const sb = tryGetSupabase();
    if (!sb) return;
    const { error } = await sb.from(TABLE).insert([{ from_number, message, status }]);
    if (error) logger.warn(`[whatsapp webhook] DB save: ${error.message}`);
  } catch (e) {
    logger.warn(`[whatsapp webhook] DB save exception: ${e.message}`);
  }
}

// ─── Signature validation ─────────────────────────────────────────────────────

function isTwilioRequestValid(req) {
  if (process.env.SKIP_TWILIO_SIG_CHECK === '1') return true;
  const authToken = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!authToken) return true; // dev mode

  const sig = (req.headers['x-twilio-signature'] || '').trim();
  if (!sig) return false;
  const params = req.body || {};

  const derivedUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  if (twilio.validateRequest(authToken, sig, derivedUrl, params)) return true;

  const explicit = (process.env.TWILIO_WEBHOOK_WHATSAPP_URL || '').trim();
  if (explicit && twilio.validateRequest(authToken, sig, explicit, params)) return true;

  logger.warn(`[whatsapp webhook] sig invalid url=${derivedUrl}`);
  return false;
}

// ─── Reply formatter ──────────────────────────────────────────────────────────

function formatDecision(pipelineResult) {
  const action      = pipelineResult?.decision?.action_required ?? 'STOP';
  // Use decision.confidence (data-completeness based, 0-100)
  // Fall back to emergence_score only if confidence not set
  const rawConf = pipelineResult?.decision?.confidence
    ?? Math.round((pipelineResult?.score?.emergence_score ?? 0) * 100);
  const conf = Math.min(Math.max(Math.round(rawConf), 0), 100);
  const reason = (pipelineResult?.decision?.reason || '')
    .replace(/```json[\s\S]*?```/gi, '')
    .replace(/```[\s\S]*?```/gi, '')
    .trim();
  const missingData = pipelineResult?.decision?.missing_data ?? [];
  const kernelTag   = pipelineResult?.decision?.kernel_tripped ? ' [KERNEL]' : '';

  const actionLine = action === 'GO'      ? '✅ GO'
                   : action === 'ITERATE' ? '⚠️ ITERATE'
                   : '❌ STOP';

  const rawFirst = reason
    .replace(/```json[\s\S]*?```/gi, '')   // strip any leaked JSON blocks
    .replace(/```[\s\S]*?```/gi, '')
    .split(/[.!?\n]/)[0]
    .replace(/^\[KERNEL GATE\]\s*/i, '')
    .trim();

  // Pattern matches both English and Hebrew "no supporting info" responses
  const noSupportPattern = /no supporting information|no evidence|no data available|insufficient information|אין.*מידע.*תומך|אין מידע|אין תמיכה/i;
  const firstSentence = (noSupportPattern.test(rawFirst) && conf > 0)
    ? `Partial data detected (${conf}% evidence completeness) — provide full experiment data to proceed.`
    : rawFirst || 'No details available.';

  let reply = `MATRIYA Decision${kernelTag}:\n${actionLine}\nConfidence: ${conf}%\n${firstSentence}`;

  // STOP: always append what is missing so David knows what to send next
  if (action === 'STOP' && missingData.length > 0) {
    const missingList = missingData.join(', ');
    reply += `\n\nMissing: ${missingList}.\nSend these to continue.`;
  }

  return reply;
}

function escapeTwiml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function twimlResponse(text) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeTwiml(text)}</Message></Response>`;
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
    res.set('Content-Type', 'text/xml');
    return res.send('<Response></Response>');
  }

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

  // Save to DB for audit (best-effort — does not block pipeline)
  saveTask(from_number, message, 'PROCESSING');

  // Run pipeline with timeout race
  let replyText;
  let finalStatus = 'DONE';

  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('PIPELINE_TIMEOUT')), PIPELINE_TIMEOUT_MS)
    );

    const pipelineResult = await Promise.race([runPipeline(message), timeout]);
    replyText = formatDecision(pipelineResult);
    logger.info(`[whatsapp webhook] pipeline completed: ${replyText.replace(/\n/g, ' | ')}`);
  } catch (e) {
    if (e.message === 'PIPELINE_TIMEOUT') {
      logger.warn('[whatsapp webhook] pipeline timed out — sending fallback, polling will retry');
      replyText = '⏳ MATRIYA: עיבוד מורחב — תשובה תגיע תוך דקה.';
      finalStatus = 'PENDING'; // let polling loop handle it
    } else {
      logger.error(`[whatsapp webhook] pipeline error: ${e.stack || e.message}`);
      replyText = `MATRIYA: שגיאה בעיבוד הבקשה.\n${e.message}`;
      finalStatus = 'ERROR';
    }
  }

  // Update task status
  try {
    const sb = tryGetSupabase();
    if (sb) {
      await sb.from(TABLE)
        .update({ status: finalStatus })
        .eq('from_number', from_number)
        .eq('message', message)
        .eq('status', 'PROCESSING');
    }
  } catch (_) {}

  res.set('Content-Type', 'text/xml');
  res.send(twimlResponse(replyText));
});

export default router;
