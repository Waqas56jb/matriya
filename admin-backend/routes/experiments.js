/**
 * Experiments data routes
 *
 * GET    /api/admin/experiments               — browse with filters
 * GET    /api/admin/experiments/export        — CSV export
 * GET    /api/admin/experiments/:id           — single experiment
 * PATCH  /api/admin/experiments/:id           — update flags (decision_shift, breakdown_flag, validated)
 * DELETE /api/admin/experiments/:id           — delete experiment
 * POST   /api/admin/experiments/trigger       — manually trigger pipeline with custom input
 */

import { Router } from 'express';
import { supabase } from '../server.js';

const router = Router();

router.get('/', async (req, res) => {
  const { status, validated, breakdown_flag, decision_shift, search, page = 1, limit = 50 } = req.query;
  let query = supabase
    .from('experiments')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (status        !== undefined) query = query.eq('status', status);
  if (validated     !== undefined) query = query.eq('validated', validated === 'true');
  if (breakdown_flag !== undefined) query = query.eq('breakdown_flag', breakdown_flag === 'true');
  if (decision_shift !== undefined) query = query.eq('decision_shift', decision_shift === 'true');
  if (search)        query = query.or(`experiment_id.ilike.%${search}%,operator.ilike.%${search}%,outcome.ilike.%${search}%`);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ experiments: data, total: count, page: +page, limit: +limit });
});

router.get('/export', async (req, res) => {
  const { data, error } = await supabase
    .from('experiments')
    .select('experiment_id, date, operator, outcome, status, decision_shift, breakdown_flag, validated, notes, created_at')
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error) return res.status(500).json({ error: error.message });

  const header = Object.keys(data[0] || {}).join(',');
  const rows = (data || []).map(row =>
    Object.values(row).map(v => {
      if (v === null || v === undefined) return '';
      const str = String(v).replace(/"/g, '""');
      return str.includes(',') || str.includes('"') ? `"${str}"` : str;
    }).join(',')
  );

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="experiments.csv"');
  res.send([header, ...rows].join('\r\n'));
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: 'Experiment not found' });
  res.json({ experiment: data });
});

router.patch('/:id', async (req, res) => {
  const allowed = ['decision_shift', 'breakdown_flag', 'validated', 'status', 'notes', 'outcome'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No valid fields provided' });

  const { data, error } = await supabase
    .from('experiments')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ experiment: data });
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('experiments').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Experiment deleted' });
});

router.post('/trigger', async (req, res) => {
  const { input } = req.body || {};
  if (!input) return res.status(400).json({ error: 'input required' });

  const MATRIYA_URL = process.env.MATRIYA_BACK_URL || 'https://matriya-back-gold.vercel.app';
  try {
    const { default: fetch } = await import('node-fetch');
    const result = await fetch(`${MATRIYA_URL}/api/pipeline/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input, source: 'admin_manual_trigger' }),
    }).then(r => r.json());
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
