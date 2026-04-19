/**
 * User management routes
 *
 * GET    /api/admin/users                  — list all users with status + role
 * GET    /api/admin/users/:id              — single user detail
 * POST   /api/admin/users/:id/approve      — approve pending access request
 * POST   /api/admin/users/:id/reject       — reject access request
 * POST   /api/admin/users/:id/block        — block user permanently
 * POST   /api/admin/users/:id/unblock      — unblock user
 * POST   /api/admin/users/:id/revoke       — revoke active JWT session
 * POST   /api/admin/users/:id/force-logout — force logout immediately
 * PATCH  /api/admin/users/:id/role         — change user role
 * PATCH  /api/admin/users/:id/password     — reset user password
 * POST   /api/admin/users/generate         — generate new user credentials
 * DELETE /api/admin/users/:id              — permanently delete user
 */

import { Router } from 'express';
import bcrypt from 'bcrypt';
import { supabase } from '../server.js';

const router = Router();

router.get('/', async (req, res) => {
  const { status, role, search, page = 1, limit = 50 } = req.query;
  let query = supabase
    .from('users')
    .select('id, username, email, role, status, created_at, last_login, device_fingerprint', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (status) query = query.eq('status', status);
  if (role)   query = query.eq('role', role);
  if (search) query = query.or(`username.ilike.%${search}%,email.ilike.%${search}%`);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ users: data, total: count, page: +page, limit: +limit });
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: 'User not found' });
  res.json({ user: data });
});

router.post('/:id/approve', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .update({ status: 'active', approved_at: new Date().toISOString(), approved_by: req.admin.email })
    .eq('id', req.params.id)
    .select('id, email, status')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data, message: 'User approved' });
});

router.post('/:id/reject', async (req, res) => {
  const { reason = 'Rejected by admin' } = req.body || {};
  const { data, error } = await supabase
    .from('users')
    .update({ status: 'rejected', reject_reason: reason })
    .eq('id', req.params.id)
    .select('id, email, status')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data, message: 'User rejected' });
});

router.post('/:id/block', async (req, res) => {
  const { reason = 'Blocked by admin' } = req.body || {};
  const { data, error } = await supabase
    .from('users')
    .update({
      status: 'blocked',
      block_reason: reason,
      blocked_at: new Date().toISOString(),
      blocked_by: req.admin.email,
      session_token: null,
    })
    .eq('id', req.params.id)
    .select('id, email, status')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data, message: 'User blocked and session revoked' });
});

router.post('/:id/unblock', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .update({ status: 'active', block_reason: null, blocked_at: null, blocked_by: null })
    .eq('id', req.params.id)
    .select('id, email, status')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data, message: 'User unblocked' });
});

router.post('/:id/revoke', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .update({ session_token: null, session_revoked_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('id, email')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data, message: 'Session revoked — user must re-login' });
});

router.post('/:id/force-logout', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .update({ session_token: null, force_logout: true, force_logout_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('id, email')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data, message: 'Force logout applied' });
});

router.patch('/:id/role', async (req, res) => {
  const { role } = req.body || {};
  const allowed = ['admin', 'operator', 'viewer', 'blocked'];
  if (!allowed.includes(role)) return res.status(400).json({ error: `role must be one of: ${allowed.join(', ')}` });

  const { data, error } = await supabase
    .from('users')
    .update({ role })
    .eq('id', req.params.id)
    .select('id, email, role')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data, message: `Role updated to ${role}` });
});

router.patch('/:id/password', async (req, res) => {
  const { new_password } = req.body || {};
  if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const password_hash = await bcrypt.hash(new_password, 12);
  const { data, error } = await supabase
    .from('users')
    .update({ password_hash, session_token: null, password_reset_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('id, email')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data, message: 'Password reset and session revoked' });
});

router.post('/generate', async (req, res) => {
  const { username, email, role = 'viewer' } = req.body || {};
  if (!username || !email) return res.status(400).json({ error: 'username and email required' });

  const rawPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-4).toUpperCase() + '!';
  const password_hash = await bcrypt.hash(rawPassword, 12);

  const { data, error } = await supabase
    .from('users')
    .insert({ username, email: email.toLowerCase().trim(), password_hash, role, status: 'active' })
    .select('id, username, email, role, status')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({
    user: data,
    generated_password: rawPassword,
    message: 'Share this password with the user — it is shown only once',
  });
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('users').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'User deleted permanently' });
});

export default router;
