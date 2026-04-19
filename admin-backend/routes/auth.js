/**
 * POST /api/admin/auth/login
 * Body: { email, password }
 * Returns: { token, admin: { id, email, role } }
 *
 * Admin accounts are stored in `admin_users` table with bcrypt passwords.
 */

import { Router } from 'express';
import bcrypt from 'bcrypt';
import { supabase } from '../server.js';
import { signAdminToken } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const { data: admin, error } = await supabase
    .from('admin_users')
    .select('id, email, password_hash, role, is_active')
    .eq('email', email.toLowerCase().trim())
    .single();

  if (error || !admin) return res.status(401).json({ error: 'Invalid credentials' });
  if (!admin.is_active) return res.status(403).json({ error: 'Account disabled' });

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signAdminToken(admin.id, admin.email);

  res.json({
    token,
    admin: { id: admin.id, email: admin.email, role: admin.role },
  });
});

/**
 * POST /api/admin/auth/create-admin
 * One-time endpoint to seed the first admin (disabled after first use via env flag).
 * Body: { email, password, secret }
 * Requires ADMIN_SEED_SECRET env var to match.
 */
router.post('/create-admin', async (req, res) => {
  const { email, password, secret } = req.body || {};
  const SEED_SECRET = process.env.ADMIN_SEED_SECRET;

  if (!SEED_SECRET) return res.status(403).json({ error: 'Seeding disabled' });
  if (secret !== SEED_SECRET) return res.status(403).json({ error: 'Invalid seed secret' });
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const password_hash = await bcrypt.hash(password, 12);

  const { data, error } = await supabase
    .from('admin_users')
    .insert({ email: email.toLowerCase().trim(), password_hash, role: 'admin', is_active: true })
    .select('id, email, role')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ admin: data });
});

export default router;
