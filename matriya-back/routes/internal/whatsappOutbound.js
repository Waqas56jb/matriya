/**
 * Server-to-server: send outbound WhatsApp via Twilio (same credentials as webhooks).
 * Used by admin-backend when an access request is approved — avoids duplicating Twilio env on Railway.
 *
 * POST /api/internal/whatsapp-outbound
 * Headers: X-Matriya-Internal-Key: <MATRIYA_INTERNAL_KEY>
 * Body:    { "to": "whatsapp:+972...", "body": "message text" }
 */
import { Router } from 'express';
import logger from '../../logger.js';
import { sendWhatsAppMessage } from '../../twilioGateway.js';

const router = Router();

router.post('/', async (req, res) => {
  const key = (req.headers['x-matriya-internal-key'] || '').trim();
  const expected = (process.env.MATRIYA_INTERNAL_KEY || '').trim();
  if (!expected) {
    return res.status(503).json({ error: 'MATRIYA_INTERNAL_KEY not configured on matriya-back' });
  }
  if (!key || key !== expected) {
    logger.warn('[internal/whatsapp-outbound] forbidden: missing or invalid key');
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { to, body } = req.body || {};
  if (!to || typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ error: 'to and body (non-empty string) required' });
  }

  try {
    await sendWhatsAppMessage(String(to).trim(), body.trim());
    logger.info(`[internal/whatsapp-outbound] sent to ${String(to).slice(0, 24)}…`);
    return res.json({ ok: true });
  } catch (e) {
    logger.error(`[internal/whatsapp-outbound] Twilio error: ${e.message}`);
    return res.status(500).json({ error: e.message || 'Send failed', code: e.code });
  }
});

export default router;
