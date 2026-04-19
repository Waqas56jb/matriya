/**
 * Analytics & traffic routes
 * Real column names:
 *   whatsapp_tasks → from_number, message, received_at, status, decision, confidence
 *   users          → id, username, email, is_active, is_admin, created_at, last_login
 */
import { Router } from 'express';
import { supabase } from '../server.js';

const router = Router();

router.get('/overview', async (_req, res) => {
  const [usersRes, tasksRes, experimentsRes, inactiveRes] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('whatsapp_tasks').select('id', { count: 'exact', head: true }),
    supabase.from('experiments').select('id', { count: 'exact', head: true }),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('is_active', false),
  ]);

  res.json({
    total_users:        usersRes.count       ?? 0,
    total_messages:     tasksRes.count       ?? 0,
    total_experiments:  experimentsRes.count ?? 0,
    pending_approvals:  inactiveRes.count    ?? 0,
  });
});

router.get('/decisions', async (req, res) => {
  const { days = 30 } = req.query;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('whatsapp_tasks')
    .select('decision, received_at')
    .gte('received_at', since)
    .not('decision', 'is', null);

  if (error) return res.status(500).json({ error: error.message });

  const counts = { GO: 0, ITERATE: 0, STOP: 0, OTHER: 0 };
  for (const row of data || []) {
    const d = (row.decision || '').toUpperCase();
    if (counts[d] !== undefined) counts[d]++;
    else counts.OTHER++;
  }

  res.json({ period_days: +days, counts, total: (data || []).length });
});

router.get('/whatsapp', async (req, res) => {
  const { days = 14 } = req.query;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('whatsapp_tasks')
    .select('received_at')
    .gte('received_at', since)
    .order('received_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const byDay = {};
  for (const row of data || []) {
    const day = (row.received_at || '').slice(0, 10);
    if (day) byDay[day] = (byDay[day] || 0) + 1;
  }

  res.json({
    period_days: +days,
    daily: Object.entries(byDay).map(([date, count]) => ({ date, count })),
    total: (data || []).length,
  });
});

router.get('/top-users', async (req, res) => {
  const { limit = 10 } = req.query;

  const { data, error } = await supabase
    .from('whatsapp_tasks')
    .select('from_number')
    .not('from_number', 'is', null);

  if (error) return res.status(500).json({ error: error.message });

  const freq = {};
  for (const row of data || []) freq[row.from_number] = (freq[row.from_number] || 0) + 1;

  const sorted = Object.entries(freq)
    .map(([phone, count]) => ({ phone, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, +limit);

  res.json({ top_users: sorted });
});

router.get('/pending', async (_req, res) => {
  const { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', false);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ pending_approvals: count ?? 0 });
});

router.get('/response-times', async (req, res) => {
  const { days = 7 } = req.query;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Use received_at as start time; no completed_at in real schema so return placeholder
  const { count, error } = await supabase
    .from('whatsapp_tasks')
    .select('id', { count: 'exact', head: true })
    .gte('received_at', since)
    .not('decision', 'is', null);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ avg_ms: 0, p95_ms: 0, count: count ?? 0, period_days: +days });
});

export default router;
