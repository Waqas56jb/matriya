/**
 * MATRIYA Admin Backend — Express API
 * Provides full administrative control over all MATRIYA services.
 *
 * Endpoints:
 *   POST /api/admin/auth/login             — admin login → JWT
 *   GET  /api/admin/users                  — list all users + status
 *   POST /api/admin/users/:id/approve      — approve access request
 *   POST /api/admin/users/:id/block        — block user permanently
 *   POST /api/admin/users/:id/revoke       — revoke active session
 *   GET  /api/admin/sessions               — live active sessions
 *   GET  /api/admin/analytics              — traffic + decision stats
 *   GET  /api/admin/whatsapp/queue         — WhatsApp task queue
 *   POST /api/admin/whatsapp/resend/:id    — resend failed message
 *   GET  /api/admin/whatsapp/whitelist     — phone number whitelist
 *   POST /api/admin/whatsapp/whitelist     — add to whitelist
 *   DELETE /api/admin/whatsapp/whitelist/:phone — remove from whitelist
 *   GET  /api/admin/experiments            — experiments table
 *   PATCH /api/admin/experiments/:id       — update flags
 *   GET  /api/admin/experiments/export     — CSV export
 *   GET  /api/admin/system/health          — service health check
 *   GET  /api/admin/system/logs            — recent error logs
 *   GET  /api/admin/audit                  — full admin audit log
 *   GET  /api/admin/config                 — system config values
 *   PUT  /api/admin/config                 — update config values
 *   GET  /api/admin/management-users       — list Management panel users (plain password column for admin)
 *   POST /api/admin/management-users       — provision user (calls Matriya with MATRIYA_PROVISION_SECRET)
 */

import 'dotenv/config';
/** Vercel may set VERCEL_URL / VERCEL_ENV without VERCEL — avoid app.listen() on serverless. */
if ((process.env.VERCEL_ENV || process.env.VERCEL_URL) && !process.env.VERCEL) {
  process.env.VERCEL = '1';
}
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';

import authRouter     from './routes/auth.js';
import usersRouter    from './routes/users.js';
import sessionsRouter from './routes/sessions.js';
import analyticsRouter from './routes/analytics.js';
import whatsappRouter from './routes/whatsapp.js';
import experimentsRouter from './routes/experiments.js';
import systemRouter   from './routes/system.js';
import auditRouter    from './routes/audit.js';
import configRouter   from './routes/config.js';
import managementUsersRouter from './routes/managementUsers.js';

import { requireAdmin } from './middleware/auth.js';
import { logAdminAction } from './middleware/auditLogger.js';

const PORT = parseInt(process.env.PORT, 10) || 9000;

const _sbUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const _sbKey = (
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_KEY ||
  ''
).trim();
export const supabase =
  _sbUrl && _sbKey ? createClient(_sbUrl, _sbKey) : null;
if (!supabase) {
  console.error(
    '[admin-backend] Missing Supabase URL or server key (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY from Vercel integration).'
  );
}

const app = express();

// CORS: comma-separated origins in ADMIN_FRONTEND_URL. Always includes localhost ports for dev.
// If ADMIN_FRONTEND_URL is empty or *, all origins are reflected (dev-only).
// Also allows any Vercel preview URL matching the same project name pattern.
const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:5173',
];

// Vercel generates multiple URLs per deployment: the main domain and preview/branch URLs.
// Extract the base project name from ADMIN_FRONTEND_URL to allow all Vercel preview variants.
function getVercelProjectPattern() {
  const raw = (process.env.ADMIN_FRONTEND_URL || '').trim();
  const urls = raw.split(',').map(s => s.trim()).filter(s => s.includes('.vercel.app'));
  if (!urls.length) return null;
  // e.g. "https://matriya-system-project-azxf.vercel.app" → "matriya-system-project"
  const match = urls[0].match(/https?:\/\/([\w-]+?)(?:-[a-z0-9]{4,})?\.vercel\.app/);
  return match ? match[1] : null;
}

function corsOrigin() {
  const raw = (process.env.ADMIN_FRONTEND_URL || '').trim();
  if (!raw || raw === '*') return true;
  const explicit = raw.split(',').map(s => s.trim()).filter(Boolean);
  const all = [...new Set([...explicit, ...DEV_ORIGINS])];

  const projectBase = getVercelProjectPattern();
  // Return a function so we can dynamically allow any Vercel preview URL for this project
  return (origin, callback) => {
    if (!origin) return callback(null, true); // non-browser requests (curl, mobile apps)
    if (all.includes(origin)) return callback(null, true);
    // Allow any *.vercel.app URL that starts with the same project base name
    if (projectBase && /^https:\/\//.test(origin) && origin.includes('.vercel.app')) {
      const subMatch = origin.match(/^https:\/\/([\w-]+)\.vercel\.app$/);
      if (subMatch && subMatch[1].startsWith(projectBase)) return callback(null, true);
    }
    callback(new Error(`CORS: origin ${origin} not allowed`));
  };
}

app.use(cors({
  origin: corsOrigin(),
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

app.get('/health', (_req, res) => {
  if (!supabase) {
    return res.status(503).json({
      ok: false,
      service: 'admin-backend',
      error:
        'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add them in Vercel → Project → Settings → Environment Variables.',
    });
  }
  res.json({ status: 'ok', service: 'admin-backend', ts: new Date().toISOString() });
});

app.use((req, res, next) => {
  if (supabase) return next();
  if (req.path === '/health') return next();
  return res.status(503).json({
    ok: false,
    service: 'admin-backend',
    error:
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on this Vercel project.',
  });
});

// Auth — public
app.use('/api/admin/auth', authRouter);

// All other admin routes — require valid admin JWT + log action
app.use('/api/admin', requireAdmin, logAdminAction);
app.use('/api/admin/users',       usersRouter);
app.use('/api/admin/sessions',    sessionsRouter);
app.use('/api/admin/analytics',   analyticsRouter);
app.use('/api/admin/whatsapp',    whatsappRouter);
app.use('/api/admin/experiments', experimentsRouter);
app.use('/api/admin/system',      systemRouter);
app.use('/api/admin/audit',       auditRouter);
app.use('/api/admin/config',      configRouter);
app.use('/api/admin/management-users', managementUsersRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error('[admin-backend error]', err);
  // body-parser sets err.status for JSON parse failures (400), respect it
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

const isVercelServerless =
  process.env.VERCEL === '1' ||
  process.env.VERCEL === 'true' ||
  Boolean(process.env.VERCEL_ENV) ||
  Boolean(process.env.VERCEL_URL);

if (!isVercelServerless) {
  app.listen(PORT, () => {
    console.log(`[admin-backend] listening on port ${PORT}`);
  });
}

export default app;
