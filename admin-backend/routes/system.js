/**
 * System & infrastructure routes
 *
 * GET /api/admin/system/health     — check all services
 * GET /api/admin/system/logs       — recent error logs from Supabase
 * GET /api/admin/system/env        — view env vars (masked secrets)
 * GET /api/admin/system/openai     — OpenAI API usage info
 */

import { Router } from 'express';
import { supabase } from '../server.js';

const router = Router();

const SERVICES = {
  'matriya-back':    process.env.MATRIYA_BACK_URL     || 'http://localhost:8000',
  'managment-back':  process.env.MANAGEMENT_BACK_URL  || 'http://localhost:8001',
  'matriya-finance': process.env.MATRIYA_FINANCE_URL  || 'http://localhost:9001',
};

router.get('/health', async (_req, res) => {
  const { default: fetch } = await import('node-fetch');

  const checks = await Promise.all(
    Object.entries(SERVICES).map(async ([name, url]) => {
      try {
        const t0 = Date.now();
        const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(4000) });
        const ok = r.ok;
        return { service: name, status: ok ? 'up' : 'degraded', latency_ms: Date.now() - t0 };
      } catch {
        return { service: name, status: 'down', latency_ms: null };
      }
    })
  );

  const { error: dbErr } = await supabase.from('users').select('id', { count: 'exact', head: true });
  checks.push({ service: 'supabase', status: dbErr ? 'down' : 'up', latency_ms: null });

  const overall = checks.every(c => c.status === 'up') ? 'healthy' : 'degraded';
  res.json({ overall, services: checks, checked_at: new Date().toISOString() });
});

router.get('/logs', async (req, res) => {
  const { level = 'error', limit = 100 } = req.query;

  const { data, error } = await supabase
    .from('system_logs')
    .select('*')
    .eq('level', level)
    .order('created_at', { ascending: false })
    .limit(+limit);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ logs: data, count: data.length });
});

router.get('/env', (_req, res) => {
  const maskSecret = (val) => {
    if (!val) return '(not set)';
    if (val.length <= 8) return '***';
    return val.slice(0, 4) + '***' + val.slice(-4);
  };

  const vars = {
    SUPABASE_URL:          process.env.SUPABASE_URL || '(not set)',
    SUPABASE_KEY:          maskSecret(process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
    OPENAI_API_KEY:        maskSecret(process.env.OPENAI_API_KEY),
    JWT_SECRET:            maskSecret(process.env.JWT_SECRET),
    TWILIO_ACCOUNT_SID:    maskSecret(process.env.TWILIO_ACCOUNT_SID),
    TWILIO_AUTH_TOKEN:     maskSecret(process.env.TWILIO_AUTH_TOKEN),
    TWILIO_WHATSAPP_FROM:  process.env.TWILIO_WHATSAPP_FROM || '(not set)',
    RACHEL_WHATSAPP:       process.env.RACHEL_WHATSAPP || '(not set)',
    DAVID_WHATSAPP:        process.env.DAVID_WHATSAPP || '(not set)',
    MATRIYA_BACK_URL:      process.env.MATRIYA_BACK_URL || '(not set)',
    MANAGEMENT_BACK_URL:   process.env.MANAGEMENT_BACK_URL || '(not set)',
    WHATSAPP_WHITELIST_ENABLED: process.env.WHATSAPP_WHITELIST_ENABLED || '(not set)',
    NODE_ENV:              process.env.NODE_ENV || 'development',
  };

  res.json({ env: vars });
});

router.get('/openai', async (_req, res) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(400).json({ error: 'OPENAI_API_KEY not configured' });

  try {
    const { default: fetch } = await import('node-fetch');
    const r = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) return res.status(r.status).json({ error: `OpenAI API error ${r.status}` });
    res.json({ openai_status: 'connected', message: 'API key valid' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
