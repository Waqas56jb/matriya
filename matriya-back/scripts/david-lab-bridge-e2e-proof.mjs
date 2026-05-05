/**
 * David lab-bridge proof (no fake payloads): discovers a real base_id with ≥2 formulation
 * versions that have production_runs, then POSTs /decision/run (HTTP) so audit + bridge run
 * through the real Express stack.
 *
 * Prerequisites (local):
 *   - managment-back running with POSTGRES_URL (lab DB has formulations + production_runs)
 *   - matriya-back running with MANAGEMENT_BACK_URL pointing at that API
 *   - matriya-back .env: POSTGRES_URL (same or matriya DB for decision_audit_log query)
 *
 * Production parity:
 *   - Redeploy matriya-back (e.g. matriya-back-gold on Vercel) with latest code (lab bridge in decisionRunV110.js)
 *   - Vercel env on matriya-back: MANAGEMENT_BACK_URL=https://matriya-mangment-back.vercel.app
 *   - managment-back production must have POSTGRES_URL for /api/lab/query
 *
 * Usage (from matriya-back):
 *   node scripts/david-lab-bridge-e2e-proof.mjs
 *   node scripts/david-lab-bridge-e2e-proof.mjs --matriya-url http://127.0.0.1:8000
 *
 * --in-process  (no HTTP): runs processDecisionRun from THIS checkout (proves repo code vs stale node process).
 *   Does not write audit unless you use HTTP against a restarted server.
 *
 * Optional explicit IDs (skip discovery):
 *   LAB_PROOF_BASE_ID=BASE-xxx LAB_PROOF_SKIP_DISCOVERY=1 node scripts/david-lab-bridge-e2e-proof.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import pg from 'pg';
import axios from 'axios';
import { normalizePostgresEnv } from '../lib/normalizePostgresEnv.js';
import { processDecisionRun } from '../lib/decisionRunV110.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const matriyaRoot = path.join(__dirname, '..');

dotenv.config({ path: path.join(matriyaRoot, '.env') });
normalizePostgresEnv();

const mgmtEnv = path.join(matriyaRoot, '..', 'managment-back', '.env');
if (fs.existsSync(mgmtEnv)) {
  dotenv.config({ path: mgmtEnv, override: false });
}

function pgConn() {
  const raw =
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    '';
  const s = raw ? String(raw).replace(/^\uFEFF/, '').trim() : '';
  return s || null;
}

async function discoverBaseId(client) {
  const q = `
    SELECT f.base_id::text AS base_id
    FROM formulations f
    INNER JOIN production_runs pr ON pr.formulation_id = f.id
    WHERE f.version IS NOT NULL AND trim(f.version::text) <> ''
    GROUP BY f.base_id
    HAVING COUNT(DISTINCT f.version) >= 2
    LIMIT 1`;
  const { rows } = await client.query(q);
  return rows[0]?.base_id || null;
}

function fail(msg, extra = null) {
  console.error('\n[FAIL]', msg);
  if (extra) console.error(JSON.stringify(extra, null, 2));
  process.exit(1);
}

function ok(msg) {
  console.log('[OK]', msg);
}

async function main() {
  const argv = process.argv.slice(2);
  const inProcess = argv.includes('--in-process');
  const matIdx = argv.indexOf('--matriya-url');
  const matriyaUrl = (
    matIdx >= 0
      ? argv[matIdx + 1]
      : process.env.MATRIYA_PROOF_URL ||
        process.env.MATRIYA_BASE_URL ||
        'http://127.0.0.1:8000'
  ).replace(/\/$/, '');

  const mgmt = (process.env.MANAGEMENT_BACK_URL || process.env.MATRIYA_MANAGEMENT_BACK_URL || '').trim().replace(/\/$/, '');
  if (!mgmt) {
    fail('MANAGEMENT_BACK_URL (or MATRIYA_MANAGEMENT_BACK_URL) is not set. matriya-back cannot call the lab bridge.');
  }
  ok(`Management API base: ${mgmt}`);

  if (!inProcess && mgmt.includes('vercel.app') && (matriyaUrl.includes('127.0.0.1') || matriyaUrl.includes('localhost'))) {
    console.warn(
      '[WARN] MANAGEMENT_BACK_URL points to Vercel but Matriya URL is localhost — your local node process may be an OLD build. Use --in-process to test this repo, or restart local matriya-back after git pull; for production proof redeploy matriya-back on Vercel (e.g. matriya-back-gold).'
    );
  }

  let baseId = (process.env.LAB_PROOF_BASE_ID || '').trim();
  if (!baseId && process.env.LAB_PROOF_SKIP_DISCOVERY === '1') {
    fail('LAB_PROOF_SKIP_DISCOVERY=1 but LAB_PROOF_BASE_ID is empty.');
  }

  const conn = pgConn();
  if (!baseId) {
    if (!conn) {
      fail(
        'No LAB_PROOF_BASE_ID and no POSTGRES_URL/DATABASE_URL — cannot discover a base_id. Set POSTGRES_URL (management DB) or export LAB_PROOF_BASE_ID=...'
      );
    }
    const c = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
    await c.connect();
    try {
      baseId = await discoverBaseId(c);
    } catch (e) {
      fail(`Discovery query failed: ${e.message}`, { hint: 'Check formulations / production_runs exist on this database.' });
    } finally {
      await c.end();
    }
    if (!baseId) {
      fail('No formulation base found with ≥2 distinct versions that have production_runs.');
    }
    ok(`Discovered base_id=${baseId} (from DB)`);
  } else {
    ok(`Using LAB_PROOF_BASE_ID=${baseId}`);
  }

  const body = {
    input: {
      type: 'lab',
      data: {
        lab_query_type: 'compare_latest_runs',
        base_id: baseId,
      },
    },
    context: {
      project_id: 'david-lab-bridge-cli',
      model_id: 'gpt-4o-mini',
    },
  };

  let envelope;
  if (inProcess) {
    ok('Running processDecisionRun in-process (current repo code, no HTTP matriya).');
    envelope = await processDecisionRun(body, {
      persistAudit: async () => {
        /* noop — use HTTP mode + restarted server for real audit rows */
      },
    });
  } else {
    try {
      const r = await axios.post(`${matriyaUrl}/decision/run`, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000,
        validateStatus: () => true,
      });
      if (r.status !== 200) {
        fail(`POST /decision/run HTTP ${r.status}`, r.data);
      }
      envelope = r.data;
    } catch (e) {
      fail(`POST /decision/run failed: ${e.message}`, { hint: 'Is matriya-back running on ' + matriyaUrl + ' ?' });
    }
  }

  console.log('\n--- /decision/run response (truncated) ---');
  console.log(
    JSON.stringify(
      {
        decision: envelope.decision,
        data_source: envelope.data_source,
        confidence: envelope.confidence,
        experiment_ids: envelope.evidence?.experiment_ids,
        reason: envelope.reason?.slice?.(0, 200),
        _routing: envelope._routing,
      },
      null,
      2
    )
  );

  if (envelope.data_source !== 'DB_COMPUTED') {
    fail(`Expected data_source=DB_COMPUTED, got ${envelope.data_source}`, {
      hint:
        envelope._routing?.legacy_hint === 'SCOPE_BOUNDARY' &&
        String(envelope.reason || '').includes('no downstream lab bridge')
          ? 'Running server is OLD matriya-back (pre lab-bridge). Fix: restart local `node server.js` after pull, OR redeploy matriya-back on Vercel (e.g. matriya-back-gold). Set MANAGEMENT_BACK_URL on matriya env.'
          : 'See reason and _routing above.',
    });
  }
  const ids = Array.isArray(envelope.evidence?.experiment_ids) ? envelope.evidence.experiment_ids : [];
  if (ids.length === 0) {
    fail('experiment_ids is empty — lab bridge returned no source_run_ids for this base.', { baseId });
  }
  if (!(Number(envelope.confidence) > 0)) {
    fail(`Expected confidence > 0, got ${envelope.confidence}`);
  }

  ok('David checks 1–3 passed on /decision/run response.');

  if (inProcess) {
    console.warn('[WARN] --in-process: audit log (check 4) skipped. Run without --in-process after restarting matriya-back for full SQL proof.');
    console.log('\nAll requested checks passed (in-process mode).');
    return;
  }

  if (conn) {
    const c2 = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
    await c2.connect();
    try {
      const trace = envelope.trace_id;
      const { rows } = await c2.query(
        `SELECT id, decision, decision_run_v11_audit->>'trace_id' AS trace_id
         FROM decision_audit_log
         WHERE decision_run_v11_audit->>'trace_id' = $1
         ORDER BY id DESC
         LIMIT 3`,
        [trace]
      );
      if (!rows.length) {
        fail('Audit log: no row with matching trace_id on decision_audit_log.', { trace_id: trace });
      }
      ok(`Audit log: ${rows.length} row(s) with trace_id=${trace} (latest id=${rows[0].id})`);
    } catch (e) {
      fail(`Audit SQL failed: ${e.message}`);
    } finally {
      await c2.end();
    }
  } else {
    console.warn('[WARN] No POSTGRES_URL — skipped audit log SQL (check 4 not verified).');
  }

  console.log('\nAll requested checks passed for this run.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
