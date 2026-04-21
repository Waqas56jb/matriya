/**
 * matriya-finance/server.js
 *
 * Node.js wrapper for the MATRIYA Finance Python pipeline.
 *
 * Responsibilities:
 *   1. Express health endpoint  GET /health  → 200 OK (Railway health check)
 *   2. Cron job: daily at 07:00 UTC → runs `python trigger_monitor.py`
 *   3. Manual trigger endpoint  POST /run    → runs the pipeline on demand
 *
 * Environment variables (Twilio matches matriya-back — copy same Railway vars):
 *   PORT                    — HTTP port (Railway sets this automatically)
 *   PYTHON_CMD              — Python binary (default: python3)
 *   TWILIO_ACCOUNT_SID      — same as matriya-back
 *   TWILIO_AUTH_TOKEN       — same as matriya-back
 *   TWILIO_WHATSAPP_FROM    — preferred sender (whatsapp:+…)
 *   TWILIO_WHATSAPP_NUMBER  — if FROM unset, backend-style plain +E164 is normalized to whatsapp:+…
 *   TWILIO_WHATSAPP_TO      — finance alert recipient
 *   DAVID_WHATSAPP          — matriya-back; used if TWILIO_WHATSAPP_TO unset
 *   RACHEL_WHATSAPP         — same as matriya-back; passed through for Python alerts
 *   FINANCE_SHADOW_SIGNALS_PATH — NDJSON log (default: ./Layer3_Shadow_Signals.ndjson)
 *   FINANCE_CORS_ORIGINS    — comma-separated origins for dashboard (Vercel), or * for dev
 */

import express from 'express';
import cron    from 'node-cron';
import { spawn } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = process.env.PORT || 3100;
const PYTHON = process.env.PYTHON_CMD || 'python3';

/** Normalize E164 or whatsapp:+… to Twilio WhatsApp address (same rules as matriya-back). */
function normalizeWhatsAppAddress(raw) {
  if (!raw) return '';
  const t = String(raw).trim();
  if (t.startsWith('whatsapp:')) return t;
  if (t.startsWith('+')) return `whatsapp:${t}`;
  const digits = t.replace(/\D/g, '');
  if (!digits) return '';
  return `whatsapp:+${digits}`;
}

/** Twilio env aligned with matriya-back; merged into Python child env. */
function twilioEnvForChild() {
  const fromRaw = (process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_WHATSAPP_NUMBER || '').trim();
  const toRaw = (process.env.TWILIO_WHATSAPP_TO || process.env.DAVID_WHATSAPP || '').trim();
  const rachelNorm = normalizeWhatsAppAddress((process.env.RACHEL_WHATSAPP || '').trim());
  const out = {
    TWILIO_ACCOUNT_SID: (process.env.TWILIO_ACCOUNT_SID || '').trim(),
    TWILIO_AUTH_TOKEN: (process.env.TWILIO_AUTH_TOKEN || '').trim(),
    TWILIO_WHATSAPP_FROM: normalizeWhatsAppAddress(fromRaw),
    TWILIO_WHATSAPP_TO: normalizeWhatsAppAddress(toRaw),
  };
  if (rachelNorm) out.RACHEL_WHATSAPP = rachelNorm;
  return out;
}

app.use(express.json());

// ─── CORS (Vercel dashboard → Railway API) ────────────────────────────────────

app.use((req, res, next) => {
  const raw = (process.env.FINANCE_CORS_ORIGINS || '*').trim();
  const origin = req.headers.origin;
  if (raw === '*' || raw === '') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (origin && list.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function ndjsonSignalsPath() {
  const o = (process.env.FINANCE_SHADOW_SIGNALS_PATH || '').trim();
  if (o) return o;
  return path.join(__dirname, 'Layer3_Shadow_Signals.ndjson');
}

function readSignalsFromNdjson(limit = 200) {
  const filePath = ndjsonSignalsPath();
  if (!fs.existsSync(filePath)) {
    return { path: filePath, signals: [], file_exists: false, error: 'ndjson_missing' };
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-limit);
  const signals = [];
  for (const line of tail) {
    try {
      signals.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  let mtime = null;
  try {
    mtime = fs.statSync(filePath).mtime.toISOString();
  } catch {
    /* */
  }
  return { path: filePath, signals, file_exists: true, line_count: lines.length, mtime_iso: mtime };
}

function financeRuntimeStatus() {
  const filePath = ndjsonSignalsPath();
  let st = null;
  try {
    st = fs.statSync(filePath);
  } catch {
    /* */
  }
  return {
    service: 'matriya-finance',
    time: new Date().toISOString(),
    ndjson_path: filePath,
    ndjson_exists: !!st,
    ndjson_bytes: st?.size ?? 0,
    ndjson_mtime_iso: st?.mtime?.toISOString?.() ?? null,
    twilio_ready: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    fred_configured: !!(process.env.FRED_API_KEY || '').trim(),
    sec_user_agent_set: !!(process.env.SEC_EDGAR_USER_AGENT || '').trim(),
  };
}

// ─── Finance API (React dashboard on Vercel) ─────────────────────────────────

app.get('/api/finance/signals', (_req, res) => {
  try {
    const { path: p, signals, file_exists, line_count, mtime_iso, error } = readSignalsFromNdjson(300);
    res.json({
      ok: true,
      path: p,
      file_exists,
      line_count: line_count ?? signals.length,
      mtime_iso: mtime_iso ?? null,
      error: error || null,
      signals,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'read_failed' });
  }
});

app.get('/api/finance/status', (_req, res) => {
  res.json({ ok: true, ...financeRuntimeStatus() });
});

// ─── Health endpoint (Railway checks this) ────────────────────────────────────

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'matriya-finance', time: new Date().toISOString() });
});

app.get('/', (_req, res) => {
  res.status(200).json({ service: 'matriya-finance', status: 'running' });
});

// ─── Python runner ────────────────────────────────────────────────────────────

/**
 * Run trigger_monitor.py and return a promise that resolves with stdout/stderr.
 * Rejects if the process exits with non-zero code.
 */
function runTriggerMonitor() {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'trigger_monitor.py');
    console.log(`[matriya-finance] starting trigger_monitor.py at ${new Date().toISOString()}`);

    const proc = spawn(PYTHON, [scriptPath], {
      env: {
        ...process.env,
        ...twilioEnvForChild(),
        PYTHONUNBUFFERED: '1',
      },
      cwd: __dirname,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => { stdout += d.toString(); process.stdout.write(d); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); process.stderr.write(d); });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[matriya-finance] trigger_monitor.py completed successfully`);
        resolve({ code, stdout, stderr });
      } else {
        console.error(`[matriya-finance] trigger_monitor.py exited with code ${code}`);
        reject(new Error(`trigger_monitor.py exited with code ${code}\n${stderr}`));
      }
    });

    proc.on('error', (err) => {
      console.error(`[matriya-finance] failed to start Python: ${err.message}`);
      reject(err);
    });
  });
}

// ─── Cron: daily 07:00 UTC ────────────────────────────────────────────────────

cron.schedule('0 7 * * *', async () => {
  console.log('[matriya-finance] cron triggered — running daily finance monitor');
  try {
    await runTriggerMonitor();
  } catch (err) {
    console.error(`[matriya-finance] cron run failed: ${err.message}`);
  }
}, { timezone: 'UTC' });

console.log('[matriya-finance] cron scheduled — trigger_monitor.py runs daily at 07:00 UTC');

// ─── Manual trigger endpoint ──────────────────────────────────────────────────

app.post('/run', async (_req, res) => {
  console.log('[matriya-finance] manual /run triggered');
  try {
    const result = await runTriggerMonitor();
    res.json({ ok: true, stdout: result.stdout, stderr: result.stderr });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── Start server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[matriya-finance] server running on port ${PORT}`);
});
