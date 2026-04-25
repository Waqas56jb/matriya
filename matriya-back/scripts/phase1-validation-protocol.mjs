/**
 * Phase 1 Formal Validation Protocol
 * ====================================
 * 5 queries × 3 independent runs each = 15 total runs
 * Produces:
 *   - ground_truth.json  (direct SQL from lab_experiments)
 *   - 15 raw run outputs
 *   - normalized structured_output per run
 *   - determinism_report (are 3 runs per query consistent?)
 *   - ground_truth comparison (system output vs DB values)
 *   - PASS / FAIL per query
 *
 * Run: node scripts/phase1-validation-protocol.mjs
 */
import pg from 'pg';
import http from 'http';
import https from 'https';
import { writeFileSync } from 'fs';

const { Client } = pg;

const SCIENCE_BASE = process.env.SCIENCE_BASE || 'http://localhost:8000';
const MGMT_BASE    = process.env.MGMT_BASE    || 'http://localhost:8001';
const PROJECT_ID   = '48738878-a1ce-408b-bed2-66b80abc7e3f';

// ── HTTP helper (http + https) ────────────────────────────────────────────────
function request(method, urlStr, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const transport = u.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: {
        'Accept': 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...extraHeaders
      }
    };
    const req = transport.request(opts, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: r.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const post = (base, path, body, hdrs = {}) => request('POST', base + path, body, hdrs);

// ── DB ────────────────────────────────────────────────────────────────────────
const db = new Client({
  connectionString: 'postgresql://postgres.osrcrdroyhlvrtwpybtr:Matriya2026@aws-1-eu-central-1.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});
await db.connect();

// ── Session + run helper ──────────────────────────────────────────────────────
async function runOnce(query) {
  const s = await post(SCIENCE_BASE, '/research/session', { project_id: PROJECT_ID });
  if (s.status !== 200 && s.status !== 201) throw new Error(`Session ${s.status}: ${JSON.stringify(s.body)}`);
  const sessionId = s.body.session_id;
  const r = await post(SCIENCE_BASE, '/api/research/run',
    { session_id: sessionId, query, use_4_agents: true });
  return { sessionId, httpStatus: r.status, raw: r.body };
}

// ── Normalize raw output → structured_output ─────────────────────────────────
// "structured_output" is the stable, text-independent summary:
//   experiments_used  : sorted array of experiment_id strings
//   recommended       : experiment_id the synthesis names as best/winner
//   fields_used       : sorted array of metric fields referenced
//   mode              : 'result' | 'no_match'
//   no_hallucination  : bool — true when recommended is in experiments_used (or mode=no_match)
function normalize(raw, httpStatus) {
  if (httpStatus === 404 && raw?.mode === 'no_match') {
    return {
      mode: 'no_match',
      experiments_used: [],
      recommended: null,
      fields_used: [],
      missing_entities: raw.missing_entities || [],
      run_id: null,
      no_hallucination: true
    };
  }
  const exps = (raw?.selected_experiments || []).map(e => e.experiment_id).filter(Boolean).sort();
  const fields = [...(raw?.fields_used || [])].sort();
  const synthesis = raw?.outputs?.synthesis || '';

  // Extract recommended experiment from conclusion.
  // Hebrew synthesis always ends with the verdict/conclusion naming the winner.
  // Strategy: look at last 200 chars of synthesis for experiment IDs — the
  // last-mentioned ID in the conclusion is the recommended one.
  // Fallback: scan for verdict-word + forward-60-char window to find the winner.
  let recommended = null;

  if (exps.length > 0) {
    // 1. Conclusion scan: last 200 chars of synthesis
    const conclusion = synthesis.slice(-200);
    let lastIdx = -1, lastExp = null;
    for (const exp of exps) {
      const idx = conclusion.lastIndexOf(exp);
      if (idx > lastIdx) { lastIdx = idx; lastExp = exp; }
    }
    if (lastExp) { recommended = lastExp; }

    // 2. Verdict-forward scan (fallback if no exp in last 200 chars)
    if (!recommended) {
      const verdictPhrases = [
        'הניסוי המומלץ', 'הניסוי המנצח', 'יש להשתמש', 'מתאים יותר', 'עדיף',
        'recommended', 'winner', 'should use', 'preferred'
      ];
      for (const phrase of verdictPhrases) {
        const pi = synthesis.indexOf(phrase);
        if (pi === -1) continue;
        const forward = synthesis.slice(pi, pi + 80);
        for (const exp of exps) {
          if (forward.includes(exp)) { recommended = exp; break; }
        }
        if (recommended) break;
      }
    }

    // 3. Last-mentioned overall (final fallback)
    if (!recommended) {
      let lastGlobal = -1, lastGlobalExp = null;
      for (const exp of exps) {
        const idx = synthesis.lastIndexOf(exp);
        if (idx > lastGlobal) { lastGlobal = idx; lastGlobalExp = exp; }
      }
      recommended = lastGlobalExp;
    }
  }

  const no_hallucination = recommended == null || exps.includes(recommended);

  return {
    mode: 'result',
    experiments_used: exps,
    recommended,
    fields_used: fields,
    run_id: raw?.run_id ?? null,
    no_hallucination
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. GROUND TRUTH — fetch directly from lab_experiments via SQL
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(72));
console.log('STEP 1 — Building ground_truth.json from direct SQL');
console.log('═'.repeat(72));

const GT_EXPERIMENTS = ['EXP-004','EXP-006','EXP-007','EXP-009'];
const { rows: gtRows } = await db.query(`
  SELECT experiment_id,
         expansion_ratio, adhesion, viscosity, char_quality,
         experiment_outcome, formula
  FROM lab_experiments
  WHERE project_id = $1
    AND experiment_id = ANY($2)
  ORDER BY experiment_id
`, [PROJECT_ID, GT_EXPERIMENTS]);

const groundTruth = {};
for (const row of gtRows) {
  groundTruth[row.experiment_id] = row;
  console.log(`  ${row.experiment_id}: expansion=${row.expansion_ratio} adhesion=${row.adhesion} viscosity=${row.viscosity} outcome=${row.experiment_outcome}`);
}
writeFileSync('ground_truth.json', JSON.stringify(groundTruth, null, 2));
console.log(`\n  Saved ground_truth.json (${gtRows.length} experiments)`);

// ══════════════════════════════════════════════════════════════════════════════
// 2. DEFINE 5 QUERIES + expected ground_truth answer
// ══════════════════════════════════════════════════════════════════════════════
const QUERIES = [
  {
    id: 'Q1',
    text: 'Compare EXP-004 and EXP-007 across expansion_ratio, adhesion, and viscosity. Which should be used for high-adhesion production requirements?',
    experiments: ['EXP-004','EXP-007'],
    expected_winner: 'EXP-004',
    expected_mode: 'result',
    rationale: 'EXP-004 adhesion=92 > EXP-007 adhesion=68; outcome=success vs partial; wins on all 3 metrics'
  },
  {
    id: 'Q2',
    text: 'Which experiment has the strictly higher expansion_ratio numeric value: EXP-009 or EXP-006? Report both values and name the winner.',
    experiments: ['EXP-006','EXP-009'],
    expected_winner: 'EXP-009',
    expected_mode: 'result',
    rationale: 'EXP-009 expansion_ratio=27.1 > EXP-006 expansion_ratio=23.8 — pure numeric comparison'
  },
  {
    id: 'Q3',
    text: 'Compare EXP-006 and EXP-004 on adhesion and viscosity. Which has higher values on both metrics and is better for high-viscosity applications?',
    experiments: ['EXP-004','EXP-006'],
    expected_winner: 'EXP-006',
    expected_mode: 'result',
    rationale: 'EXP-006 adhesion=95 > EXP-004 adhesion=92; EXP-006 viscosity=1560 > EXP-004 viscosity=1480; EXP-006 wins on both'
  },
  {
    id: 'Q4',
    text: 'Compare EXP-007 and EXP-009 on production suitability based on experiment_outcome and expansion_ratio.',
    experiments: ['EXP-007','EXP-009'],
    expected_winner: 'EXP-009',
    expected_mode: 'result',
    rationale: 'EXP-009 outcome=success expansion=27.1; EXP-007 outcome=partial expansion=11.5'
  },
  {
    id: 'Q5',
    text: 'Compare EXP-999 and EXP-888 expansion ratio and adhesion.',
    experiments: [],
    expected_winner: null,
    expected_mode: 'no_match',
    rationale: 'Neither experiment exists in lab_experiments — must return NO_MATCH'
  }
];

// ══════════════════════════════════════════════════════════════════════════════
// 3. RUN 15 RUNS (5 queries × 3 each)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(72));
console.log('STEP 2 — Running 15 runs (5 queries × 3 each)');
console.log('═'.repeat(72));

const allRuns = {};  // queryId → [{run_number, raw, structured, timestamp}]

for (const q of QUERIES) {
  allRuns[q.id] = [];
  console.log(`\n  ${q.id}: "${q.text.slice(0,70)}..."`);
  for (let run = 1; run <= 3; run++) {
    process.stdout.write(`    Run ${run}/3 ... `);
    const t0 = Date.now();
    const { sessionId, httpStatus, raw } = await runOnce(q.text);
    const ms = Date.now() - t0;
    const structured = normalize(raw, httpStatus);
    allRuns[q.id].push({ run_number: run, session_id: sessionId, http_status: httpStatus, duration_ms: ms, raw, structured });
    console.log(`done (${ms}ms, run_id=${structured.run_id}, mode=${structured.mode}, recommended=${structured.recommended})`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. DETERMINISM REPORT
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(72));
console.log('STEP 3 — Determinism Report (3 runs per query must agree)');
console.log('═'.repeat(72));

const determinismReport = {};

for (const q of QUERIES) {
  const runs = allRuns[q.id];
  const modes        = runs.map(r => r.structured.mode);
  const recommended  = runs.map(r => r.structured.recommended);
  const expSets      = runs.map(r => r.structured.experiments_used.join(','));

  const modeConsistent   = new Set(modes).size === 1;
  const recConsistent    = new Set(recommended).size === 1;
  const expsConsistent   = new Set(expSets).size === 1;
  const deterministic    = modeConsistent && recConsistent && expsConsistent;

  determinismReport[q.id] = {
    query_text: q.text,
    runs: runs.map(r => ({
      run_number: r.run_number,
      run_id: r.structured.run_id,
      mode: r.structured.mode,
      recommended: r.structured.recommended,
      experiments_used: r.structured.experiments_used,
      fields_used: r.structured.fields_used,
      no_hallucination: r.structured.no_hallucination
    })),
    deterministic,
    mode_consistent: modeConsistent,
    recommendation_consistent: recConsistent,
    experiments_consistent: expsConsistent
  };

  const status = deterministic ? '✓ DETERMINISTIC' : '✗ NON-DETERMINISTIC';
  console.log(`\n  ${q.id} — ${status}`);
  console.log(`    modes       : [${modes.join(', ')}] ${modeConsistent?'(consistent)':'(VARY!)'}`);
  console.log(`    recommended : [${recommended.join(', ')}] ${recConsistent?'(consistent)':'(VARY!)'}`);
  console.log(`    exp sets    : [${expSets.join(' | ')}] ${expsConsistent?'(consistent)':'(VARY!)'}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. GROUND TRUTH COMPARISON
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(72));
console.log('STEP 4 — Ground Truth Comparison: system_output vs SQL ground_truth');
console.log('═'.repeat(72));

const gtComparison = {};

for (const q of QUERIES) {
  const sampleRun = allRuns[q.id][0]; // use run 1 as sample (all 3 should match after determinism check)
  const struct     = sampleRun.structured;

  if (q.expected_mode === 'no_match') {
    const modeCorrect = struct.mode === 'no_match';
    const runIdNull   = struct.run_id === null;
    gtComparison[q.id] = {
      expected_mode: 'no_match',
      actual_mode: struct.mode,
      mode_match: modeCorrect,
      run_id_null: runIdNull,
      pass: modeCorrect && runIdNull
    };
    console.log(`\n  ${q.id}: mode=${struct.mode} run_id=${struct.run_id}`);
    console.log(`    ${gtComparison[q.id].pass ? '✓ PASS' : '✗ FAIL'} (expected no_match, no agents run)`);
    continue;
  }

  // Verify recommended experiment matches ground truth winner
  const recCorrect = struct.recommended === q.expected_winner;

  // Verify system used actual DB values (check selected_experiments against ground_truth)
  const valueChecks = [];
  for (const expId of struct.experiments_used) {
    const gt = groundTruth[expId];
    const sysExp = sampleRun.raw?.selected_experiments?.find(e => e.experiment_id === expId);
    if (!gt || !sysExp) continue;
    const checks = [
      { field: 'expansion_ratio', gt: Number(gt.expansion_ratio), sys: Number(sysExp.expansion_ratio) },
      { field: 'adhesion',        gt: Number(gt.adhesion),        sys: Number(sysExp.adhesion) },
      { field: 'viscosity',       gt: Number(gt.viscosity),       sys: Number(sysExp.viscosity) }
    ];
    for (const c of checks) {
      if (!isNaN(c.gt) && !isNaN(c.sys)) {
        const match = Math.abs(c.gt - c.sys) < 0.01;
        valueChecks.push({ experiment: expId, field: c.field, gt: c.gt, sys: c.sys, match });
      }
    }
  }

  const allValuesMatch = valueChecks.every(c => c.match);
  const pass = recCorrect && allValuesMatch && determinismReport[q.id].deterministic;

  gtComparison[q.id] = {
    expected_winner: q.expected_winner,
    actual_winner: struct.recommended,
    recommendation_match: recCorrect,
    rationale: q.rationale,
    value_checks: valueChecks,
    all_values_match: allValuesMatch,
    deterministic: determinismReport[q.id].deterministic,
    pass
  };

  console.log(`\n  ${q.id}: expected_winner=${q.expected_winner} actual_winner=${struct.recommended}`);
  for (const c of valueChecks) {
    console.log(`    ${c.match?'✓':'✗'} ${c.experiment}.${c.field}: GT=${c.gt} SYS=${c.sys}`);
  }
  console.log(`    ${pass ? '✓ PASS' : '✗ FAIL'} (rec_match=${recCorrect} values_match=${allValuesMatch} deterministic=${determinismReport[q.id].deterministic})`);
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. FINAL REPORT
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(72));
console.log('FINAL REPORT — Phase 1 Validation Protocol');
console.log('═'.repeat(72));

const finalReport = {
  protocol: 'Phase 1 Formal Validation',
  timestamp: new Date().toISOString(),
  science_backend: SCIENCE_BASE,
  total_runs: 15,
  queries: QUERIES.map(q => ({
    id: q.id,
    text: q.text,
    expected_mode: q.expected_mode,
    expected_winner: q.expected_winner,
    rationale: q.rationale,
    runs: determinismReport[q.id].runs,
    deterministic: determinismReport[q.id].deterministic,
    ground_truth_comparison: gtComparison[q.id],
    pass: gtComparison[q.id].pass
  }))
};

const passCount = finalReport.queries.filter(q => q.pass).length;
const allPass   = passCount === QUERIES.length;

console.log(`\n  Query | Deterministic | GT Match | PASS/FAIL`);
console.log(`  ─────────────────────────────────────────────`);
for (const q of finalReport.queries) {
  const det  = determinismReport[q.id].deterministic ? '✓ yes' : '✗ NO';
  const gtm  = q.ground_truth_comparison.recommendation_match != null
    ? (q.ground_truth_comparison.recommendation_match || q.ground_truth_comparison.pass ? '✓ yes' : '✗ NO')
    : '✓ yes (no-match)';
  const pf   = q.pass ? '✅ PASS' : '❌ FAIL';
  console.log(`  ${q.id}    | ${det.padEnd(13)} | ${gtm.padEnd(8)} | ${pf}`);
}

console.log(`\n  Total: ${passCount}/${QUERIES.length} queries PASS`);
console.log(`  Overall: ${allPass ? '✅ ALL PASS — Phase 1 VALIDATED' : '❌ SOME FAIL — see details'}`);

// Save full report to JSON
writeFileSync('validation_report.json', JSON.stringify(finalReport, null, 2));
console.log('\n  Saved validation_report.json');
console.log('  Saved ground_truth.json');
console.log('═'.repeat(72));

await db.end();
process.exit(allPass ? 0 : 1);
