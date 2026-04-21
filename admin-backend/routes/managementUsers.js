/**
 * Admin-only: provision Management panel users directly in Supabase.
 * Creates users in the same `users` table that matriya-back uses,
 * bypassing the inter-service provision call entirely.
 */
import { Router } from 'express';
import bcrypt from 'bcrypt';
import { supabase } from '../server.js';

const router = Router();

router.get('/', async (_req, res) => {
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
    last_login: u.last_login,
  }));
  res.json({ users });
});

router.post('/', async (req, res) => {
  const { username, email, password, full_name } = req.body || {};

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, and password are required' });
  }
  if (!String(email).includes('@')) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const emailNorm = String(email).trim().toLowerCase();
  const usernameTrim = String(username).trim();

  try {
    // Check for duplicate username
    const { data: existingUsername } = await supabase
      .from('users')
      .select('id')
      .eq('username', usernameTrim)
      .maybeSingle();

    if (existingUsername) {
      return res.status(400).json({ error: 'Username already registered' });
    }

    // Check for duplicate email
    const { data: existingEmail } = await supabase
      .from('users')
      .select('id')
      .eq('email', emailNorm)
      .maybeSingle();

    if (existingEmail) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash the password (same rounds as matriya-back)
    const hashed_password = await bcrypt.hash(String(password), 10);
    const now = new Date().toISOString();

    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        username: usernameTrim,
        email: emailNorm,
        hashed_password,
        full_name: full_name ? String(full_name).trim() : null,
        is_active: true,
        is_admin: false,
        is_management_user: true,
        management_plain_password: String(password),
        password_updated_at: now,
      })
      .select('id, username, email, full_name, is_management_user, password_updated_at, created_at')
      .single();

    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }

    return res.status(201).json({ user: newUser });
  } catch (e) {
    console.error('[managementUsers] provision error:', e.message);
    return res.status(500).json({ error: e.message || 'Failed to create user' });
  }
});

export default router;
