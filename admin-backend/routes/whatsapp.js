/**
 * WhatsApp management routes
 * Real whatsapp_tasks columns:
 *   id, from_number, message, received_at, status, decision, confidence, candidates, rachel_notified
 */

import { Router } from 'express';
import twilio from 'twilio';
import { supabase } from '../server.js';

const router = Router();

const twilioClient = () => twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/** Twilio expects `whatsapp:+E164` */
function toWhatsAppAddress(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  if (s.startsWith('whatsapp:')) return s;
  if (s.startsWith('+')) return `whatsapp:${s}`;
  return `whatsapp:+${s.replace(/^\+/, '')}`;
}

/** Sent when an admin approves an access request from the panel */
const APPROVAL_MESSAGE = [
  'MATRIYA — Access approved',
  '',
  'Congratulations. Your request to use MATRIYA has been approved by an administrator.',
  '',
  'You may now send your laboratory messages to this number. MATRIYA will respond with structured research decisions (GO / ITERATE / STOP) based on your data.',
  '',
  'Welcome aboard — we look forward to supporting your research.',
].join('\n');

async function sendAccessApprovedWhatsApp(toRaw) {
  const to = toWhatsAppAddress(toRaw);
  if (!to) return { sent: false, error: 'Invalid phone number' };

  // Prefer matriya-back proxy — Twilio is already configured there (Railway admin-backend often has no Twilio vars).
  const matriyaUrl = (process.env.MATRIYA_BACK_URL || '').trim().replace(/\/$/, '');
  const internalKey = (process.env.MATRIYA_INTERNAL_KEY || '').trim();
  if (matriyaUrl && internalKey) {
    try {
      const r = await fetch(`${matriyaUrl}/api/internal/whatsapp-outbound`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Matriya-Internal-Key': internalKey,
        },
        body: JSON.stringify({ to: toRaw, body: APPROVAL_MESSAGE }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        return { sent: false, error: j.error || `matriya-back HTTP ${r.status}`, via: 'matriya-back' };
      }
      return { sent: true, via: 'matriya-back' };
    } catch (e) {
      return { sent: false, error: `matriya-back proxy: ${e.message}`, via: 'matriya-back' };
    }
  }

  // Fallback: Twilio directly on admin-backend
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  let from = (process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_WHATSAPP_NUMBER || '').trim();
  if (!from) {
    return {
      sent: false,
      error: 'No send path: set MATRIYA_BACK_URL + MATRIYA_INTERNAL_KEY (same key on matriya-back), or set Twilio vars on admin-backend',
    };
  }
  if (!from.startsWith('whatsapp:')) from = `whatsapp:${from}`;

  if (!sid || !token) {
    return { sent: false, error: 'Twilio not configured on admin-backend (or set MATRIYA_INTERNAL_KEY + MATRIYA_BACK_URL)' };
  }
  try {
    const msg = await twilioClient().messages.create({ from, to, body: APPROVAL_MESSAGE });
    return { sent: true, twilio_sid: msg.sid, via: 'twilio-direct' };
  } catch (e) {
    return { sent: false, error: e.message || String(e), via: 'twilio-direct' };
  }
}

/* ── Task queue ───────────────────────────────────────────── */

router.get('/queue', async (req, res) => {
  const { status, from_number, page = 1, limit = 50 } = req.query;
  let query = supabase
    .from('whatsapp_tasks')
    .select('id, from_number, message, received_at, status, decision, confidence, rachel_notified', { count: 'exact' })
    .order('received_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (status)      query = query.eq('status', status);
  if (from_number) query = query.eq('from_number', from_number);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ tasks: data, total: count, page: +page, limit: +limit });
});

router.get('/queue/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('whatsapp_tasks')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: 'Task not found' });
  res.json({ task: data });
});

router.post('/resend/:id', async (req, res) => {
  const { data: task, error: fetchErr } = await supabase
    .from('whatsapp_tasks')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (fetchErr || !task) return res.status(404).json({ error: 'Task not found' });

  const to   = task.from_number?.startsWith('whatsapp:') ? task.from_number : `whatsapp:${task.from_number}`;
  const body = task.message || 'MATRIYA: message resent by admin';

  try {
    const msg = await twilioClient().messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to,
      body,
    });
    res.json({ message: 'Resent successfully', twilio_sid: msg.sid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Whitelist ─────────────────────────────────────────────── */
// Real columns: phone, label, active, added_at

router.get('/whitelist', async (_req, res) => {
  const { data, error } = await supabase
    .from('whatsapp_whitelist')
    .select('id, phone, label, active, added_at')
    .eq('active', true)
    .order('added_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ whitelist: data });
});

router.post('/whitelist', async (req, res) => {
  const { phone_number, label } = req.body || {};
  if (!phone_number) return res.status(400).json({ error: 'phone_number required' });

  const { data, error } = await supabase
    .from('whatsapp_whitelist')
    .upsert({ phone: phone_number.trim(), label, active: true }, { onConflict: 'phone' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ entry: data });
});

router.patch('/whitelist/:phone', async (req, res) => {
  const updates = {};
  const { label, active } = req.body || {};
  if (label  !== undefined) updates.label  = label;
  if (active !== undefined) updates.active = active;

  const { data, error } = await supabase
    .from('whatsapp_whitelist')
    .update(updates)
    .eq('phone', decodeURIComponent(req.params.phone))
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ entry: data });
});

router.delete('/whitelist/:phone', async (req, res) => {
  const { error } = await supabase
    .from('whatsapp_whitelist')
    .delete()
    .eq('phone', decodeURIComponent(req.params.phone));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Number removed from whitelist' });
});

/* ── Blocked numbers ────────────────────────────────────────── */

router.get('/blocked', async (_req, res) => {
  const { data, error } = await supabase
    .from('whatsapp_whitelist')
    .select('id, phone, label, active, added_at')
    .eq('active', false)
    .order('added_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ blocked: data });
});

/* ── Access Requests ───────────────────────────────────────── */

router.get('/requests', async (req, res) => {
  const { status = 'pending' } = req.query;
  const query = supabase
    .from('access_requests')
    .select('*', { count: 'exact' })
    .order('last_seen', { ascending: false });

  const finalQuery = status === 'all' ? query : query.eq('status', status);
  const { data, error, count } = await finalQuery;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ requests: data, total: count });
});

router.post('/requests/:id/approve', async (req, res) => {
  // 1. Get request row
  const { data: reqRow, error: fetchErr } = await supabase
    .from('access_requests')
    .select('phone_number')
    .eq('id', req.params.id)
    .single();

  if (fetchErr || !reqRow) return res.status(404).json({ error: 'Request not found' });

  const phone = reqRow.phone_number;

  // 2. Add to whitelist — real columns: phone, label, active
  const { error: wlErr } = await supabase
    .from('whatsapp_whitelist')
    .upsert({ phone, active: true, label: 'Approved via admin panel' }, { onConflict: 'phone' });

  if (wlErr) return res.status(500).json({ error: `Whitelist insert failed: ${wlErr.message}` });

  // 3. Mark request as approved
  const { data, error } = await supabase
    .from('access_requests')
    .update({ status: 'approved', reviewed_by: req.admin.email, reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  const whatsapp = await sendAccessApprovedWhatsApp(phone);

  res.json({
    request: data,
    message: `${phone} approved and added to whitelist`,
    whatsapp_sent: whatsapp.sent,
    ...(whatsapp.error && !whatsapp.sent ? { whatsapp_error: whatsapp.error } : {}),
    ...(whatsapp.twilio_sid ? { twilio_sid: whatsapp.twilio_sid } : {}),
  });
});

router.post('/requests/:id/deny', async (req, res) => {
  const { note } = req.body || {};
  const { data, error } = await supabase
    .from('access_requests')
    .update({ status: 'denied', reviewed_by: req.admin.email, reviewed_at: new Date().toISOString(), note })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ request: data, message: 'Request denied' });
});

/* ── Replay pipeline ───────────────────────────────────────── */

router.post('/replay/:id', async (req, res) => {
  const { data: task, error } = await supabase
    .from('whatsapp_tasks')
    .select('message')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: 'Task not found' });

  const MATRIYA_URL = process.env.MATRIYA_BACK_URL || 'https://matriya-back-gold.vercel.app';
  try {
    const { default: fetch } = await import('node-fetch');
    const result = await fetch(`${MATRIYA_URL}/api/pipeline/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: task.message, source: 'admin_replay' }),
    }).then(r => r.json());
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
