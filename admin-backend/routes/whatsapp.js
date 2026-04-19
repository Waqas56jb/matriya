/**
 * WhatsApp management routes
 *
 * GET    /api/admin/whatsapp/queue              — full task queue
 * GET    /api/admin/whatsapp/queue/:id          — single task detail
 * POST   /api/admin/whatsapp/resend/:id         — resend failed outbound
 * GET    /api/admin/whatsapp/whitelist           — phone number whitelist
 * POST   /api/admin/whatsapp/whitelist           — add number to whitelist
 * PATCH  /api/admin/whatsapp/whitelist/:phone    — update whitelist entry
 * DELETE /api/admin/whatsapp/whitelist/:phone    — remove from whitelist
 * GET    /api/admin/whatsapp/blocked             — blocked numbers
 * POST   /api/admin/whatsapp/replay/:id          — replay pipeline for task
 */

import { Router } from 'express';
import twilio from 'twilio';
import { supabase } from '../server.js';

const router = Router();

const twilioClient = () => twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* ── Task queue ───────────────────────────────────────────── */

router.get('/queue', async (req, res) => {
  const { status, from_number, page = 1, limit = 50 } = req.query;
  let query = supabase
    .from('whatsapp_tasks')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
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

  const to = task.from_number?.startsWith('whatsapp:') ? task.from_number : `whatsapp:${task.from_number}`;
  const body = task.response || task.message || 'MATRIYA: message resent by admin';

  try {
    const msg = await twilioClient().messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to,
      body,
    });

    await supabase.from('whatsapp_tasks').update({ resent_at: new Date().toISOString(), twilio_sid: msg.sid }).eq('id', task.id);
    res.json({ message: 'Resent successfully', twilio_sid: msg.sid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Whitelist ─────────────────────────────────────────────── */

router.get('/whitelist', async (_req, res) => {
  const { data, error } = await supabase
    .from('whatsapp_whitelist')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ whitelist: data });
});

router.post('/whitelist', async (req, res) => {
  const { phone_number, label, note } = req.body || {};
  if (!phone_number) return res.status(400).json({ error: 'phone_number required' });

  const { data, error } = await supabase
    .from('whatsapp_whitelist')
    .insert({ phone_number: phone_number.trim(), label, note, added_by: req.admin.email })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ entry: data });
});

router.patch('/whitelist/:phone', async (req, res) => {
  const { label, note, is_active } = req.body || {};
  const updates = {};
  if (label     !== undefined) updates.label     = label;
  if (note      !== undefined) updates.note      = note;
  if (is_active !== undefined) updates.is_active = is_active;

  const { data, error } = await supabase
    .from('whatsapp_whitelist')
    .update(updates)
    .eq('phone_number', decodeURIComponent(req.params.phone))
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ entry: data });
});

router.delete('/whitelist/:phone', async (req, res) => {
  const { error } = await supabase
    .from('whatsapp_whitelist')
    .delete()
    .eq('phone_number', decodeURIComponent(req.params.phone));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Number removed from whitelist' });
});

/* ── Blocked numbers ────────────────────────────────────────── */

router.get('/blocked', async (_req, res) => {
  const { data, error } = await supabase
    .from('whatsapp_whitelist')
    .select('*')
    .eq('is_active', false)
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ blocked: data });
});

/* ── Replay pipeline ───────────────────────────────────────── */

router.post('/replay/:id', async (req, res) => {
  const { data: task, error } = await supabase
    .from('whatsapp_tasks')
    .select('message')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: 'Task not found' });

  const MATRIYA_URL = process.env.MATRIYA_BACK_URL || 'http://localhost:8000';
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
