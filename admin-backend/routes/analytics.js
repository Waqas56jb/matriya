/**
 * Analytics & traffic routes
 *
 * GET /api/admin/analytics/overview        — summary card counts
 * GET /api/admin/analytics/decisions       — GO/ITERATE/STOP counts + trend
 * GET /api/admin/analytics/whatsapp        — message volume per day
 * GET /api/admin/analytics/top-users       — top users by message count
 * GET /api/admin/analytics/pending         — pending approval requests count
 * GET /api/admin/analytics/response-times  — avg pipeline response time
 */

import { Router } from 'express';
import { supabase } from '../server.js';

const router = Router();

router.get('/overview', async (_req, res) => {
  const [usersRes, tasksRes, experimentsRes, pendingRes] = await Promise.all([
    supabase.from('users').select('id', { count: 'exact', head: true }),
    supabase.from('whatsapp_tasks').select('id', { count: 'exact', head: true }),
    supabase.from('experiments').select('id', { count: 'exact', head: true }),
    supabase.from('users').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);

  res.json({
    total_users:        usersRes.count   ?? 0,
    total_messages:     tasksRes.count   ?? 0,
    total_experiments:  experimentsRes.count ?? 0,
    pending_approvals:  pendingRes.count ?? 0,
  });
});

router.get('/decisions', async (req, res) => {
  const { days = 30 } = req.query;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('whatsapp_tasks')
    .select('decision, created_at')
    .gte('created_at', since)
    .not('decision', 'is', null);

  if (error) return res.status(500).json({ error: error.message });

  const counts = { GO: 0, ITERATE: 0, STOP: 0, OTHER: 0 };
  for (const row of data || []) {
    const d = (row.decision || '').toUpperCase();
    if (counts[d] !== undefined) counts[d]++;
    else counts.OTHER++;
  }

  res.json({ period_days: +days, counts, total: data.length });
});

router.get('/whatsapp', async (req, res) => {
  const { days = 14 } = req.query;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('whatsapp_tasks')
    .select('created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  const byDay = {};
  for (const row of data || []) {
    const day = row.created_at.slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
  }

  res.json({
    period_days: +days,
    daily: Object.entries(byDay).map(([date, count]) => ({ date, count })),
    total: data.length,
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
    .eq('status', 'pending');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ pending_approvals: count ?? 0 });
});

router.get('/response-times', async (req, res) => {
  const { days = 7 } = req.query;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('whatsapp_tasks')
    .select('created_at, completed_at')
    .gte('created_at', since)
    .not('completed_at', 'is', null);

  if (error) return res.status(500).json({ error: error.message });

  const times = (data || [])
    .map(r => new Date(r.completed_at) - new Date(r.created_at))
    .filter(t => t > 0)
    .sort((a, b) => a - b);

  if (times.length === 0) return res.json({ avg_ms: 0, p95_ms: 0, count: 0 });

  const avg = Math.round(times.reduce((s, t) => s + t, 0) / times.length);
  const p95 = times[Math.floor(times.length * 0.95)] ?? times[times.length - 1];

  res.json({ avg_ms: avg, p95_ms: p95, count: times.length, period_days: +days });
});

export default router;
