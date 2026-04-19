/**
 * System configuration routes
 *
 * GET /api/admin/config            — all config values
 * PUT /api/admin/config            — update one or more config values
 * GET /api/admin/config/:key       — single value by key
 *
 * Config keys stored in `admin_config` Supabase table:
 *   system_prompt          — MATRIYA LLM system prompt
 *   stop_threshold         — confidence max for STOP (default 0)
 *   iterate_threshold      — confidence range for ITERATE (default 1-69)
 *   go_threshold           — confidence min for GO (default 70)
 *   finance_cron_schedule  — cron expression for matriya-finance
 *   daily_pipeline_limit   — max pipeline calls per user per day
 *   whitelist_enabled      — boolean flag for phone whitelist
 *   rachel_enabled         — boolean flag for Rachel outbound
 */

import { Router } from 'express';
import { supabase } from '../server.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('admin_config')
    .select('key, value, updated_at, updated_by')
    .order('key', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const config = {};
  for (const row of data || []) config[row.key] = row.value;
  res.json({ config, rows: data });
});

router.get('/:key', async (req, res) => {
  const { data, error } = await supabase
    .from('admin_config')
    .select('key, value, updated_at')
    .eq('key', req.params.key)
    .single();
  if (error) return res.status(404).json({ error: 'Config key not found' });
  res.json({ key: data.key, value: data.value, updated_at: data.updated_at });
});

router.put('/', async (req, res) => {
  const updates = req.body || {};
  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No fields provided' });

  const rows = Object.entries(updates).map(([key, value]) => ({
    key,
    value: String(value),
    updated_at: new Date().toISOString(),
    updated_by: req.admin.email,
  }));

  const { data, error } = await supabase
    .from('admin_config')
    .upsert(rows, { onConflict: 'key' })
    .select();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ updated: data });
});

export default router;
