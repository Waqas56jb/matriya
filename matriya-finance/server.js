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
 */

import express from 'express';
import cron    from 'node-cron';
import { spawn } from 'child_process';
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
