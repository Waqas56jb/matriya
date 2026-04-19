/**
 * Session management routes
 *
 * GET  /api/admin/sessions            — all currently active sessions
 * GET  /api/admin/sessions/live       — live users (logged in last 15 min)
 * GET  /api/admin/sessions/:userId    — session history for user
 * POST /api/admin/sessions/revoke-all — revoke ALL active sessions (emergency)
 */

import { Router } from 'express';
import { supabase } from '../server.js';

const router = Router();

router.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('user_sessions')
    .select(`
      id, user_id, ip_address, device, browser, logged_in_at, last_active_at, is_active,
      users ( username, email, role )
    `)
    .eq('is_active', true)
    .order('last_active_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ sessions: data });
});

router.get('/live', async (_req, res) => {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('user_sessions')
    .select(`
      id, user_id, ip_address, device, last_active_at,
      users ( username, email, role )
    `)
    .eq('is_active', true)
    .gte('last_active_at', cutoff)
    .order('last_active_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ live_count: data.length, sessions: data });
});

router.get('/:userId', async (req, res) => {
  const { data, error } = await supabase
    .from('user_sessions')
    .select('id, ip_address, device, browser, logged_in_at, last_active_at, is_active, logout_reason')
    .eq('user_id', req.params.userId)
    .order('logged_in_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ sessions: data });
});

router.post('/revoke-all', async (req, res) => {
  const { confirm } = req.body || {};
  if (confirm !== 'REVOKE_ALL') {
    return res.status(400).json({ error: 'Send { confirm: "REVOKE_ALL" } to confirm this action' });
  }

  const { error: sessionError } = await supabase
    .from('user_sessions')
    .update({ is_active: false, logout_reason: 'admin_emergency_revoke' })
    .eq('is_active', true);

  const { error: tokenError } = await supabase
    .from('users')
    .update({ session_token: null })
    .neq('role', 'admin');

  if (sessionError || tokenError) {
    return res.status(500).json({ error: (sessionError || tokenError).message });
  }

  res.json({ message: 'All active sessions revoked. All non-admin users must re-login.' });
});

export default router;
