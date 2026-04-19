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
 */

import 'dotenv/config';
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

import { requireAdmin } from './middleware/auth.js';
import { logAdminAction } from './middleware/auditLogger.js';

const PORT = parseInt(process.env.PORT, 10) || 9000;

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const app = express();

app.use(cors({
  origin: process.env.ADMIN_FRONTEND_URL || '*',
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
  res.json({ status: 'ok', service: 'admin-backend', ts: new Date().toISOString() });
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

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error('[admin-backend error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`[admin-backend] listening on port ${PORT}`);
});
