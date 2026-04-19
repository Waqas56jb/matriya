/**
 * User management routes
 * Real users table columns:
 *   id, username, email, hashed_password, full_name, is_active, is_admin, created_at, last_login
 *   + admin-added: status, approved_at, approved_by, reject_reason, block_reason, blocked_at,
 *                  blocked_by, session_token, session_revoked_at, force_logout, force_logout_at,
 *                  password_reset_at, device_fingerprint
 */

import { Router } from 'express';
import bcrypt from 'bcrypt';
import { supabase } from '../server.js';

const router = Router();

const USER_SELECT = 'id, username, email, full_name, is_active, is_admin, created_at, last_login, status, block_reason, blocked_at, device_fingerprint';

/* helpers */
function mapRole(u)   { return u.is_admin ? 'admin' : 'operator'; }
function mapStatus(u) { return u.status || (u.is_active ? 'active' : 'inactive'); }

router.get('/', async (req, res) => {
  const { search, active, page = 1, limit = 50 } = req.query;
  let query = supabase
    .from('users')
    .select(USER_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (active !== undefined) query = query.eq('is_active', active === 'true');
  if (search)               query = query.or(`username.ilike.%${search}%,email.ilike.%${search}%`);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const users = (data || []).map(u => ({ ...u, role: mapRole(u), display_status: mapStatus(u) }));
  res.json({ users, total: count, page: +page, limit: +limit });
});

router.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { ...data, role: mapRole(data), display_status: mapStatus(data) } });
});

router.post('/:id/approve', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .update({ is_active: true, status: 'active', approved_at: new Date().toISOString(), approved_by: req.admin.email })
    .eq('id', req.params.id)
    .select('id, email, is_active')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data, message: 'User approved and activated' });
});

router.post('/:id/reject', async (req, res) => {
  const { reason = 'Rejected by admin' } = req.body || {};
  const { data, error } = await supabase
    .from('users')
    .update({ is_active: false, status: 'rejected', reject_reason: reason })
    .eq('id', req.params.id)
    .select('id, email')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data, message: 'User rejected' });
});

router.post('/:id/block', async (req, res) => {
  const { reason = 'Blocked by admin' } = req.body || {};
  const { data, error } = await supabase
    .from('users')
    .update({
      is_active: false,
      status: 'blocked',
      block_reason: reason,
      blocked_at: new Date().toISOString(),
      blocked_by: req.admin.email,
      session_token: null,
    })
    .eq('id', req.params.id)
    .select('id, email, is_active')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data, message: 'User blocked and session revoked' });
});

router.post('/:id/unblock', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .update({ is_active: true, status: 'active', block_reason: null, blocked_at: null, blocked_by: null })
    .eq('id', req.params.id)
    .select('id, email, is_active')
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
  const is_admin = role === 'admin';
  const { data, error } = await supabase
    .from('users')
    .update({ is_admin })
    .eq('id', req.params.id)
    .select('id, email, is_admin')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data, message: `Role updated to ${role}` });
});

router.patch('/:id/password', async (req, res) => {
  const { new_password } = req.body || {};
  if (!new_password || new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const hashed_password = await bcrypt.hash(new_password, 12);
  const { data, error } = await supabase
    .from('users')
    .update({ hashed_password, session_token: null, password_reset_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('id, email')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data, message: 'Password reset and session revoked' });
});

router.post('/generate', async (req, res) => {
  const { username, email, is_admin = false } = req.body || {};
  if (!username || !email) return res.status(400).json({ error: 'username and email required' });

  const rawPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-4).toUpperCase() + '!';
  const hashed_password = await bcrypt.hash(rawPassword, 12);

  const { data, error } = await supabase
    .from('users')
    .insert({ username, email: email.toLowerCase().trim(), hashed_password, is_admin, is_active: true, status: 'active' })
    .select('id, username, email, is_admin, is_active')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({
    user: { ...data, role: mapRole(data) },
    generated_password: rawPassword,
    message: 'Share this password with the user — shown only once',
  });
});

router.delete('/:id', async (req, res) => {
  const { error } = await supabase.from('users').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'User deleted permanently' });
});

export default router;
