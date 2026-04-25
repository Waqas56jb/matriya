/**
 * Full Research Cycle Proof
 *
 * Steps:
 *  1. POST /research/session             → creates research_sessions row
 *  2. POST /api/research/run             → runs 4-agent loop with live lab experiments
 *                                          stores research_loop_runs row
 *  3. Read back DB rows from both tables  → proves full chain
 *  4. Print linked experiment_ids from outputs.selected_experiments
 */
import pg from 'pg';
import http from 'http';

const { Client } = pg;
const BASE = 'http://localhost:8000';
const PROJECT_ID = '48738878-a1ce-408b-bed2-66b80abc7e3f';

// ── HTTP helper ───────────────────────────────────────────────────────────────
function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname: 'localhost',
      port: 8000,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── DB client ─────────────────────────────────────────────────────────────────
const db = new Client({
  connectionString: 'postgresql://postgres.osrcrdroyhlvrtwpybtr:Matriya2026@aws-1-eu-central-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});
await db.connect();

// ── STEP 1: Create research session ──────────────────────────────────────────
console.log('\n' + '═'.repeat(70));
console.log('STEP 1 — Create Research Session');
console.log('═'.repeat(70));

const sessResp = await httpPost('/research/session', { project_id: PROJECT_ID });
if (sessResp.status !== 200 && sessResp.status !== 201) {
  console.error('Failed to create session:', JSON.stringify(sessResp.body));
  await db.end(); process.exit(1);
}
const sessionId = sessResp.body.session_id;
console.log(`✓ Session created: ${sessionId}`);

// Verify in DB
const { rows: sessionRows } = await db.query(
  `SELECT id, project_id, user_id, completed_stages, started_at FROM research_sessions WHERE id = $1`, [sessionId]
);
if (sessionRows.length === 0) {
  console.error('✗ Session NOT found in DB!');
  await db.end(); process.exit(1);
}
console.log('✓ Confirmed in DB:');
console.log(`  id            : ${sessionRows[0].id}`);
console.log(`  project_id    : ${sessionRows[0].project_id}`);
console.log(`  started_at    : ${sessionRows[0].started_at}`);
console.log(`  completed_stages: ${JSON.stringify(sessionRows[0].completed_stages)}`);

// ── STEP 2: Run full research cycle ──────────────────────────────────────────
console.log('\n' + '═'.repeat(70));
console.log('STEP 2 — Run Full Research Cycle (4-agent loop + lab experiments)');
console.log('═'.repeat(70));

const QUERY = 'Compare EXP-004 and EXP-007 across expansion_ratio, adhesion, and viscosity. Which should be used for high-adhesion production requirements?';
console.log(`Query: "${QUERY}"`);
console.log('Running... (may take 15-30s for LLM agents)');

const runResp = await httpPost('/api/research/run', {
  session_id: sessionId,
  query: QUERY,
  use_4_agents: true
});

if (runResp.status !== 200) {
  console.error('✗ Research run failed:', JSON.stringify(runResp.body, null, 2));
  await db.end(); process.exit(1);
}

const runResult = runResp.body;
console.log(`✓ Run completed. run_id: ${runResult.run_id}`);
console.log(`  Agents executed: ${Object.keys(runResult.outputs || {}).filter(k => k !== 'selected_experiments').join(', ')}`);
console.log(`  Justifications: ${(runResult.justifications || []).length}`);
console.log(`  Selected experiments: ${JSON.stringify((runResult.selected_experiments || []).map(e => e.experiment_id))}`);

// ── STEP 3: Read back DB rows ─────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70));
console.log('STEP 3 — DB Proof: research_loop_runs row');
console.log('═'.repeat(70));

const { rows: loopRows } = await db.query(
  `SELECT id, session_id, query, stopped_by_violation, duration_ms, created_at,
          outputs->'selected_experiments' AS linked_experiments,
          outputs->'analysis' AS analysis_snippet,
          outputs->'synthesis' AS synthesis_snippet
   FROM research_loop_runs WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`,
  [sessionId]
);

if (loopRows.length === 0) {
  console.error('✗ No research_loop_run row found in DB!');
  await db.end(); process.exit(1);
}

const lr = loopRows[0];
console.log('✓ research_loop_runs row confirmed:');
console.log(`  id               : ${lr.id}`);
console.log(`  session_id       : ${lr.session_id}`);
console.log(`  query            : ${lr.query}`);
console.log(`  duration_ms      : ${lr.duration_ms}`);
console.log(`  created_at       : ${lr.created_at}`);
console.log(`  linked_experiments: ${JSON.stringify(lr.linked_experiments)}`);
console.log(`  analysis (first 300): ${String(lr.analysis_snippet || '').slice(0, 300)}`);
console.log(`  synthesis (decision): ${String(lr.synthesis_snippet || '').slice(0, 600)}`);

// ── STEP 4: Join proof — full chain in one query ───────────────────────────────
console.log('\n' + '═'.repeat(70));
console.log('STEP 4 — Full Chain JOIN Proof');
console.log('═'.repeat(70));

const { rows: chainRows } = await db.query(`
  SELECT
    rs.id             AS session_id,
    rs.project_id,
    rs.started_at     AS session_started,
    rlr.id            AS loop_run_id,
    rlr.query,
    rlr.duration_ms,
    le.experiment_id,
    le.expansion_ratio,
    le.adhesion,
    le.experiment_outcome,
    le.research_session_id
  FROM research_sessions rs
  JOIN research_loop_runs rlr ON rlr.session_id = rs.id
  LEFT JOIN lab_experiments le ON le.project_id = rs.project_id
    AND le.experiment_id = ANY(
      SELECT jsonb_array_elements(rlr.outputs->'selected_experiments')->>'experiment_id'
    )
  WHERE rs.id = $1
  ORDER BY le.experiment_id
`, [sessionId]);

if (chainRows.length === 0) {
  console.log('  (No joined experiment rows — selected_experiments may be empty if mgmt API unreachable)');
} else {
  chainRows.forEach(r => {
    console.log(`  session=${r.session_id.slice(0,8)}...  run=${r.loop_run_id}  exp=${r.experiment_id}  expansion=${r.expansion_ratio}  adhesion=${r.adhesion}  outcome=${r.experiment_outcome}  session_linked=${r.research_session_id ? r.research_session_id.slice(0,8)+'...' : 'NULL'}`);
  });
}

await db.end();

console.log('\n' + '═'.repeat(70));
console.log('FULL CYCLE COMPLETE');
console.log(`  session_id  : ${sessionId}`);
console.log(`  loop_run_id : ${lr.id}`);
console.log(`  query       : ${lr.query}`);
console.log(`  linked exps : ${JSON.stringify((runResult.selected_experiments || []).map(e => e.experiment_id))}`);
console.log('═'.repeat(70));
