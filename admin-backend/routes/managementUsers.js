/**
 * Admin-only: provision Management panel users (stored in same Supabase `users` as Matriya auth).
 */
import { Router } from 'express';
import axios from 'axios';
import { supabase } from '../server.js';

const router = Router();

function matriyaBase() {
  return (process.env.MATRIYA_BACK_URL || '').replace(/\/$/, '');
}

router.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, email, management_plain_password, password_updated_at, created_at, last_login, is_management_user')
    .eq('is_management_user', true)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  const users = (data || []).map((u) => ({
    id: u.id,
    username: u.username,
    email: u.email,
    password: u.management_plain_password ?? '—',
    password_updated_at: u.password_updated_at,
    created_at: u.created_at,
    last_login: u.last_login
  }));
  res.json({ users });
});

router.post('/', async (req, res) => {
  const base = matriyaBase();
  const secret = process.env.MATRIYA_PROVISION_SECRET || '';
  if (!base) return res.status(503).json({ error: 'MATRIYA_BACK_URL is not configured on admin-backend' });
  if (!secret) return res.status(503).json({ error: 'MATRIYA_PROVISION_SECRET is not configured on admin-backend' });

  const { username, email, password, full_name } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, and password are required' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const r = await axios.post(
      `${base}/auth/management/provision`,
      { username: String(username).trim(), email: String(email).trim(), password: String(password), full_name: full_name || null },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Matriya-Provision-Key': secret
        },
        timeout: 30000,
        validateStatus: () => true
      }
    );
    if (r.status >= 400) {
      const msg = (r.data && typeof r.data.error === 'string') ? r.data.error : `Upstream ${r.status}`;
      return res.status(r.status >= 500 ? 502 : r.status).json({ error: msg });
    }
    return res.status(201).json({ user: r.data });
  } catch (e) {
    const code = e.code || '';
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
      return res.status(503).json({ error: 'Cannot reach Matriya backend. Check MATRIYA_BACK_URL.' });
    }
    return res.status(500).json({ error: e.message || 'Provision failed' });
  }
});

export default router;
