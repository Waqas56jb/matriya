/**
 * Task 7 — Real Data Closed Loop (System Validation)
 * 3 cycles — previous result feeds next query — no hardcoded values except
 * evaluation thresholds.
 *
 * TRADEOFF DEFINITION (data-adaptive):
 *   expansion_ratio > 20  AND  adhesion < 95
 * (expansion_ratio > 20 = significant expansion achieved;
 *  adhesion < 95 = not at the maximum adhesion ceiling yet)
 *
 * Cycle 1: "top 5 by expansion_ratio"
 * Cycle 2: built from Cycle 1 APP:PER
 *   tradeoff=true  → "highest adhesion where APP:PER < {C1_appPer}"
 *   tradeoff=false → "top 5 by expansion_ratio where APP:PER >= {C1_appPer}"
 * Cycle 3: built from Cycle 2 APP:PER (same logic)
 */
import http from 'http';

const BASE_HOST = 'localhost';
const BASE_PORT = 8000;
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0dmVyaWZ5IiwiZXhwIjoxNzc5NjczNzA0LCJpYXQiOjE3NzcwODE3MDR9.28BbToGkQjSCeeIa9oJU2hzOtAxDHxNHCPxzKIdk7Yk';

// ── HTTP helper ──────────────────────────────────────────────────────────────
function post(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname: BASE_HOST, port: BASE_PORT, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${TOKEN}`
      },
      timeout: 35000
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { reject(new Error(`JSON parse failed: ${raw.slice(0, 300)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out after 35s')); });
    req.write(payload);
    req.end();
  });
}

function pickNum(row, ...keys) {
  for (const k of keys) { const v = parseFloat(row[k]); if (!isNaN(v)) return v; }
  return null;
}

// Select top row by expansion_ratio from response rows
function topByExpansion(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.reduce((best, r) => {
    return (pickNum(r, 'expansion_ratio') ?? -Infinity) > (pickNum(best, 'expansion_ratio') ?? -Infinity) ? r : best;
  }, rows[0]);
}

function computeTradeoff(row) {
  const exp = pickNum(row, 'expansion_ratio');
  const adh = pickNum(row, 'adhesion');
  if (exp === null || adh === null) return false;
  // tradeoff = high expansion achieved but not at adhesion ceiling yet
  return exp > 20 && adh < 95;
}

const DIV = '═'.repeat(72);
function printCycle(num, query, resp, extracted) {
  console.log(`\n${DIV}\nCYCLE ${num} — QUERY: "${query}"\n${DIV}`);
  console.log('\n[RAW BACKEND JSON]');
  console.log(JSON.stringify(resp.body, null, 2));
  console.log('\n[EXTRACTED]');
  console.log(`  experiment_id  : ${extracted.experiment_id}`);
  console.log(`  expansion_ratio: ${extracted.expansion_ratio}`);
  console.log(`  adhesion       : ${extracted.adhesion}`);
  console.log(`  APP:PER        : ${extracted.appPer}`);
  console.log(`  tradeoff       : ${extracted.tradeoff}  (expansion_ratio > 20 AND adhesion < 95)`);
}

// ── CYCLE 1 ──────────────────────────────────────────────────────────────────
const q1 = 'top 5 by expansion_ratio';
console.log(`\nCYCLE 1 → sending: "${q1}"`);
const r1 = await post('/ask-matriya', { message: q1, filenames: [] });
if (!r1.body?.data?.rows?.length) {
  console.error('CYCLE 1 FAILED'); console.log(JSON.stringify(r1.body, null, 2)); process.exit(1);
}
const row1 = topByExpansion(r1.body.data.rows);
const exp1 = {
  experiment_id: row1.experiment_id ?? '?',
  expansion_ratio: pickNum(row1, 'expansion_ratio'),
  adhesion: pickNum(row1, 'adhesion'),
  appPer: pickNum(row1, 'APP:PER', 'app_per'),
};
exp1.tradeoff = computeTradeoff(row1);
printCycle(1, q1, r1, exp1);
if (exp1.appPer === null) { console.error('C1 APP:PER null'); process.exit(1); }

// ── CYCLE 2 — query built from C1 APP:PER ────────────────────────────────────
// tradeoff=true  → find best adhesion among lower APP:PER experiments
// tradeoff=false → find best expansion among experiments at the same APP:PER tier (>=)
const q2 = exp1.tradeoff
  ? `highest adhesion where APP:PER < ${exp1.appPer}`
  : `top 5 by expansion_ratio where APP:PER >= ${exp1.appPer}`;
console.log(`\nCYCLE 2 → sending: "${q2}"`);
console.log(`           (C1 tradeoff=${exp1.tradeoff}, C1 APP:PER=${exp1.appPer})`);
const r2 = await post('/ask-matriya', { message: q2, filenames: [] });
if (!r2.body?.data?.rows?.length) {
  console.error('CYCLE 2 FAILED'); console.log(JSON.stringify(r2.body, null, 2)); process.exit(1);
}
const row2 = topByExpansion(r2.body.data.rows);
const exp2 = {
  experiment_id: row2.experiment_id ?? '?',
  expansion_ratio: pickNum(row2, 'expansion_ratio'),
  adhesion: pickNum(row2, 'adhesion'),
  appPer: pickNum(row2, 'APP:PER', 'app_per'),
};
exp2.tradeoff = computeTradeoff(row2);
printCycle(2, q2, r2, exp2);
if (exp2.appPer === null) { console.error('C2 APP:PER null'); process.exit(1); }

// ── CYCLE 3 — query built from C2 APP:PER ────────────────────────────────────
const q3 = exp2.tradeoff
  ? `highest adhesion where APP:PER < ${exp2.appPer}`
  : `top 5 by expansion_ratio where APP:PER >= ${exp2.appPer}`;
console.log(`\nCYCLE 3 → sending: "${q3}"`);
console.log(`           (C2 tradeoff=${exp2.tradeoff}, C2 APP:PER=${exp2.appPer})`);
const r3 = await post('/ask-matriya', { message: q3, filenames: [] });
if (!r3.body?.data?.rows?.length) {
  console.error('CYCLE 3 FAILED'); console.log(JSON.stringify(r3.body, null, 2)); process.exit(1);
}
const row3 = topByExpansion(r3.body.data.rows);
const exp3 = {
  experiment_id: row3.experiment_id ?? '?',
  expansion_ratio: pickNum(row3, 'expansion_ratio'),
  adhesion: pickNum(row3, 'adhesion'),
  appPer: pickNum(row3, 'APP:PER', 'app_per'),
};
exp3.tradeoff = computeTradeoff(row3);
printCycle(3, q3, r3, exp3);

// ── CLOSED-LOOP VALIDATION ───────────────────────────────────────────────────
console.log(`\n${DIV}\nCLOSED-LOOP VALIDATION SUMMARY\n${DIV}`);
console.log(`C1 experiment: ${exp1.experiment_id}  | query: "${q1}"`);
console.log(`C2 experiment: ${exp2.experiment_id}  | query: "${q2}"  (embeds C1 APP:PER=${exp1.appPer})`);
console.log(`C3 experiment: ${exp3.experiment_id}  | query: "${q3}"  (embeds C2 APP:PER=${exp2.appPer})`);
console.log('');

const validations = [
  ['Queries change between all cycles',       q1 !== q2 && q2 !== q3],
  ['C2 query embeds C1 APP:PER value',        q2.includes(String(exp1.appPer))],
  ['C3 query embeds C2 APP:PER value',        q3.includes(String(exp2.appPer))],
  ['C2 experiment differs from C1',           exp2.experiment_id !== exp1.experiment_id],
  ['C3 experiment differs from C2',           exp3.experiment_id !== exp2.experiment_id],
  ['All responses have trigger_id (live API)', !!(r1.body?.trigger_id && r2.body?.trigger_id && r3.body?.trigger_id)],
  ['C1 trigger_id unique',                    r1.body?.trigger_id !== r2.body?.trigger_id],
  ['C2 trigger_id unique',                    r2.body?.trigger_id !== r3.body?.trigger_id],
];

let allPass = true;
for (const [label, pass] of validations) {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}`);
  if (!pass) allPass = false;
}
console.log(allPass ? `\nRESULT: CLOSED LOOP VALIDATED` : `\nRESULT: VALIDATION FAILED — see FAIL lines above`);
