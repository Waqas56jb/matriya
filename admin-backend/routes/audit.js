/**
 * Audit log routes
 *
 * GET /api/admin/audit                 — full admin audit log
 * GET /api/admin/audit/by-admin/:email — actions by specific admin
 * GET /api/admin/audit/recent          — last 50 actions
 */

import { Router } from 'express';
import { supabase } from '../server.js';

const router = Router();

router.get('/', async (req, res) => {
  const { action, admin_email, page = 1, limit = 100 } = req.query;
  let query = supabase
    .from('admin_audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (action)      query = query.ilike('action', `%${action}%`);
  if (admin_email) query = query.eq('admin_email', admin_email);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ logs: data, total: count, page: +page, limit: +limit });
});

router.get('/by-admin/:email', async (req, res) => {
  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('*')
    .eq('admin_email', decodeURIComponent(req.params.email))
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ logs: data });
});

router.get('/recent', async (_req, res) => {
  const { data, error } = await supabase
    .from('admin_audit_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ logs: data });
});

export default router;
