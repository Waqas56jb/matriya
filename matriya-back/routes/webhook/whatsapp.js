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
import { sendWhatsAppMessage, logTicket } from '../../twilioGateway.js';

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

async function saveTask(from_number, message, status = 'PENDING', extra = {}) {
  try {
    const sb = tryGetSupabase();
    if (!sb) return;
    const { error } = await sb.from(TABLE).insert([{ from_number, message, status, ...extra }]);
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
  // "Sufficient" language in an ITERATE decision is semantically misleading — replace it
  const sufficientPattern = /sufficient|enough data|adequate|supports? (?:a )?(?:positive |final )?decision|allows? (?:for )?(?:a )?(?:positive )?(?:decision|proceed|go ahead)/i;

  let firstSentence;
  if (noSupportPattern.test(rawFirst) && conf > 0) {
    firstSentence = `Partial data detected (${conf}% evidence completeness) — provide full experiment data to proceed.`;
  } else if (action === 'ITERATE' && sufficientPattern.test(rawFirst)) {
    firstSentence = `Partial evidence supports iteration; additional data may improve decision confidence.`;
  } else {
    firstSentence = rawFirst || 'No details available.';
  }

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

// ─── GET /test-rachel — diagnostic: send a test message to Rachel ─────────────
// Usage: GET /api/webhook/whatsapp/test-rachel
// Returns JSON with success/error so we can see the exact Twilio error.

router.get('/test-rachel', async (_req, res) => {
  const rachelRaw = (process.env.RACHEL_WHATSAPP || '').trim();
  if (!rachelRaw) {
    return res.json({ ok: false, error: 'RACHEL_WHATSAPP env var not set' });
  }

  const testMsg = [
    'MATRIYA → ⚠️ ITERATE (Confidence: 55%)',
    '',
    '3 N-Stage Candidates:',
    '1. Provide experiment results to advance the decision',
    '2. Provide formulation parameters for evaluation',
    '3. Add baseline or control comparison data'
  ].join('\n');

  try {
    await sendWhatsAppMessage(rachelRaw, testMsg);
    res.json({ ok: true, sent_to: rachelRaw, message: testMsg });
  } catch (e) {
    res.json({ ok: false, sent_to: rachelRaw, error: e.message, code: e.code, status: e.status });
  }
});

// ─── POST — main handler ──────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const incomingBody = req.body?.Body || '';

  // Finance signal echo suppression — matriya-finance sends status alerts via
  // Twilio; suppress them here so they do not trigger the lab decision pipeline.
  if (incomingBody.startsWith('🔴 MATRIYA SIGNAL') ||
      incomingBody.startsWith('🟢 MATRIYA SIGNAL') ||
      incomingBody.startsWith('🟡 MATRIYA SIGNAL')) {
    logger.info('[whatsapp webhook] Finance signal echo suppressed');
    return res.status(200).send('<Response></Response>');
  }

  const message     = incomingBody.trim();
  const from_number = (req.body?.From || '').trim();

  if (!message || !from_number) {
    res.set('Content-Type', 'text/xml');
    return res.send('<Response></Response>');
  }

  if (!isTwilioRequestValid(req)) {
    return res.status(403).send('Invalid Twilio signature');
  }

  // ── Phone number whitelist (Supabase-backed) ─────────────────────────────────
  // Source of truth: whatsapp_whitelist table in Supabase.
  // David can add/remove numbers directly in Supabase — no code change or
  // redeploy required.  Falls back to OPEN mode if Supabase is unavailable.
  const whitelistEnabled = (process.env.WHATSAPP_WHITELIST_ENABLED || '1') !== '0';
  if (whitelistEnabled) {
    const sb = tryGetSupabase();
    if (sb) {
      const { data: row } = await sb
        .from('whatsapp_whitelist')
        .select('active')
        .eq('phone', from_number)
        .eq('active', true)
        .maybeSingle();

      if (!row) {
        logger.warn(`[whatsapp webhook] BLOCKED number=${from_number} — not in whitelist`);

        // Log access request so admin can approve from the panel
        try {
          await sb.from('access_requests').upsert({
            phone_number:  from_number,
            first_message: message.slice(0, 500),
            last_seen:     new Date().toISOString(),
          }, {
            onConflict:    'phone_number',
            ignoreDuplicates: false,
          });
          // Increment request_count on repeated attempts
          await sb.rpc('increment_access_request_count', { p_phone: from_number }).catch(() => {});
        } catch (e) {
          logger.warn(`[whatsapp webhook] access_requests log failed: ${e.message}`);
        }

        res.set('Content-Type', 'text/xml');
        return res.send(twimlResponse('Access denied. Contact system administrator.'));
      }
    }
  }

  logger.info(`[whatsapp webhook] from=${from_number} msg="${message.slice(0, 80)}"`);

  // Save initial task row (PROCESSING) — updated below with full result
  saveTask(from_number, message, 'PROCESSING');

  // Run pipeline with timeout race
  let replyText;
  let finalStatus = 'DONE';
  let taskExtra = {};   // extra columns written back after pipeline completes

  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('PIPELINE_TIMEOUT')), PIPELINE_TIMEOUT_MS)
    );

    const pipelineResult = await Promise.race([runPipeline(message), timeout]);
    replyText = formatDecision(pipelineResult);
    logger.info(`[whatsapp webhook] pipeline completed: ${replyText.replace(/\n/g, ' | ')}`);

    // Build extra columns for Supabase row (proof for David's screenshot)
    const action    = pipelineResult?.decision?.action_required ?? 'STOP';
    const conf      = pipelineResult?.decision?.confidence ?? 0;
    const cands     = pipelineResult?.candidates ?? [];
    taskExtra = {
      decision:         action,
      confidence:       conf,
      candidates:       cands.length > 0 ? cands : null,
      rachel_notified:  false
    };

    // ── Outbound Rachel notification on ITERATE with candidates ────────────────
    if (action === 'ITERATE' && cands.length > 0) {
      try {
        await notifyRachel(pipelineResult);
        taskExtra.rachel_notified = true;
        logger.info('[whatsapp webhook] Rachel notified ✓');
      } catch (e) {
        logger.error(`[whatsapp webhook] notifyRachel error: ${e.message}`);
      }
    }
  } catch (e) {
    if (e.message === 'PIPELINE_TIMEOUT') {
      logger.warn('[whatsapp webhook] pipeline timed out — sending fallback, polling will retry');
      replyText = '⏳ MATRIYA: עיבוד מורחב — תשובה תגיע תוך דקה.';
      finalStatus = 'PENDING';
    } else {
      logger.error(`[whatsapp webhook] pipeline error: ${e.stack || e.message}`);
      replyText = `MATRIYA: שגיאה בעיבוד הבקשה.\n${e.message}`;
      finalStatus = 'ERROR';
    }
  }

  // Update task row with final status + pipeline result columns
  try {
    const sb = tryGetSupabase();
    if (sb) {
      await sb.from(TABLE)
        .update({ status: finalStatus, ...taskExtra })
        .eq('from_number', from_number)
        .eq('message', message)
        .eq('status', 'PROCESSING');
    }
  } catch (_) {}

  res.set('Content-Type', 'text/xml');
  res.send(twimlResponse(replyText));
});

// ─── Rachel outbound notification ─────────────────────────────────────────────

/**
 * When MATRIYA returns ITERATE and candidates are present, send an outbound
 * WhatsApp message to Rachel (RACHEL_WHATSAPP env var) listing all 3 candidates.
 *
 * Silent no-op if RACHEL_WHATSAPP is not configured or decision is not ITERATE.
 *
 * @param {object} pipelineResult — full runPipeline() result
 */
async function notifyRachel(pipelineResult) {
  const rachelRaw = (process.env.RACHEL_WHATSAPP || '').trim();
  if (!rachelRaw) return; // not configured — skip

  const action = pipelineResult?.decision?.action_required;
  if (action !== 'ITERATE') return; // only fire on ITERATE

  const candidates = pipelineResult?.candidates || [];
  if (candidates.length === 0) return; // no candidates to send

  const rachelAddr = rachelRaw.startsWith('whatsapp:') ? rachelRaw : `whatsapp:${rachelRaw}`;
  const msg = formatRachelMessage(pipelineResult, candidates);

  logger.info(`[whatsapp webhook] sending ITERATE candidates to Rachel at ${rachelAddr}`);
  await sendWhatsAppMessage(rachelAddr, msg);
  await logTicket(rachelAddr, msg, 'outbound_rachel');
}

/**
 * Build the outbound message to Rachel.
 * Format:
 *   MATRIYA → ITERATE (Confidence: 30%)
 *   3 N-Stage Candidates:
 *   1. <candidate 1>
 *   2. <candidate 2>
 *   3. <candidate 3>
 */
function formatRachelMessage(pipelineResult, candidates) {
  const conf = pipelineResult?.decision?.confidence ?? 0;
  const lines = [
    `MATRIYA → ⚠️ ITERATE (Confidence: ${conf}%)`,
    ``,
    `3 N-Stage Candidates:`,
    ...candidates.slice(0, 3).map((c, i) => `${i + 1}. ${c}`)
  ];
  return lines.join('\n');
}

export default router;
