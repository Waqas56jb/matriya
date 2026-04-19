import { supabase } from '../server.js';

/**
 * Middleware: log every authenticated admin action to `admin_audit_log` table.
 * Runs after requireAdmin so req.admin is already populated.
 */
export async function logAdminAction(req, _res, next) {
  const action = `${req.method} ${req.path}`;
  const payload = {
    admin_email: req.admin?.email || 'unknown',
    action,
    body: req.method !== 'GET' ? JSON.stringify(req.body) : null,
    ip: req.ip,
    created_at: new Date().toISOString(),
  };

  supabase
    .from('admin_audit_log')
    .insert(payload)
    .then(({ error }) => {
      if (error) console.warn('[auditLogger] insert failed:', error.message);
    });

  next();
}
