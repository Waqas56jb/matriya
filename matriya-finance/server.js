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
 * Environment variables:
 *   PORT                 — HTTP port (Railway sets this automatically)
 *   PYTHON_CMD           — Python binary to use (default: python3)
 *   TWILIO_ACCOUNT_SID   — Twilio SID (forwarded to Python via env)
 *   TWILIO_AUTH_TOKEN    — Twilio token
 *   TWILIO_WHATSAPP_FROM — Sender number e.g. whatsapp:+14155238886
 *   TWILIO_WHATSAPP_TO   — Recipient number e.g. whatsapp:+972...
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
        PYTHONUNBUFFERED: '1'
      },
      cwd: __dirname
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
